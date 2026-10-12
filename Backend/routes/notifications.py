from fastapi import APIRouter, HTTPException, Depends, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
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
    limit: int = 50,
    offset: int = 0
):
    user_id = auth_ctx.user_id
    try:
        service_client = get_service_supabase_client()
        resp = (
            service_client.table("notifications")
            .select("id,title,message,type,metadata,read,created_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )
        return {"success": True, "notifications": resp.data or []}
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
    user_id: Optional[str] = None
):
    auth_user_id = user_id or websocket.query_params.get("user_id")
    auth_token = websocket.query_params.get("token")

    if not auth_user_id and auth_token:
        try:
            auth_ctx = get_request_auth_optional(authorization=f"Bearer {auth_token}")
            auth_user_id = auth_ctx.user_id
        except Exception:
            pass

    await websocket.accept()

    if not auth_user_id:
        try:
            import asyncio, json
            init_text = await asyncio.wait_for(websocket.receive_text(), timeout=5.0)
            payload = json.loads(init_text)
            if payload.get("type") == "auth" and payload.get("token"):
                auth_ctx = get_request_auth_optional(authorization=f"Bearer {payload['token']}")
                auth_user_id = auth_ctx.user_id
        except Exception:
            pass

    if not auth_user_id:
        await websocket.send_json({"error": "Unauthorized: Missing user identity"})
        await websocket.close(code=1008)
        return

    await manager.connect(auth_user_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(auth_user_id, websocket)
    except Exception as e:
        print(f"[WebSocket] Exception on notifications WS for user {auth_user_id}: {e}")
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
                
        # Send emails synchronously
        sent_emails = 0
        if email_recipients:
            email_result = await send_bulk_assignment_notification_emails(
                recipients=email_recipients,
                assignment_title=request.assignment_title,
                company_name=company_name,
                assignment_kind=request.assignment_type,
                frontend_url=request.frontend_url,
                send_in_app=False,
            )
            sent_emails = email_result.get("sent_count", 0)

        # Send WebSockets & FCM Push Notifications via ARQ Worker Queue
        from utils.notification_dispatcher import schedule_bulk_notification_jobs
        
        realtime_user_ids = [u["user_id"] for u in realtime_recipients]
        fcm_failed_user_ids = [] # Deprecated field since it's async now
        sent_realtime = 0
        
        if realtime_user_ids:
            target_scr = "Sprint" if request.assignment_type == "sprint" else "Roleplay"
            metadata = {
                "assignment_title": request.assignment_title,
                "module_name": request.assignment_title,
                "module_type": request.assignment_type,
                "target_screen": target_scr,
                "company_id": request.company_id,
                "title": request.assignment_title,
            }
            
            await schedule_bulk_notification_jobs(
                user_ids=realtime_user_ids,
                notification_type="MODULE_ASSIGNED",
                metadata=metadata
            )
            
            sent_realtime = len(realtime_user_ids)

        return {
            "success": True,
            "message": f"Sent assignment notifications to {sent_emails} email(s) and {sent_realtime} mobile device(s)",
            "sent_emails": sent_emails,
            "sent_realtime": sent_realtime,
            "fcm_failed_count": len(fcm_failed_user_ids),
            "fcm_failed_user_ids": fcm_failed_user_ids,
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
    """Verifies that the requesting user has the developer or super_admin role."""
    from utils.db.permissions import check_user_permission
    try:
        if await check_user_permission(user_id, "developer"):
            return
    except Exception:
        pass

    try:
        service_client = get_service_supabase_client()
        role_res = service_client.table("user_roles").select("roles(name)").eq("user_id", user_id).execute()
        roles = [r.get("roles", {}).get("name", "").lower() for r in (role_res.data or []) if r.get("roles")]
        if "developer" in roles:
            return
    except Exception:
        pass

    raise HTTPException(
        status_code=403,
        detail="Forbidden: Developer role required to manage global notification templates."
    )


from utils.notifications.template_engine import (
    TemplateCompiler,
    TemplateLinter,
    normalize_token_key,
    CHANNEL_CONSTRAINTS,
)
import uuid as _uuid_lib


class VariableCreateRequest(BaseModel):
    key: str
    label: str
    description: Optional[str] = None
    data_type: Literal["string", "number", "date", "url", "percentage", "boolean"] = "string"
    namespace: str = "custom"
    source_path: Optional[str] = None
    is_required: bool = False
    default_fallback: Optional[str] = None
    sample_value: str


class EventPresetCreateRequest(BaseModel):
    key: str
    label: str
    category: str = "CUSTOM"
    description: Optional[str] = None
    default_channels: List[str] = ["IN_APP", "PUSH"]
    recommended_variables: List[str] = []


class TemplateValidateRequest(BaseModel):
    title_template: Optional[str] = None
    body_template: str
    channel: str = "ALL"
    custom_sample_context: Optional[Dict[str, Any]] = None


class NotificationTemplateCreateRequest(BaseModel):
    notification_type: str
    channel: Literal["IN_APP", "PUSH", "EMAIL", "WHATSAPP", "ALL"] = "ALL"
    variation_index: int = 0
    title_template: Optional[str] = None
    body_template: str
    cta_label: Optional[str] = None
    language: str = "en"
    version: int = 1
    status: Literal["DRAFT", "VALIDATED", "PUBLISHED", "ARCHIVED"] = "PUBLISHED"
    is_active: bool = True


class NotificationTemplateUpdateRequest(BaseModel):
    title_template: Optional[str] = None
    body_template: Optional[str] = None
    cta_label: Optional[str] = None
    channel: Optional[Literal["IN_APP", "PUSH", "EMAIL", "WHATSAPP", "ALL"]] = None
    variation_index: Optional[int] = None
    status: Optional[Literal["DRAFT", "VALIDATED", "PUBLISHED", "ARCHIVED"]] = None
    is_active: Optional[bool] = None


class TestSendTemplateRequest(BaseModel):
    template_id: Optional[str] = None
    notification_type: Optional[str] = None
    title_template: Optional[str] = None
    body_template: str
    channel: Optional[str] = "ALL"
    custom_variables: Optional[Dict[str, Any]] = None


# ─────────────────────────────────────────────────────────────────
# 1. VARIABLE REGISTRY ENDPOINTS
# ─────────────────────────────────────────────────────────────────

@router.get("/registry/variables")
async def get_variable_registry(
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """Returns the complete contract-based dynamic variable registry."""
    try:
        service_client = get_service_supabase_client()
        res = (
            service_client.table("notification_variable_registry")
            .select("*")
            .order("namespace", desc=False)
            .order("key", desc=False)
            .execute()
        )
        vars_list = res.data or []
        sample_ctx = {}
        for v in vars_list:
            sample_ctx[v["key"]] = v.get("sample_value") or ""
            # also add short alias without namespace for convenience
            short_key = v["key"].split(".")[-1]
            if short_key not in sample_ctx:
                sample_ctx[short_key] = v.get("sample_value") or ""

        return {
            "success": True,
            "variables": vars_list,
            "sample_context": sample_ctx,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/registry/variables")
async def create_custom_variable(
    request: VariableCreateRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """Registers a new developer custom variable with typed schema contract."""
    await require_developer_role(auth_ctx.user_id)
    key_clean = request.key.strip().lower()
    # Ensure key has namespace prefix or default to custom
    if "." not in key_clean:
        key_clean = f"custom.{key_clean}"

    try:
        service_client = get_service_supabase_client()
        insert_payload = {
            "key": key_clean,
            "label": request.label.strip(),
            "description": request.description.strip() if request.description else None,
            "data_type": request.data_type,
            "namespace": request.namespace or "custom",
            "source_path": request.source_path or f"payload.{key_clean.split('.')[-1]}",
            "is_required": request.is_required,
            "default_fallback": request.default_fallback.strip() if request.default_fallback else None,
            "sample_value": request.sample_value.strip(),
            "is_system": False,
            "created_by": auth_ctx.user_id,
        }
        res = service_client.table("notification_variable_registry").insert(insert_payload).execute()
        if not res.data:
            raise HTTPException(status_code=400, detail="Failed to create variable")
        return {"success": True, "message": "Variable registered successfully", "variable": res.data[0]}
    except HTTPException:
        raise
    except Exception as e:
        err_str = str(e)
        if "unique" in err_str.lower() or "duplicate" in err_str.lower():
            raise HTTPException(status_code=409, detail=f"Variable with key '{key_clean}' already exists.")
        raise HTTPException(status_code=500, detail=err_str)


@router.delete("/registry/variables/{variable_id}")
async def delete_custom_variable(
    variable_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """Deletes a developer custom variable. System variables cannot be deleted."""
    await require_developer_role(auth_ctx.user_id)
    try:
        service_client = get_service_supabase_client()
        var_res = service_client.table("notification_variable_registry").select("is_system, key").eq("id", variable_id).maybe_single().execute()
        var_data = getattr(var_res, "data", None)
        if not var_data:
            raise HTTPException(status_code=404, detail="Variable not found")
        if var_data.get("is_system"):
            raise HTTPException(status_code=403, detail="System variables cannot be deleted.")

        service_client.table("notification_variable_registry").delete().eq("id", variable_id).execute()
        return {"success": True, "message": f"Variable '{var_data.get('key')}' deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────────────────────────
# 2. EVENT PRESETS ENDPOINTS
# ─────────────────────────────────────────────────────────────────

@router.get("/registry/presets")
async def get_event_presets(
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """Returns all notification event type presets."""
    try:
        service_client = get_service_supabase_client()
        res = service_client.table("notification_event_presets").select("*").order("category", desc=False).order("key", desc=False).execute()
        return {"success": True, "presets": res.data or []}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/registry/presets")
async def create_event_preset(
    request: EventPresetCreateRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """Registers a new developer custom event preset."""
    await require_developer_role(auth_ctx.user_id)
    key_clean = request.key.strip().upper().replace(" ", "_")
    try:
        service_client = get_service_supabase_client()
        insert_payload = {
            "key": key_clean,
            "label": request.label.strip(),
            "category": request.category.strip().upper() or "CUSTOM",
            "description": request.description.strip() if request.description else None,
            "default_channels": request.default_channels or ["IN_APP", "PUSH"],
            "recommended_variables": request.recommended_variables or [],
            "is_system": False,
            "created_by": auth_ctx.user_id,
        }
        res = service_client.table("notification_event_presets").insert(insert_payload).execute()
        if not res.data:
            raise HTTPException(status_code=400, detail="Failed to create event preset")
        return {"success": True, "message": "Event preset created successfully", "preset": res.data[0]}
    except HTTPException:
        raise
    except Exception as e:
        err_str = str(e)
        if "unique" in err_str.lower() or "duplicate" in err_str.lower():
            raise HTTPException(status_code=409, detail=f"Preset with key '{key_clean}' already exists.")
        raise HTTPException(status_code=500, detail=err_str)


@router.delete("/registry/presets/{preset_id}")
async def delete_event_preset(
    preset_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """Deletes a custom event preset. System presets cannot be deleted."""
    await require_developer_role(auth_ctx.user_id)
    try:
        service_client = get_service_supabase_client()
        preset_res = service_client.table("notification_event_presets").select("is_system, key").eq("id", preset_id).maybe_single().execute()
        preset_data = getattr(preset_res, "data", None)
        if not preset_data:
            raise HTTPException(status_code=404, detail="Preset not found")
        if preset_data.get("is_system"):
            raise HTTPException(status_code=403, detail="System presets cannot be deleted.")

        service_client.table("notification_event_presets").delete().eq("id", preset_id).execute()
        return {"success": True, "message": f"Preset '{preset_data.get('key')}' deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
    and channel recommended/hard limits.
    """
    service_client = get_service_supabase_client()
    var_res = service_client.table("notification_variable_registry").select("*").execute()
    vars_list = var_res.data or []
    known_vars = {v["key"]: v for v in vars_list}
    sample_ctx = {v["key"]: v.get("sample_value") or "" for v in vars_list}

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
    return {"success": True, "lint": lint_result}


# ─────────────────────────────────────────────────────────────────
# 4. TEMPLATE CRUD & AUDIT DISPATCH ENDPOINTS
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
    is_active: Optional[bool] = None,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """Lists global notification templates with status and version."""
    try:
        service_client = get_service_supabase_client()
        query = service_client.table("notification_templates").select("*")
        if notification_type:
            query = query.eq("notification_type", notification_type)
        if channel:
            query = query.eq("channel", channel)
        if is_active is not None:
            query = query.eq("is_active", is_active)

        query = query.order("notification_type", desc=False).order("variation_index", desc=False)
        resp = query.execute()
        return {"success": True, "templates": resp.data or []}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/templates")
async def create_notification_template(
    request: NotificationTemplateCreateRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """
    Creates a new template. Strictly enforces linter hard errors before allowing publishing.
    """
    await require_developer_role(auth_ctx.user_id)
    service_client = get_service_supabase_client()

    # Load registry for compile-time validation
    var_res = service_client.table("notification_variable_registry").select("*").execute()
    known_vars = {v["key"]: v for v in (var_res.data or [])}
    sample_ctx = {v["key"]: v.get("sample_value") or "" for v in (var_res.data or [])}

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

    try:
        insert_data = {
            "notification_type": request.notification_type.strip().upper(),
            "channel": request.channel,
            "variation_index": request.variation_index,
            "title_template": request.title_template.strip() if request.title_template else None,
            "body_template": request.body_template.strip(),
            "cta_label": request.cta_label.strip() if request.cta_label else None,
            "language": request.language,
            "version": request.version,
            "status": request.status,
            "is_active": request.is_active,
        }
        resp = service_client.table("notification_templates").insert(insert_data).execute()
        if not resp.data:
            raise HTTPException(status_code=400, detail="Failed to create template")
        return {
            "success": True,
            "message": "Notification template created successfully",
            "template": resp.data[0],
            "lint_report": lint_result,
        }
    except HTTPException:
        raise
    except Exception as e:
        err_msg = str(e)
        if "unique" in err_msg.lower() or "duplicate" in err_msg.lower():
            raise HTTPException(
                status_code=409,
                detail=f"Template variation #{request.variation_index} for type '{request.notification_type}' and channel '{request.channel}' already exists.",
            )
        raise HTTPException(status_code=500, detail=err_msg)


@router.put("/templates/{template_id}")
async def update_notification_template(
    template_id: str,
    request: NotificationTemplateUpdateRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """Updates an existing notification template with validation enforcement."""
    await require_developer_role(auth_ctx.user_id)
    service_client = get_service_supabase_client()

    update_data: Dict[str, Any] = {}
    if request.title_template is not None:
        update_data["title_template"] = request.title_template.strip() if request.title_template else None
    if request.body_template is not None:
        update_data["body_template"] = request.body_template.strip()
    if request.cta_label is not None:
        update_data["cta_label"] = request.cta_label.strip() if request.cta_label else None
    if request.channel is not None:
        update_data["channel"] = request.channel
    if request.variation_index is not None:
        update_data["variation_index"] = request.variation_index
    if request.status is not None:
        update_data["status"] = request.status
    if request.is_active is not None:
        update_data["is_active"] = request.is_active

    try:
        resp = service_client.table("notification_templates").update(update_data).eq("id", template_id).execute()
        if not resp.data:
            raise HTTPException(status_code=404, detail="Template not found")
        return {"success": True, "message": "Notification template updated", "template": resp.data[0]}
    except HTTPException:
        raise
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
    var_res = service_client.table("notification_variable_registry").select("*").execute()
    reg_vars = {v["key"]: v for v in (var_res.data or [])}

    # Build context: default samples + real developer profile + custom overrides
    context: Dict[str, Any] = {v["key"]: v.get("sample_value") for v in (var_res.data or [])}
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
    rendered_title, unres_title = TemplateCompiler.render(title_str, context, reg_vars, use_fallbacks=True)
    rendered_body, unres_body = TemplateCompiler.render(body_str, context, reg_vars, use_fallbacks=True)

    unresolved_required = list(set(unres_title + unres_body))
    validation_status = "VALIDATED" if not unresolved_required else "VALIDATION_FAILED"

    # Audit record tracking
    audit_record = {
        "correlation_id": correlation_id,
        "template_id": request.template_id,
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
