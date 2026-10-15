"""
Scheduled Email Dispatcher Worker.
Polls the `scheduled_emails` Supabase table and delivers due one-time and recurring emails
via SMTP with unsubscribe link injection and RFC compliance.
Integrated with ARQ + Redis cron scheduler.
"""

from __future__ import annotations

import asyncio
import logging
import os
import smtplib
from datetime import date, datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any, Dict, List, Optional

from utils.db.email_db import (
    get_all_pending_emails,
    update_email_status,
)
from utils.email_helper import (
    generate_unsubscribe_url,
    get_user_by_email,
    inject_unsubscribe_link,
    should_send_email,
)
from utils.supabase_client import supabase_admin

logger = logging.getLogger("lucid.email_cron")


def _get_smtp_config() -> Dict[str, Any]:
    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_pass = os.getenv("SMTP_PASS", "")
    from_email = os.getenv("FROM_EMAIL", smtp_user)
    frontend_url = os.getenv("FRONTEND_URL", "https://lucid.workfloww.ai")

    if not smtp_user or not smtp_pass:
        raise RuntimeError("SMTP credentials (SMTP_USER, SMTP_PASS) not configured on server")

    return {
        "smtp_host": smtp_host,
        "smtp_port": smtp_port,
        "smtp_user": smtp_user,
        "smtp_pass": smtp_pass,
        "from_email": from_email,
        "frontend_url": frontend_url,
    }


def _send_smtp_sync(
    recipient_email: str,
    subject: str,
    html_body: str,
    unsubscribe_url: str,
    cfg: Dict[str, Any],
) -> None:
    """Synchronous SMTP delivery helper executed in worker thread pool."""
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = cfg["from_email"]
    msg["To"] = recipient_email

    # RFC 2369 & RFC 8058 compliant headers for email clients (Gmail, Outlook)
    msg["List-Unsubscribe"] = f"<{unsubscribe_url}>"
    msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click-Unsubscribe"

    msg.attach(MIMEText(html_body, "html"))

    with smtplib.SMTP(cfg["smtp_host"], cfg["smtp_port"]) as server:
        server.starttls()
        server.login(cfg["smtp_user"], cfg["smtp_pass"])
        server.sendmail(cfg["from_email"], recipient_email, msg.as_string())


