from fastapi import APIRouter, HTTPException, Depends, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from typing import List, Literal, Optional
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

@router.post("/feedback")
async def submit_module_feedback(
    request: ModuleFeedbackRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    try:
        service_client = get_service_supabase_client()
        resp = service_client.table("module_feedback").insert({
            "user_id": user_id,
            "module_id": request.module_id,
            "module_type": request.module_type,
            "rating": request.rating,
            "thumbs_up": request.thumbs_up,
            "comments": request.comments,
        }).execute()
        return {"success": True, "message": "Feedback submitted successfully", "data": resp.data}
    except Exception as e:
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

        # Categorize recipients based on identity info
        email_recipients = []
        realtime_recipients = []

        for user in recipients:
            has_email = bool(user.get("email"))
            has_phone = bool(user.get("phone"))

            if has_email:
                email_recipients.append(user)
            if has_phone:
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
        
        if realtime_user_ids:
            metadata = {
                "assignment_title": request.assignment_title,
                "module_name": request.assignment_title,
                "module_type": request.assignment_type,
                "company_id": request.company_id
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
