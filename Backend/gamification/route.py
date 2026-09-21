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
from utils.db.gamification_db import (
    get_module_sprints,
    get_user_assigned_sprints,
    create_sprint_and_drills,
    get_user_completed_drills,
    submit_user_drill_progress,
    get_user_gamification_profile,
    get_leaderboard_users,
    get_drill_base_xp,
    check_and_award_badges,
    get_user_badges,
    get_user_activity_calendar
)
from utils.auth import RequestAuth, get_request_auth_required, require_addon
from gamification.service import GamificationService

router = APIRouter(
    prefix="/api/gamification",
    tags=["Gamification"],
    dependencies=[Depends(require_addon("gamification"))]
)

class GenerateDrillsRequest(BaseModel):
    module_id: str
    company_id: str
    user_id: str
    content: str

@router.post("/generate")
async def generate_drills(
    request: GenerateDrillsRequest,
    auth: RequestAuth = Depends(get_request_auth_required)
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
        # 1. Use the synthesized content passed from the worker
        if not request.content or not request.content.strip():
            raise HTTPException(status_code=400, detail="Module content not provided or empty.")
            
        module_content = request.content

        # 2. Call AI Gateway via AIRequest (Gateway handles prompt loading from DB)
        ai_response = await AI.execute(
            AIRequest(
                feature="gamification_generation",
                company_id=str(request.company_id),
                user_id=str(auth.user_id),
                route="/generate",
                prompt_type="default",
                variables={
                    "moduleContent": module_content,
                    "sprint_title": "Module Review Sprint"
                },
                response_format="json",
            )
        )

        response_text = str(ai_response.content or "").strip()
        if response_text.startswith("```json"):
            response_text = response_text[7:]
        if response_text.startswith("```"):
            response_text = response_text[3:]
        if response_text.endswith("```"):
            response_text = response_text[:-3]
        response_text = response_text.strip()

        # 3. Parse the massive JSON response
        try:
            drills_data = json.loads(response_text)
            if not isinstance(drills_data, dict):
                raise ValueError("AI response is not a JSON object")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to parse AI output into JSON: {e}")
        
        # We assume the parsed data has 'sprint_title', 'sprint_description', 'sprint_number', and a list of 'drills'
        # Map AI drill format to DB schema
        mapped_drills = []
        for idx, d in enumerate(drills_data.get("drills", [])):
            format_type = d.get("drill_type", "VIBE_CHECK").upper()
            
            mapped_drills.append({
                "format_type": format_type,
                "title": d.get("title", f"Drill {idx+1}"),
                "base_xp": 200,
                "order_index": idx + 1,
                "content_payload": d.get("content", {})
            })

        # 4. Save to DB
        result = create_sprint_and_drills(
            company_id=str(request.company_id),
            module_id=str(request.module_id),
            sprint_title=drills_data.get("sprint_title", drills_data.get("title", "Module Review Sprint")),
            sprint_description=drills_data.get("sprint_description", drills_data.get("description", "")),
            sprint_number=1,
            drills=mapped_drills
        )

        if not result:
             raise HTTPException(status_code=500, detail="Failed to save sprint and drills to DB")

        return {"status": "success", "data": result}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[gamification route] Error generating drills: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Internal Server Error during drill generation: {str(e)}")

@router.get("/sprints")
async def get_user_sprints(
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """
    Returns all active gamification sprints for all modules assigned to the authenticated user.
    """
    try:
        sprints = get_user_assigned_sprints(auth.user_id, auth.company_id)
        completed_drills = get_user_completed_drills(user_id=auth.user_id)
        
        # Determine unlock status sequentially
        for idx, sprint in enumerate(sprints):
            if idx == 0:
                sprint["is_locked"] = False
            else:
                prev_sprint = sprints[idx - 1]
                prev_drills = prev_sprint.get("gamification_drills", [])
                
                prev_completed = True
                if not prev_drills:
                    prev_completed = False
                
                for d in prev_drills:
                    if str(d.get("drill_id")) not in completed_drills:
                        prev_completed = False
                        break
                        
                sprint["is_locked"] = not prev_completed

        return {"status": "success", "data": sprints}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/leaderboard")
async def get_leaderboard(
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """
    Returns the leaderboard for the company based on XP.
    """
    try:
        users = get_leaderboard_users(auth.company_id)
        
        # Format for frontend
        formatted_users = []
        for row in users:
            user_data = row.get("users", {}) or {}
            formatted_users.append({
                "id": row.get("user_id"),
                "name": user_data.get("name", "Unknown"),
                "role": user_data.get("role", "Employee"),
                "sprints_completed": row.get("sprints_completed", 0),
                "xp": row.get("total_xp", 0),
                "badges_count": row.get("badges_count", 0),
                "avatar_color": user_data.get("avatar_color", "bg-indigo-600"),
                "is_current_user": row.get("user_id") == auth.user_id
            })
            
        return {"status": "success", "data": formatted_users}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class DrillProgressRequest(BaseModel):
    sprint_id: str
    drill_id: str
    completed: bool
    wrong_attempts: int
    completion_time_seconds: int

@router.post("/progress")
async def record_progress(
    request: DrillProgressRequest, 
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """
    Why we need this: When a user completes or fails a game drill, the frontend sends 
    the result here. We store it in DB, which triggers XP calculation via Postgres triggers.
    """
    # 1. Fetch the drill's base XP
    base_xp = get_drill_base_xp(request.drill_id, auth.company_id)
    
    # 2. Fetch the user's current streak multiplier
    multiplier = GamificationService.get_user_streak_multiplier(auth.user_id, auth.company_id)
    
    # 3. Calculate dynamic XP (Base - (Mistakes * 25), min 50, * multiplier)
    earned_xp = 0
    if request.completed:
        earned_xp = GamificationService.calculate_earned_xp(
            base_xp=base_xp, 
            wrong_attempts=request.wrong_attempts, 
            streak_multiplier=multiplier
        )

    res = submit_user_drill_progress(
        user_id=auth.user_id,
        company_id=auth.company_id,
        sprint_id=request.sprint_id,
        drill_id=request.drill_id,
        completed=request.completed,
        earned_xp=earned_xp,
        wrong_attempts=request.wrong_attempts,
        completion_time_seconds=request.completion_time_seconds
    )
    if not res:
        raise HTTPException(status_code=500, detail="Failed to record progress")
        
    # 4. Check for new badges
    new_badges = []
    if request.completed:
        new_badges = check_and_award_badges(user_id=auth.user_id, company_id=auth.company_id)
        
    return {
        "status": "success", 
        "data": {
            "progress": res, 
            "earned_xp": earned_xp, 
            "streak_multiplier": multiplier,
            "new_badges": new_badges
        }
    }

@router.get("/profile")
def fetch_user_profile(auth: RequestAuth = Depends(get_request_auth_required)):
    """
    Fetches the authenticated user's gamification profile (XP, streaks, etc).
    """
    try:
        profile = get_user_gamification_profile(user_id=auth.user_id)
        completed_drills = get_user_completed_drills(user_id=auth.user_id)
        
        # Fetch unlocked badges
        unlocked_badges = get_user_badges(user_id=auth.user_id)
        
        if not profile:
            return {
                "status": "success", 
                "data": {
                    "total_xp": 0, 
                    "current_streak_days": 0, 
                    "best_streak_days": 0, 
                    "drills_completed_count": 0, 
                    "completed_drills": completed_drills,
                    "unlocked_badges": unlocked_badges
                }
            }
        
        profile["completed_drills"] = completed_drills
        profile["unlocked_badges"] = unlocked_badges
        return {"status": "success", "data": profile}
    except Exception as e:
        print(f"[gamification] Profile endpoint error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Failed to fetch user profile")

@router.get("/activity-calendar")
def fetch_activity_calendar(auth: RequestAuth = Depends(get_request_auth_required)):
    """
    Fetches the distinct dates the user was active in the last 7 days.
    """
    try:
        active_dates = get_user_activity_calendar(user_id=auth.user_id)
        return {"status": "success", "data": active_dates}
    except Exception as e:
        print(f"[gamification] Activity calendar endpoint error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Failed to fetch activity calendar")

@router.get("/leaderboard")
def fetch_leaderboard(auth: RequestAuth = Depends(get_request_auth_required)):
    """
    Fetches the company leaderboard and formats it for the frontend.
    """
    try:
        if not auth.company_id:
            raise HTTPException(status_code=400, detail="Company ID missing")
        
        raw_leaderboard = get_leaderboard_users(company_id=auth.company_id)
        
        formatted = []
        for row in raw_leaderboard:
            user_data = row.get("users", {})
            formatted.append({
                "id": row.get("user_id"),
                "name": user_data.get("name", "Unknown User"),
                "role": user_data.get("role", "Employee"),
                "sprints_completed": row.get("drills_completed_count", 0), # Fallback mapping since sprints aren't fully tracked yet
                "xp": row.get("total_xp", 0),
                "badges_count": len(row.get("earned_badges", [])) if row.get("earned_badges") else 0,
                "avatar_color": user_data.get("avatar_color", "bg-slate-500"),
                "is_current_user": row.get("user_id") == auth.user_id
            })
            
        return {"status": "success", "data": formatted}
    except Exception as e:
        print(f"[gamification] Leaderboard endpoint error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Failed to fetch leaderboard")