class EmailCronWorker:
    """
    Background worker that checks the `scheduled_emails` table and dispatches due emails.
    """

    def is_due_today(self, record: Dict[str, Any], today_date: date) -> bool:
        schedule_type = record.get("schedule_type", "one_time")
        today_str = today_date.isoformat()

        if schedule_type == "one_time":
            scheduled_date = record.get("scheduled_date")
            if not scheduled_date:
                return False
            return str(scheduled_date) <= today_str

        elif schedule_type == "recurring":
            # Avoid sending recurring email multiple times on the same day
            last_sent = record.get("sent_at")
            if last_sent and str(last_sent).startswith(today_str):
                return False

            days_of_week = record.get("days_of_week") or []
            if not days_of_week:
                return False

            # Convert Python weekday (0=Mon, 6=Sun) to ISO (0=Sun, 1=Mon, ..., 6=Sat)
            iso_dow = (today_date.weekday() + 1) % 7
            return iso_dow in days_of_week

        return False

    def is_time_due(self, scheduled_time: str, current_time: datetime) -> bool:
        """Checks if the scheduled UTC time HH:MM has arrived."""
        try:
            sched_time_obj = datetime.strptime(scheduled_time.strip(), "%H:%M").time()
            return current_time.time() >= sched_time_obj
        except Exception as e:
            logger.warning(f"[EmailCron] Invalid scheduled_time format '{scheduled_time}': {e}")
            return False

    async def send_single_recipient(
        self,
        recipient_email: str,
        subject: str,
        raw_body: str,
        cfg: Dict[str, Any],
    ) -> bool:
        """Sends email to a single recipient after verifying subscription preferences."""
        try:
            # 1. Unsubscribe safety check
            allowed, block_reason = await should_send_email(recipient_email, reason="scheduled_dispatch")
            if not allowed:
                logger.info(f"[EmailCron] Skipped email to {recipient_email}: {block_reason}")
                return False

            # 2. Get user info to generate signed unsubscribe URL
            user = await get_user_by_email(recipient_email)
            user_id = user.get("user_id") if user else "anon"
            frontend_url = cfg["frontend_url"]

            try:
                unsubscribe_url = await generate_unsubscribe_url(recipient_email, str(user_id), frontend_url)
            except Exception:
                unsubscribe_url = f"{frontend_url}/login"

            # 3. Inject unsubscribe link into HTML body
            rendered_body = inject_unsubscribe_link(raw_body, unsubscribe_url)

            # 4. Asynchronous SMTP delivery
            await asyncio.to_thread(_send_smtp_sync, recipient_email, subject, rendered_body, unsubscribe_url, cfg)
            logger.info(f"[EmailCron] Successfully sent email to {recipient_email}")
            return True

        except Exception as e:
            logger.error(f"[EmailCron] Error dispatching email to {recipient_email}: {e}")
            return False

    async def process_record(self, record: Dict[str, Any], cfg: Dict[str, Any]) -> None:
        """Processes a single scheduled email record atomically."""
        email_id = record.get("scheduled_email_id")
        recipients = record.get("recipient_emails") or []
        subject = record.get("subject", "Notification from Lucid")
        body = record.get("body", "")
        schedule_type = record.get("schedule_type", "one_time")

        if not recipients:
            await update_email_status(email_id, status="failed", last_error="No recipient emails specified")
            return

        # Atomically claim the record to prevent race conditions across multi-instance ARQ workers
        claim = (
            supabase_admin.table("scheduled_emails")
            .update({"status": "processing"})
            .eq("scheduled_email_id", email_id)
            .eq("status", "pending")
            .execute()
        )
        if not claim.data:
            # Another concurrent worker claimed it
            logger.debug(f"[EmailCron] Job {email_id} already claimed by another worker. Skipping.")
            return

        success_count = 0
        now_iso = datetime.now(timezone.utc).isoformat()

        try:
            for recipient in recipients:
                ok = await self.send_single_recipient(recipient, subject, body, cfg)
                if ok:
                    success_count += 1

            if success_count > 0:
                if schedule_type == "one_time":
                    await update_email_status(email_id, status="sent", sent_at=now_iso)
                else:
                    # Recurring remains active/pending for next cycle with sent_at updated
                    await update_email_status(email_id, status="pending", sent_at=now_iso)
                logger.info(f"[EmailCron] Email schedule {email_id} completed ({success_count}/{len(recipients)} sent)")
            else:
                await update_email_status(
                    email_id,
                    status="failed" if schedule_type == "one_time" else "pending",
                    last_error="All recipients failed delivery or unsubscribed",
                )

        except Exception as e:
            logger.error(f"[EmailCron] Fatal error in email schedule {email_id}: {e}")
            await update_email_status(email_id, status="failed", last_error=str(e))

    async def process_pending_emails(self) -> None:
        """Main cron tick: queries and delivers all scheduled emails currently due."""
        try:
            cfg = _get_smtp_config()
        except Exception as e:
            logger.warning(f"[EmailCron] SMTP not configured. Scheduled emails suspended: {e}")
            return

        now_utc = datetime.now(timezone.utc)
        today_date = now_utc.date()

        try:
            res = await get_all_pending_emails()
            if res.get("error"):
                logger.error(f"[EmailCron] Error fetching pending emails: {res['error']}")
                return

            records = res.get("data") or []
            if not records:
                return

            due_records = [
                r for r in records
                if self.is_due_today(r, today_date) and self.is_time_due(r.get("scheduled_time", "00:00"), now_utc)
            ]

            if due_records:
                logger.info(f"[EmailCron] Found {len(due_records)} due emails to deliver.")
                for record in due_records:
                    await self.process_record(record, cfg)

        except Exception as e:
            logger.error(f"[EmailCron] Error during scheduled email scan: {e}", exc_info=True)


email_cron_worker = EmailCronWorker()


async def run_email_cron(ctx: Optional[dict] = None) -> None:
    """Entry point for ARQ cron scheduler."""
    await email_cron_worker.process_pending_emails()


async def send_email_task(
    ctx: Optional[dict],
    recipient_emails: List[str],
    subject: str,
    body: str,
) -> bool:
    """Direct ARQ task for enqueued background email sends."""
    cfg = _get_smtp_config()
    worker = EmailCronWorker()
    success = True
    for email in recipient_emails:
        ok = await worker.send_single_recipient(email, subject, body, cfg)
        if not ok:
            success = False
    return success
