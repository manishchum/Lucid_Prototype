"""
Roleplay Page Operations API Routes
Handles scenario fetching, deletion, and assignment operations
Backend proxy for secure database access
"""

from fastapi import APIRouter, Header, HTTPException, Query, Request, Depends
from pydantic import BaseModel
from typing import Optional, List, Literal
from utils.supabase_client import supabase
from utils.auth import (
    get_request_auth_optional,
    get_effective_company_id,
    get_request_auth_required,
    RequestAuth
)
from utils.auth_bridge import get_service_supabase_client

router = APIRouter(prefix="/roleplay/page", tags=["roleplay-page"])


class AssignScenarioRequest(BaseModel):
    scenario_id: str
    assignment_type: Literal['department', 'sub_department', 'user']
    target_ids: List[str]
    company_id: str


class DeleteScenarioRequest(BaseModel):
    scenario_id: str


# ============================================================================
# Helper Functions
# ============================================================================

def normalize_scenario(db_scenario: dict) -> dict:
    """Convert database scenario format to frontend format"""
    # Normalize difficulty
    difficulty = db_scenario.get('difficulty', 'Medium')
    if isinstance(difficulty, str):
        difficulty_lower = difficulty.lower()
        if difficulty_lower == 'easy':
            difficulty = 'Easy'
        elif difficulty_lower == 'medium':
            difficulty = 'Medium'
        elif difficulty_lower == 'hard':
            difficulty = 'Hard'
    
    return {
        'scenario_id': db_scenario.get('scenario_id'),
        'title': db_scenario.get('title', ''),
        'description': db_scenario.get('description', ''),
        'role': db_scenario.get('role', ''),
        'difficulty': difficulty,
        'initialPrompt': db_scenario.get('initialPrompt', ''),
        'userRole': db_scenario.get('userRole', ''),
        'tone': db_scenario.get('tone', 'Neutral'),
        'learnerBrief': db_scenario.get('learnerBrief', ''),
        'aiObjectives': (
            db_scenario.get('aiObjective')[0] 
            if isinstance(db_scenario.get('aiObjective'), list) and db_scenario.get('aiObjective')
            else db_scenario.get('aiObjective')
        ),
        'maxDuration': (
            db_scenario.get('maxDuration')[0]
            if isinstance(db_scenario.get('maxDuration'), list) and db_scenario.get('maxDuration')
            else db_scenario.get('maxDuration')
        ),
        'minTurns': (
            db_scenario.get('minTurns')[0]
            if isinstance(db_scenario.get('minTurns'), list) and db_scenario.get('minTurns')
            else db_scenario.get('minTurns')
        ),
        'endConditions': (
            db_scenario.get('endConditions')[0]
            if isinstance(db_scenario.get('endConditions'), list) and db_scenario.get('endConditions')
            else db_scenario.get('endConditions')
        ),
        'evaluationParams': (
            db_scenario.get('evaluationParams')
            if isinstance(db_scenario.get('evaluationParams'), list)
            else db_scenario.get('evaluationParams')
        ),
        'passingScore': (
            db_scenario.get('passingScore')[0]
            if isinstance(db_scenario.get('passingScore'), list) and db_scenario.get('passingScore')
            else db_scenario.get('passingScore')
        ),
        'isCustom': True,
    }


def fetch_all_scenarios(company_id: str) -> tuple[list, dict | None]:
    """Fetch all scenarios from database for a specific company"""
    supabase = get_service_supabase_client()

    try:
        result = supabase.table("scenarios").select(
            "scenario_id, title, description, role, difficulty, initialPrompt, userRole, tone, learnerBrief, aiObjective, maxDuration, minTurns, endConditions, evaluationParams, passingScore, created_at"
        ).eq('company_id', company_id).order('created_at', desc=True).execute()
        return result.data, None
    except Exception as e:
        return [], {'code': 'DB_ERROR', 'message': str(e)}


