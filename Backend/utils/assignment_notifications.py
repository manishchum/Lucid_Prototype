"""
Helpers for assignment notification emails.

Used for sprint and roleplay assignment notifications that should be sent
immediately after the underlying assignment is created.
"""

from __future__ import annotations

import asyncio
import logging
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any, Dict, List, Optional

from utils.email_helper import (
    MissingSecretError,
    generate_unsubscribe_url,
    should_send_email,
)

logger = logging.getLogger(__name__)


def _smtp_settings() -> Dict[str, Any]:
    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_pass = os.getenv("SMTP_PASS", "")
    from_email = os.getenv("FROM_EMAIL", smtp_user)
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")

    if not smtp_user or not smtp_pass:
        raise RuntimeError("SMTP credentials not configured on server")

    return {
        "smtp_host": smtp_host,
        "smtp_port": smtp_port,
        "smtp_user": smtp_user,
        "smtp_pass": smtp_pass,
        "from_email": from_email,
        "frontend_url": frontend_url,
    }


def _assignment_label(assignment_kind: str) -> str:
    kind = (assignment_kind or "").strip().lower()
    if kind == "roleplay":
        return "roleplay"
    return "sprint"


def _build_assignment_email(
    recipient_name: str,
    assignment_title: str,
    company_name: str,
    assignment_kind: str,
    frontend_url: str,
    unsubscribe_url: str,
) -> Dict[str, str]:
    label = _assignment_label(assignment_kind)
    title_text = assignment_title.strip() if assignment_title else f"New {label.title()}"
    subject = f"New {label.title()} Assigned: {title_text}"
    cta_url = f"{frontend_url}/login"

    html = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{subject}</title>
  <style>
    body {{ margin: 0; padding: 0; background: #f4f7fb; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1f2937; }}
    .container {{ max-width: 640px; margin: 0 auto; padding: 32px 20px; }}
    .card {{ background: #ffffff; border-radius: 18px; overflow: hidden; box-shadow: 0 18px 48px rgba(15, 23, 42, 0.10); }}
    .header {{ background: linear-gradient(135deg, #2563eb 0%, #14b8a6 100%); color: #ffffff; padding: 28px 32px; }}
    .header h1 {{ margin: 0; font-size: 28px; line-height: 1.2; }}
    .header p {{ margin: 8px 0 0; opacity: 0.92; }}
    .content {{ padding: 32px; background: #ffffff; }}
    .assignment-box {{ background: #f8fafc; border: 1px solid #e2e8f0; border-left: 5px solid #2563eb; border-radius: 14px; padding: 20px; margin: 22px 0; }}
    .meta {{ margin-top: 12px; font-size: 14px; color: #475569; }}
    .button {{ display: inline-block; margin-top: 22px; padding: 13px 24px; background: #0f766e; color: #ffffff !important; text-decoration: none; border-radius: 999px; font-weight: 700; }}
    .footer {{ padding: 18px 32px 28px; font-size: 12px; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; background: #ffffff; }}
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="header">
        <h1>New {label.title()} Assigned</h1>
        <p>Your learning dashboard has been updated.</p>
      </div>
      <div class="content">
        <p>Hello {recipient_name or 'there'},</p>
        <p>A new {label} has been assigned to you. Please review it at your earliest convenience.</p>

        <div class="assignment-box">
          <strong>{title_text}</strong>
          <div class="meta">Company: {company_name}</div>
        </div>

        <p>Open your dashboard to continue:</p>
        <a href="{cta_url}" class="button">View Dashboard</a>
      </div>
      <div class="footer">
        <p>This is an automated notification from Lucid Learning.</p>
        <p><a href="{unsubscribe_url}" style="color:#64748b;text-decoration:none;">Manage email preferences</a></p>
      </div>
    </div>
  </div>
</body>
</html>"""

    text = (
        f"Hello {recipient_name or 'there'},\n\n"
        f"A new {label} has been assigned to you.\n\n"
        f"Assignment: {title_text}\n"
        f"Company: {company_name}\n\n"
        f"View your dashboard: {cta_url}\n\n"
        f"This is an automated notification from Lucid Learning.\n"
        f"Manage email preferences: {unsubscribe_url}"
    )

    return {"subject": subject, "html": html, "text": text}


def _send_via_smtp(
    from_email: str,
    smtp_host: str,
    smtp_port: int,
    smtp_user: str,
    smtp_pass: str,
    recipient_email: str,
    subject: str,
    html_body: str,
    text_body: str,
) -> None:
    server = smtplib.SMTP(smtp_host, smtp_port)
    try:
        server.starttls()
        server.login(smtp_user, smtp_pass)

        message = MIMEMultipart("alternative")
        message["Subject"] = subject
        message["From"] = from_email
        message["To"] = recipient_email
        message.attach(MIMEText(text_body, "plain"))
        message.attach(MIMEText(html_body, "html"))

        server.sendmail(from_email, recipient_email, message.as_string())
    finally:
        try:
            server.quit()
        except Exception:
            pass


async def send_assignment_notification_email(
    recipient_email: str,
    recipient_name: str,
    recipient_user_id: str,
    assignment_title: str,
    company_name: str,
    assignment_kind: str,
    frontend_url: Optional[str] = None,
    send_in_app: bool = True,
) -> Dict[str, Any]:
    # ── 1. Create In-App Notification ──────────────────────────────────────────
    if send_in_app:
        try:
            from utils.supabase_client import supabase
            from utils.websocket_manager import manager
            from utils.auth import _ensure_firebase_admin_initialized
            from firebase_admin import messaging

            # Query user's company_id and fcm_token
            user_data = supabase.table("users").select("company_id, fcm_token").eq("user_id", recipient_user_id).single().execute()
            company_id = user_data.data.get("company_id") if user_data.data else None
            fcm_token = user_data.data.get("fcm_token") if user_data.data else None

            title = "New Sprint Assigned" if assignment_kind == "sprint" else "New Roleplay Coach Assigned"
            msg_body = f"You have been assigned to sprint '{assignment_title}'." if assignment_kind == "sprint" else f"You have been assigned to roleplay coach '{assignment_title}'."

            notification_payload = {
                "user_id": recipient_user_id,
                "title": title,
                "message": msg_body,
                "type": f"{assignment_kind}_assigned",
                "metadata": {
                    "assignment_title": assignment_title,
                    "company_id": company_id
                }
            }
            
            insert_resp = supabase.table("notifications").insert(notification_payload).execute()
            
            if insert_resp.data:
                notification = insert_resp.data[0]
                
                # Send WebSocket notification
                ws_payload = {
                    "event": "new_notification",
                    "data": notification
                }
                await manager.send_personal_message(recipient_user_id, ws_payload)
                
                # Send FCM Push notification
                if fcm_token:
                    try:
                        _ensure_firebase_admin_initialized()
                        fcm_message = messaging.Message(
                            notification=messaging.Notification(
                                title=notification["title"],
                                body=notification["message"],
                            ),
                            data={
                                "id": str(notification["id"]),
                                "type": str(notification["type"]),
                                "assignment_title": str(assignment_title),
                            },
                            token=fcm_token,
                        )
                        messaging.send(fcm_message)
                    except Exception as fcm_err:
                        logger.warning("[FCM] Error sending push notification: %s", fcm_err)
        except Exception as notif_err:
            logger.error("Failed to create in-app notification for %s: %s", recipient_user_id, notif_err)

    # ── 2. Send Email Notification ──────────────────────────────────────────────
    should_send, reason = await should_send_email(recipient_email, reason=f"{assignment_kind}_assignment")
    if not should_send:
        return {
            "success": False,
            "email": recipient_email,
            "reason": reason or "User is not eligible for email notifications",
        }

    settings = _smtp_settings()
    app_frontend_url = frontend_url or settings["frontend_url"]

    unsubscribe_url = f"{app_frontend_url}/login"
    try:
        unsubscribe_url = await generate_unsubscribe_url(recipient_email, recipient_user_id, app_frontend_url)
    except MissingSecretError:
        logger.warning("UNSUBSCRIBE_SECRET is not configured; sending assignment email without unsubscribe token.")
    except Exception as exc:
        logger.warning("Failed to generate unsubscribe URL for %s: %s", recipient_email, exc)

    email_payload = _build_assignment_email(
        recipient_name=recipient_name,
        assignment_title=assignment_title,
        company_name=company_name,
        assignment_kind=assignment_kind,
        frontend_url=app_frontend_url,
        unsubscribe_url=unsubscribe_url,
    )

    try:
        await asyncio.to_thread(
            _send_via_smtp,
            settings["from_email"],
            settings["smtp_host"],
            settings["smtp_port"],
            settings["smtp_user"],
            settings["smtp_pass"],
            recipient_email,
            email_payload["subject"],
            email_payload["html"],
            email_payload["text"],
        )
        return {
            "success": True,
            "email": recipient_email,
            "subject": email_payload["subject"],
        }
    except Exception as exc:
        logger.error("Failed to send assignment email to %s: %s", recipient_email, exc)
        return {
            "success": False,
            "email": recipient_email,
            "error": str(exc),
        }


async def send_bulk_assignment_notification_emails(
    recipients: List[Dict[str, Any]],
    assignment_title: str,
    company_name: str,
    assignment_kind: str,
    frontend_url: Optional[str] = None,
    send_in_app: bool = True,
) -> Dict[str, Any]:
    results = []
    sent_count = 0
    failed_count = 0

    for recipient in recipients:
        result = await send_assignment_notification_email(
            recipient_email=recipient.get("email", ""),
            recipient_name=recipient.get("name", "Employee"),
            recipient_user_id=recipient.get("user_id", ""),
            assignment_title=assignment_title,
            company_name=company_name,
            assignment_kind=assignment_kind,
            frontend_url=frontend_url,
            send_in_app=send_in_app,
        )
        results.append(result)
        if result.get("success"):
            sent_count += 1
        else:
            failed_count += 1

    return {
        "success": failed_count == 0,
        "sent_count": sent_count,
        "failed_count": failed_count,
        "results": results,
    }