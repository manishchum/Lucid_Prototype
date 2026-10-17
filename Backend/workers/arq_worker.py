import asyncio
import os
import logging
import random
from typing import Any, Dict, Optional
from datetime import datetime, timezone

from arq import Worker, cron
from arq.connections import RedisSettings

from utils.auth_bridge import get_service_supabase_client
from utils.notification_dispatcher import dispatch_hybrid_notification
from utils.notifications.template_engine import TemplateCompiler

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("lucid.arq_worker")

# -----------------------------------------------------------------------------
# Redis Configuration for ARQ
# -----------------------------------------------------------------------------
redis_host = os.getenv("REDIS_HOST", "localhost")
redis_port = int(os.getenv("REDIS_PORT", "6379"))
redis_username = os.getenv("REDIS_USERNAME", None)
redis_password = os.getenv("REDIS_PASSWORD", None)

redis_settings = RedisSettings(
    host=redis_host,
    port=redis_port,
    username=redis_username,
    password=redis_password,
    conn_timeout=10,
    conn_retries=5,
    conn_retry_delay=1,
    retry_on_timeout=True,
)

# -----------------------------------------------------------------------------
# Reconciliation & Polling Loop
# -----------------------------------------------------------------------------
async def _process_and_update_job(sem: asyncio.Semaphore, db, job: Dict[str, Any]) -> None:
    """Processes a single job under semaphore control and updates its terminal or retry status."""
    async with sem:
        job_id = job.get("id")
        try:
            logger.info(f"[ARQ Worker] Concurrently processing job {job_id} (Type: {job.get('notification_type')})")
            success, failure_cat = await process_single_job(db, job)

            is_permanent = (
                failure_cat in [
                    "PERMANENT_SCHEMA_VIOLATION",
                    "PERMANENT_TEMPLATE_ERROR",
                    "SKIPPED_POLICY",
                ]
                or (
                    bool(failure_cat)
                    and (
                        failure_cat.startswith("SUPPRESSED_")
                        or failure_cat.startswith("REJECTED_")
                        or failure_cat.startswith("SKIPPED_")
                    )
                )
            )

            if failure_cat and failure_cat.startswith("SUPPRESSED_"):
                final_status = "SKIPPED"
            elif failure_cat and failure_cat.startswith("REJECTED_"):
                final_status = "FAILED"
            elif success:
                final_status = "SENT"
            else:
                final_status = "FAILED"

            if not success and not is_permanent and job["attempts"] < job["max_attempts"]:
                final_status = "QUEUED"

            (
                db.table("notification_jobs")
                .update({
                    "status": final_status,
                    "processed_at": datetime.now(timezone.utc).isoformat() if final_status in ["SENT", "FAILED", "SKIPPED"] else None,
                    "failure_category": failure_cat,
                    "dead_lettered_at": datetime.now(timezone.utc).isoformat() if is_permanent and not success else None,
                })
                .eq("id", job_id)
                .execute()
            )
        except Exception as job_err:
            logger.error(f"[ARQ Worker] Error in worker processing job {job_id}: {job_err}")


async def poll_notification_jobs(ctx: Dict[str, Any]) -> None:
    """
    Cron job function that polls the `notification_jobs` table for jobs that are
    PENDING/QUEUED and scheduled in the past. Executes claimed jobs concurrently
    with a bounded concurrency semaphore (up to 20 parallel workers).
    """
    try:
        db = get_service_supabase_client()
        res = db.rpc("get_and_lock_notification_jobs", {"p_limit": 50}).execute()
        
        jobs = getattr(res, "data", [])
        if not jobs:
            return

        logger.info(f"[ARQ Worker] Found {len(jobs)} notification jobs to process. Dispatching concurrently...")

        sem = asyncio.Semaphore(20)
        tasks = [_process_and_update_job(sem, db, j) for j in jobs]
        await asyncio.gather(*tasks, return_exceptions=True)

    except Exception as e:
        logger.error(f"[ARQ Worker] Error in poll_notification_jobs: {e}")


