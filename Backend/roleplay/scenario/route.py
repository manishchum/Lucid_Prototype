from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from utils.supabase_client import supabase
from utils.auth import RequestAuth, get_request_auth_required

router = APIRouter(prefix="/roleplay/scenarios", tags=["roleplay-scenarios"])


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


@router.post("/create")
async def create_scenario(
    request_data: CreateScenarioRequest,
    user_id: Optional[str] = Header(None, alias="X-User-ID"),
    company_id: Optional[str] = Header(None, alias="X-Company-ID")
):
    """
    Create a new custom roleplay scenario
    """
    try:
        if not user_id or not company_id:
            raise HTTPException(status_code=401, detail="User ID and Company ID required")

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
        result = supabase.table("scenarios").insert(payload).execute()

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


@router.put("/{scenario_id}")
async def update_scenario(
    scenario_id: str,
    request_data: UpdateScenarioRequest,
    user_id: Optional[str] = Header(None, alias="X-User-ID"),
    company_id: Optional[str] = Header(None, alias="X-Company-ID")
):
    """
    Update an existing custom roleplay scenario
    """
    try:
        if not user_id or not company_id:
            raise HTTPException(status_code=401, detail="User ID and Company ID required")

        # Verify ownership
        existing = supabase.table("scenarios").select("scenario_id").eq("scenario_id", scenario_id).eq("company_id", company_id).execute()
        
        if not existing.data:
            raise HTTPException(status_code=404, detail="Scenario not found or access denied")

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
        result = supabase.table("scenarios").update(payload).eq("scenario_id", scenario_id).execute()

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


@router.delete("/{scenario_id}")
async def delete_scenario(
    scenario_id: str,
    user_id: Optional[str] = Header(None, alias="X-User-ID"),
    company_id: Optional[str] = Header(None, alias="X-Company-ID")
):
    """
    Delete a custom roleplay scenario
    """
    try:
        if not user_id or not company_id:
            raise HTTPException(status_code=401, detail="User ID and Company ID required")

        # Verify ownership
        existing = supabase.table("scenarios").select("scenario_id").eq("scenario_id", scenario_id).eq("company_id", company_id).execute()
        
        if not existing.data:
            raise HTTPException(status_code=404, detail="Scenario not found or access denied")

        # Delete from Supabase
        result = supabase.table("scenarios").delete().eq("scenario_id", scenario_id).execute()

        return {
            "success": True,
            "message": "Scenario deleted successfully"
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting scenario: {str(e)}")


@router.get("/user-data/{user_email}")
async def fetch_user_data(
    user_email: str,
    user_id: Optional[str] = Header(None, alias="X-User-ID")
):
    """
    Fetch user data (user_id and company_id) by email
    """
    try:
        if not user_email:
            raise HTTPException(status_code=400, detail="User email required")

        # Fetch user data from Supabase
        result = supabase.table("users").select("user_id, company_id").eq("email", user_email).execute()

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
