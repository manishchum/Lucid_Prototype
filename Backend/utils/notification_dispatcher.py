import logging
from typing import Any, Dict, Optional, List
from utils.auth_bridge import get_service_supabase_client
from utils.websocket_manager import manager
from utils.redis_client import redis_client
from utils.auth import _ensure_firebase_admin_initialized
import firebase_admin
from firebase_admin import messaging

logger = logging.getLogger("lucid.notification_dispatcher")

ANDROID_CHANNEL_ID = "lucid_high_importance_channel"


def get_redis_unread_count(user_id: str) -> Optional[int]:
    """
    Fetches cached unread notification count from Redis.
    Returns None if cache miss.
    """
    key = f"unread_count:{user_id}"
    try:
        val = redis_client.get(key)
        if val is not None:
            return int(val)
    except Exception as e:
        logger.warning(f"Failed to read unread count from Redis for {user_id}: {e}")
    return None


def set_redis_unread_count(user_id: str, count: int) -> None:
    """
    Caches unread notification count in Redis with 1-hour TTL.
    """
    key = f"unread_count:{user_id}"
    try:
        redis_client.setex(key, 3600, int(count))
    except Exception as e:
        logger.warning(f"Failed to set unread count in Redis for {user_id}: {e}")


def invalidate_redis_unread_count(user_id: str) -> None:
    """
    Deletes cached unread notification count from Redis.
    """
    key = f"unread_count:{user_id}"
    try:
        redis_client.delete(key)
    except Exception:
        pass


async def dispatch_hybrid_notification(
    user_id: str,
    title: str,
    message: str,
    notif_type: str = "general",
    metadata: Optional[Dict[str, Any]] = None,
    send_in_app: bool = True,
    send_push: bool = True,
) -> Dict[str, Any]:
    """
    Unified Hybrid Notification Dispatcher:
    1. Inserts notification row into Supabase DB ('notifications' table).
    2. Invalidates/increments unread notification count in Redis cache.
    3. Emits live WebSocket payload for in-app banner & badge updates.
    4. Sends high-priority FCM Push Notification to Android/iOS System Status Tray.
    """
    metadata = metadata or {}
    notification_data = None

    # Step 1: Save to Supabase DB (Persistence / History Log)
    if send_in_app:
        try:
            _db = get_service_supabase_client()
            insert_resp = (
                _db.table("notifications")
                .insert({
                    "user_id": user_id,
                    "title": title,
                    "message": message,
                    "type": notif_type,
                    "metadata": metadata,
                    "read": False,
                })
                .execute()
            )
            if insert_resp.data and len(insert_resp.data) > 0:
                notification_data = insert_resp.data[0]
        except Exception as e:
            logger.error(f"[Dispatcher] DB Insert failed for user {user_id}: {e}")

        if not notification_data:
            notification_data = {
                "id": f"temp-{user_id}",
                "user_id": user_id,
                "title": title,
                "message": message,
                "type": notif_type,
                "metadata": metadata,
                "read": False,
                "created_at": __import__("datetime").datetime.utcnow().isoformat(),
            }

        # Step 2: Redis Cache Update (Unread Count)
        try:
            cached_count = get_redis_unread_count(user_id)
            if cached_count is not None:
                set_redis_unread_count(user_id, cached_count + 1)
            else:
                invalidate_redis_unread_count(user_id)
        except Exception as e:
            logger.warning(f"[Dispatcher] Redis cache update failed: {e}")

        # Step 3: WebSocket Live Broadcast (In-App Badges & Toasts)
        ws_payload = {
            "event": "new_notification",
            "data": notification_data,
        }
        try:
            await manager.send_personal_message(user_id, ws_payload)
            logger.info(f"[Dispatcher] WebSocket payload sent to user {user_id}")
        except Exception as e:
            logger.warning(f"[Dispatcher] WebSocket broadcast failed: {e}")

    # Step 4: FCM Push Notification (Android & iOS System Tray / Lock Screen)
    if send_push:
        try:
            _db = get_service_supabase_client()
            user_res = (
                _db.table("users")
                .select("fcm_token")
                .eq("user_id", user_id)
                .maybe_single()
                .execute()
            )
            fcm_token = (getattr(user_res, "data", None) or {}).get("fcm_token")

            if fcm_token:
                _ensure_firebase_admin_initialized()
                
                # Stringify metadata dictionary values for FCM data payload
                fcm_data_payload = {
                    "type": str(notif_type),
                    "title": str(title),
                    "message": str(message),
                    "user_id": str(user_id),
                }
            for k, v in metadata.items():
                if v is not None:
                    fcm_data_payload[str(k)] = str(v)

            fcm_message = messaging.Message(
                notification=messaging.Notification(
                    title=title,
                    body=message,
                ),
                data=fcm_data_payload,
                android=messaging.AndroidConfig(
                    priority="high",
                    notification=messaging.AndroidNotification(
                        channel_id=ANDROID_CHANNEL_ID,
                        sound="default",
                        priority="high",
                        default_sound=True,
                        default_vibrate_timings=True,
                    ),
                ),
                apns=messaging.APNSConfig(
                    payload=messaging.APNSPayload(
                        aps=messaging.Aps(
                            sound="default",
                            badge=1,
                        )
                    )
                ),
                token=fcm_token,
            )

            response = messaging.send(fcm_message)
            logger.info(f"[Dispatcher] FCM system tray push sent to user {user_id}, msg_id={response}")
        except Exception as e:
            err_msg = str(e)
            logger.warning(f"[Dispatcher] FCM push dispatch failed for user {user_id}: {err_msg}")
            if any(token_err in err_msg.lower() for token_err in ["unregistered", "notregistered", "invalid-registration-token", "not registered"]):
                try:
                    _db = get_service_supabase_client()
                    _db.table("users").update({"fcm_token": None}).eq("user_id", user_id).execute()
                    logger.info(f"[Dispatcher] Purged stale FCM token for user {user_id}")
                except Exception as purge_err:
                    logger.warning(f"[Dispatcher] Failed to purge stale FCM token: {purge_err}")

    return notification_data