def get_assigned_scenario_ids_for_user(user_id: str) -> tuple[list, dict | None]:
    """Get scenario IDs assigned to a user"""
    try:
        # Get user's department
        user_result = supabase.table("users").select("department_id").eq("user_id", user_id).single().execute()
        if not user_result.data:
            return [], None
        
        user_data = user_result.data
        department_id = user_data.get('department_id')
        
        # Check if user has admin roles
        role_result = supabase.table("user_role_assignments").select("role_id").eq("user_id", user_id).execute()
        
        if role_result.data and len(role_result.data) > 1:
            # User has multiple roles - likely admin
            all_scenarios = supabase.table("scenarios").select("scenario_id").order('created_at', desc=True).execute()
            scenario_ids = [s.get('scenario_id') for s in (all_scenarios.data or [])]
            return scenario_ids, None
        
        # Get user's direct assignments
        user_assignments = supabase.table("scenario_assignments").select("scenario_id").eq("user_id", user_id).execute()
        scenario_ids = [a.get('scenario_id') for a in (user_assignments.data or [])]
        
        # Get department assignments
        if department_id:
            dept_assignments = supabase.table("scenario_assignments").select("scenario_id").eq("department_id", department_id).execute()
            dept_ids = [a.get('scenario_id') for a in (dept_assignments.data or [])]
            scenario_ids = list(set(scenario_ids + dept_ids))
        
        return scenario_ids, None
    except Exception as e:
        return [], {'code': 'DB_ERROR', 'message': str(e)}


def get_company_roleplay_limits(company_id: str) -> tuple[dict, dict | None]:
    """Get roleplay limits for a company"""
    try:
        result = supabase.table("companies").select(
            "rate_limit_role_play, rate_limit_role_play_retries"
        ).eq("company_id", company_id).single().execute()
        
        if not result.data:
            return {}, None
        
        data = result.data
        return {
            'roleplayLimit': data.get('rate_limit_role_play', 5),
            'retryLimit': data.get('rate_limit_role_play_retries', 3),
        }, None
    except Exception as e:
        return {}, {'code': 'DB_ERROR', 'message': str(e)}


def get_user_company_and_department(user_id: str) -> tuple[dict, dict | None]:
    """Get user's company and department"""
    try:
        result = supabase.table("users").select("company_id, department_id").eq("user_id", user_id).single().execute()
        if not result.data:
            return {}, {'code': 'USER_NOT_FOUND', 'message': 'User not found'}
        
        return result.data, None
    except Exception as e:
        return {}, {'code': 'DB_ERROR', 'message': str(e)}


def get_distinct_assigned_scenario_ids_for_user(
    user_id: str,
    company_id: str,
    department_id: Optional[str]
) -> tuple[list, dict | None]:
    """Get distinct scenario IDs assigned to user (via user or department)"""
    try:
        # User direct assignments
        user_result = supabase.table("scenario_assignments").select("scenario_id").eq(
            "company_id", company_id
        ).eq("assignment_type", "user").eq("user_id", user_id).execute()
        
        user_ids = [a.get('scenario_id') for a in (user_result.data or [])]
        
        # Department assignments
        dept_ids = []
        if department_id:
            dept_result = supabase.table("scenario_assignments").select("scenario_id").eq(
                "company_id", company_id
            ).eq("assignment_type", "department").eq("department_id", department_id).execute()
            
            dept_ids = [a.get('scenario_id') for a in (dept_result.data or [])]
        
        # Combine and deduplicate
        distinct_ids = list(set(user_ids + dept_ids))
        return distinct_ids, None
    except Exception as e:
        return [], {'code': 'DB_ERROR', 'message': str(e)}


# ============================================================================
# API Endpoints
# ============================================================================

