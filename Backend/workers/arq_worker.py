import asyncio
import os
import logging
import random
from typing import Any, Dict
from datetime import datetime, timezone

from arq import Worker, cron
from arq.connections import RedisSettings

from utils.auth_bridge import get_service_supabase_client
from utils.notification_dispatcher import dispatch_hybrid_notification
from utils.notifications.template_engine import TemplateCompiler

logger = logging.getLogger("lucid.arq_worker")

# -----------------------------------------------------------------------------
# Redis Configuration for ARQ
# -----------------------------------------------------------------------------
redis_host = os.getenv("REDIS_HOST", "localhost")
redis_port = int(os.getenv("REDIS_PORT", "6379"))
redis_password = os.getenv("REDIS_PASSWORD", None)

redis_settings = RedisSettings(
    host=redis_host,
    port=redis_port,
    password=redis_password,
)

# -----------------------------------------------------------------------------
# Reconciliation & Polling Loop
# -----------------------------------------------------------------------------
async def poll_notification_jobs(ctx: Dict[str, Any]) -> None:
    """
    Cron job function that polls the `notification_jobs` table for jobs that are
    PENDING/QUEUED and scheduled in the past.
    """
    try:
        db = get_service_supabase_client()
        now_iso = datetime.now(timezone.utc).isoformat()
        
        res = db.rpc("get_and_lock_notification_jobs", {"p_limit": 50}).execute()
        
        jobs = getattr(res, "data", [])
        if not jobs:
            return

        logger.info(f"[ARQ Worker] Found {len(jobs)} notification jobs to process.")

        for job in jobs:
            logger.info(f"[ARQ Worker] Processing job {job['id']} (Type: {job['notification_type']})")
            
            success = await process_single_job(db, job)
            
            final_status = "SENT" if success else "FAILED"
            if not success and job["attempts"] < job["max_attempts"]:
                final_status = "QUEUED"
                
            (
                db.table("notification_jobs")
                .update({
                    "status": final_status,
                    "processed_at": datetime.now(timezone.utc).isoformat() if final_status in ["SENT", "FAILED"] else None
                })
                .eq("id", job["id"])
                .execute()
            )

    except Exception as e:
        logger.error(f"[ARQ Worker] Error in poll_notification_jobs: {e}")


async def process_single_job(db, job: Dict[str, Any]) -> bool:
    """
    Processes a single notification job: checks preferences, formats template, and dispatches.
    """
    user_id = job["user_id"]
    company_id = job["company_id"]
    notif_type = job["notification_type"]
    metadata = job["metadata"] or {}

    try:
        # 1. Check Preferences
        prefs_res = db.table("notification_preferences").select(
            "deadline_reminders_enabled,post_completion_enabled,streak_notifications_enabled,in_app_enabled,push_enabled"
        ).eq("user_id", user_id).maybe_single().execute()
        prefs = getattr(prefs_res, "data", {}) or {}
        
        if "DEADLINE" in notif_type and prefs.get("deadline_reminders_enabled") is False:
            return True
        if notif_type == "POST_COMPLETION_FEEDBACK" and prefs.get("post_completion_enabled") is False:
            return True
        if "STREAK" in notif_type and prefs.get("streak_notifications_enabled") is False:
            return True

        # 2. Fetch Template
        tpl_res = (
            db.table("notification_templates")
            .select("title_template,body_template,channel")
            .eq("notification_type", notif_type)
            .eq("is_active", True)
            .execute()
        )
        templates = getattr(tpl_res, "data", [])
        if not templates:
            logger.warning(f"No active templates found for type {notif_type}")
            return False
            
        template = random.choice(templates)
        
        # 3. Enrich Recipient Profile & Render Templates via TemplateCompiler
        user_res = db.table("users").select("name,email,first_name").eq("user_id", user_id).maybe_single().execute()
        user_data = getattr(user_res, "data", None) or {}
        full_name = user_data.get("name") or user_data.get("full_name") or ""
        first_name = user_data.get("first_name") or (full_name.split()[0] if full_name else "")
        email = user_data.get("email") or ""

        context = {
            "subscriber.first_name": first_name,
            "subscriber.full_name": full_name,
            "subscriber.email": email,
            "first_name": first_name,
            "full_name": full_name,
            "email": email,
            **metadata,
        }

        # Ensure deep linking navigation contract is present in metadata
        if "target_screen" not in metadata:
            if "SPRINT" in notif_type:
                metadata["target_screen"] = "Sprint"
            elif "TASK" in notif_type:
                metadata["target_screen"] = "Home"
                metadata["initial_tab"] = "tasks"
            elif "ROLEPLAY" in notif_type:
                metadata["target_screen"] = "Roleplay"
            elif "REPORT" in notif_type or "QUIZ" in notif_type or "MODULE_COMPLETED" in notif_type:
                metadata["target_screen"] = "Reports"
            elif "FEEDBACK" in notif_type:
                metadata["target_screen"] = "Feedback"

        title_str, unresolved_title = TemplateCompiler.render(template.get("title_template"), context)
        body_str, unresolved_body = TemplateCompiler.render(template.get("body_template"), context)

        unresolved_required = list(set(unresolved_title + unresolved_body))
        if unresolved_required:
            logger.error(
                f"[ARQ Worker] Job {job['id']} blocked by strict validation. Missing required variables: {', '.join(unresolved_required)}"
            )
            return False

        # 4. Dispatch Deliveries
        send_in_app = False
        send_push = False
        
        if template["channel"] in ["ALL", "IN_APP"] and (prefs.get("in_app_enabled") is not False):
            send_in_app = True
        if template["channel"] in ["ALL", "PUSH"] and (prefs.get("push_enabled") is not False):
            send_push = True
            
        success = True
        try:
            await dispatch_hybrid_notification(
                user_id=user_id,
                title=title_str,
                message=body_str,
                notif_type=notif_type,
                metadata=metadata,
                send_in_app=send_in_app,
                send_push=send_push
            )
            delivery_status = "SENT"
        except Exception as e:
            logger.error(f"Failed to dispatch notification for job {job['id']}: {e}")
            delivery_status = "FAILED"
            success = False

        if send_in_app:
            db.table("notification_deliveries").insert({
                "notification_job_id": job["id"],
                "company_id": company_id,
                "user_id": user_id,
                "channel": "IN_APP",
                "status": delivery_status
            }).execute()
            
        if send_push:
            db.table("notification_deliveries").insert({
                "notification_job_id": job["id"],
                "company_id": company_id,
                "user_id": user_id,
                "channel": "PUSH",
                "status": delivery_status
            }).execute()

        return success
        
    except Exception as e:
        logger.error(f"[ARQ Worker] Failed to process job {job['id']}: {e}")
        return False


# -----------------------------------------------------------------------------
# Worker Settings
# -----------------------------------------------------------------------------
class WorkerSettings:
    """
    ARQ Worker Settings.
    Run via CLI: `arq utils.arq_worker.WorkerSettings`
    """
    redis_settings = redis_settings
    
    cron_jobs = [
        cron(poll_notification_jobs, second=set(range(0, 60, 10))),
    ]
    
    on_startup = None
    on_shutdown = None
