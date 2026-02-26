from typing import Dict, Any, List
from ..supabase_client import supabase


async def get_sprints_by_company(company_id: str) -> Dict[str, Any]:
    """Get all training_modules (sprints) for a company."""
    try:
        response = (
            supabase.table("training_modules")
            .select("module_id, title, description, processing_status, review_stage")
            .eq("company_id", company_id)
            .eq("processing_status", "completed")
            .order("created_at", desc=True)
            .execute()
        )
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_sub_modules_by_sprint(module_id: str) -> Dict[str, Any]:
    """Get all processed_modules for a given training_module (sprint)."""
    try:
        response = (
            supabase.table("processed_modules")
            .select("processed_module_id, title, section_type, order_index")
            .eq("original_module_id", module_id)
            .order("order_index")
            .execute()
        )
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_assigned_users_for_sprint(module_id: str) -> Dict[str, Any]:
    """
    Get all users assigned to a sprint via the learning_plan table.
    Returns user_id list from learning_plan, then fetches user details.
    """
    try:
        # Get user_ids from learning_plan for this module
        lp_response = (
            supabase.table("learning_plan")
            .select("user_id")
            .eq("module_id", module_id)
            .execute()
        )
        if not lp_response.data:
            return {"data": [], "error": None}

        user_ids = list({row["user_id"] for row in lp_response.data if row.get("user_id")})
        if not user_ids:
            return {"data": [], "error": None}

        # Fetch user details
        users_response = (
            supabase.table("users")
            .select("user_id, name, email")
            .in_("user_id", user_ids)
            .eq("is_active", True)
            .execute()
        )
        return {"data": users_response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}