async def schedule_notification_job(
    user_id: str,
    notification_type: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    company_id: Optional[str] = None,  # Left for backward compatibility, but ignored by RPC if we want
    assignment_id: Optional[str] = None,
    scheduled_at: Optional[Any] = None,
    notif_type: Optional[str] = None,
    **kwargs: Any,
) -> bool:
    """
    Schedules a notification by calling the schedule_notification_job_rpc.
    The ARQ worker will process it at the scheduled_at time.
    Supports both `notification_type` and `notif_type` parameter names.
    Evicts stale finished jobs with the same idempotency key so user retries trigger notifications.
    """
    actual_type = notification_type or notif_type
    if not actual_type:
        logger.error(f"[Dispatcher] Missing notification type for user {user_id}")
        return False

    metadata = metadata or {}
    try:
        _db = get_service_supabase_client()
        import datetime
        if isinstance(scheduled_at, datetime.datetime):
            scheduled_at = scheduled_at.isoformat()
        elif scheduled_at is None:
            scheduled_at = datetime.datetime.now(datetime.timezone.utc).isoformat()

        entity_id = (
            metadata.get("task_id")
            or metadata.get("sprint_id")
            or metadata.get("scenario_id")
            or metadata.get("module_id")
            or str(int(datetime.datetime.now().timestamp()))
        )
        idempotency_key = f"{user_id}:{actual_type}:{entity_id}"

        # Check if an existing job with this key already finished (e.g. earlier quiz completion attempt)
        existing = _db.table("notification_jobs").select("id,status").eq("idempotency_key", idempotency_key).maybe_single().execute()
        existing_data = getattr(existing, "data", None)
        if existing_data:
            if existing_data.get("status") in ["SENT", "FAILED", "CANCELLED"]:
                # Evict stale finished job so the new completion attempt creates a fresh job
                _db.table("notification_jobs").delete().eq("id", existing_data["id"]).execute()
            else:
                # Still pending or processing, do not create duplicate
                return True

        res = _db.rpc("schedule_notification_job_rpc", {
            "p_user_id": user_id,
            "p_notification_type": actual_type,
            "p_metadata": metadata,
            "p_assignment_id": assignment_id,
            "p_scheduled_at": scheduled_at
        }).execute()
        return True
    except Exception as e:
        logger.error(f"[Dispatcher] Failed to schedule notification job for {user_id}: {e}")
        return False


async def schedule_bulk_notification_jobs(
    user_ids: List[str],
    notification_type: str,
    metadata: Dict[str, Any],
    company_id: Optional[str] = None,
    assignment_id: Optional[str] = None,
    scheduled_at: Optional[Any] = None,
) -> int:
    """
    Schedules notifications in bulk to a list of user IDs.
    Returns the count of notifications successfully scheduled.
    """
    count = 0
    for uid in user_ids:
        success = await schedule_notification_job(
            user_id=uid,
            notification_type=notification_type,
            metadata=metadata,
            company_id=company_id,
            assignment_id=assignment_id,
            scheduled_at=scheduled_at
        )
        if success:
            count += 1
    return count


async def dispatch_task_assignment_notification(
    user_ids: List[str],
    task_id: str,
    assignment_id: str,
    title: str,
) -> int:
    """
    Centralized dispatcher for task assignment notifications.
    Schedules the notification via the ARQ PostgreSQL queue.
    """
    if not user_ids:
        return 0
        
    metadata = {
        "task_id": task_id,
        "assignment_id": assignment_id,
        "title": title,
        "module_name": title,  # For template compat
        "first_name": "Learner", # Placeholder, worker could fetch real name or template engine
    }
    return await schedule_bulk_notification_jobs(
        user_ids=list(set(user_ids)),
        notification_type="MODULE_ASSIGNED", # Map to the new standard type
        metadata=metadata,
    )


async def dispatch_sprint_assignment_notification(
    user_ids: List[str],
    sprint_id: str,
    title: str,
) -> int:
    """
    Centralized dispatcher for sprint assignment notifications.
    """
    if not user_ids:
        return 0
        
    metadata = {
        "sprint_id": sprint_id,
        "title": title,
        "module_name": title,
        "first_name": "Learner",
    }
    return await schedule_bulk_notification_jobs(
        user_ids=list(set(user_ids)),
        notification_type="MODULE_ASSIGNED",
        metadata=metadata,
    )


async def dispatch_roleplay_assignment_notification(
    user_ids: List[str],
    scenario_id: str,
    title: str,
) -> int:
    """
    Centralized dispatcher for roleplay assignment notifications.
    """
    if not user_ids:
        return 0
        
    metadata = {
        "scenario_id": scenario_id,
        "title": title,
        "module_name": title,
        "first_name": "Learner",
    }
    return await schedule_bulk_notification_jobs(
        user_ids=list(set(user_ids)),
        notification_type="MODULE_ASSIGNED",
        metadata=metadata,
    )