@router.get("/scenarios")
async def fetch_scenarios_for_user(
    request: Request,
    is_admin: bool = Query(False),
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    effective_company_id: str = Depends(get_effective_company_id)
):
    """
    Fetch scenarios for a user (admin gets all, regular users get assigned)
    Supports Authorization Bearer token or X-User-ID header
    Query: is_admin (boolean)
    """
    try:
        user_id = auth_ctx.user_id
        # print("Auth context for scenario fetch:", auth_ctx)
        if not user_id:
            raise HTTPException(status_code=401, detail="Authentication required")
        
        # Admin gets all scenarios
        if is_admin:
            db_scenarios, error = fetch_all_scenarios(effective_company_id)
            print("Fetched all scenarios for admin:", db_scenarios)
            
            if error:
                raise HTTPException(status_code=500, detail=error['message'])
            
            normalized = [normalize_scenario(s) for s in (db_scenarios or [])]
            return {
                'success': True,
                'data': normalized
            }
        
        # Regular user gets assigned scenarios
        assigned_ids, error = get_assigned_scenario_ids_for_user(user_id)
        # print("Assigned scenario IDs for user:", assigned_ids)
        
        if error:
            # Fall back to returning no custom scenarios
            return {
                'success': True,
                'data': []
            }
        
        if not assigned_ids:
            return {
                'success': True,
                'data': []
            }
        
        # Fetch assigned scenarios
        result = supabase.table("scenarios").select(
            "scenario_id, title, description, role, difficulty, initialPrompt, userRole, tone, learnerBrief, aiObjective, maxDuration, minTurns, endConditions, evaluationParams, passingScore, created_at"
        ).in_(
            "scenario_id", assigned_ids
        ).order('created_at', desc=True).execute()
        

        print(result)
        assigned_scenarios = result.data or []
        normalized = [normalize_scenario(s) for s in assigned_scenarios]
        print("These are the assigned_scenarios:", assigned_scenarios)
        return {
            'success': True,
            'data': normalized
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/scenarios/{scenario_id}")
async def delete_scenario(
    scenario_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    effective_company_id: str = Depends(get_effective_company_id)
):
    """
    Delete a custom scenario
    """
    try:
        # Verify ownership (scenario belongs to company)
        scenario_result = supabase.table("scenarios").select("scenario_id").eq(
            "scenario_id", scenario_id
        ).eq("company_id", effective_company_id).execute()
        
        if not scenario_result.data:
            raise HTTPException(status_code=403, detail="Scenario not found or access denied")
        
        # Delete scenario
        delete_result = supabase.table("scenarios").delete().eq(
            "scenario_id", scenario_id
        ).execute()
        
        return {
            'success': True,
            'message': 'Scenario deleted successfully'
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/scenarios/assign")
async def assign_scenario_to_targets(
    request_data: AssignScenarioRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    effective_company_id: str = Depends(get_effective_company_id)
):
    """
    Assign a scenario to departments, sub-departments, or users
    """
    try:
        user_id = auth_ctx.user_id
        scenario_id = request_data.scenario_id
        assignment_type = request_data.assignment_type
        target_ids = request_data.target_ids
        # OVERRIDE the request_data company_id with the secure one
        company_id = effective_company_id
        
        if not target_ids:
            raise HTTPException(status_code=400, detail="No targets provided")
        
        effective_target_ids = target_ids.copy()
        
        # Validate user assignments
        if assignment_type == 'user':
            for target_user_id in target_ids:
                # Get user's company and department
                user_meta, error = get_user_company_and_department(target_user_id)
                if error:
                    raise HTTPException(status_code=400, detail=error['message'])
                
                target_company_id = user_meta.get('company_id')
                target_department_id = user_meta.get('department_id')
                
                # Get company limits
                company_limits, error = get_company_roleplay_limits(target_company_id)
                if error:
                    raise HTTPException(status_code=500, detail="Unable to fetch company roleplay limits")
                
                roleplay_limit = company_limits.get('roleplayLimit', 5)
                
                if roleplay_limit <= 0:
                    raise HTTPException(status_code=400, detail="Roleplay assignment limit is 0 for this company")
                
                # Get existing assignments
                assigned_ids, error = get_distinct_assigned_scenario_ids_for_user(
                    target_user_id,
                    target_company_id,
                    target_department_id
                )
                
                if error:
                    raise HTTPException(status_code=500, detail="Unable to verify existing assignments")
                
                is_already_assigned = scenario_id in assigned_ids
                if not is_already_assigned and len(assigned_ids) >= roleplay_limit:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Cannot assign more roleplays. User has reached limit of {roleplay_limit}"
                    )
            
            # Check for duplicate assignments
            existing_result = supabase.table("scenario_assignments").select("user_id").eq(
                "scenario_id", scenario_id
            ).eq("company_id", company_id).eq(
                "assignment_type", "user"
            ).in_("user_id", target_ids).execute()
            
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
                'department_id': target_id if assignment_type != 'user' else None,
                'company_id': company_id,
                'assigned_at': __import__('datetime').datetime.utcnow().isoformat() + 'Z',
            }
            assignments.append(assignment)
        
        # Insert assignments
        insert_result = supabase.table("scenario_assignments").insert(assignments).execute()
        
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
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    effective_company_id: str = Depends(get_effective_company_id)
):
    """
    Get all assignments for a scenario
    """
    try:
        
        # result = supabase.table("scenario_assignments").select("*").eq(
        #     "scenario_id", scenario_id
        # ).execute()
        result = supabase.table("scenario_assignments").select(
        "assignment_id, scenario_id, assignment_type, department_id, company_id, assigned_at, user_id"
        ).eq("company_id", effective_company_id).eq(
        "scenario_id", scenario_id
        ).execute()
        
        return {
            'success': True,
            'data': result.data or []
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))