async def process_single_job(db, job: Dict[str, Any]) -> tuple[bool, Optional[str]]:
    """
    Processes a single notification job: checks dynamic developer policies,
    formats template, and dispatches. Returns (success, failure_category).
    """
    user_id = job["user_id"]
    company_id = job["company_id"]
    notif_type = job["notification_type"]
    metadata = job["metadata"] or {}

    try:
        # 1. Enterprise Policy Dispatch-Time Revalidation
        # Hard Gates: Tenant Boundary & Recipient Active Status, Company Feature Entitlement
        # Soft Gates: Global Disables, User Category and Channel Preferences
        from utils.notifications.policy_evaluator import NotificationPolicyEvaluator
        allowed, reason, details = await NotificationPolicyEvaluator.evaluate_full_policy(
            event_company_id=company_id,
            recipient_user_id=user_id,
            trigger_or_event=notif_type,
            category=metadata.get("category"),
            channels=metadata.get("channels") or ["IN_APP", "PUSH"],
            manager_id=metadata.get("manager_id"),
            is_critical=bool(metadata.get("is_critical", False)),
        )
        if not allowed:
            logger.info(f"[ARQ Worker] Job {job['id']} terminally suppressed at dispatch boundary: {reason}")
            NotificationPolicyEvaluator.record_policy_audit(
                correlation_id=metadata.get("correlation_id") or f"job-{job['id']}",
                notification_type=notif_type,
                recipient_user_id=user_id,
                company_id=company_id,
                status="SUPPRESSED" if "SUPPRESSED" in reason else "REJECTED",
                suppression_reason=reason,
                channel=metadata.get("channels", ["ALL"])[0] if metadata.get("channels") else "ALL",
                details=details,
                is_test=bool(metadata.get("is_test", False)),
            )
            return False, reason

        # 1b. Phase 7.6 Stale-State Check for Delayed / Scheduled Reminders
        wf_id = metadata.get("workflow_id")
        if wf_id:
            from utils.notifications.workflow_engine import WorkflowEngine
            is_valid, reason = await WorkflowEngine.recheck_conditions_before_send(
                workflow_id=wf_id,
                user_id=user_id,
                base_payload=metadata,
                company_id=company_id,
            )
            if not is_valid:
                logger.info(f"[ARQ Worker] Delayed job {job['id']} safely suppressed: {reason}")
                return True, f"SKIPPED_{reason}"

        # 2. Fetch Active Template
        template = None
        if metadata.get("custom_title") or metadata.get("custom_body"):
            template = {
                "title_template": metadata.get("custom_title"),
                "body_template": metadata.get("custom_body"),
                "channel": "ALL",
            }
        elif metadata.get("pinned_template_id"):
            try:
                pin_res = (
                    db.table("notification_templates")
                    .select("id,title_template,body_template,channel")
                    .eq("id", metadata["pinned_template_id"])
                    .maybe_single()
                    .execute()
                )
                template = getattr(pin_res, "data", None)
            except Exception:
                pass

        if not template:
            tpl_res = (
                db.table("notification_templates")
                .select("id,title_template,body_template,channel")
                .eq("notification_type", notif_type)
                .eq("is_active", True)
                .execute()
            )
            templates = getattr(tpl_res, "data", [])
            if templates:
                template = random.choice(templates)

        if not template:
            logger.warning(f"No active templates found for type {notif_type}")
            return False, "PERMANENT_TEMPLATE_ERROR"
        
        # 3. Enrich Recipient Profile & Personalization Context via ContextEnricher
        from utils.notifications.context_enricher import NotificationContextEnricher
        context = await NotificationContextEnricher.enrich(
            user_id=user_id,
            base_payload=metadata,
            company_id=company_id,
        )
        user_email = context.get("subscriber.email") or context.get("email")

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

        title_template = metadata.get("custom_title") or template.get("title_template")
        body_template = metadata.get("custom_body") or template.get("body_template")

        title_str, unresolved_title = TemplateCompiler.render(title_template, context)
        body_str, unresolved_body = TemplateCompiler.render(body_template, context)

        unresolved_required = list(set(unresolved_title + unresolved_body))
        if unresolved_required:
            logger.error(
                f"[ARQ Worker] Job {job['id']} blocked by strict validation. Missing required variables: {', '.join(unresolved_required)}"
            )
            return False, "PERMANENT_SCHEMA_VIOLATION"

        # 4. Dispatch Deliveries: Parallel vs. Ordered Fallback Policy
        delivery_policy = str(metadata.get("delivery_policy") or "PARALLEL").upper()
        selected_channels = metadata.get("channels") or ["IN_APP", "PUSH"]

        prefs = {}
        try:
            p_res = db.table("notification_preferences").select("in_app_enabled,push_enabled,email_enabled").eq("user_id", user_id).maybe_single().execute()
            prefs = getattr(p_res, "data", {}) or {}
        except Exception:
            pass

        eligible_in_app = ("IN_APP" in selected_channels or template["channel"] in ["ALL", "IN_APP"]) and (prefs.get("in_app_enabled") is not False)
        eligible_push = ("PUSH" in selected_channels or template["channel"] in ["ALL", "PUSH"]) and (prefs.get("push_enabled") is not False)
        is_email_unsubscribed = bool(context.get("subscriber.email_unsubscribed"))
        eligible_email = (
            ("EMAIL" in selected_channels or template["channel"] in ["ALL", "EMAIL"])
            and (prefs.get("email_enabled") is not False)
            and not is_email_unsubscribed
            and bool(user_email)
        )

        success = True

        if delivery_policy == "ORDERED_FALLBACK":
            # Ordered Fallback sequence: Primary (PUSH) -> Secondary (IN_APP) -> Tertiary (EMAIL)
            delivered_any = False

            if eligible_push:
                push_res = await dispatch_hybrid_notification(
                    user_id=user_id,
                    title=title_str,
                    message=body_str,
                    notif_type=notif_type,
                    metadata=metadata,
                    send_in_app=False,
                    send_push=True,
                )
                # Check if push was successfully sent
                if push_res and not push_res.get("suppressed"):
                    delivered_any = True
                    try:
                        db.table("notification_deliveries").insert({
                            "notification_job_id": job["id"],
                            "company_id": company_id,
                            "user_id": user_id,
                            "channel": "PUSH",
                            "status": "SENT",
                        }).execute()
                    except Exception as de:
                        logger.warning(f"Failed to record PUSH delivery: {de}")

            if not delivered_any and eligible_in_app:
                # Fallback to In-App
                inapp_res = await dispatch_hybrid_notification(
                    user_id=user_id,
                    title=title_str,
                    message=body_str,
                    notif_type=notif_type,
                    metadata=metadata,
                    send_in_app=True,
                    send_push=False,
                )
                if inapp_res and not inapp_res.get("suppressed"):
                    delivered_any = True
                    try:
                        db.table("notification_deliveries").insert({
                            "notification_job_id": job["id"],
                            "company_id": company_id,
                            "user_id": user_id,
                            "channel": "IN_APP",
                            "status": "SENT",
                            "blocked_reason": "Fallback from PUSH",
                        }).execute()
                    except Exception as de:
                        logger.warning(f"Failed to record IN_APP fallback delivery: {de}")

            if not delivered_any and eligible_email:
                # Fallback to Email (CAN-SPAM Compliant with List-Unsubscribe headers)
                email_status = "SENT"
                try:
                    from utils.assignment_notifications import _send_via_smtp, _smtp_settings
                    settings = _smtp_settings()
                    unsub_url = ""
                    try:
                        from utils.email_helper import generate_unsubscribe_url
                        unsub_url = await generate_unsubscribe_url(user_email, str(user_id), settings.get("frontend_url", "http://localhost:3000"))
                    except Exception:
                        unsub_url = f"{settings.get('frontend_url', 'http://localhost:3000')}/unsubscribe"

                    footer_html = f"<div style='margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;text-align:center;'><p>Automated notification from Lucid Learning.</p><p><a href='{unsub_url}' style='color:#64748b;'>Unsubscribe from email updates</a></p></div>"
                    html_email = f"<div style='font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;'><h2>{title_str}</h2><p>{body_str}</p>{footer_html}</div>"
                    text_email = f"{title_str}\n\n{body_str}\n\nUnsubscribe: {unsub_url}"
                    extra_headers = {
                        "List-Unsubscribe": f"<{unsub_url}>",
                        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                    }

                    await asyncio.to_thread(
                        _send_via_smtp,
                        settings["from_email"],
                        settings["smtp_host"],
                        settings["smtp_port"],
                        settings["smtp_user"],
                        settings["smtp_pass"],
                        user_email,
                        title_str,
                        html_email,
                        text_email,
                        extra_headers,
                    )
                    delivered_any = True
                except Exception as em_err:
                    logger.warning(f"[ARQ Worker] Email fallback dispatch failed for job {job['id']}: {em_err}")
                    email_status = "FAILED"
                try:
                    db.table("notification_deliveries").insert({
                        "notification_job_id": job["id"],
                        "company_id": company_id,
                        "user_id": user_id,
                        "channel": "EMAIL",
                        "status": email_status,
                        "blocked_reason": "Fallback from PUSH & IN_APP",
                    }).execute()
                except Exception as de:
                    pass

            success = delivered_any

        else:
            # Parallel Policy: Concurrent delivery across all enabled channels
            if eligible_in_app or eligible_push:
                try:
                    await dispatch_hybrid_notification(
                        user_id=user_id,
                        title=title_str,
                        message=body_str,
                        notif_type=notif_type,
                        metadata=metadata,
                        send_in_app=eligible_in_app,
                        send_push=eligible_push,
                    )
                    delivery_status = "SENT"
                except Exception as e:
                    logger.error(f"Failed to dispatch parallel notification for job {job['id']}: {e}")
                    delivery_status = "FAILED"
                    success = False

                if eligible_in_app:
                    try:
                        db.table("notification_deliveries").insert({
                            "notification_job_id": job["id"],
                            "company_id": company_id,
                            "user_id": user_id,
                            "channel": "IN_APP",
                            "status": delivery_status,
                        }).execute()
                    except Exception as d_err:
                        pass

                if eligible_push:
                    try:
                        db.table("notification_deliveries").insert({
                            "notification_job_id": job["id"],
                            "company_id": company_id,
                            "user_id": user_id,
                            "channel": "PUSH",
                            "status": delivery_status,
                        }).execute()
                    except Exception as d_err:
                        pass

                try:
                    db.table("notification_dispatch_audit").insert({
                        "correlation_id": metadata.get("correlation_id") or f"job-{job['id']}",
                        "template_id": template.get("id") if template and template.get("id") else None,
                        "notification_type": notif_type,
                        "channel": "ALL",
                        "recipient_user_id": user_id,
                        "status": "DELIVERED" if delivery_status == "SENT" else "FAILED",
                        "rendered_title": title_str,
                        "rendered_body": body_str,
                        "is_test": bool(metadata.get("is_test", False)),
                        "dispatched_by": metadata.get("dispatched_by") or user_id,
                    }).execute()
                except Exception as a_err:
                    pass

            if eligible_email:
                email_status = "SENT"
                try:
                    from utils.assignment_notifications import _send_via_smtp, _smtp_settings
                    settings = _smtp_settings()
                    unsub_url = ""
                    try:
                        from utils.email_helper import generate_unsubscribe_url
                        unsub_url = await generate_unsubscribe_url(user_email, str(user_id), settings.get("frontend_url", "http://localhost:3000"))
                    except Exception:
                        unsub_url = f"{settings.get('frontend_url', 'http://localhost:3000')}/unsubscribe"

                    footer_html = f"<div style='margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;text-align:center;'><p>Automated notification from Lucid Learning.</p><p><a href='{unsub_url}' style='color:#64748b;'>Unsubscribe from email updates</a></p></div>"
                    html_email = f"<div style='font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;'><h2>{title_str}</h2><p>{body_str}</p>{footer_html}</div>"
                    text_email = f"{title_str}\n\n{body_str}\n\nUnsubscribe: {unsub_url}"
                    extra_headers = {
                        "List-Unsubscribe": f"<{unsub_url}>",
                        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                    }

                    await asyncio.to_thread(
                        _send_via_smtp,
                        settings["from_email"],
                        settings["smtp_host"],
                        settings["smtp_port"],
                        settings["smtp_user"],
                        settings["smtp_pass"],
                        user_email,
                        title_str,
                        html_email,
                        text_email,
                        extra_headers,
                    )
                except Exception as em_err:
                    logger.warning(f"[ARQ Worker] Parallel email dispatch failed for job {job['id']}: {em_err}")
                    email_status = "FAILED"
                try:
                    db.table("notification_deliveries").insert({
                        "notification_job_id": job["id"],
                        "company_id": company_id,
                        "user_id": user_id,
                        "channel": "EMAIL",
                        "status": email_status,
                    }).execute()
                except Exception:
                    pass

        return success, (None if success else "TRANSIENT_NETWORK_ERROR")

    except Exception as e:
        logger.error(f"[ARQ Worker] Failed to process job {job['id']}: {e}")
        return False, "TRANSIENT_NETWORK_ERROR"


