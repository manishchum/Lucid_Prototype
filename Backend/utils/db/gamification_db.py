import traceback
from typing import Dict, Any, List, Optional
from utils.supabase_client import supabase, supabase_admin

def get_module_sprints(module_id: str, company_id: str) -> List[Dict[str, Any]]:
    """
    Why we need this: To fetch all gamification sprints associated with a specific training module
    so the frontend can display them to the user.
    """
    try:
        response = supabase.table("gamification_sprints") \
            .select("*, gamification_drills(*)") \
            .eq("module_id", module_id) \
            .eq("company_id", company_id) \
            .execute()
        return response.data if response.data else []
    except Exception as e:
        print(f"[gamification_db] Error fetching sprints for module {module_id}: {e}")
        traceback.print_exc()
        return []

def get_user_assigned_sprints(user_id: str, company_id: str) -> List[Dict[str, Any]]:
    """
    Fetches all active sprints for all modules assigned to the user in their learning plan.
    """
    try:
        # 1. Fetch assigned modules from learning_plan
        plan_res = supabase.table("learning_plan") \
            .select("module_id") \
            .eq("user_id", user_id) \
            .execute()
        
        module_ids = [row["module_id"] for row in plan_res.data]
        if not module_ids:
            return []

        # 2. Fetch all sprints for those modules
        res = supabase_admin.table("gamification_sprints") \
            .select("*, gamification_drills(*)") \
            .in_("module_id", module_ids) \
            .eq("company_id", company_id) \
            .eq("is_active", True) \
            .order("sprint_number") \
            .execute()
        
        print(f"[gamification_db] user_id: {user_id} | company_id: {company_id} | module_ids assigned: {module_ids} | sprints found: {len(res.data) if res.data else 0}")
        return res.data if res.data else []
    except Exception as e:
        print(f"[gamification_db] Error fetching assigned sprints for user {user_id}: {e}")
        traceback.print_exc()
        return []

def create_sprint_and_drills(
    module_id: str,
    company_id: str,
    sprint_title: str,
    sprint_description: str,
    sprint_number: int,
    drills: List[Dict[str, Any]]
) -> Optional[Dict[str, Any]]:
    """
    Why we need this: After the AI generates the 7 drill formats, we need to save the Sprint 
    and all associated Drills transactionally (or in rapid succession) to the database.
    """
    try:
        # 0. Calculate correct sprint_number
        max_sprint_res = supabase_admin.table("gamification_sprints").select("sprint_number").eq("company_id", company_id).order("sprint_number", desc=True).limit(1).execute()
        if max_sprint_res.data:
            sprint_number = max_sprint_res.data[0]["sprint_number"] + 1
        else:
            sprint_number = 1

        # 1. Create Sprint
        sprint_res = supabase_admin.table("gamification_sprints").insert({
            "company_id": company_id,
            "module_id": module_id,
            "sprint_number": sprint_number,
            "title": sprint_title,
            "description": sprint_description,
            "is_active": True
        }).execute()

        if not sprint_res.data:
            print("[gamification_db] Failed to create sprint.")
            return None
        
        sprint_id = sprint_res.data[0]["sprint_id"]

        # 2. Attach sprint_id and company_id to drills and insert
        for drill in drills:
            drill["sprint_id"] = sprint_id
            drill["company_id"] = company_id
        
        drill_res = supabase_admin.table("gamification_drills").insert(drills).execute()
        
        return {
            "sprint": sprint_res.data[0],
            "drills_created": len(drill_res.data) if drill_res.data else 0
        }
    except Exception as e:
        print(f"[gamification_db] Error creating sprint and drills: {e}")
        traceback.print_exc()
        return None

def submit_user_drill_progress(
    user_id: str,
    company_id: str,
    sprint_id: str,
    drill_id: str,
    completed: bool,
    earned_xp: int,
    wrong_attempts: int,
    completion_time_seconds: int
) -> Optional[Dict[str, Any]]:
    """
    Why we need this: To record a user's attempt at a drill. Because of the RLS policies, 
    the company_id is enforced. The database trigger 'fn_on_drill_completed' will automatically
    fire after this insert to update the user's total XP and streak!
    """
    try:
        res = supabase_admin.table("user_gamification_progress").upsert({
            "user_id": user_id,
            "company_id": company_id,
            "sprint_id": sprint_id,
            "drill_id": drill_id,
            "completed": completed,
            "earned_xp": earned_xp,
            "wrong_attempts": wrong_attempts,
            "completion_time_seconds": completion_time_seconds
        }, on_conflict="user_id, drill_id").execute()
        
        return res.data[0] if res.data else None
    except Exception as e:
        print(f"[gamification_db] Error submitting drill progress: {e}")
        traceback.print_exc()
        return None

def get_drill_base_xp(drill_id: str, company_id: str) -> int:
    """
    Fetches the base XP for a specific drill.
    """
    try:
        res = supabase.table("gamification_drills") \
            .select("base_xp") \
            .eq("drill_id", drill_id) \
            .eq("company_id", company_id) \
            .limit(1) \
            .execute()
        
        if res.data:
            return res.data[0].get("base_xp", 200)
    except Exception as e:
        print(f"[gamification_db] Error fetching drill base XP: {e}")
    
    return 200

def get_leaderboard_users(company_id: str) -> List[Dict[str, Any]]:
    """
    Fetches the top users for the company leaderboard.
    """
    try:
        res = supabase_admin.table("user_gamification_profiles") \
            .select("*, users!inner(name)") \
            .eq("company_id", company_id) \
            .order("total_xp", desc=True) \
            .limit(50) \
            .execute()
        return res.data if res.data else []
    except Exception as e:
        print(f"[gamification_db] Error fetching leaderboard for company {company_id}: {e}")
        traceback.print_exc()
        return []

def get_user_gamification_profile(user_id: str) -> Optional[Dict[str, Any]]:
    """
    Fetches the gamification profile for a specific user.
    """
    try:
        res = supabase_admin.table("user_gamification_profiles") \
            .select("*") \
            .eq("user_id", user_id) \
            .execute()
        return res.data[0] if res.data else None
    except Exception as e:
        print(f"[gamification_db] Error fetching profile for user {user_id}: {e}")
        return None

def get_user_completed_drills(user_id: str) -> List[Dict[str, Any]]:
    """
    Fetches a list of drill records that the user has already successfully completed.
    """
    try:
        res = supabase_admin.table("user_gamification_progress") \
            .select("drill_id, earned_xp") \
            .eq("user_id", user_id) \
            .eq("completed", True) \
            .execute()
        return res.data if res.data else []
    except Exception as e:
        print(f"[gamification_db] Error fetching completed drills for user {user_id}: {e}")
        return []
