import asyncio
import json
import logging
import re
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional
import httpx
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    WebSocket,
)
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from websockets.asyncio.client import connect

from config import OPENAI_API_KEY

from utils.auth import (
    RoleplayContext,
    _verify_token,
    _build_request_auth_from_verified_claims,
    get_roleplay_context,
    require_addon,
)

from utils.db import roleplay_db
from utils.db.permissions import check_user_permission
from ai.model_manager import ModelManager
from ai.ai_gateway import AI
from ai.cost_calculator import CostCalculator
from ai.types import AIRequest, UsageLog
from ai.usage_tracker import UsageTracker
router = APIRouter(
    prefix="/roleplay",
    tags=["Roleplay"],
    dependencies=[Depends(require_addon("role_play"))]
)

ws_router = APIRouter(
    prefix="/roleplay",
    tags=["Roleplay"],
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
# OPENAI_REALTIME_URL = f"wss://api.openai.com/v1/realtime?model={OPENAI_REALTIME_MODEL}"

# ============================================================
# Request Models
# ============================================================

# ------------------------------------------------------------
# Scenario Models
# ------------------------------------------------------------

class EvaluationParameter(BaseModel):
    name: str
    description: str
    weight: float


class CreateScenarioRequest(BaseModel):
    title: str
    description: Optional[str] = None
    learnerBrief: str
    aiRole: str
    aiPersonality: Optional[str] = None
    aiObjectives: Optional[str] = None
    endConditions: Optional[str] = None
    maxDuration: Optional[int] = 15
    minTurns: Optional[int] = 5
    evaluationParameters: List[EvaluationParameter]
    cutoffScore: Optional[int] = 60
    difficulty: Optional[str] = "Medium"
    tone: Optional[str] = "Neutral"
    userRole: str
    initialPrompt: str


class UpdateScenarioRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    learnerBrief: Optional[str] = None
    aiRole: Optional[str] = None
    aiPersonality: Optional[str] = None
    aiObjectives: Optional[str] = None
    endConditions: Optional[str] = None
    maxDuration: Optional[int] = None
    minTurns: Optional[int] = None
    evaluationParameters: Optional[List[EvaluationParameter]] = None
    cutoffScore: Optional[int] = None
    difficulty: Optional[str] = None
    tone: Optional[str] = None
    userRole: Optional[str] = None
    initialPrompt: Optional[str] = None


# ------------------------------------------------------------
# Assignment Models
# ------------------------------------------------------------

class AssignScenarioRequest(BaseModel):
    assignment_type: Literal['function', 'sub_function', 'user']
    target_ids: List[str]


class DeleteScenarioRequest(BaseModel):
    scenario_id: str


# ------------------------------------------------------------
# Session Models
# ------------------------------------------------------------

class CreateSessionRequest(BaseModel):
    employee_id: str
    scenario_id: str
    scenario_title: str
    scenario_role: str
    scenario_difficulty: str
    module_id: Optional[str] = None


class UpdateSessionRequest(BaseModel):
    messages: List[Dict[str, Any]]
    is_completed: bool = False

class FinishSessionRequest(BaseModel):
    session_id: str
    
class AssessmentParameter(BaseModel):
    name: str
    score: int
    feedback: str


# class CreateAssessmentRequest(BaseModel):
#     session_id: str
#     employee_id: str
#     overallScore: int
#     summary: str
#     parameters: List[AssessmentParameter]
#     recommendations: List[str]
    
    
def fallback_assessment(summary: str) -> JSONResponse:
    return JSONResponse(
        content={
            "success": True,
            "data": {
                "overallScore": 50,
                "summary": summary,
                "parameters": [
                    {"name": "Communication Clarity", "score": 50, "feedback": "Assessment pending"},
                    {"name": "Objection Handling", "score": 50, "feedback": "Assessment pending"},
                    {"name": "Value Proposition", "score": 50, "feedback": "Assessment pending"},
                    {"name": "Active Listening", "score": 50, "feedback": "Assessment pending"},
                    {"name": "Confidence & Professionalism", "score": 50, "feedback": "Assessment pending"},
                ],
                "recommendations": [
                    "Your practice session was recorded successfully.",
                    "Try again later to get a detailed assessment.",
                    "Contact support if the issue persists.",
                    "Your progress is being tracked.",
                ],
            },
            "message": "Assessment generated with fallback response",
        },
        status_code=200,
    )

def build_system_prompt(scenario_context: dict) -> str:
    tone_instructions = {
        "Friendly": "Be warm, encouraging, and supportive. Show enthusiasm and positivity.",
        "Neutral": "Maintain a professional and balanced demeanor.",
        "Aggressive": "Be challenging, skeptical, and push back on ideas.",
    }
    tone = scenario_context.get("tone", "Neutral")
    tone_instruction = tone_instructions.get(tone, tone_instructions["Neutral"])

    scenario_role = scenario_context.get("scenario_role") or "role-play character"
    user_role = scenario_context.get("user_role") or "learner"
    initial_prompt = scenario_context.get("initial_prompt") or ""
    ai_personality = scenario_context.get("ai_personality") or ""
    ai_objectives = scenario_context.get("ai_objectives") or ""

    return f"""You are an AI actor in a role-play simulation.

YOUR ROLE: You are playing the {scenario_role}.
THE USER'S ROLE: The human is playing the {user_role}.
SCENARIO: "{scenario_context.get('scenario_title')}"

CRITICAL INSTRUCTIONS:
- You must ONLY speak and act as the {scenario_role}.
- NEVER play the user's role.
- Wait for the user to respond before speaking again.
- Keep your responses short, conversational, and natural (1-2 sentences).
- Do not provide coaching, evaluation, or advice. Just stay in character.
- Raise realistic objections or concerns based on the scenario.

CHARACTER TONE: {tone_instruction}
AI character personality/context: {ai_personality}
AI character objective: {ai_objectives}"""


# ============================================================
# Scenario CRUD
# ============================================================

@router.post("/scenarios")
async def create_scenario(
    request_data: CreateScenarioRequest,
    ctx: RoleplayContext = Depends(get_roleplay_context)
):
    """
    Create a new custom roleplay scenario
    """
    try:
        company_id = ctx.company_id

        is_admin = await check_user_permission(ctx.user_id, "admin")
        is_super_admin = await check_user_permission(ctx.user_id, "super_admin")
        is_developer = await check_user_permission(ctx.user_id, "developer")

        if not (is_admin or is_super_admin or is_developer):
            raise HTTPException(
                status_code=403,
                detail="Only administrators can create roleplay scenarios."
            )
            
        # Convert Pydantic models to dictionaries
        evaluation_params = [
            {
                "name": param.name,
                "description": param.description,
                "weight": param.weight
            }
            for param in request_data.evaluationParameters
        ]

        # Prepare payload for Supabase
        payload = {
            "title": request_data.title,
            "description": request_data.description,
            "learnerBrief": request_data.learnerBrief,
            "role": request_data.aiRole,
            "aiPersonality": request_data.aiPersonality,
            "aiObjective": [request_data.aiObjectives] if request_data.aiObjectives else None,
            "endConditions": [request_data.endConditions] if request_data.endConditions else None,
            "maxDuration": [request_data.maxDuration] if request_data.maxDuration else None,
            "minTurns": [request_data.minTurns] if request_data.minTurns else None,
            "evaluationParams": evaluation_params,  # Use cleaned dictionary list
            "passingScore": [request_data.cutoffScore] if request_data.cutoffScore else None,
            "difficulty": request_data.difficulty,
            "tone": request_data.tone,
            "userRole": request_data.userRole,
            "initialPrompt": request_data.initialPrompt,
            "company_id": company_id,
        }

        # Insert into Supabase
        result = roleplay_db.create_scenario(payload)

        if result.data:
            return {
                "success": True,
                "data": result.data[0] if isinstance(result.data, list) else result.data,
                "message": "Scenario created successfully"
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to create scenario")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating scenario: {str(e)}")


@router.put("/scenarios/{scenario_id}")
async def update_scenario(
    scenario_id: str,
    request_data: UpdateScenarioRequest,
    ctx: RoleplayContext = Depends(get_roleplay_context)
):
    """
    Update an existing custom roleplay scenario
    """
    try:
        company_id = ctx.company_id
        
        is_admin = await check_user_permission(ctx.user_id, "admin")
        is_super_admin = await check_user_permission(ctx.user_id, "super_admin")
        is_developer = await check_user_permission(ctx.user_id, "developer")

        if not (is_admin or is_super_admin or is_developer):
            raise HTTPException(
                status_code=403,
                detail="Only administrators can update roleplay scenarios."
            )
        # Verify ownership
        roleplay_db.require_company_scenario(scenario_id, company_id)

        # Prepare update payload (only include non-None fields)
        payload = {}
        
        if request_data.title is not None:
            payload["title"] = request_data.title
        if request_data.description is not None:
            payload["description"] = request_data.description
        if request_data.learnerBrief is not None:
            payload["learnerBrief"] = request_data.learnerBrief
        if request_data.aiRole is not None:
            payload["role"] = request_data.aiRole
        if request_data.aiPersonality is not None:
            payload["aiPersonality"] = request_data.aiPersonality
        if request_data.aiObjectives is not None:
            payload["aiObjective"] = [request_data.aiObjectives]
        if request_data.endConditions is not None:
            payload["endConditions"] = [request_data.endConditions]
        if request_data.maxDuration is not None:
            payload["maxDuration"] = [request_data.maxDuration]
        if request_data.minTurns is not None:
            payload["minTurns"] = [request_data.minTurns]
        if request_data.evaluationParameters is not None:
            # Convert Pydantic models to dictionaries
            evaluation_params = [
                {
                    "name": param.name,
                    "description": param.description,
                    "weight": param.weight
                }
                for param in request_data.evaluationParameters
            ]
            payload["evaluationParams"] = evaluation_params
        if request_data.cutoffScore is not None:
            payload["passingScore"] = [request_data.cutoffScore]
        if request_data.difficulty is not None:
            payload["difficulty"] = request_data.difficulty
        if request_data.tone is not None:
            payload["tone"] = request_data.tone
        if request_data.userRole is not None:
            payload["userRole"] = request_data.userRole
        if request_data.initialPrompt is not None:
            payload["initialPrompt"] = request_data.initialPrompt

        # Update in Supabase
        result = roleplay_db.update_scenario(scenario_id, payload)

        if result.data:
            return {
                "success": True,
                "data": result.data[0] if isinstance(result.data, list) else result.data,
                "message": "Scenario updated successfully"
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to update scenario")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error updating scenario: {str(e)}")


@router.delete("/scenarios/{scenario_id}")
async def delete_scenario(
    scenario_id: str,
    ctx: RoleplayContext = Depends(get_roleplay_context)
):
    """
    Delete a custom roleplay scenario
    """
    try:
        company_id = ctx.company_id
        
        is_admin = await check_user_permission(ctx.user_id, "admin")
        is_super_admin = await check_user_permission(ctx.user_id, "super_admin")
        is_developer = await check_user_permission(ctx.user_id, "developer")

        if not (is_admin or is_super_admin or is_developer):
            raise HTTPException(
                status_code=403,
                detail="Only administrators can delete roleplay scenarios."
            )

        # Verify ownership
        roleplay_db.require_company_scenario(scenario_id, company_id)

        # Delete from Supabase
        result = roleplay_db.delete_scenario(scenario_id)

        return {
            "success": True,
            "data": None,
            "message": "Scenario deleted successfully"
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting scenario: {str(e)}")


@router.get("/user-data/{user_email}")
async def fetch_user_data(
    user_email: str,
):
    """
    Fetch user data (user_id and company_id) by email
    """
    try:
        if not user_email:
            raise HTTPException(status_code=400, detail="User email required")

        # Fetch user data from Supabase
        result = roleplay_db.get_user_by_email(user_email)

        if result.data and len(result.data) > 0:
            return {
                "success": True,
                "data": result.data[0],
                "message": "User data fetched successfully"
            }
        else:
            raise HTTPException(status_code=404, detail="User not found")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching user data: {str(e)}")
    
    
@router.get("/scenarios")
async def fetch_scenarios_for_user(
    is_admin: bool = Query(False),
    ctx: RoleplayContext = Depends(get_roleplay_context)
):
    """
    Fetch scenarios for a user (admin gets all, regular users get assigned)
    Supports Authorization Bearer token or X-User-ID header
    Query: is_admin (boolean)
    """
    try:
        user_id = ctx.user_id
        # print("Auth context for scenario fetch:", auth_ctx)
        if not user_id:
            raise HTTPException(status_code=401, detail="Authentication required")
        
        # Admin gets all scenarios
        if is_admin:
            db_scenarios, error = roleplay_db.fetch_all_scenarios(ctx.company_id)
            # print("Fetched all scenarios for admin:", db_scenarios)
            
            if error:
                raise HTTPException(status_code=500, detail=error['message'])
            
            normalized = [roleplay_db.normalize_scenario(s) for s in (db_scenarios or [])]
            return {
                'success': True,
                'data': normalized,
                'message': 'Scenarios fetched successfully'
            }
        
        # Regular user gets assigned scenarios
        assigned_ids, error = roleplay_db.get_assigned_scenario_ids_for_user(user_id)
        # print("Assigned scenario IDs for user:", assigned_ids)
        
        if error:
            # Fall back to returning no custom scenarios
            return {
                'success': True,
                'data': [],
                'message': 'No assigned scenarios found'
            }
        
        if not assigned_ids:
            return {
                'success': True,
                'data': [],
                'message': 'No assigned scenarios found'
            }
        
        # Fetch assigned scenarios
        result = roleplay_db.get_scenarios_by_ids(assigned_ids)
        

        # print(result)
        assigned_scenarios = result.data or []
        normalized = [roleplay_db.normalize_scenario(s) for s in assigned_scenarios]
        # print("These are the assigned_scenarios:", assigned_scenarios)
        return {
            'success': True,
            'data': normalized,
            'message': 'Scenarios fetched successfully'
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/scenarios/{scenario_id}/assignments")
async def assign_scenario_to_targets(
    scenario_id: str,
    request_data: AssignScenarioRequest,
    ctx: RoleplayContext = Depends(get_roleplay_context)
):
    """
    Assign a scenario to departments, sub-departments, or users
    """
    try:
        assignment_type = request_data.assignment_type
        target_ids = request_data.target_ids
        company_id = ctx.company_id

        roleplay_db.require_company_scenario(scenario_id, company_id)
        
        if not target_ids:
            raise HTTPException(status_code=400, detail="No targets provided")
        
        effective_target_ids = target_ids.copy()
        
        # Validate user assignments
        if assignment_type == 'user':
            for target_user_id in target_ids:
                # Get user's company and functions
                user_meta, error = roleplay_db.get_user_company_and_functions(target_user_id)
                if error:
                    raise HTTPException(status_code=400, detail=error['message'])
                
                target_company_id = user_meta.get('company_id')
                target_function_id = user_meta.get('function_id')
                target_sub_function_id = user_meta.get('sub_function_id')
                
                # Get company limits
                company_limits, error = roleplay_db.get_company_roleplay_limits(target_company_id)
                if error:
                    raise HTTPException(status_code=500, detail="Unable to fetch company roleplay limits")
                
                roleplay_limit = company_limits.get('roleplayLimit', 5)
                
                if roleplay_limit <= 0:
                    raise HTTPException(status_code=400, detail="Roleplay assignment limit is 0 for this company")
                
                # Get existing assignments
                assigned_ids, error = roleplay_db.get_distinct_assigned_scenario_ids_for_user(
                    target_user_id,
                    target_company_id,
                    target_function_id,
                    target_sub_function_id
                )
                
                if error:
                    raise HTTPException(status_code=500, detail=error.get("Unable to verify existing assignments", str(error)))
                
                is_already_assigned = scenario_id in assigned_ids
                if not is_already_assigned and len(assigned_ids) >= roleplay_limit:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Cannot assign more roleplays. User has reached limit of {roleplay_limit}"
                    )
            
            # Check for duplicate assignments
            existing_result = roleplay_db.get_existing_assignments(scenario_id, company_id, assignment_type, effective_target_ids)
            
            existing_user_ids = set(a.get('user_id') for a in (existing_result.data or []))
            effective_target_ids = [id for id in target_ids if id not in existing_user_ids]
            
            if not effective_target_ids:
                return {
                    'success': True,
                    'data': [],
                    'message': 'All selected users already have this scenario assigned'
                }
        
        # Create assignment records
        assignments = []
        for target_id in effective_target_ids:
            assignment = {
                'scenario_id': scenario_id,
                'assignment_type': assignment_type,
                'user_id': target_id if assignment_type == 'user' else None,
                'target_id': target_id if assignment_type != 'user' else None,
                'company_id': company_id,
                'assigned_at': __import__('datetime').datetime.utcnow().isoformat() + 'Z',
            }
            assignments.append(assignment)
        
        # Insert assignments
        insert_result = roleplay_db.create_scenario_assignments(assignments)
        
        return {
            'success': True,
            'data': insert_result.data or [],
            'message': f'Scenario assigned to {len(effective_target_ids)} target(s)'
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/scenarios/assignments/{scenario_id}")
async def get_scenario_assignments(
    scenario_id: str,
    ctx: RoleplayContext = Depends(get_roleplay_context)
):
    """
    Get all assignments for a scenario
    """
    try:
        
        # result = supabase.table("scenario_assignments").select("*").eq(
        #     "scenario_id", scenario_id
        # ).execute()
        roleplay_db.require_company_scenario(scenario_id, ctx.company_id)
        result = roleplay_db.get_scenario_assignments(scenario_id, ctx.company_id)
        
        return {
            'success': True,
            'data': result.data or [],
            'message': 'Scenario assignments fetched successfully'
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/assignment-targets")
async def get_assignment_targets(
    ctx: RoleplayContext = Depends(get_roleplay_context)
):
    try:
        functions = roleplay_db.get_functions(ctx.company_id)
        sub_functions = roleplay_db.get_sub_functions(ctx.company_id)
        users = roleplay_db.get_active_company_users(ctx.company_id)

        return {
            "success": True,
            "data": {
                "functions": functions.data or [],
                "sub_functions": sub_functions.data or [],
                "users": users.data or [],
            },
            "message": "Assignment targets fetched successfully"
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=str(e)
        )
# ==================================================
# SESSIONS
# ==================================================

@router.get("/bootstrap")
async def get_roleplay_bootstrap(
    ctx: RoleplayContext = Depends(get_roleplay_context)
):
    try:

        is_admin = await check_user_permission(ctx.user_id, "admin")
        is_super_admin = await check_user_permission(ctx.user_id, "super_admin")
        is_developer = await check_user_permission(ctx.user_id, "developer")

        permissions = {
            "isAdmin": is_admin,
            "isSuperAdmin": is_super_admin,
            "isDeveloper": is_developer,
        }

        company_data = roleplay_db.get_bootstrap_data(ctx.company_id)

        retry_limits = company_data["companyLimits"].get("retryLimit", 3)

        if permissions["isAdmin"] or permissions["isSuperAdmin"] or permissions["isDeveloper"]:
            scenarios = [
                roleplay_db.normalize_scenario(s)
                for s in company_data["scenarios"]
            ]
        else:
            assigned_ids, error = roleplay_db.get_assigned_scenario_ids_for_user(ctx.user_id)
            if error:
                assigned_ids = []

            result = roleplay_db.get_scenarios_by_ids(assigned_ids)

            scenarios = [
                roleplay_db.normalize_scenario(s)
                for s in (result.data or [])
            ]

        return {
            "success": True,
            "data": {
                "scenarios": scenarios,
                "assignmentTargets": company_data["assignmentTargets"],
                "permissions": permissions,
                "retryLimits": {
                    "maxRetries": retry_limits
                },
                "companyLimits": company_data["companyLimits"]
            }
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=str(e)
        )
        
@router.post("/sessions")
async def create_roleplay_session(
    payload: CreateSessionRequest,
    ctx: RoleplayContext = Depends(get_roleplay_context)
):
    try:
        logger.info(
            "[Roleplay Session] user=%s company=%s scenario=%s",
            ctx.user_id,
            ctx.company_id,
            payload.scenario_id,
        )

        # User can only create a session for themselves
        if payload.employee_id != ctx.user_id:
            raise HTTPException(
                status_code=403,
                detail="Not authorized to create sessions for other users"
            )

        # Scenario must belong to the authenticated user's company
        roleplay_db.require_company_scenario(
            payload.scenario_id,
            ctx.company_id
        )

        # Check company retry policy
        roleplay_db.check_retry_limit(
            payload.employee_id,
            payload.scenario_id,
            ctx.company_id
        )

        insert_data = {
            "employee_id": payload.employee_id,
            "scenario_id": payload.scenario_id,
            "scenario_title": payload.scenario_title,
            "scenario_role": payload.scenario_role,
            "scenario_difficulty": payload.scenario_difficulty,
            "conversation_transcript": [],
            "message_count": 0,
            "started_at": datetime.utcnow().isoformat(),
        }

        if payload.module_id:
            insert_data["module_id"] = payload.module_id

        res = roleplay_db.create_roleplay_session(insert_data)

        if not res.data:
            raise HTTPException(
                status_code=500,
                detail="Failed to create session in database"
            )

        return {
            "success": True,
            "data": res.data[0],
            "message": "Session created successfully"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("[Roleplay Session] Failed to create session")
        raise HTTPException(
            status_code=500,
            detail=str(e)
        )
        
@router.put("/sessions/{session_id}")
async def update_roleplay_session(
    session_id: str,
    payload: UpdateSessionRequest,
    ctx: RoleplayContext = Depends(get_roleplay_context)
):
    try:
        update_data = {
            "conversation_transcript": payload.messages,
            "message_count": len(payload.messages)
        }
        if payload.is_completed:
            update_data["completed_at"] = datetime.utcnow().isoformat()

        res = roleplay_db.update_roleplay_session(session_id, update_data)
        if not res.data:
            raise HTTPException(status_code=500, detail="Failed to update session in database")
            
        return {
            "success": True,
            "data": res.data[0],
            "message": "Session updated successfully"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# @router.get("/sessions/employee/{employee_id}")
# async def get_employee_roleplay_sessions(
#     employee_id: str,
#     limit: int = Query(10),
#     ctx: RoleplayContext = Depends(get_roleplay_context),
# ):
#     if employee_id != ctx.user_id:
#         raise HTTPException(
#             status_code=403,
#             detail="Not authorized"
#         )

#     result = roleplay_db.get_employee_roleplay_sessions(
#         employee_id,
#         limit
#     )

#     return {
#         "success": True,
#         "data": result.data or []
#     }
    
# @router.get("/stats/{employee_id}")
# async def get_employee_roleplay_stats(
#     employee_id: str,
#     ctx: RoleplayContext = Depends(get_roleplay_context),
# ):
#     if employee_id != ctx.user_id:
#         raise HTTPException(
#             status_code=403,
#             detail="Not authorized"
#         )

#     stats = roleplay_db.get_employee_roleplay_stats(
#         employee_id
#     )

#     return {
#         "success": True,
#         "data": stats
#     }
    
@router.get("/reports/{employee_id}")
async def get_employee_roleplay_reports(
    employee_id: str,
    limit: int = Query(20),
    ctx: RoleplayContext = Depends(get_roleplay_context),
):
    if employee_id != ctx.user_id:
        raise HTTPException(
            status_code=403,
            detail="Not authorized"
        )

    report = roleplay_db.get_employee_roleplay_reports(
        employee_id,
        limit
    )

    return {
        "success": True,
        "data": report
    }
# @router.post("/assessments/create")
# async def create_roleplay_assessment(
#     payload: CreateAssessmentRequest,
#     ctx: RoleplayContext = Depends(get_roleplay_context)
# ):
#     try:
#         if payload.employee_id != ctx.user_id:
#             raise HTTPException(status_code=403, detail="Not authorized to create assessments for other users")
#         insert_data = {
#             "session_id": payload.session_id,
#             "employee_id": payload.employee_id,
#             "overall_score": payload.overallScore,
#             "summary": payload.summary,
#             "parameters": [p.model_dump() for p in payload.parameters],
#             "recommendations": payload.recommendations
#         }
#         res = roleplay_db.save_roleplay_assessment(insert_data)
#         if not res.data:
#             raise HTTPException(status_code=500, detail="Failed to create assessment in database")
            
#         return {
#             "success": True,
#             "data": res.data[0],
#             "message": "Assessment saved successfully"
#         }
#     except Exception as e:
#         raise HTTPException(status_code=500, detail=str(e))

# ============================================================
# Assessment
# ============================================================

@router.post("/sessions/{session_id}/assessment")
async def generate_assessment(session_id: str, ctx: RoleplayContext = Depends(get_roleplay_context)):
    try:
        logging.info("Assessment request for session_id=%s user_id=%s", session_id, ctx.user_id)

        session_result = roleplay_db.get_roleplay_session(session_id)

        if not session_result.data:
            raise HTTPException(
                status_code=404,
                detail="Roleplay session not found"
            )

        session = session_result.data

        if session.get("employee_id") != ctx.user_id:
            raise HTTPException(status_code=403, detail="Not authorized to access this roleplay session")

        scenario_result = roleplay_db.get_roleplay_scenario(session["scenario_id"])

        if not scenario_result.data:
            raise HTTPException(
                status_code=404,
                detail="Scenario not found"
            )

        scenario = scenario_result.data

        # if not GEMINI_API_KEY:
        #     return JSONResponse(
        #         content={"error": "Gemini API key not configured"},
        #         status_code=500
        #     )

        # print(session)
        messages = session.get("conversation_transcript",[])
        scenario_title = scenario["title"]
        scenario_role = scenario["role"]
        user_role = scenario["userRole"]

        # ✅ Handle both missing and empty messages array
        if messages is None:
            messages = []

        logging.info("Assessment request received with %d messages", len(messages))
        
        # Filter messages
        user_messages = [m for m in messages if m.get("role") == "user"]
        ai_messages = [m for m in messages if m.get("role") == "avatar"]
        
        logging.info("Filtered messages - users: %d, ai: %d, total: %d", len(user_messages), len(ai_messages), len(messages))

        min_exchanges = 3
        min_user_messages = 2

        # Short / incomplete conversation → zero score
        if len(user_messages) < min_user_messages or len(messages) < min_exchanges * 2:
            logging.warning(
                "⚠️ Conversation too short - returning zero score",
                extra={
                    "totalMessages": len(messages),
                    "userMessages": len(user_messages),
                    "aiMessages": len(ai_messages),
                }
            )

            return JSONResponse(
                content={
                    "success": True,
                    "data": {
                        "overallScore": 0,
                        "summary": (
                            "The conversation was ended abruptly or was too short to provide "
                            "a meaningful assessment. Please complete a full roleplay session "
                            "with at least 3-4 exchanges to receive proper feedback."
                        ),
                        "parameters": [
                            {"name": "Communication Clarity", "score": 0,
                             "feedback": "Insufficient conversation to evaluate communication skills."},
                            {"name": "Objection Handling", "score": 0,
                             "feedback": "No sufficient interaction to evaluate objection handling."},
                            {"name": "Value Proposition", "score": 0,
                             "feedback": "Conversation ended before value proposition could be assessed."},
                            {"name": "Active Listening", "score": 0,
                             "feedback": "Insufficient dialogue to assess listening skills."},
                            {"name": "Confidence & Professionalism", "score": 0,
                             "feedback": "Not enough interaction to evaluate confidence and professionalism."},
                        ],
                        "recommendations": [
                            "Complete a full roleplay session without ending it prematurely.",
                            "Engage in at least 4-5 exchanges with the LT to demonstrate your skills.",
                            "Practice maintaining the conversation until a natural conclusion is reached.",
                            "Use the session duration effectively to showcase your abilities.",
                        ],
                    },
                    "message": "Assessment generated successfully",
                }
            )

        learner_role = user_role or "Learner"
        ai_role = scenario_role or "AI Coach"

        transcript = "\n\n".join(
            f"{learner_role if m.get('role') == 'user' else ai_role}: {m.get('text')}"
            for m in messages
        )

#         assessment_prompt = f"""
# You are an expert communication and sales coach analyzing a role-play conversation.

# Scenario: {scenario_title}
# Learner's Role: {learner_role} (the person being evaluated)
# AI Coach's Role: {ai_role} (the practice partner)

# CRITICAL INSTRUCTION: You are evaluating the LEARNER ({learner_role}), NOT the AI Coach.

# Conversation Transcript:
# {transcript}

# Analyze the LEARNER's performance and provide a detailed assessment in this EXACT JSON format:

# {{
#   "overallScore": <number between 0-100>,
#   "summary": "<detailed summary of overall performance>",
#   "parameters": [
#     {{
#       "name": "Communication Clarity",
#       "score": <number between 0-100>,
#       "feedback": "<specific feedback>"
#     }},
#     {{
#       "name": "Objection Handling",
#       "score": <number between 0-100>,
#       "feedback": "<specific feedback>"
#     }},
#     {{
#       "name": "Value Proposition",
#       "score": <number between 0-100>,
#       "feedback": "<specific feedback>"
#     }},
#     {{
#       "name": "Active Listening",
#       "score": <number between 0-100>,
#       "feedback": "<specific feedback>"
#     }},
#     {{
#       "name": "Confidence & Professionalism",
#       "score": <number between 0-100>,
#       "feedback": "<specific feedback>"
#     }}
#   ],
#   "recommendations": [
#     "<recommendation 1>",
#     "<recommendation 2>",
#     "<recommendation 3>",
#     "<recommendation 4>"
#   ]
# }}

# Provide ONLY the JSON object with these exact keys: overallScore, summary, parameters, recommendations. No additional text before or after.
# """

        # async with httpx.AsyncClient() as client:
        #     try:
        #         logging.info("Calling Gemini API with model: gemini-2.5-flash-lite")
        #         response = await client.post(
        #             f"https://generativelanguage.googleapis.com/v1beta/models/"
        #             f"gemini-2.5-flash-lite:generateContent?key={GEMINI_API_KEY}",
        #             headers={"Content-Type": "application/json"},
        #             json={
        #                 "contents": [
        #                     {
        #                         "role": "user",
        #                         "parts": [{"text": assessment_prompt}],
        #                     }
        #                 ],
        #                 "generationConfig": {
        #                     "temperature": 0.4,
        #                     "topK": 40,
        #                     "topP": 0.95,
        #                     "maxOutputTokens": 2048,
        #                 },
        #             },
        #             timeout=60.0  # ✅ Increased from 30 to 60 seconds
        #         )
        #         logging.info("Gemini API responded with status: %d", response.status_code)
        #     except httpx.TimeoutException:
        #         logging.error("❌ Gemini API timeout after 60 seconds")
        #         raise HTTPException(status_code=503, detail="Gemini API timeout - please try again")
        #     except Exception as e:
        #         logging.error("❌ Gemini API connection error: %s", str(e))
        #         raise HTTPException(status_code=503, detail=f"Failed to connect to Gemini API: {str(e)[:50]}")

        # if response.status_code != 200:
        #     error_detail = response.text
        #     logging.error("Gemini API error (status %d): %s", response.status_code, error_detail)
        #     try:
        #         gemini_error = response.json().get("error", {})
        #         gemini_message = gemini_error.get("message") or error_detail[:200]
        #     except Exception:
        #         gemini_message = error_detail[:200]
            
        #     # Check for rate limit or quota issues
        #     if response.status_code == 429:
        #         return fallback_assessment(
        #             "Assessment could not be generated because Gemini is rate limited. "
        #             "Your conversation has been saved and can be assessed again later."
        #         )
        #     elif response.status_code == 403:
        #         return fallback_assessment(
        #             f"Assessment could not be generated because Gemini denied access: {gemini_message}"
        #         )
        #     else:
        #         return fallback_assessment(
        #             f"Assessment could not be generated because Gemini returned an error: {error_detail[:100]}"
        #         )

        try:
            ai_response = await AI.execute(
                AIRequest(
                    feature="roleplay_assessment",
                    company_id=str(ctx.company_id),
                    user_id=str(ctx.user_id),
                    route="/roleplay/sessions/{session_id}/assessment",
                    prompt_type="default",
                    variables={
                        "scenarioTitle": scenario_title,
                        "learnerRole": learner_role,
                        "aiRole": ai_role,
                        "transcript": transcript,
                    },
                    response_format="json",
                )
            )
        except Exception as e:
            logging.exception(
                "❌ Roleplay assessment AI Gateway error"
            )
            return fallback_assessment(
                f"Assessment could not be generated at this moment: {str(e)[:200]}"
            )

        if not ai_response or not ai_response.content:
            logging.error(
                "❌ Roleplay assessment returned empty AI Gateway response"
            )
            return fallback_assessment(
                "Assessment could not be generated because the AI service returned an empty response."
            )

        logging.info(
            "[Roleplay Assessment] AI Gateway: provider=%s model=%s prompt_version=%s",
            ai_response.provider,
            ai_response.model,
            ai_response.prompt_version,
        )

        assessment_text = str(ai_response.content).strip()

        if not assessment_text:
            logging.error(
                "No assessment content returned by AI Gateway"
            )
            return fallback_assessment(
                "Assessment could not be generated because the AI service returned an empty response."
            )

        # Remove markdown fences if the model returned them
        assessment_text = re.sub(
            r"^```(?:json)?\s*|\s*```$",
            "",
            assessment_text,
            flags=re.IGNORECASE
        ).strip()

        try:
            assessment = json.loads(assessment_text)
        except json.JSONDecodeError:
            logging.error(
                "Failed to parse AI Gateway assessment JSON: %s",
                assessment_text[:1000]
            )
            return fallback_assessment(
                "Assessment could not be generated because the AI service returned an invalid response."
            )

        # Log the assessment structure for debugging
        logging.info("Assessment keys: %s", list(assessment.keys()))
        logging.info("Full assessment: %s", json.dumps(assessment, indent=2))

        if not all(k in assessment for k in ("overallScore", "summary", "parameters", "recommendations")):
            missing_keys = [k for k in ("overallScore", "summary", "parameters", "recommendations") if k not in assessment]
            logging.error("Missing required keys: %s. Available keys: %s", missing_keys, list(assessment.keys()))
            raise HTTPException(status_code=500, detail=f"Invalid assessment report structure. Missing: {missing_keys}")

        insert_data = {
            "session_id": session_id,
            "employee_id": session["employee_id"],
            "overall_score": assessment["overallScore"],
            "summary": assessment["summary"],
            "parameters": assessment["parameters"],
            "recommendations": assessment["recommendations"],
        }

        roleplay_db.save_roleplay_assessment(insert_data)

        return {
            "success": True,
            "data": assessment,
            "message": "Assessment generated successfully"
        }

    except json.JSONDecodeError as e:
        logging.error("❌ JSON decode error: %s", str(e))
        logging.error("Raw assessment text: %s", assessment_text if 'assessment_text' in locals() else "N/A")
        return JSONResponse(
            content={"error": "Failed to parse assessment - invalid JSON format"},
            status_code=500
        )
    except HTTPException:
        raise
    except Exception as e:
        logging.exception("❌ Assessment generation error")
        logging.error("Exception details: %s", str(e))
        
        # ✅ Return a graceful fallback assessment on error
        logging.info("Returning fallback assessment due to error")
        # return fallback_assessment(
        #     "Assessment could not be generated at this moment. Please try again in a few minutes. "
        #     "Your conversation has been saved and you can review it in your reports."
        # )
        raise

@router.post("/finish")
async def finish_roleplay(
    payload: FinishSessionRequest,
    ctx: RoleplayContext = Depends(get_roleplay_context)
):

    assessment_response = await generate_assessment(
        payload.session_id,
        ctx
    )

    if isinstance(assessment_response, JSONResponse):
        assessment_json = json.loads(
            assessment_response.body.decode()
        )
    else:
        assessment_json = assessment_response

    assessment = assessment_json["data"]

    # roleplay_db.save_roleplay_assessment({
    #     "session_id": payload.session_id,
    #     "employee_id": ctx.user_id,
    #     "overall_score": assessment["overallScore"],
    #     "summary": assessment["summary"],
    #     "parameters": assessment["parameters"],
    #     "recommendations": assessment["recommendations"],
    # })

    roleplay_db.update_roleplay_session(
        payload.session_id,
        {
            "completed_at": datetime.utcnow().isoformat()
        }
    )

    return {
        "success": True,
        "data": assessment
    }
# ============================================================
# Reports
# ============================================================


# ============================================================
# Realtime
# ============================================================

@ws_router.websocket("/realtime")
async def websocket_realtime_roleplay(websocket: WebSocket):
    token = websocket.query_params.get("token")

    if not token:
        logger.warning("[Realtime Auth] ❌ Missing bearer token")
        await websocket.close(code=1008)
        return

    try:
        logger.info("[Realtime Auth] 🔐 WebSocket authentication started")

        # Use the SAME token verification path as normal HTTP requests.
        # This supports Firebase/Supabase tokens through the centralized auth layer.
        claims = _verify_token(token)

        token_user_id = (
            claims.get("uid")
            or claims.get("user_id")
            or claims.get("sub")
        )
        email = claims.get("email")

        logger.info(
            "[Realtime Auth] Token verified: uid=%s email=%s",
            token_user_id,
            email,
        )

        # Use the SAME Firebase/Supabase -> internal Lucid user/company
        # resolution used by normal authenticated HTTP requests.
        auth_context = _build_request_auth_from_verified_claims(
            claims
        )

        logger.info(
            "[Realtime Auth] ✅ Context resolved: user_id=%s company_id=%s",
            auth_context.user_id,
            auth_context.company_id,
        )

        from utils.auth_bridge import get_service_supabase_client
        supabase_client = get_service_supabase_client()
        resp = supabase_client.table('companies').select('subscription_addons').eq('company_id', auth_context.company_id).maybe_single().execute()
        
        if not resp.data or "role_play" not in (resp.data.get('subscription_addons') or []):
            logger.warning("[Realtime Auth] ❌ Company does not have role_play addon")
            await websocket.close(code=1008)
            return

    except HTTPException as e:
        logger.warning(
            "[Realtime Auth] ❌ Authentication failed: status=%s detail=%s",
            e.status_code,
            e.detail,
        )
        await websocket.close(code=1008)
        return

    except Exception as e:
        logger.exception(
            "[Realtime Auth] ❌ Unexpected authentication error: %s",
            str(e),
        )
        await websocket.close(code=1008)
        return

    # Authentication succeeded.
    await websocket.accept()

    logger.info(
        "[Realtime Auth] ✅ WebSocket connection accepted: user_id=%s company_id=%s",
        auth_context.user_id,
        auth_context.company_id,
    )

    conversation_transcript = []
    items_dict = {}
    item_ids_order = []
    scenario_context = None
    realtime_usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
    realtime_started_at = asyncio.get_running_loop().time()
    realtime_model_config = None

    try:
        # 1. Receive initial session config
        init_data = json.loads(await websocket.receive_text())

        scenario_context = {
            "scenario_title": init_data.get("scenarioTitle"),
            "scenario_role":  init_data.get("scenarioRole"),
            "user_role":      init_data.get("userRole", "User"),
            "initial_prompt": init_data.get("initialPrompt"),
            "ai_personality": init_data.get("aiPersonality"),
            "ai_objectives": init_data.get("aiObjectives"),
            "learner_brief": init_data.get("learnerBrief"),
            "tone":           init_data.get("tone", "Neutral"),
            "employee_id":    auth_context.user_id,
            "session_id":     init_data.get("sessionId"),
            "voice_gender":   init_data.get("voiceGender", "female"),
        }

        logger.info(f"✅ [Realtime] Session started: {scenario_context['session_id']}")
        logger.info(f"   Role: {scenario_context['scenario_role']}, Tone: {scenario_context['tone']}")
        logger.warning(
            "[Realtime] Role assignment: AI=%s | Learner=%s | Scenario=%s",
            scenario_context["scenario_role"],
            scenario_context["user_role"],
            scenario_context["scenario_title"],
        )
        
        if scenario_context.get("session_id"):
            session_result = roleplay_db.get_roleplay_session(
                scenario_context["session_id"]
            )

            if not session_result.data:
                logger.warning(
                    "[Realtime Auth] ❌ Session not found: %s",
                    scenario_context["session_id"],
                )
                await websocket.close(code=1008)
                return

            session_employee_id = session_result.data.get("employee_id")

            if str(session_employee_id) != str(auth_context.user_id):
                logger.warning(
                    "[Realtime Auth] ❌ Session ownership mismatch: "
                    "session_user=%s authenticated_user=%s",
                    session_employee_id,
                    auth_context.user_id,
                )
                await websocket.close(code=1008)
                return
            
        if not OPENAI_API_KEY:
            raise ValueError("OPENAI_API_KEY not set")

        if not OPENAI_API_KEY:
            raise ValueError("OPENAI_API_KEY is empty after stripping")

        realtime_model_config = ModelManager.get("roleplay_realtime")
        if realtime_model_config.provider.lower() != "openai":
            raise ValueError(
                f"Roleplay realtime currently requires an OpenAI-compatible realtime provider. "
                f"Configured provider: {realtime_model_config.provider}"
            )

        realtime_model = realtime_model_config.model

        realtime_url = (
            f"wss://api.openai.com/v1/realtime"
            f"?model={realtime_model}"
        )

        logger.info(
            "[Realtime] Model resolved from AI config: provider=%s model=%s",
            realtime_model_config.provider,
            realtime_model,
        )
        logger.info("[Realtime] 🔑 API Key: loaded and verified")
        logger.info(f"[Realtime] 🌐 Conneting using configured realtime model: {realtime_url}")

        headers = {
            "Authorization": f"Bearer {OPENAI_API_KEY}",
        }



        # ✅ FIX: Use additional_headers parameter with websockets library

        async with connect(realtime_url, additional_headers=headers) as openai_ws:
            logger.info("[Realtime] ✅ Connected to OpenAI Realtime API")

            # ✅ FIX 8: Map voice gender to OpenAI voice options
            voice_map = {
                "female": "alloy",  # Female: alloy, shimmer, nova
                "male": "echo",     # Male: echo, onyx, fable
            }
            voice = voice_map.get(scenario_context.get("voice_gender", "female"), "alloy")
            logger.info(f"[Realtime] 🎙️ Voice gender: {scenario_context.get('voice_gender')}, selected voice: {voice}")

            # ✅ FIX 3: Added turn_detection (VAD) to session.update
            # ✅ FIX 4: Improved voice clarity - use selected voice
            # ✅ FIX 6: Added input_audio_transcription with Whisper-1 for user speech transcription
            # ✅ FIX 7: Updated to OpenAI Realtime API GA schema (nested audio object, no temperature)
            await openai_ws.send(json.dumps({
                "type": "session.update",
                "session": {
                    "type": "realtime",
                    "instructions": build_system_prompt(scenario_context),
                    "audio": {
                        "output": {
                            "voice": voice
                        },
                        "input": {
                            "transcription": {
                                "model": "whisper-1"
                            },
                            "turn_detection": {
                                "type": "server_vad",
                                "threshold": 0.7,
                                "prefix_padding_ms": 300,
                                "silence_duration_ms": 600
                            }
                        }
                    }
                }
            }))
            logger.info(f"[Realtime] ✅ Session configured — voice: {voice}")

            # Trigger the opening greeting without overriding the session system prompt
            if scenario_context.get("initial_prompt"):
                # 1. Add a system message telling it to start WITH THE FULL PROMPT
                full_prompt = build_system_prompt(scenario_context)
                await openai_ws.send(json.dumps({
                    "type": "conversation.item.create",
                    "item": {
                        "type": "message",
                        "role": "system",
                        "content": [
                            {
                                "type": "input_text",
                                "text": f"{full_prompt}\n\nPlease begin the roleplay now. Say your opening line based on this context: {scenario_context['initial_prompt']}"
                            }
                        ]
                    }
                }))
                
                # 2. Tell it to generate a response
                await openai_ws.send(json.dumps({
                    "type": "response.create"
                }))
                logger.info("[Realtime] 🎤 Requested opening greeting")

            # --- Bidirectional tasks ---

            async def forward_client_to_openai():
                nonlocal conversation_transcript
                try:
                    while True:
                        msg = json.loads(await websocket.receive_text())
                        msg_type = msg.get("type")

                        if msg_type == "audio":
                            await openai_ws.send(json.dumps({
                                "type": "input_audio_buffer.append",
                                "audio": msg.get("audio")
                            }))

                        elif msg_type == "end_session":
                            final_transcript = []
                            for iid in item_ids_order:
                               if iid in items_dict:
                                   msg_text = items_dict[iid]["text"].strip()
                                   if msg_text:
                                       final_transcript.append({
                                           "role": items_dict[iid]["role"],
                                           "text": msg_text
                                        })
                            if not final_transcript and conversation_transcript:
                               final_transcript = conversation_transcript
                            conversation_transcript = final_transcript

                            logger.info(
                                f"[Realtime] 📞 Session end requested - transcript contains {len(conversation_transcript)} messages"
                            )

                            # -----------------------------
                            # Persist transcript
                            # -----------------------------
                            if scenario_context and scenario_context.get("session_id"):
                                session_id = scenario_context["session_id"]

                                try:
                                    logger.info(
                                        f"[Realtime] 💾 Saving transcript for session {session_id}"
                                    )

                                    update_data = {
                                        "conversation_transcript": final_transcript,
                                        "message_count": len(final_transcript),
                                        "completed_at": datetime.utcnow().isoformat()
                                    }

                                    # Calculate duration exactly like frontend did
                                    if len(final_transcript) >= 2:
                                        try:
                                            start_time = datetime.fromisoformat(
                                                final_transcript[0]["timestamp"].replace("Z", "+00:00")
                                            )
                                            end_time = datetime.fromisoformat(
                                                final_transcript[-1]["timestamp"].replace("Z", "+00:00")
                                            )

                                            update_data["duration_seconds"] = int(
                                                (end_time - start_time).total_seconds()
                                            )
                                        except Exception as e:
                                            logger.warning(
                                                f"[Realtime] Could not calculate duration: {e}"
                                            )

                                    roleplay_db.update_roleplay_session(session_id, update_data)

                                    logger.info("[Realtime] ✅ Transcript saved")

                                except Exception as e:
                                    logger.error(f"[Realtime] ❌ Failed to save transcript: {e}")

                            await websocket.send_json({
                                "type": "session_ended",
                                "transcript": final_transcript
                            })

                            break

                except Exception as e:
                    logger.error(f"[Realtime] ❌ Forward error: {e}")

            async def receive_openai_to_client():
                nonlocal conversation_transcript, realtime_usage
                try:
                    while True:
                        response = json.loads(await openai_ws.recv())
                        response_type = response.get("type")

                        if response_type in ("response.output_audio.delta", "response.audio.delta"):
                            await websocket.send_json({
                                "type": "audio",
                                "audio": response.get("delta")
                            })

                        elif response_type in ("response.output_audio_transcript.delta", "response.audio_transcript.delta"):
                            # ✅ Correct event for bot speech transcript
                            await websocket.send_json({
                                "type": "transcript_chunk",
                                "text": response.get("delta", ""),
                                "role": "bot"
                            })

                        elif response_type == "conversation.item.created":
                            item = response.get("item", {})
                            item_id = item.get("id")
                            role = item.get("role")
                            if item_id and role in ("user", "assistant"):
                               mapped_role = "user" if role == "user" else "bot"
                               items_dict[item_id] = {"role": mapped_role, "text": ""}
                               item_ids_order.append(item_id)

                        elif response_type in ("response.output_audio_transcript.done", "response.audio_transcript.done"):
                           text = response.get("transcript", "")
                           item_id = response.get("item_id")
                           if item_id and item_id in items_dict:
                               items_dict[item_id]["text"] = text
                           elif text:
                               conversation_transcript.append({"role": "bot", "text": text})
                           logger.info(f"[Realtime] 💬 Bot: {text[:60]}...")
                           await websocket.send_json({
                               "type": "bot_transcription",
                               "text": text
                           })

                        elif response_type == "conversation.item.input_audio_transcription.completed":
                           text = response.get("transcript", "")
                           item_id = response.get("item_id")
                           if item_id and item_id in items_dict:
                               items_dict[item_id]["text"] = text
                           elif text:
                               conversation_transcript.append({"role": "user", "text": text})
                           logger.info(f"[Realtime] 👤 User: {text[:60]}...")
                           await websocket.send_json({
                               "type": "user_transcription",
                               "text": text
                           })

                        elif response_type == "input_audio_buffer.speech_started":
                            logger.info("[Realtime] 🎙️ User started speaking")
                            await websocket.send_json({"type": "speech_started"})

                        elif response_type == "response.done":
                            response_data = response.get("response") or {}
                            usage = response_data.get("usage") or response.get("usage")
                            if usage:
                                input_tokens = int(usage.get("input_tokens") or 0)
                                output_tokens = int(usage.get("output_tokens") or 0)
                                total_tokens = int(
                                    usage.get("total_tokens")
                                    or input_tokens + output_tokens
                                )
                                realtime_usage["input_tokens"] += input_tokens
                                realtime_usage["output_tokens"] += output_tokens
                                realtime_usage["total_tokens"] += total_tokens
                            logger.info("[Realtime] ✅ Response complete")

                        elif response_type == "error":
                            error_detail = response.get("error", {})
                            error_code = error_detail.get("code")
                            error_message = error_detail.get("message")
                            error_type = error_detail.get("type")
                            
                            logger.error(f"[Realtime] ❌ OpenAI API Error")
                            logger.error(f"   Type: {error_type}")
                            logger.error(f"   Code: {error_code}")
                            logger.error(f"   Message: {error_message}")
                            
                            if error_code == "invalid_api_key":
                                logger.error(f"[Realtime] 🔑 API Key Issue!")
                                logger.error(f"   - Check that your OpenAI API key is active")
                                logger.error(f"   - Verify the key has Realtime API access")
                                logger.error(f"   - Visit: https://platform.openai.com/account/api-keys")
                            
                            await websocket.send_json({
                                "type": "error",
                                "message": f"{error_code}: {error_message}" if error_code else error_message or "Unknown OpenAI error"
                            })

                except Exception as e:
                    logger.error(f"[Realtime] ❌ Receive error: {e}")

            forward_task = asyncio.create_task(forward_client_to_openai())
            receive_task = asyncio.create_task(receive_openai_to_client())

            done, pending = await asyncio.wait(
                [forward_task, receive_task],
                return_when=asyncio.FIRST_COMPLETED
            )
            for task in pending:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

    except Exception as e:
        logger.error(f"[Realtime] ❌ WebSocket error: {str(e)}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except:
            pass

    finally:
        sid = scenario_context.get("session_id") if scenario_context else "unknown"

        if realtime_model_config and (
            realtime_usage["total_tokens"] or sid != "unknown"
        ):
            try:
                input_tokens = realtime_usage["input_tokens"]
                output_tokens = realtime_usage["output_tokens"]
                total_tokens = realtime_usage["total_tokens"]
                cost_usd, cost_inr = CostCalculator.calculate(
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    input_cost_per_million=realtime_model_config.input_cost_per_million,
                    output_cost_per_million=realtime_model_config.output_cost_per_million,
                )
                UsageTracker.log(
                    UsageLog(
                        company_id=str(auth_context.company_id),
                        user_id=str(auth_context.user_id),
                        feature_id=realtime_model_config.feature_id,
                        provider=realtime_model_config.provider,
                        model=realtime_model_config.model,
                        route="/roleplay/realtime",
                        prompt_version=0,
                        input_tokens=input_tokens,
                        output_tokens=output_tokens,
                        total_tokens=total_tokens,
                        cost_usd=cost_usd,
                        cost_inr=cost_inr,
                        latency_ms=0,
                        status="success",
                        usage_quantity=(asyncio.get_running_loop().time() - realtime_started_at) / 60,
                        usage_unit="session_minutes",
                        duration_seconds=asyncio.get_running_loop().time() - realtime_started_at,
                    )
                )
                logger.info(
                    "[Realtime] Usage logged: input=%s output=%s total=%s duration_seconds=%s",
                    input_tokens,
                    output_tokens,
                    total_tokens,
                    asyncio.get_running_loop().time() - realtime_started_at,
                )
            except Exception as e:
                logger.error("[Realtime] Failed to log usage: %s", e)
        
        # Build the final transcript robustly if it wasn't requested via end_session
        final_transcript = []
        for iid in item_ids_order:
            if iid in items_dict:
                msg_text = items_dict[iid]["text"].strip()
                if msg_text:
                    final_transcript.append({
                        "role": items_dict[iid]["role"],
                        "text": msg_text
                    })
        if not final_transcript and conversation_transcript:
            final_transcript = conversation_transcript
            
        logger.info(f"[Realtime] 🔌 Disconnected, session {sid}. Final backend transcript has {len(final_transcript)} messages.")
        if len(final_transcript) > 0:
            logger.info(f"[Realtime] Last message: {final_transcript[-1]['text'][:100]}")
                    # --- START PHASE 2 ENTERPRISE STATE MANAGEMENT ---
        if sid != "unknown":
                try:
                    logger.info(f"[Realtime] 💾 Auto-saving {len(final_transcript)} messages to DB for session {sid}...")
                    roleplay_db.update_roleplay_session(sid, {"conversation_transcript": final_transcript, "message_count": len(final_transcript)})
                    logger.info("[Realtime] ✅ Transcript safely stored on disconnect.")
                except Exception as e:
                    logger.error(f"[Realtime] ❌ Failed to auto-save transcript: {str(e)}")
            # --- END PHASE 2 ENTERPRISE STATE MANAGEMENT ---

