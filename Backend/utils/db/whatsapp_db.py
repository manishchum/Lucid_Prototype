from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
from ..supabase_client import supabase, supabase_admin


# ── CREATE / INSERT OPERATIONS ──────────────────────────────────────

async def create_scheduled_whatsapp(
    company_id: str,
    message_body: str,
    schedule_type: str,  # 'one_time' or 'recurring'
    scheduled_time: str,  # "HH:MM" format
    processed_module_id: Optional[str] = None,
    original_module_id: Optional[str] = None,
    scheduled_date: Optional[str] = None,  # "YYYY-MM-DD" for one_time
    days_of_week: Optional[List[int]] = None,  # [0,1,2,3,4] for recurring
    media_url: Optional[str] = None,
    media_type: Optional[str] = None,
    is_active: bool = True,
) -> Dict[str, Any]:
    """
    Create a scheduled WhatsApp message.
    Returns: {"data": record, "error": None} or {"data": None, "error": "..."}
    """
    try:

        print("inside the sending payload")
        payload = {
            "company_id": company_id,
            "message_body": message_body,
            "schedule_type": schedule_type,
            "scheduled_time": scheduled_time,
            "is_active": is_active,
        }
        
        if processed_module_id:
            payload["processed_module_id"] = processed_module_id
        if original_module_id:
            payload["original_module_id"] = original_module_id
        if scheduled_date:
            payload["scheduled_date"] = scheduled_date
        if days_of_week is not None:
            payload["days_of_week"] = days_of_week
        if media_url:
            payload["media_url"] = media_url
        if media_type:
            payload["media_type"] = media_type
        
        print("Inserting this kind payload to database",payload)

        response = supabase_admin.table("scheduled_whatsapp").insert(payload).execute()
        print("this is the response fron the database")
        print(response)
        if response.data:
            return {"data": response.data[0], "error": None}
        return {"data": None, "error": "Insert returned no data"}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def create_whatsapp_dispatch_batch(
    scheduled_whatsapp_id: str,
    users_data: List[Dict[str, Any]],  # List of {user_id, phone_number}
) -> Dict[str, Any]:
    """
    Batch create whatsapp_dispatch records for multiple users.
    users_data: [{"user_id": "...", "phone_number": "+1234567890"}, ...]
    Returns: {"data": [records], "error": None}
    """
    try:
        if not users_data:
            return {"data": [], "error": None}
        
        payloads = [
            {
                "scheduled_whatsapp_id": scheduled_whatsapp_id,
                "user_id": user["user_id"],
                "phone_number": user["phone_number"],
                "status": "pending",
                "retry_count": 0,
                "max_retries": 3,
            }
            for user in users_data
            if user.get("phone_number")  # Only create if phone exists
        ]
        
        if not payloads:
            return {"data": [], "error": "No valid phone numbers in user list"}
        
        response = supabase_admin.table("whatsapp_dispatch").insert(payloads).execute()
        return {"data": response.data or [], "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


# ── QUERY OPERATIONS ────────────────────────────────────────────────

async def get_pending_scheduled_messages() -> Dict[str, Any]:
    """
    Get all active scheduled WhatsApp messages that are due to be sent today.
    
    For one_time: WHERE schedule_type='one_time' AND scheduled_date <= TODAY AND is_active=TRUE
    For recurring: WHERE schedule_type='recurring' AND EXTRACT(DOW, NOW()) = ANY(days_of_week) AND is_active=TRUE
    
    Returns list of scheduled_whatsapp records with their dispatch counts.
    """
    try:
        from datetime import date
        today = str(date.today())
        
        # Query one_time messages that are due
        one_time_response = (
            supabase_admin.table("scheduled_whatsapp")
            .select(
                "scheduled_whatsapp_id, company_id, message_body, schedule_type, "
                "scheduled_date, scheduled_time, days_of_week, media_type, media_url"
            )
            .eq("schedule_type", "one_time")
            .eq("is_active", True)
            .lte("scheduled_date", today)
            .execute()
        )
        
        # Query recurring messages (for recurring, we'll filter in Python since 
        # day-of-week matching is easier in app logic)
        recurring_response = (
            supabase_admin.table("scheduled_whatsapp")
            .select(
                "scheduled_whatsapp_id, company_id, message_body, schedule_type, "
                "scheduled_date, scheduled_time, days_of_week, media_type, media_url"
            )
            .eq("schedule_type", "recurring")
            .eq("is_active", True)
            .execute()
        )
        
        all_messages = (one_time_response.data or []) + (recurring_response.data or [])
        
        return {"data": all_messages, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_pending_dispatch_records(
    scheduled_whatsapp_id: str,
    status: str = "pending",
) -> Dict[str, Any]:
    """
    Get all dispatch records for a scheduled message with given status.
    Returns: {"data": [records], "error": None}
    """
    try:
        response = (
            supabase_admin.table("whatsapp_dispatch")
            .select(
                "whatsapp_dispatch_id, scheduled_whatsapp_id, user_id, phone_number, "
                "status, retry_count, max_retries"
            )
            .eq("scheduled_whatsapp_id", scheduled_whatsapp_id)
            .eq("status", status)
            .execute()
        )
        return {"data": response.data or [], "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_scheduled_whatsapp_by_id(
    scheduled_whatsapp_id: str,
) -> Dict[str, Any]:
    """
    Fetch a specific scheduled WhatsApp message.
    """
    try:
        response = (
            supabase_admin.table("scheduled_whatsapp")
            .select(
                "scheduled_whatsapp_id, company_id, message_body, schedule_type, "
                "scheduled_date, scheduled_time, days_of_week, is_active, created_at, "
                "original_module_id, processed_module_id, media_type, media_url"
            )
            .eq("scheduled_whatsapp_id", scheduled_whatsapp_id)
            .single()
            .execute()
        )
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_dispatch_record_by_id(
    whatsapp_dispatch_id: str,
) -> Dict[str, Any]:
    """
    Fetch a specific dispatch record.
    """
    try:
        response = (
            supabase_admin.table("whatsapp_dispatch")
            .select(
                "whatsapp_dispatch_id, scheduled_whatsapp_id, user_id, phone_number, "
                "status, whatsapp_message_id, attempted_at, delivered_at, error_message, "
                "retry_count, max_retries, created_at"
            )
            .eq("whatsapp_dispatch_id", whatsapp_dispatch_id)
            .single()
            .execute()
        )
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_scheduled_messages_by_company(
    company_id: str,
    limit: int = 100,
) -> Dict[str, Any]:
    """
    Get all scheduled WhatsApp messages for a company.
    """
    try:
        response = (
            supabase_admin.table("scheduled_whatsapp")
            .select(
                "scheduled_whatsapp_id, company_id, message_body, schedule_type, "
                "scheduled_date, scheduled_time, days_of_week, is_active, created_at, "
                "media_type, media_url"
            )
            .eq("company_id", company_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return {"data": response.data or [], "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


# ── UPDATE OPERATIONS ───────────────────────────────────────────────

async def update_dispatch_status(
    whatsapp_dispatch_id: str,
    status: str,
    whatsapp_message_id: Optional[str] = None,
    error_message: Optional[str] = None,
    delivered_at: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Update the status of a dispatch record.
    status: 'pending', 'queued', 'sent', 'delivered', 'failed'
    """
    try:
        payload = {
            "status": status,
            "attempted_at": datetime.utcnow().isoformat(),
        }
        
        if whatsapp_message_id:
            payload["whatsapp_message_id"] = whatsapp_message_id
        if error_message:
            payload["error_message"] = error_message
        if delivered_at:
            payload["delivered_at"] = delivered_at
        if status == "delivered" and not delivered_at:
            payload["delivered_at"] = datetime.utcnow().isoformat()
        
        response = (
            supabase_admin.table("whatsapp_dispatch")
            .update(payload)
            .eq("whatsapp_dispatch_id", whatsapp_dispatch_id)
            .execute()
        )
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def update_dispatch_retry_count(
    whatsapp_dispatch_id: str,
) -> Dict[str, Any]:
    """
    Increment retry_count for a dispatch record.
    """
    try:
        # First get current count
        get_result = await get_dispatch_record_by_id(whatsapp_dispatch_id)
        if get_result["error"] or not get_result["data"]:
            return {"data": None, "error": "Dispatch record not found"}
        
        current_count = get_result["data"].get("retry_count", 0)
        new_count = current_count + 1
        
        response = (
            supabase_admin.table("whatsapp_dispatch")
            .update({"retry_count": new_count})
            .eq("whatsapp_dispatch_id", whatsapp_dispatch_id)
            .execute()
        )
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def update_scheduled_whatsapp(
    scheduled_whatsapp_id: str,
    **kwargs,
) -> Dict[str, Any]:
    """
    Update a scheduled WhatsApp message.
    """
    try:
        if not kwargs:
            return {"data": None, "error": "No fields to update"}
        
        response = (
            supabase_admin.table("scheduled_whatsapp")
            .update(kwargs)
            .eq("scheduled_whatsapp_id", scheduled_whatsapp_id)
            .execute()
        )
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


# ── DELETION OPERATIONS ─────────────────────────────────────────────

async def deactivate_scheduled_whatsapp(
    scheduled_whatsapp_id: str,
) -> Dict[str, Any]:
    """
    Soft-delete a scheduled message by setting is_active=FALSE.
    """
    try:
        response = (
            supabase_admin.table("scheduled_whatsapp")
            .update({"is_active": False})
            .eq("scheduled_whatsapp_id", scheduled_whatsapp_id)
            .execute()
        )
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


# ── HELPER FUNCTIONS ────────────────────────────────────────────────

async def get_users_for_module(
    module_id: str,
    company_id: Optional[str] = None,
    specific_user_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Get all active users assigned to a module/sprint with their contact info.
    Restricts strictly to users assigned to this module/sprint in learning_plan.
    Returns: {"data": [{"user_id": "...", "phone_number": "+...", "name": "...", "email": "..."}], "error": None}
    """
    try:
        # 1. Resolve sprint (original_module_id) if module_id is a processed_module_id
        sprint_id = module_id
        try:
            pm_resp = (
                supabase_admin.table("processed_modules")
                .select("original_module_id")
                .eq("processed_module_id", module_id)
                .maybe_single()
                .execute()
            )
            if pm_resp.data and pm_resp.data.get("original_module_id"):
                sprint_id = pm_resp.data.get("original_module_id")
        except Exception:
            pass

        # 2. Query learning_plan for this sprint_id or module_id
        lp_query = supabase_admin.table("learning_plan").select("user_id, status")
        if sprint_id != module_id:
            lp_query = lp_query.or_(f"module_id.eq.{sprint_id},module_id.eq.{module_id}")
        else:
            lp_query = lp_query.eq("module_id", sprint_id)
        lp_response = lp_query.execute()

        assigned_user_ids = set()
        for row in (lp_response.data or []):
            uid = row.get("user_id")
            status = str(row.get("status") or "").strip().upper()
            if uid and status not in ["UNASSIGNED", "CANCELLED", "DELETED"]:
                assigned_user_ids.add(str(uid))

        passed_ids = set(str(uid) for uid in (specific_user_ids or []) if uid)
        # Ensure all users assigned to that sprint are included
        if assigned_user_ids:
            target_user_ids = list(assigned_user_ids.union(passed_ids))
        elif passed_ids:
            target_user_ids = list(passed_ids)
        else:
            return {"data": [], "error": None}

        # 3. Fetch user details with phone numbers
        users_query = (
            supabase_admin.table("users")
            .select("user_id, name, email, phone, company_id")
            .in_("user_id", target_user_ids)
            .eq("is_active", True)
        )

        users_response = users_query.execute()

        # Filter for users with valid phone numbers (10+ digits)
        users_with_phone = []
        for user in (users_response.data or []):
            raw_phone = str(user.get("phone") or "").strip()
            digits = "".join(filter(str.isdigit, raw_phone))
            if len(digits) >= 10:
                full_name = user.get("name") or "Learner"
                first_name = full_name.strip().split()[0] if full_name.strip() else "Learner"
                users_with_phone.append({
                    "user_id": str(user["user_id"]),
                    "phone_number": raw_phone,
                    "name": first_name,
                    "email": user.get("email", ""),
                })

        return {"data": users_with_phone, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_module_content(module_id: str) -> Dict[str, Any]:
    """
    Fetch processed module content (flashcards, audio, video, etc.)
    Supports querying by processed_module_id OR original_module_id (sprint ID).
    Resolves dynamic language variants and sprint visuals.
    """
    try:
        # 1. Try querying by processed_module_id
        response = (
            supabase_admin.table("processed_modules")
            .select(
                "processed_module_id, original_module_id, title, flashcard_data, audio_url, audio_url_hinglish, video_url, video_url_hinglish, mindmap_data, infographic_data"
            )
            .eq("processed_module_id", module_id)
            .maybe_single()
            .execute()
        )
        data = response.data

        # 2. If not found by processed_module_id, check if module_id is an original_module_id (sprint ID)
        if not data:
            pm_resp = (
                supabase_admin.table("processed_modules")
                .select(
                    "processed_module_id, original_module_id, title, flashcard_data, audio_url, audio_url_hinglish, video_url, video_url_hinglish, mindmap_data, infographic_data"
                )
                .eq("original_module_id", module_id)
                .order("order_index")
                .limit(1)
                .execute()
            )
            if pm_resp.data and len(pm_resp.data) > 0:
                data = pm_resp.data[0]

        # 3. If still not found, check training_modules
        if not data:
            tm_resp = (
                supabase_admin.table("training_modules")
                .select("module_id, title, description")
                .eq("module_id", module_id)
                .maybe_single()
                .execute()
            )
            if tm_resp.data:
                data = {
                    "processed_module_id": tm_resp.data.get("module_id"),
                    "original_module_id": tm_resp.data.get("module_id"),
                    "title": tm_resp.data.get("title"),
                    "flashcard_data": [],
                    "audio_url": None,
                    "video_url": None,
                }

        if not data:
            return {"data": None, "error": f"Module {module_id} not found"}

        # Resolve primary audio/video URLs (fallback to hinglish or other variants if available)
        if not data.get("audio_url") and data.get("audio_url_hinglish"):
            data["audio_url"] = data["audio_url_hinglish"]
        if not data.get("video_url") and data.get("video_url_hinglish"):
            data["video_url"] = data["video_url_hinglish"]

        # Fetch sprint image from vectordb_images as dynamic visual fallback
        orig_id = data.get("original_module_id") or module_id
        if orig_id:
            try:
                img_resp = (
                    supabase_admin.table("vectordb_images")
                    .select("image_url")
                    .eq("module_id", orig_id)
                    .limit(1)
                    .execute()
                )
                if img_resp.data and len(img_resp.data) > 0:
                    data["sprint_image_url"] = img_resp.data[0].get("image_url")
            except Exception:
                pass

        print(f"[get_module_content DEBUG] Successfully resolved dynamic content for module: {module_id}")
        return {"data": data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}