async def scan_workflow_schedules(ctx):
    """
    Periodic Background Cron Scanner for time-based workflow triggers:
    - DAILY_STREAK_CHECK: Finds learners with active streaks who have not practiced today.
    Uses keyset/range pagination to evaluate all eligible learners up to 1,000 per run.
    """
    logger.info("[ARQ Worker] Running scheduled workflow scan...")
    try:
        from utils.notifications.workflow_engine import WorkflowEngine
        db = get_service_supabase_client()

        # 1. Check if any workflows are listening for DAILY_STREAK_CHECK
        streak_wfs = WorkflowEngine.get_cached_workflows_for_trigger("DAILY_STREAK_CHECK")
        if streak_wfs:
            today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            batch_size = 100
            offset = 0
            max_eval = 1000

            while offset < max_eval:
                res = (
                    db.table("user_gamification_profiles")
                    .select("user_id,company_id,current_streak_days,last_activity_date")
                    .gt("current_streak_days", 0)
                    .neq("last_activity_date", today_str)
                    .range(offset, offset + batch_size - 1)
                    .execute()
                )
                users = getattr(res, "data", []) or []
                if not users:
                    break

                for u in users:
                    await WorkflowEngine.trigger_lifecycle(
                        trigger_lifecycle="DAILY_STREAK_CHECK",
                        user_id=u["user_id"],
                        payload={"streak_days": u["current_streak_days"]},
                        company_id=u.get("company_id"),
                    )

                if len(users) < batch_size:
                    break
                offset += batch_size

    except Exception as e:
        logger.error(f"[ARQ Worker] Error during scheduled workflow scan: {e}")


