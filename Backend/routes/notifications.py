from fastapi import APIRouter, HTTPException, Depends, WebSocket, WebSocketDisconnect, Query
import json
from pydantic import BaseModel, model_validator
from typing import List, Literal, Optional, Dict, Any
from datetime import datetime

from utils.auth_bridge import get_service_supabase_client
from utils.assignment_notifications import send_bulk_assignment_notification_emails
from utils.supabase_client import supabase
from utils.websocket_manager import manager
from utils.auth import RequestAuth, get_request_auth_required, get_request_auth_optional, _ensure_firebase_admin_initialized
from utils.notification_dispatcher import (
    dispatch_hybrid_notification,
    get_redis_unread_count,
    set_redis_unread_count,
    invalidate_redis_unread_count,
    ANDROID_CHANNEL_ID,
)
import firebase_admin
from firebase_admin import messaging



import logging

logger = logging.getLogger("lucid.notifications")

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


class AssignmentNotificationRequest(BaseModel):
    assignment_type: Literal["sprint", "roleplay"]
    assignment_title: str
    company_id: str
    target_type: Literal["user", "function", "sub_function"]
    target_ids: List[str]
    frontend_url: str | None = None


class RegisterTokenRequest(BaseModel):
    fcm_token: str


@router.post("/register-token")
async def register_token(
    request: RegisterTokenRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    try:
        service_client = get_service_supabase_client()
        resp = service_client.table("users").update({"fcm_token": request.fcm_token}).eq("user_id", user_id).execute()
        if not resp.data:
            raise HTTPException(status_code=404, detail="User not found")
        return {"success": True, "message": "FCM token registered successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class ModuleFeedbackRequest(BaseModel):
    module_id: str
    module_type: Optional[str] = None
    rating: Optional[int] = None
    thumbs_up: Optional[bool] = None
    comments: Optional[str] = None
    comment: Optional[str] = None
    feedback_tags: Optional[List[str]] = None
    completion_event_id: Optional[str] = None

@router.post("/feedback")
async def submit_module_feedback(
    request: ModuleFeedbackRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    try:
        service_client = get_service_supabase_client()
        from datetime import datetime, timezone
        now_iso = datetime.now(timezone.utc).isoformat()

        # Derive company_id
        company_id = auth_ctx.claims.get("company_id") if auth_ctx.claims else None
        if not company_id:
            u_res = service_client.table("users").select("company_id").eq("user_id", user_id).maybe_single().execute()
            company_id = (getattr(u_res, "data", None) or {}).get("company_id")

        # Compile feedback tags
        tags = list(request.feedback_tags or [])
        if request.thumbs_up is True and "thumbs_up" not in tags:
            tags.append("thumbs_up")
        elif request.thumbs_up is False and "thumbs_down" not in tags:
            tags.append("thumbs_down")
        if request.module_type and f"type:{request.module_type}" not in tags:
            tags.append(f"type:{request.module_type}")

        # Normalize rating (1 to 5)
        rating_val = request.rating
        if rating_val is None:
            if request.thumbs_up is True:
                rating_val = 5
            elif request.thumbs_up is False:
                rating_val = 1

        completion_event_id = request.completion_event_id or f"{user_id}:{request.module_id}:{now_iso}"
        comment_text = request.comment or request.comments or None

        resp = service_client.table("module_feedback").insert({
            "user_id": user_id,
            "company_id": company_id,
            "module_id": request.module_id,
            "completion_event_id": completion_event_id,
            "rating": rating_val,
            "feedback_tags": tags,
            "comment": comment_text,
            "status": "SUBMITTED",
            "submitted_at": now_iso,
        }).execute()
        return {"success": True, "message": "Feedback submitted successfully", "data": resp.data}
    except Exception as e:
        logger.error(f"[Feedback] Failed to record module feedback: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/unread-count")
async def get_unread_count(
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    cached_count = get_redis_unread_count(user_id)
    if cached_count is not None:
        return {"success": True, "unread_count": cached_count, "source": "redis"}

    try:
        service_client = get_service_supabase_client()
        resp = (
            service_client.table("notifications")
            .select("id", count="exact")
            .eq("user_id", user_id)
            .eq("read", False)
            .execute()
        )
        count = resp.count if resp.count is not None else len(resp.data or [])
        set_redis_unread_count(user_id, count)
        return {"success": True, "unread_count": count, "source": "db"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/")
async def list_notifications(
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    limit: int = Query(default=50, ge=1, le=200, description="Max records to return (1-200)"),
    offset: int = Query(default=0, ge=0, description="Number of records to skip")
):
    user_id = auth_ctx.user_id
    try:
        safe_limit = max(1, min(limit, 200))
        safe_offset = max(0, offset)
        service_client = get_service_supabase_client()
        resp = (
            service_client.table("notifications")
            .select("id,title,message,type,metadata,read,created_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .range(safe_offset, safe_offset + safe_limit - 1)
            .execute()
        )
        return {
            "success": True,
            "notifications": resp.data or [],
            "limit": safe_limit,
            "offset": safe_offset,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{notification_id}/read")
async def mark_notification_read(
    notification_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    try:
        service_client = get_service_supabase_client()
        resp = (
            service_client.table("notifications")
            .update({"read": True})
            .eq("id", notification_id)
            .eq("user_id", user_id)
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=404, detail="Notification not found or access denied")
        invalidate_redis_unread_count(user_id)
        return {"success": True, "notification": resp.data[0]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/read-all")
async def mark_all_notifications_read(
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    try:
        service_client = get_service_supabase_client()
        resp = (
            service_client.table("notifications")
            .update({"read": True})
            .eq("user_id", user_id)
            .eq("read", False)
            .execute()
        )
        invalidate_redis_unread_count(user_id)
        return {"success": True, "updated_count": len(resp.data or [])}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



@router.websocket("/ws")
async def websocket_notifications(
    websocket: WebSocket,
):
    """
    Secure real-time WebSocket notifications endpoint.
    Strictly verifies JWT identity before connecting. Never trusts unverified user_id parameters.
    """
    auth_token = websocket.query_params.get("token") or websocket.headers.get("Sec-WebSocket-Protocol")
    auth_user_id = None

    if auth_token:
        try:
            auth_ctx = get_request_auth_optional(authorization=f"Bearer {auth_token}")
            if auth_ctx and auth_ctx.user_id:
                auth_user_id = auth_ctx.user_id
        except Exception:
            pass

    await websocket.accept()

    # If not verified from query param/header, allow 3.0s window for initial auth payload frame
    if not auth_user_id:
        try:
            import asyncio, json
            init_text = await asyncio.wait_for(websocket.receive_text(), timeout=3.0)
            payload = json.loads(init_text)
            if payload.get("type") == "auth" and payload.get("token"):
                auth_ctx = get_request_auth_optional(authorization=f"Bearer {payload['token']}")
                if auth_ctx and auth_ctx.user_id:
                    auth_user_id = auth_ctx.user_id
        except Exception:
            pass

    if not auth_user_id:
        try:
            await websocket.send_json({"error": "Unauthorized: Valid JWT authentication token required"})
            await websocket.close(code=1008)
        except Exception:
            pass
        return

    await manager.connect(auth_user_id, websocket)
    try:
        while True:
            msg = await websocket.receive_text()
            if msg == "ping":
                await websocket.send_text("pong")
            elif msg.strip().startswith("{"):
                try:
                    import json
                    parsed = json.loads(msg)
                    if parsed.get("type") == "ping":
                        await websocket.send_json({"type": "pong"})
                except Exception:
                    pass
    except WebSocketDisconnect:
        
        manager.disconnect(auth_user_id, websocket)
    except Exception as e:
        manager.disconnect(auth_user_id, websocket)



@router.post("/assignment")
async def send_assignment_notification(
    request: AssignmentNotificationRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """Send assignment notifications. Caller must be authenticated and belong to the target company."""
    if not request.target_ids:
        raise HTTPException(status_code=400, detail="target_ids is required")

    # Validate caller belongs to the same company they are targeting,
    # unless they have an explicit super-admin / developer override.
    if auth_ctx.company_id and auth_ctx.company_id != request.company_id:
        from utils.db.permissions import check_user_permission
        try:
            is_admin = await check_user_permission(auth_ctx.user_id, "super_admin")
            is_dev = await check_user_permission(auth_ctx.user_id, "developer")
        except Exception:
            is_admin, is_dev = False, False
        if not (is_admin or is_dev):
            raise HTTPException(
                status_code=403,
                detail="Not authorized to send notifications for this company"
            )

    try:
        query = (
            supabase
            .table("users")
            .select("user_id, email, name, phone, fcm_token")
            .eq("company_id", request.company_id)
            .eq("is_active", True)
        )

        if request.target_type == "user":
            query = query.in_("user_id", request.target_ids)
        elif request.target_type == "sub_function":
            query = query.in_("sub_function_id", request.target_ids)
        else:
            selected_functions = (
                supabase
                .table("function")
                .select("function_name")
                .in_("function_id", request.target_ids)
                .eq("company_id", request.company_id)
                .execute()
            )
            function_names = list({
                row.get("function_name")
                for row in (selected_functions.data or [])
                if row.get("function_name")
            })

            if not function_names:
                return {
                    "success": True,
                    "sent_count": 0,
                    "failed_count": 0,
                    "message": "No matching functions found",
                }

            all_subfunctions = (
                supabase
                .table("function")
                .select("function_id")
                .in_("function_name", function_names)
                .eq("company_id", request.company_id)
                .execute()
            )
            all_function_ids = [
                row.get("function_id")
                for row in (all_subfunctions.data or [])
                if row.get("function_id")
            ]

            if not all_function_ids:
                return {
                    "success": True,
                    "sent_count": 0,
                    "failed_count": 0,
                    "message": "No matching recipients found",
                }

            query = query.in_("function_id", all_function_ids)

        result = query.execute()
        recipients = result.data or []

        if not recipients:
            return {
                "success": True,
                "sent_count": 0,
                "failed_count": 0,
                "message": "No matching recipients found",
            }

        company_result = (
            supabase
            .table("companies")
            .select("name")
            .eq("company_id", request.company_id)
            .single()
            .execute()
        )
        company_name = (company_result.data or {}).get("name", "Your company")

        # Categorize recipients: emails to users with email, real-time/push to ALL assignees
        email_recipients = []
        realtime_recipients = []

        for user in recipients:
            if user.get("email"):
                email_recipients.append(user)
            # In-app and push notifications deliver to all assignees
            realtime_recipients.append(user)
                
        # Decouple all dispatch (Email, WebSocket, FCM Push) to background ARQ worker queue
        # Prevents blocking the HTTP request thread during bulk assignments
        from utils.notification_dispatcher import schedule_bulk_notification_jobs
        
        all_user_ids = [u["user_id"] for u in recipients]
        sent_realtime = 0
        
        if all_user_ids:
            target_scr = "Sprint" if request.assignment_type == "sprint" else "Roleplay"
            metadata = {
                "assignment_title": request.assignment_title,
                "module_name": request.assignment_title,
                "module_type": request.assignment_type,
                "target_screen": target_scr,
                "company_id": request.company_id,
                "company_name": company_name,
                "frontend_url": request.frontend_url,
                "title": request.assignment_title,
                "channels": ["IN_APP", "PUSH", "EMAIL"],
            }
            
            await schedule_bulk_notification_jobs(
                user_ids=all_user_ids,
                notification_type="MODULE_ASSIGNED",
                metadata=metadata
            )
            sent_realtime = len(all_user_ids)

        return {
            "success": True,
            "message": f"Queued assignment notifications for {len(email_recipients)} email recipient(s) and {sent_realtime} mobile device(s)",
            "sent_emails": len(email_recipients),
            "sent_realtime": sent_realtime,
            "fcm_failed_count": 0,
            "fcm_failed_user_ids": [],
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ============================================================================
# NOTIFICATION TEMPLATES (DEVELOPER CONSOLE)
# ============================================================================

SUPPORTED_DYNAMIC_VARIABLES = [
    {
        "token": "{{first_name}}",
        "key": "first_name",
        "label": "First Name",
        "category": "Learner Profile",
        "description": "Recipient's given name",
        "sample": "Alex",
    },
    {
        "token": "{{last_name}}",
        "key": "last_name",
        "label": "Last Name",
        "category": "Learner Profile",
        "description": "Recipient's surname",
        "sample": "Morgan",
    },
    {
        "token": "{{company_name}}",
        "key": "company_name",
        "label": "Company Name",
        "category": "Learner Profile",
        "description": "Organization or enterprise name",
        "sample": "Acme Retail",
    },
    {
        "token": "{{module_name}}",
        "key": "module_name",
        "label": "Module Title",
        "category": "Curriculum",
        "description": "Sprint or training module title",
        "sample": "Store Associate Customer Excellence",
    },
    {
        "token": "{{due_date}}",
        "key": "due_date",
        "label": "Due Date",
        "category": "Curriculum",
        "description": "Formatted assignment completion deadline",
        "sample": "Tomorrow, 5:00 PM",
    },
    {
        "token": "{{time_remaining}}",
        "key": "time_remaining",
        "label": "Time Remaining",
        "category": "Curriculum",
        "description": "Humanized remaining duration before deadline",
        "sample": "24 hours",
    },
    {
        "token": "{{progress}}",
        "key": "progress",
        "label": "Progress %",
        "category": "Curriculum",
        "description": "Learner module completion percentage (0-100)",
        "sample": "65",
    },
    {
        "token": "{{score}}",
        "key": "score",
        "label": "Score %",
        "category": "Assessment",
        "description": "Quiz or assessment percentage achieved",
        "sample": "85",
    },
    {
        "token": "{{assessment_name}}",
        "key": "assessment_name",
        "label": "Assessment Name",
        "category": "Assessment",
        "description": "Title of the quiz or competency test",
        "sample": "Product Knowledge Benchmark",
    },
    {
        "token": "{{result_message}}",
        "key": "result_message",
        "label": "Result Message",
        "category": "Assessment",
        "description": "Summary feedback or evaluation rationale",
        "sample": "You have met all required competency standards.",
    },
    {
        "token": "{{streak_days}}",
        "key": "streak_days",
        "label": "Streak Days",
        "category": "Gamification",
        "description": "Current consecutive learning streak days",
        "sample": "7",
    },
    {
        "token": "{{completed_count}}",
        "key": "completed_count",
        "label": "Completed Count",
        "category": "Gamification",
        "description": "Total modules finished by the learner",
        "sample": "5",
    },
    {
        "token": "{{content_name}}",
        "key": "content_name", 
        "label": "Content Name",
        "category": "Recommendations",
        "description": "Title of recommended video or article",
        "sample": "Handling Difficult Customer Interactions",
    },
]


async def require_developer_role(user_id: str) -> None:
    """Verifies that the requesting user strictly has the developer role."""
    from utils.db.permissions import check_user_permission
    try:
        # Strictly check for developer role (level 6)
        if await check_user_permission(user_id, "developer"):
            return
    except Exception:
        pass

    try:
        service_client = get_service_supabase_client()
        role_res = service_client.table("user_role_assignments").select("roles(name, level)").eq("user_id", user_id).execute()
        for r in (role_res.data or []):
            role_data = r.get("roles") or {}
            role_name = (role_data.get("name") or "").lower()
            role_lvl = role_data.get("level") or 0
            if role_name == "developer" or role_lvl >= 6:
                return
    except Exception:
        pass

    raise HTTPException(
        status_code=403,
        detail="Forbidden: Developer role required to access and manage automated notification templates."
    )


class GlobalNotificationSettingsUpdateRequest(BaseModel):
    in_app_enabled: Optional[bool] = None
    push_enabled: Optional[bool] = None
    email_enabled: Optional[bool] = None
    whatsapp_enabled: Optional[bool] = None
    deadline_reminders_enabled: Optional[bool] = None
    post_completion_enabled: Optional[bool] = None
    streak_notifications_enabled: Optional[bool] = None
    quiet_hours_enabled: Optional[bool] = None
    quiet_hours_start: Optional[str] = None
    quiet_hours_end: Optional[str] = None
    max_daily_per_user: Optional[int] = None
    disabled_event_keys: Optional[List[str]] = None
    event_policies: Optional[Dict[str, Any]] = None


@router.get("/admin/global-settings")
async def get_global_notification_settings(
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    """Fetches system-wide global notification policies and channel controls (Developer role required)."""
    await require_developer_role(auth_ctx.user_id)
    try:
        service_client = get_service_supabase_client()
        res = service_client.table("global_notification_settings").select("*").eq("id", "global_default").maybe_single().execute()
        settings = getattr(res, "data", None)
        if not settings:
            default_row = {
                "id": "global_default",
                "in_app_enabled": True,
                "push_enabled": True,
                "email_enabled": True,
                "whatsapp_enabled": False,
                "deadline_reminders_enabled": True,
                "post_completion_enabled": True,
                "streak_notifications_enabled": True,
                "quiet_hours_enabled": False,
                "quiet_hours_start": "22:00",
                "quiet_hours_end": "08:00",
                "max_daily_per_user": 10,
                "disabled_event_keys": [],
                "event_policies": {},
            }
            ins = service_client.table("global_notification_settings").insert(default_row).execute()
            settings = ins.data[0] if ins.data else default_row
        return {"success": True, "settings": settings}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/admin/global-settings")
async def update_global_notification_settings(
    request: GlobalNotificationSettingsUpdateRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    """Updates system-wide global notification policies (Developer role required)."""
    await require_developer_role(auth_ctx.user_id)
    payload = {k: v for k, v in request.model_dump().items() if v is not None}
    if not payload:
        raise HTTPException(status_code=400, detail="No fields provided for update")
    payload["updated_by"] = auth_ctx.user_id
    from datetime import timezone
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    try:
        service_client = get_service_supabase_client()
        res = service_client.table("global_notification_settings").update(payload).eq("id", "global_default").execute()
        updated = res.data[0] if res.data else payload
        from utils.notification_dispatcher import invalidate_global_notification_settings_cache
        invalidate_global_notification_settings_cache()
        try:
            from utils.redis_client import redis_client
            redis_client.delete("settings:disabled_events")
        except Exception:
            pass
        return {"success": True, "message": "Global notification settings saved successfully", "settings": updated}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


from utils.notifications.template_engine import (
    TemplateCompiler,
    TemplateLinter,
    normalize_token_key,
    CHANNEL_CONSTRAINTS,
    compute_content_hash,
)
import uuid as _uuid_lib


class TemplateRollbackRequest(BaseModel):
    target_version: int



from utils.notifications.registry_contracts import (
    get_system_variables,
    get_system_variable_samples,
    get_system_event_presets,
    SYSTEM_VARIABLE_MAP,
)


class EventTriggerRequest(BaseModel):
    event_key: str
    recipient_user_id: str
    payload: Dict[str, Any]
    correlation_id: Optional[str] = None
    bypass_throttle: bool = False


class TemplateValidateRequest(BaseModel):
    title_template: Optional[str] = None
    body_template: str
    channel: str = "ALL"
    custom_sample_context: Optional[Dict[str, Any]] = None


class NotificationTemplateCreateRequest(BaseModel):
    notification_type: str
    template_name: Optional[str] = None
    category: Optional[str] = "GENERAL"
    channel: Literal["IN_APP", "PUSH", "EMAIL", "WHATSAPP", "ALL"] = "ALL"
    variation_index: Optional[int] = None
    title_template: Optional[str] = None
    body_template: str
    cta_label: Optional[str] = None
    cta_url: Optional[str] = None
    fallback_defaults: Dict[str, Any] = {}
    language: str = "en"
    version: int = 1
    status: Literal["DRAFT", "VALIDATED", "PUBLISHED", "ARCHIVED"] = "PUBLISHED"
    is_active: bool = True

    @model_validator(mode="before")
    @classmethod
    def parse_string_if_needed(cls, data):
        if isinstance(data, str):
            try:
                return json.loads(data)
            except Exception:
                pass
        return data


class NotificationTemplateUpdateRequest(BaseModel):
    template_name: Optional[str] = None
    title_template: Optional[str] = None
    body_template: Optional[str] = None
    category: Optional[str] = None
    cta_label: Optional[str] = None
    cta_url: Optional[str] = None
    fallback_defaults: Optional[Dict[str, Any]] = None
    channel: Optional[Literal["IN_APP", "PUSH", "EMAIL", "WHATSAPP", "ALL"]] = None
    variation_index: Optional[int] = None
    status: Optional[Literal["DRAFT", "VALIDATED", "PUBLISHED", "ARCHIVED"]] = None
    is_active: Optional[bool] = None

    @model_validator(mode="before")
    @classmethod
    def parse_string_if_needed(cls, data):
        if isinstance(data, str):
            try:
                return json.loads(data)
            except Exception:
                pass
        return data


class TestSendTemplateRequest(BaseModel):
    template_id: Optional[str] = None
    notification_type: Optional[str] = None
    title_template: Optional[str] = None
    body_template: Optional[str] = None
    channel: Optional[str] = "ALL"
    custom_variables: Optional[Dict[str, Any]] = None

    @model_validator(mode="before")
    @classmethod
    def parse_string_if_needed(cls, data):
        if isinstance(data, str):
            try:
                return json.loads(data)
            except Exception:
                pass
        return data


# ─────────────────────────────────────────────────────────────────
# 1. VARIABLE & EVENT PRESET SYSTEM CONTRACTS (READ-ONLY)
# ─────────────────────────────────────────────────────────────────

@router.get("/registry/variables")
async def get_variable_registry(
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """Returns the standardized system variable catalog for template editing and previews."""
    return {
        "success": True,
        "variables": get_system_variables(),
        "sample_context": get_system_variable_samples(),
    }


@router.get("/registry/presets")
async def get_event_presets(
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """Returns all standardized system event trigger presets."""
    return {
        "success": True,
        "presets": get_system_event_presets(),
    }


@router.post("/events/trigger")
async def trigger_event_bus(
    request: EventTriggerRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """
    Unified entrypoint to trigger contract-validated notification events.
    Enforces JSON schema validation, applies registered fallbacks, and routes to ARQ / Hybrid Dispatcher.
    """
    await require_developer_role(auth_ctx.user_id)
    from utils.notifications.event_bus import publish_event
    result = await publish_event(
        event_key=request.event_key,
        recipient_user_id=request.recipient_user_id,
        payload=request.payload,
        correlation_id=request.correlation_id,
        bypass_throttle=request.bypass_throttle,
    )
    if not result.get("success"):
        if result.get("error_code") == "SCHEMA_VALIDATION_FAILED":
            raise HTTPException(status_code=422, detail={
                "message": "Event payload failed contract validation",
                "errors": result.get("errors"),
                "event_key": request.event_key
            })
        raise HTTPException(status_code=400, detail=result.get("message", "Event triggering failed"))
    return result


# ─────────────────────────────────────────────────────────────────
# 3. REAL-TIME TEMPLATE LINTER & VALIDATION ENDPOINT
# ─────────────────────────────────────────────────────────────────

@router.post("/templates/validate")
async def validate_template_draft(
    request: TemplateValidateRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """
    Validates a template against syntax rules, the variable registry contract,
    channel recommended/hard limits, exact-duplicate content, and conflict warnings.
    """
    known_vars = SYSTEM_VARIABLE_MAP
    sample_ctx = get_system_variable_samples()

    # Merge custom developer preview overrides if provided
    if request.custom_sample_context:
        sample_ctx.update(request.custom_sample_context)

    lint_result = TemplateLinter.lint(
        title_template=request.title_template,
        body_template=request.body_template,
        channel=request.channel,
        known_variables=known_vars,
        sample_context=sample_ctx,
    )

    # Content Fingerprint & Duplicate / Conflict Detection
    content_hash = compute_content_hash(
        title_template=request.title_template,
        body_template=request.body_template,
        channel=request.channel,
    )
    lint_result["content_hash"] = content_hash

    # Check for exact duplicates in database
    try:
        service_client = get_service_supabase_client()
        dup_query = (
            service_client.table("notification_templates")
            .select("id, notification_type, channel, variation_index")
            .eq("content_hash", content_hash)
            .eq("is_active", True)
            .execute()
        )
        duplicates = dup_query.data or []
        if duplicates:
            lint_result["exact_duplicate"] = True
            lint_result["duplicate_matches"] = duplicates
            lint_result["warnings"].append(
                f"Exact duplicate template detected: identical content exists in template '{duplicates[0]['notification_type']}' (ID: {duplicates[0]['id']})."
            )
        else:
            lint_result["exact_duplicate"] = False
    except Exception as de:
        logger.debug(f"Duplicate template check warning: {de}")

    return {
        "success": True,
        "is_valid": lint_result["valid"],
        "validation_errors": lint_result["hard_errors"],
        "lint": lint_result,
    }


# ─────────────────────────────────────────────────────────────────
# 4. TEMPLATE CRUD, VERSIONING & ROLLBACK ENDPOINTS
# ─────────────────────────────────────────────────────────────────

@router.get("/templates/variables")
async def get_template_variables_legacy(
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """Legacy backward-compatible endpoint for variables."""
    return await get_variable_registry(auth_ctx)


@router.get("/templates")
async def list_notification_templates(
    notification_type: Optional[str] = None,
    channel: Optional[str] = None,
    category: Optional[str] = None,
    is_active: Optional[bool] = None,
    limit: int = Query(default=100, ge=1, le=500, description="Max records to return (1-500)"),
    offset: int = Query(default=0, ge=0, description="Number of records to skip"),
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """Lists global notification templates with status and version."""
    try:
        actual_limit = limit.default if hasattr(limit, "default") else limit
        actual_offset = offset.default if hasattr(offset, "default") else offset
        safe_limit = max(1, min(int(actual_limit or 100), 500))
        safe_offset = max(0, int(actual_offset or 0))
        service_client = get_service_supabase_client()
        query = service_client.table("notification_templates").select("*")
        if notification_type:
            query = query.eq("notification_type", notification_type)
        if channel:
            query = query.eq("channel", channel)
        if category and category.upper() != "ALL":
            query = query.eq("category", category.upper())
        if is_active is not None:
            query = query.eq("is_active", is_active)

        query = (
            query.order("created_at", desc=True)
            .order("notification_type", desc=False)
            .order("variation_index", desc=False)
            .range(safe_offset, safe_offset + safe_limit - 1)
        )
        resp = query.execute()
        return {
            "success": True,
            "templates": resp.data or [],
            "limit": safe_limit,
            "offset": safe_offset,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/templates")
async def create_notification_template(
    request: NotificationTemplateCreateRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """
    Creates a new template. Strictly enforces linter hard errors and blocks exact duplicates
    while allowing legitimate distinct variations for the same notification type.
    """
    await require_developer_role(auth_ctx.user_id)
    service_client = get_service_supabase_client()

    # Load registry for compile-time validation
    known_vars = SYSTEM_VARIABLE_MAP
    sample_ctx = get_system_variable_samples()

    lint_result = TemplateLinter.lint(
        title_template=request.title_template,
        body_template=request.body_template,
        channel=request.channel,
        known_variables=known_vars,
        sample_context=sample_ctx,
    )

    # Block publish if hard errors exist
    if not lint_result["valid"] and request.status == "PUBLISHED":
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Template failed validation. Please resolve hard errors before publishing.",
                "hard_errors": lint_result["hard_errors"],
                "warnings": lint_result["warnings"],
            },
        )

    # Compute deterministic content hash for duplicate prevention
    content_hash = compute_content_hash(
        title_template=request.title_template,
        body_template=request.body_template,
        channel=request.channel,
        cta_label=request.cta_label,
    )

    # Block exact duplicates with identical normalized content in active scope
    try:
        dup_res = (
            service_client.table("notification_templates")
            .select("id, notification_type, variation_index")
            .eq("content_hash", content_hash)
            .eq("is_active", True)
            .execute()
        )
        if dup_res.data and len(dup_res.data) > 0:
            existing = dup_res.data[0]
            raise HTTPException(
                status_code=409,
                detail=f"Exact duplicate template rejected: an active template with identical normalized content already exists (ID: {existing['id']}, Type: {existing['notification_type']}).",
            )
    except HTTPException:
        raise
    except Exception as ex:
        logger.debug(f"Duplicate query check skipped: {ex}")

    try:
        var_idx = request.variation_index
        if var_idx is None:
            existing_vars = (
                service_client.table("notification_templates")
                .select("variation_index")
                .eq("notification_type", request.notification_type.strip().upper())
                .eq("channel", request.channel or "ALL")
                .order("variation_index", desc=True)
                .limit(1)
                .execute()
            )
            if existing_vars.data and len(existing_vars.data) > 0:
                var_idx = (existing_vars.data[0].get("variation_index") or 0) + 1
            else:
                var_idx = 0

        insert_data = {
            "notification_type": request.notification_type.strip().upper(),
            "template_name": request.template_name.strip() if request.template_name else None,
            "category": (request.category or "GENERAL").strip().upper(),
            "channel": request.channel or "ALL",
            "variation_index": var_idx,
            "title_template": request.title_template.strip() if request.title_template else None,
            "body_template": request.body_template.strip(),
            "cta_label": request.cta_label.strip() if request.cta_label else None,
            "cta_url": request.cta_url.strip() if request.cta_url else None,
            "fallback_defaults": request.fallback_defaults or {},
            "language": request.language,
            "version": request.version,
            "status": request.status,
            "is_active": request.is_active,
            "content_hash": content_hash,
        }
        resp = service_client.table("notification_templates").insert(insert_data).execute()
        if not resp.data:
            raise HTTPException(status_code=400, detail="Failed to create template")

        created_template = resp.data[0]
        created_id = created_template["id"]

        # If published, create immutable version snapshot (v1)
        if request.status == "PUBLISHED":
            try:
                service_client.table("notification_template_versions").insert({
                    "template_id": created_id,
                    "version_number": 1,
                    "notification_type": created_template["notification_type"],
                    "channel": created_template["channel"],
                    "title_template": created_template["title_template"],
                    "body_template": created_template["body_template"],
                    "cta_label": created_template["cta_label"],
                    "content_hash": content_hash,
                    "published_by": auth_ctx.user_id,
                }).execute()
            except Exception as ve:
                logger.warning(f"Failed to record initial template version: {ve}")

        return {
            "success": True,
            "message": "Notification template created successfully",
            "template": created_template,
            "lint_report": lint_result,
        }
    except HTTPException:
        raise
    except Exception as e:
        err_msg = str(e)
        if "unique" in err_msg.lower() or "duplicate" in err_msg.lower():
            raise HTTPException(
                status_code=409,
                detail=f"Template variation #{var_idx if 'var_idx' in locals() else request.variation_index} for type '{request.notification_type}' and channel '{request.channel}' already exists.",
            )
        raise HTTPException(status_code=500, detail=err_msg)


@router.put("/templates/{template_id}")
async def update_notification_template(
    template_id: str,
    request: NotificationTemplateUpdateRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """
    Updates an existing template. If published, increments version and creates an immutable snapshot.
    """
    await require_developer_role(auth_ctx.user_id)
    service_client = get_service_supabase_client()

    # Fetch current template
    current_res = (
        service_client.table("notification_templates")
        .select("*")
        .eq("id", template_id)
        .maybe_single()
        .execute()
    )
    current = getattr(current_res, "data", None)
    if not current:
        raise HTTPException(status_code=404, detail="Template not found")

    new_title = request.title_template.strip() if request.title_template is not None else current.get("title_template")
    new_body = request.body_template.strip() if request.body_template is not None else current.get("body_template")
    new_channel = request.channel if request.channel is not None else current.get("channel", "ALL")
    new_cta = request.cta_label.strip() if request.cta_label is not None else current.get("cta_label")
    new_status = request.status if request.status is not None else current.get("status", "DRAFT")

    # Compute new hash
    new_hash = compute_content_hash(
        title_template=new_title,
        body_template=new_body or "",
        channel=new_channel,
        cta_label=new_cta,
    )

    update_data: Dict[str, Any] = {
        "content_hash": new_hash,
    }
    if request.template_name is not None:
        update_data["template_name"] = request.template_name.strip()
    if request.title_template is not None:
        update_data["title_template"] = new_title
    if request.body_template is not None:
        update_data["body_template"] = new_body
    if request.cta_label is not None:
        update_data["cta_label"] = new_cta
    if request.cta_url is not None:
        update_data["cta_url"] = request.cta_url.strip()
    if request.fallback_defaults is not None:
        update_data["fallback_defaults"] = request.fallback_defaults
    if request.channel is not None:
        update_data["channel"] = new_channel
    if request.variation_index is not None:
        update_data["variation_index"] = request.variation_index
    if request.category is not None:
        update_data["category"] = request.category.strip().upper()
    if request.status is not None:
        update_data["status"] = new_status
    if request.is_active is not None:
        update_data["is_active"] = request.is_active

    # Check if this update represents a new published version
    current_version = int(current.get("version") or 1)
    is_publishing_new_version = (new_status == "PUBLISHED" and (new_hash != current.get("content_hash") or current.get("status") != "PUBLISHED"))

    if is_publishing_new_version:
        new_version = current_version + 1
        update_data["version"] = new_version
    else:
        new_version = current_version

    try:
        resp = service_client.table("notification_templates").update(update_data).eq("id", template_id).execute()
        if not resp.data:
            raise HTTPException(status_code=404, detail="Template not found")

        updated_template = resp.data[0]

        # Record immutable version snapshot when published
        if is_publishing_new_version:
            try:
                service_client.table("notification_template_versions").insert({
                    "template_id": template_id,
                    "version_number": new_version,
                    "notification_type": updated_template["notification_type"],
                    "channel": updated_template["channel"],
                    "title_template": updated_template["title_template"],
                    "body_template": updated_template["body_template"],
                    "cta_label": updated_template["cta_label"],
                    "content_hash": new_hash,
                    "published_by": auth_ctx.user_id,
                }).execute()
            except Exception as ve:
                logger.warning(f"Failed to record template version snapshot: {ve}")

        return {
            "success": True,
            "message": "Notification template updated",
            "template": updated_template,
            "version_created": is_publishing_new_version,
            "version": new_version,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/templates/{template_id}/versions")
async def get_template_versions(
    template_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """
    Returns the immutable published version history for a given template.
    """
    try:
        service_client = get_service_supabase_client()
        res = (
            service_client.table("notification_template_versions")
            .select("*")
            .eq("template_id", template_id)
            .order("version_number", desc=True)
            .execute()
        )
        return {
            "success": True,
            "template_id": template_id,
            "versions": res.data or [],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/templates/{template_id}/rollback")
async def rollback_template_version(
    template_id: str,
    request: TemplateRollbackRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """
    Rolls back a template to an earlier immutable published version without mutating historical records.
    """
    await require_developer_role(auth_ctx.user_id)
    service_client = get_service_supabase_client()

    # Find the requested version snapshot
    v_res = (
        service_client.table("notification_template_versions")
        .select("*")
        .eq("template_id", template_id)
        .eq("version_number", request.target_version)
        .maybe_single()
        .execute()
    )
    v_data = getattr(v_res, "data", None)
    if not v_data:
        raise HTTPException(
            status_code=404,
            detail=f"Version {request.target_version} not found for template {template_id}",
        )

    # Fetch current version
    t_res = (
        service_client.table("notification_templates")
        .select("version")
        .eq("id", template_id)
        .maybe_single()
        .execute()
    )
    current_ver = int((t_res.data or {}).get("version") or 1)
    new_version_num = current_ver + 1

    # Restore definition and create new active version
    update_payload = {
        "title_template": v_data["title_template"],
        "body_template": v_data["body_template"],
        "cta_label": v_data.get("cta_label"),
        "channel": v_data["channel"],
        "content_hash": v_data["content_hash"],
        "version": new_version_num,
        "status": "PUBLISHED",
        "is_active": True,
    }

    try:
        resp = service_client.table("notification_templates").update(update_payload).eq("id", template_id).execute()
        
        # Save restored version snapshot
        service_client.table("notification_template_versions").insert({
            "template_id": template_id,
            "version_number": new_version_num,
            "notification_type": v_data["notification_type"],
            "channel": v_data["channel"],
            "title_template": v_data["title_template"],
            "body_template": v_data["body_template"],
            "cta_label": v_data.get("cta_label"),
            "content_hash": v_data["content_hash"],
            "published_by": auth_ctx.user_id,
        }).execute()

        return {
            "success": True,
            "message": f"Successfully rolled back template to version {request.target_version}. New active version is {new_version_num}.",
            "template": resp.data[0] if resp.data else None,
            "restored_from_version": request.target_version,
            "new_version": new_version_num,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/templates/{template_id}")
async def delete_notification_template(
    template_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """Deletes a notification template."""
    await require_developer_role(auth_ctx.user_id)
    try:
        service_client = get_service_supabase_client()
        resp = service_client.table("notification_templates").delete().eq("id", template_id).execute()
        return {"success": True, "message": "Notification template deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────────────────────────
# 5. DISPATCH AUDIT & TEST CENTER
# ─────────────────────────────────────────────────────────────────

@router.get("/audit/dispatches")
async def get_dispatch_audit_logs(
    limit: int = 30,
    offset: int = 0,
    is_test: Optional[bool] = None,
    status: Optional[str] = None,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """Returns dispatch audit logs with resolved variables, lifecycle states, and provider responses."""
    try:
        service_client = get_service_supabase_client()
        query = (
            service_client.table("notification_dispatch_audit")
            .select("*, users:recipient_user_id(name, email)")
            .order("created_at", desc=True)
            .range(offset, offset + limit - 1)
        )
        if is_test is not None:
            query = query.eq("is_test", is_test)
        if status:
            query = query.eq("status", status)

        res = query.execute()
        return {"success": True, "audit_logs": res.data or []}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/templates/test-send")
async def send_test_notification_template(
    request: TestSendTemplateRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """
    Renders and dispatches a live test notification directly to the authenticated developer,
    using their actual user profile for subscriber.* variables, executing filters safely,
    and recording complete lifecycle stages into the dispatch audit log.
    """
    await require_developer_role(auth_ctx.user_id)
    user_id = auth_ctx.user_id
    service_client = get_service_supabase_client()
    correlation_id = f"test_{_uuid_lib.uuid4().hex[:12]}"

    # Fetch developer's real profile for personalized preview
    dev_name = "Developer"
    dev_first_name = "Developer"
    dev_company = "Lucid Platform"
    try:
        user_res = (
            service_client.table("users")
            .select("name, email, company_id, companies:company_id(name)")
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
        if user_res.data:
            full_n = user_res.data.get("name") or "Developer"
            dev_name = full_n
            dev_first_name = full_n.split(" ")[0] if full_n else "Developer"
            co = user_res.data.get("companies")
            if co and isinstance(co, dict) and co.get("name"):
                dev_company = co.get("name")
    except Exception:
        pass

    # Load variable registry contracts
    context: Dict[str, Any] = get_system_variable_samples()
    # Inject real developer profile
    context["subscriber.first_name"] = dev_first_name
    context["first_name"] = dev_first_name
    context["subscriber.full_name"] = dev_name
    context["full_name"] = dev_name
    context["subscriber.company_name"] = dev_company
    context["company_name"] = dev_company

    if request.custom_variables:
        context.update(request.custom_variables)

    # Resolve template strings
    title_str = request.title_template or ""
    body_str = request.body_template or ""
    notif_type = request.notification_type or "TEST_NOTIFICATION"

    if request.template_id:
        tpl_res = (
            service_client.table("notification_templates")
            .select("*")
            .eq("id", request.template_id)
            .maybe_single()
            .execute()
        )
        tpl = getattr(tpl_res, "data", None)
        if tpl:
            title_str = tpl.get("title_template") or title_str
            body_str = tpl.get("body_template") or body_str
            notif_type = tpl.get("notification_type") or notif_type

    if not body_str:
        raise HTTPException(status_code=400, detail="Template body cannot be empty")

    # Safe render with filter support
    reg_vars = SYSTEM_VARIABLE_MAP
    rendered_title, unres_title = TemplateCompiler.render(title_str, context, reg_vars, use_fallbacks=True)
    rendered_body, unres_body = TemplateCompiler.render(body_str, context, reg_vars, use_fallbacks=True)

    unresolved_required = list(set(unres_title + unres_body))
    validation_status = "VALIDATED" if not unresolved_required else "VALIDATION_FAILED"

    # Audit record tracking
    audit_record = {
        "correlation_id": correlation_id,
        "template_id": request.template_id if request.template_id else None,
        "notification_type": notif_type,
        "channel": request.channel or "ALL",
        "recipient_user_id": user_id,
        "status": validation_status,
        "resolved_variables": {k: str(v) for k, v in context.items() if k in (title_str + body_str)},
        "rendered_title": rendered_title,
        "rendered_body": rendered_body,
        "validation_errors": unresolved_required if unresolved_required else None,
        "is_test": True,
        "dispatched_by": user_id,
    }

    if unresolved_required:
        audit_record["status"] = "VALIDATION_FAILED"
        audit_record["failure_reason"] = f"Missing required variables: {', '.join(unresolved_required)}"
        try:
            service_client.table("notification_dispatch_audit").insert(audit_record).execute()
        except Exception:
            pass
        raise HTTPException(
            status_code=422,
            detail=f"Dispatch rejected: required variables missing: {', '.join(unresolved_required)}",
        )

    # Dispatch notification to developer
    try:
        dispatch_res = await dispatch_hybrid_notification(
            user_id=user_id,
            title=rendered_title or "Test Notification",
            message=rendered_body,
            notif_type=notif_type,
            metadata={
                "is_test": True,
                "correlation_id": correlation_id,
                "template_id": request.template_id,
                "dispatched_by": user_id,
                "rendered_at": datetime.utcnow().isoformat(),
            },
            send_in_app=True,
            send_push=True,
        )

        audit_record["status"] = "DELIVERED"
        audit_record["provider_response"] = {
            "dispatch_hybrid": "success",
            "channels": ["IN_APP", "PUSH"],
        }
        try:
            service_client.table("notification_dispatch_audit").insert(audit_record).execute()
        except Exception as ex:
            print("[AuditLog Warning]", ex)

        return {
            "success": True,
            "message": "Test notification dispatched to your account successfully!",
            "correlation_id": correlation_id,
            "lifecycle": [
                {"stage": "CREATED", "timestamp": datetime.utcnow().isoformat()},
                {"stage": "VARIABLES_RESOLVED", "variables_count": len(context)},
                {"stage": "RENDERED", "title_length": len(rendered_title), "body_length": len(rendered_body)},
                {"stage": "VALIDATED", "status": "PASSED"},
                {"stage": "DISPATCHED", "channels": ["IN_APP", "PUSH"]},
                {"stage": "DELIVERED", "recipient": dev_name},
            ],
            "rendered_title": rendered_title,
            "rendered_body": rendered_body,
            "recipient_user_id": user_id,
            "developer_profile": {
                "name": dev_name,
                "first_name": dev_first_name,
                "company": dev_company,
            },
        }
    except Exception as e:
        audit_record["status"] = "PROVIDER_REJECTED"
        audit_record["failure_reason"] = str(e)
        try:
            service_client.table("notification_dispatch_audit").insert(audit_record).execute()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"Failed to dispatch test notification: {e}")
