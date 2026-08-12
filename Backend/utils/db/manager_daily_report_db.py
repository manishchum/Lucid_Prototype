import logging
from typing import Dict, Any, List, Optional
from utils.supabase_client import supabase_admin

logger = logging.getLogger(__name__)

async def upsert_manager_daily_report(
    manager_id: str,
    report_date: str,
    manager_summary: Dict[str, Any],
    insights: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Insert or update the manager's daily aggregated report.
    """
    try:
        data = {
            "manager_id": manager_id,
            "report_date": report_date,
            "manager_summary": manager_summary,
            "insights": insights
        }
        
        # We use upsert with a conflict on manager_id and report_date
        # which requires an ON CONFLICT clause in Supabase.
        # Supabase Python client 'upsert' maps to POSTGRest upsert.
        response = supabase_admin.table("manager_daily_reports").upsert(
            data, on_conflict="manager_id,report_date"
        ).execute()
        
        if response.data:
            return {"data": response.data[0], "error": None}
        return {"data": None, "error": "Failed to upsert manager daily report."}
    except Exception as e:
        logger.error(f"Error in upsert_manager_daily_report: {e}")
        return {"data": None, "error": str(e)}

async def get_manager_daily_report_from_db(
    manager_id: str,
    report_date: str
) -> Optional[Dict[str, Any]]:
    """
    Fetch a specific day's manager report from the database.
    """
    try:
        response = supabase_admin.table("manager_daily_reports") \
            .select("report_date, insights, manager_summary, id") \
            .eq("manager_id", manager_id) \
            .eq("report_date", report_date) \
            .execute()
        
        if response.data and len(response.data) > 0:
            return response.data[0]
        return None
    except Exception as e:
        logger.error(f"Error in get_manager_daily_report_from_db: {e}")
        return None

async def get_manager_daily_reports_history(
    manager_id: str,
    limit: int = 30
) -> List[Dict[str, Any]]:
    """
    Fetch the historical daily reports for a manager, ordered by date descending.
    """
    try:
        response = supabase_admin.table("manager_daily_reports") \
            .select("report_date, insights, manager_summary, id") \
            .eq("manager_id", manager_id) \
            .order("report_date", desc=True) \
            .limit(limit) \
            .execute()
            
        return response.data or []
    except Exception as e:
        logger.error(f"Error in get_manager_daily_reports_history: {e}")
        return []
