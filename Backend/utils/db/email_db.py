from typing import Dict, Any, List, Optional
from datetime import datetime, date
from ..supabase_client import supabase


# ── CREATE / INSERT OPERATIONS ──────────────────────────────────────

async def create_scheduled_email(
    company_id: str,
    subject: str,
    body: str,
    recipient_emails: List[str],
    schedule_type: str,  # 'one_time' or 'recurring'
    scheduled_time: str,  # "HH:MM" format (UTC)
    processed_module_id: Optional[str] = None,
    original_module_id: Optional[str] = None,
    module_title: Optional[str] = None,
    scheduled_date: Optional[str] = None,  # "YYYY-MM-DD" for one_time
    days_of_week: Optional[List[int]] = None,  # [0,1,2,3,4] for recurring
    content_types: Optional[List[str]] = None,  # ["flashcards", "audio"]
    custom_flashcards: Optional[Dict[str, Any]] = None,
    custom_audio_url: Optional[str] = None,
    is_active: bool = True,
    created_by: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Create a scheduled email record in Supabase.
    
    Args:
        company_id: Company UUID
        subject: Email subject line
        body: Email HTML body
        recipient_emails: List of email addresses to send to
        schedule_type: 'one_time' or 'recurring'
        scheduled_time: "HH:MM" format in UTC
        processed_module_id: Optional module reference
        original_module_id: Optional original module reference
        module_title: Optional module title for display
        scheduled_date: Required for one_time: "YYYY-MM-DD"
        days_of_week: Required for recurring: [0-6] (0=Sun, 6=Sat)
        content_types: List of selected content types
        custom_flashcards: JSON object with custom flashcard data
        custom_audio_url: Custom audio URL override
        is_active: Whether this schedule is active
        created_by: User ID of who created this schedule
    
    Returns:
        {"data": record, "error": None} or {"data": None, "error": "..."}
    """
    try:
        payload = {
            "company_id": company_id,
            "subject": subject,
            "body": body,
            "recipient_emails": recipient_emails,
            "schedule_type": schedule_type,
            "scheduled_time": scheduled_time,
            "is_active": is_active,
            "status": "pending",
        }
        
        if processed_module_id:
            payload["processed_module_id"] = processed_module_id
        if original_module_id:
            payload["original_module_id"] = original_module_id
        if module_title:
            payload["module_title"] = module_title
        if scheduled_date:
            payload["scheduled_date"] = scheduled_date
        if days_of_week is not None:
            payload["days_of_week"] = days_of_week
        if content_types:
            payload["content_types"] = content_types
        if custom_flashcards:
            payload["custom_flashcards"] = custom_flashcards
        if custom_audio_url:
            payload["custom_audio_url"] = custom_audio_url
        if created_by:
            payload["created_by"] = created_by
        
        response = supabase.table("scheduled_emails").insert(payload).execute()
        
        if response.data:
            return {"data": response.data[0], "error": None}
        return {"data": None, "error": "Insert returned no data"}
    except Exception as e:
        return {"data": None, "error": str(e)}


# ── QUERY OPERATIONS ────────────────────────────────────────────────

async def get_pending_one_time_emails(
    scheduled_date: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Get all pending one-time emails that are due to be sent.
    
    If scheduled_date is provided, fetch emails for that specific date.
    Otherwise, fetch emails for today.
    
    Args:
        scheduled_date: Optional "YYYY-MM-DD" to filter by date
    
    Returns:
        {"data": [records], "error": None}
    """
    try:
        if scheduled_date is None:
            scheduled_date = str(date.today())
        
        response = (
            supabase.table("scheduled_emails")
            .select("*")
            .eq("schedule_type", "one_time")
            .eq("status", "pending")
            .eq("is_active", True)
            .eq("scheduled_date", scheduled_date)
            .execute()
        )
        
        return {"data": response.data or [], "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_pending_recurring_emails(
    days_of_week: List[int],
) -> Dict[str, Any]:
    """
    Get all pending recurring emails that are scheduled for today.
    
    Args:
        days_of_week: List of day-of-week integers matching today's day
    
    Returns:
        {"data": [records], "error": None}
    """
    try:
        # Query all recurring messages that are active
        response = (
            supabase.table("scheduled_emails")
            .select("*")
            .eq("schedule_type", "recurring")
            .eq("status", "pending")
            .eq("is_active", True)
            .execute()
        )
        
        # Filter in Python: check if any of today's days are in days_of_week
        matching = []
        for record in response.data or []:
            record_days = record.get("days_of_week") or []
            # Check if today matches any of the scheduled days
            if any(day in days_of_week for day in record_days):
                matching.append(record)
        
        return {"data": matching, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_all_pending_emails(
    today_date: Optional[str] = None,
    today_weekday: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Get all pending emails due to be sent (one-time + recurring).
    
    Args:
        today_date: Optional "YYYY-MM-DD", defaults to today
        today_weekday: Optional weekday (0-6), calculated if not provided
    
    Returns:
        {"data": [records], "error": None}
    """
    try:
        if today_date is None:
            today_date = str(date.today())
        
        if today_weekday is None:
            today_weekday = date.today().weekday()
            # Convert Python weekday (0=Mon) to ISO weekday (0=Sun)
            today_weekday = (today_weekday + 1) % 7
        
        # Get one-time emails due today
        one_time = await get_pending_one_time_emails(today_date)
        
        # Get recurring emails due today
        recurring = await get_pending_recurring_emails([today_weekday])
        
        if one_time["error"]:
            return one_time
        if recurring["error"]:
            return recurring
        
        all_pending = (one_time["data"] or []) + (recurring["data"] or [])
        return {"data": all_pending, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


# ── UPDATE OPERATIONS ───────────────────────────────────────────────

async def update_email_status(
    scheduled_email_id: str,
    status: str,
    sent_at: Optional[str] = None,
    last_error: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Update the status of a scheduled email.
    
    Args:
        scheduled_email_id: Email schedule UUID
        status: New status ('pending', 'sent', 'failed', 'paused', 'cancelled')
        sent_at: ISO timestamp when sent (only for status='sent')
        last_error: Error message if status='failed'
    
    Returns:
        {"data": record, "error": None} or {"data": None, "error": "..."}
    """
    try:
        payload = {
            "status": status,
        }
        
        if status == "sent" and sent_at:
            payload["sent_at"] = sent_at
        
        if status == "failed" and last_error:
            payload["last_error"] = last_error
        
        response = (
            supabase.table("scheduled_emails")
            .update(payload)
            .eq("scheduled_email_id", scheduled_email_id)
            .execute()
        )
        
        if response.data:
            return {"data": response.data[0], "error": None}
        return {"data": None, "error": "Update returned no data"}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def increment_retry_count(
    scheduled_email_id: str,
    last_error: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Increment retry count for a failed email send attempt.
    
    Args:
        scheduled_email_id: Email schedule UUID
        last_error: Optional error message to store
    
    Returns:
        {"data": record, "error": None} or {"data": None, "error": "..."}
    """
    try:
        # First, get the current retry_count
        get_response = (
            supabase.table("scheduled_emails")
            .select("retry_count, max_retries")
            .eq("scheduled_email_id", scheduled_email_id)
            .execute()
        )
        
        if not get_response.data:
            return {"data": None, "error": "Record not found"}
        
        email_data = get_response.data[0] if get_response.data else None
        if not email_data:
             return {"data": None, "error": "Record not found"}
        
        current_retry = email_data.get("retry_count", 0)
        max_retries = email_data.get("max_retries", 3)
        new_retry_count = current_retry + 1
        
        payload = {
            "retry_count": new_retry_count,
            "last_attempt_at": datetime.utcnow().isoformat(),
        }
        
        if last_error:
            payload["last_error"] = last_error
        
        # If we've exhausted retries, mark as failed
        if new_retry_count >= max_retries:
            payload["status"] = "failed"
        
        response = (
            supabase.table("scheduled_emails")
            .update(payload)
            .eq("scheduled_email_id", scheduled_email_id)
            .execute()
        )
        
        if response.data:
            return {"data": response.data[0], "error": None}
        return {"data": None, "error": "Update returned no data"}
    except Exception as e:
        return {"data": None, "error": str(e)}


# ── DELETE OPERATIONS ───────────────────────────────────────────────

async def delete_scheduled_email(
    scheduled_email_id: str,
) -> Dict[str, Any]:
    """
    Delete a scheduled email record.
    
    Args:
        scheduled_email_id: Email schedule UUID
    
    Returns:
        {"data": None, "error": None} on success or {"data": None, "error": "..."}
    """
    try:
        response = (
            supabase.table("scheduled_emails")
            .delete()
            .eq("scheduled_email_id", scheduled_email_id)
            .execute()
        )
        
        return {"data": None, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def pause_scheduled_email(
    scheduled_email_id: str,
) -> Dict[str, Any]:
    """
    Pause a scheduled email (set is_active to False).
    
    Args:
        scheduled_email_id: Email schedule UUID
    
    Returns:
        {"data": record, "error": None} or {"data": None, "error": "..."}
    """
    try:
        response = (
            supabase.table("scheduled_emails")
            .update({"is_active": False, "status": "paused"})
            .eq("scheduled_email_id", scheduled_email_id)
            .execute()
        )
        
        if response.data:
            return {"data": response.data[0], "error": None}
        return {"data": None, "error": "Update returned no data"}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def resume_scheduled_email(
    scheduled_email_id: str,
) -> Dict[str, Any]:
    """
    Resume a paused scheduled email (set is_active to True and status to pending).
    
    Args:
        scheduled_email_id: Email schedule UUID
    
    Returns:
        {"data": record, "error": None} or {"data": None, "error": "..."}
    """
    try:
        response = (
            supabase.table("scheduled_emails")
            .update({"is_active": True, "status": "pending"})
            .eq("scheduled_email_id", scheduled_email_id)
            .execute()
        )
        
        if response.data:
            return {"data": response.data[0], "error": None}
        return {"data": None, "error": "Update returned no data"}
    except Exception as e:
        return {"data": None, "error": str(e)}


# ── RETRIEVAL OPERATIONS ────────────────────────────────────────────

async def get_scheduled_email_by_id(
    scheduled_email_id: str,
) -> Dict[str, Any]:
    """
    Get a single scheduled email record by ID.
    
    Args:
        scheduled_email_id: Email schedule UUID
    
    Returns:
        {"data": record, "error": None} or {"data": None, "error": "..."}
    """
    try:
        response = (
            supabase.table("scheduled_emails")
            .select("*")
            .eq("scheduled_email_id", scheduled_email_id)
            .execute()
        )
        
        data = response.data[0] if response.data else None
        return {"data": data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_scheduled_emails_by_company(
    company_id: str,
    status: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Get all scheduled emails for a company.
    
    Args:
        company_id: Company UUID
        status: Optional filter by status
    
    Returns:
        {"data": [records], "error": None}
    """
    try:
        query = (
            supabase.table("scheduled_emails")
            .select("*")
            .eq("company_id", company_id)
        )
        
        if status:
            query = query.eq("status", status)
        
        response = query.order("created_at", desc=True).execute()
        
        return {"data": response.data or [], "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}