async def run_leaderboard_refresh(ctx: Optional[dict] = None) -> None:
    """Periodic task to refresh precomputed Redis ZSET company leaderboards."""
    logger.info("[ARQ Worker] Running scheduled company leaderboard refresh...")
    try:
        from utils.db.leaderboard_db import refresh_company_leaderboards
        res = await refresh_company_leaderboards()
        logger.info(f"[ARQ Worker] Leaderboard refresh result: {res}")
    except Exception as e:
        logger.error(f"[ARQ Worker] Error during scheduled leaderboard refresh: {e}")


async def arq_startup(ctx: dict) -> None:
    logger.info("[ARQ Worker] Lucid background ARQ worker started with Redis job bus.")


async def arq_shutdown(ctx: dict) -> None:
    logger.info("[ARQ Worker] Lucid background ARQ worker shutting down gracefully.")


# -----------------------------------------------------------------------------
# Worker Settings
# -----------------------------------------------------------------------------
from utils.email_cron import run_email_cron, send_email_task
from whatsapp.cron import run_whatsapp_cron


class WorkerSettings:
    """
    ARQ Distributed Worker Settings for Redis.
    Run via CLI: `python -m arq workers.arq_worker.WorkerSettings`
    """
    redis_settings = redis_settings

    # Periodic background cron schedules
    cron_jobs = [
        # 1. Notification dispatch queue (every 10s)
        cron(poll_notification_jobs, second=set(range(0, 60, 10))),

        # 2. Scheduled email campaign polling (every 2m)
        cron(run_email_cron, minute=set(range(0, 60, 2))),

        # 3. Scheduled WhatsApp dispatch polling (every 2m)
        cron(run_whatsapp_cron, minute=set(range(0, 60, 2))),

        # 4. Daily streak & gamification workflow triggers (every 30m)
        cron(scan_workflow_schedules, minute={0, 30}),

        # 5. Precompute company leaderboards into Redis ZSETs (hourly)
        cron(run_leaderboard_refresh, minute={0}),
    ]

    # Callable task functions that can be dynamically enqueued via arq_client.enqueue_job()
    functions = [
        send_email_task,
        poll_notification_jobs,
        run_email_cron,
        run_whatsapp_cron,
        run_leaderboard_refresh,
    ]

    on_startup = arq_startup
    on_shutdown = arq_shutdown

