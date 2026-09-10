from fastapi import APIRouter, HTTPException, Depends
from typing import Dict, Any, List
from pydantic import BaseModel
import traceback
import json

# Import the model agnostic AI Gateway and Prompt Manager
# Import the model agnostic AI Gateway
from ai.ai_gateway import AI
from ai.types import AIRequest
from utils.auth_bridge import get_service_supabase_client
from utils.db.gamification_db import get_module_sprints, create_sprint_and_drills, submit_user_drill_progress
from utils.auth import RequestAuth, get_request_auth_jwt_required, require_addon

router = APIRouter(
    prefix="/api/v1/gamification",
    tags=["Gamification"],
    dependencies=[Depends(require_addon("gamification"))]
)

class GenerateDrillsRequest(BaseModel):
    module_id: str
    company_id: str
    # other contextual info like content summary might be needed

@router.post("/generate")
async def generate_drills(
    request: GenerateDrillsRequest,
    auth: RequestAuth = Depends(get_request_auth_jwt_required)
):
    """
    Why we need this: This endpoint is the core of the AI drill synthesis. 
    It takes a module's content, retrieves the gamification prompts, calls the 
    LLM via our AI gateway, and generates the 7 drill formats in a single massive JSON response.
    """
    # Enforce that the user is operating within their own company context
    if auth.company_id != request.company_id:
        raise HTTPException(status_code=403, detail="Company ID mismatch.")

    try:
        # 1. Fetch content from the module (gpt_summary)
        db = get_service_supabase_client()
        module_resp = db.table('training_modules').select('gpt_summary').eq('module_id', request.module_id).single().execute()
        
        if not module_resp.data or not module_resp.data.get('gpt_summary'):
            raise HTTPException(status_code=400, detail="Module content/summary not found. Ensure the module has been processed.")
            
        module_content = module_resp.data['gpt_summary']

        # 2. Call AI Gateway via AIRequest (Gateway handles prompt loading from DB)
        ai_response = await AI.execute(
            AIRequest(
                feature="gamification_generation",
                company_id=str(request.company_id),
                user_id=str(auth.user_id),
                route="/generate",
                prompt_type="default",
                variables={
                    "moduleContent": module_content
                },
                response_format="json",
            )
        )

        response_text = str(ai_response.content or "")

        # 3. Parse the massive JSON response
        try:
            drills_data = json.loads(response_text)
        except json.JSONDecodeError:
            raise HTTPException(status_code=500, detail="Failed to parse AI output into JSON.")
        
        # We assume the parsed data has 'sprint_title', 'sprint_description', 'sprint_number', and a list of 'drills'
        sprint_title = drills_data.get("sprint_title", "Gamification Sprint")
        sprint_description = drills_data.get("sprint_description", "")
        sprint_number = drills_data.get("sprint_number", 1)
        drills = drills_data.get("drills", [])

        # 4. Save to DB
        result = create_sprint_and_drills(
            module_id=request.module_id, 
            company_id=request.company_id,
            sprint_title=sprint_title,
            sprint_description=sprint_description,
            sprint_number=sprint_number,
            drills=drills
        )

        if not result:
             raise HTTPException(status_code=500, detail="Failed to save sprint and drills to DB")

        return {"status": "success", "data": result}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[gamification route] Error generating drills: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Internal Server Error during drill generation")

@router.get("/sprints/{module_id}")
async def fetch_sprints(
    module_id: str, 
    auth: RequestAuth = Depends(get_request_auth_jwt_required)
):
    """
    Why we need this: Frontend needs to list available sprints for a training module 
    so the user can start playing them.
    """
    sprints = get_module_sprints(module_id, auth.company_id)
    return {"status": "success", "data": sprints}

class DrillProgressRequest(BaseModel):
    sprint_id: str
    drill_id: str
    completed: bool
    earned_xp: int
    wrong_attempts: int
    completion_time_seconds: int

@router.post("/progress")
async def record_progress(
    request: DrillProgressRequest, 
    auth: RequestAuth = Depends(get_request_auth_jwt_required)
):
    """
    Why we need this: When a user completes or fails a game drill, the frontend sends 
    the result here. We store it in DB, which triggers XP calculation via Postgres triggers.
    """
    res = submit_user_drill_progress(
        user_id=auth.user_id,
        company_id=auth.company_id,
        sprint_id=request.sprint_id,
        drill_id=request.drill_id,
        completed=request.completed,
        earned_xp=request.earned_xp,
        wrong_attempts=request.wrong_attempts,
        completion_time_seconds=request.completion_time_seconds
    )
    if not res:
        raise HTTPException(status_code=500, detail="Failed to record progress")
    return {"status": "success", "data": res}
