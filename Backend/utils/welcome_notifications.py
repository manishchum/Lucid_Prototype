from __future__ import annotations

import asyncio
import logging
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any, Dict, Optional

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


def _build_welcome_email(
  recipient_name: str,
  company_name: str,
  frontend_url: str,
  login_email: str,
  default_password: str,
) -> Dict[str, str]:
    display_name = recipient_name.strip() if recipient_name else "there"
    safe_company_name = company_name.strip() if company_name else "your organization"
    subject = f"Welcome to {safe_company_name}"
    cta_url = f"{frontend_url}/login"

    html = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset=\"utf-8\"> 
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"> 
  <title>{subject}</title>
  <style>
    body {{ margin: 0; padding: 0; background: #f4f7fb; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1f2937; }}
    .container {{ max-width: 640px; margin: 0 auto; padding: 32px 20px; }}
    .card {{ background: #ffffff; border-radius: 18px; overflow: hidden; box-shadow: 0 18px 48px rgba(15, 23, 42, 0.10); }}
    .header {{ background: linear-gradient(135deg, #0f766e 0%, #2563eb 100%); color: #ffffff; padding: 28px 32px; }}
    .header h1 {{ margin: 0; font-size: 28px; line-height: 1.2; }}
    .header p {{ margin: 8px 0 0; opacity: 0.92; }}
    .content {{ padding: 32px; background: #ffffff; }}
    .highlight {{ background: #f8fafc; border: 1px solid #e2e8f0; border-left: 5px solid #0f766e; border-radius: 14px; padding: 20px; margin: 22px 0; }}
    .button {{ display: inline-block; margin-top: 22px; padding: 13px 24px; background: #0f766e; color: #ffffff !important; text-decoration: none; border-radius: 999px; font-weight: 700; }}
    .footer {{ padding: 18px 32px 28px; font-size: 12px; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; background: #ffffff; }}
  </style>
</head>
<body>
  <div class=\"container\">
    <div class=\"card\">
      <div class=\"header\">
        <h1>Your account is ready</h1>
        <p>Welcome To The Lucid Platform.</p>
      </div>
      <div class=\"content\">
        <p>Hello {display_name},</p>
        <p>Your account for <strong>{safe_company_name}</strong> has been created successfully.</p>

        <div class=\"highlight\">
          <strong>Your login credentials</strong>
          <div style=\"margin-top: 8px; color: #475569;\"><strong>Email:</strong> {login_email}</div>
          <div style=\"margin-top: 4px; color: #475569;\"><strong>Password:</strong> {default_password}</div>
          <div style=\"margin-top: 8px; color: #475569;\">Please change your password after your first login.</div>
        </div>

        <p>Open your account here:</p>
        <a href=\"{cta_url}\" class=\"button\">Go to Login</a>
      </div>
      <div class=\"footer\">
        <p>This is an automated message from Lucid Learning.</p>
      </div>
    </div>
  </div>
</body>
</html>"""

    text = (
        f"Hello {display_name},\n\n"
        f"Your account for {safe_company_name} has been created successfully.\n\n"
        f"Your login credentials:\n"
        f"Email: {login_email}\n"
        f"Password: {default_password}\n\n"
        f"Please change your password after your first login.\n\n"
        f"Go to login: {cta_url}\n\n"
        f"This is an automated message from Lucid Learning."
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


async def send_welcome_email(
    recipient_email: str,
    recipient_name: str,
    company_name: str,
    frontend_url: Optional[str] = None,
) -> Dict[str, Any]:
    settings = _smtp_settings()
    app_frontend_url = frontend_url or settings["frontend_url"]
    email_payload = _build_welcome_email(
        recipient_name,
        company_name,
        app_frontend_url,
        recipient_email,
        "workfloww@2025",
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
        return {"success": True, "email": recipient_email, "subject": email_payload["subject"]}
    except Exception as exc:
        logger.error("Failed to send welcome email to %s: %s", recipient_email, exc)
        return {"success": False, "email": recipient_email, "error": str(exc)}


def _build_sprint_completion_email(recipient_name: str, sprint_title: str, company_name: str, frontend_url: str) -> Dict[str, str]:
    display_name = recipient_name.strip() if recipient_name else "there"
    safe_sprint_title = sprint_title.strip() if sprint_title else "the sprint"
    safe_company_name = company_name.strip() if company_name else "your organization"
    subject = f"Congratulations! You've completed {safe_sprint_title}"
    cta_url = f"{frontend_url}/dashboard"

    html = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset=\"utf-8\">
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">
  <title>{subject}</title>
  <style>
    body {{ margin: 0; padding: 0; background: #f4f7fb; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1f2937; }}
    .container {{ max-width: 640px; margin: 0 auto; padding: 32px 20px; }}
    .card {{ background: #ffffff; border-radius: 18px; overflow: hidden; box-shadow: 0 18px 48px rgba(15, 23, 42, 0.10); }}
    .header {{ background: linear-gradient(135deg, #059669 0%, #10b981 100%); color: #ffffff; padding: 28px 32px; text-align: center; }}
    .header h1 {{ margin: 0; font-size: 28px; line-height: 1.2; }}
    .header p {{ margin: 8px 0 0; opacity: 0.92; }}
    .trophy {{ font-size: 48px; margin: 12px 0; }}
    .content {{ padding: 32px; background: #ffffff; }}
    .achievement-box {{ background: #f0fdf4; border: 2px solid #86efac; border-radius: 14px; padding: 20px; margin: 22px 0; text-align: center; }}
    .achievement-box strong {{ color: #059669; font-size: 18px; }}
    .stats {{ display: flex; justify-content: space-around; margin: 20px 0; text-align: center; }}
    .stat-item {{ flex: 1; }}
    .stat-value {{ font-size: 24px; font-weight: 700; color: #059669; }}
    .stat-label {{ font-size: 12px; color: #6b7280; margin-top: 4px; }}
    .button {{ display: inline-block; margin-top: 22px; padding: 13px 32px; background: #059669; color: #ffffff !important; text-decoration: none; border-radius: 999px; font-weight: 700; }}
    .footer {{ padding: 18px 32px 28px; font-size: 12px; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; background: #ffffff; }}
  </style>
</head>
<body>
  <div class=\"container\">
    <div class=\"card\">
      <div class=\"header\">
        <div class=\"trophy\">🏆</div>
        <h1>Well Done, {display_name}!</h1>
        <p>You've successfully completed your sprint</p>
      </div>
      <div class=\"content\">
        <p>Hello {display_name},</p>
        <p>We're thrilled to inform you that you have successfully completed <strong>{safe_sprint_title}</strong> at {safe_company_name}.</p>

        <div class=\"achievement-box\">
          <div class=\"trophy\" style=\"font-size: 36px; margin: 0 0 8px 0;\">✓</div>
          <strong>Sprint Complete!</strong>
          <p style=\"margin: 8px 0 0 0; color: #059669;\">Excellent progress on your learning journey</p>
        </div>

        <p>View your completion certificate and see what's next:</p>
        <center>
          <a href=\"{cta_url}\" class=\"button\">Go to Dashboard</a>
        </center>
      </div>
      <div class=\"footer\">
        <p>This is an automated message from Lucid Learning.</p>
      </div>
    </div>
  </div>
</body>
</html>"""

    text = (
        f"Hello {display_name},\n\n"
        f"Congratulations! You have successfully completed {safe_sprint_title} at {safe_company_name}.\n\n"
        f"View your completion certificate and see what's next by visiting your dashboard:\n"
        f"{cta_url}\n\n"
        f"This is an automated message from Lucid Learning."
    )

    return {"subject": subject, "html": html, "text": text}


async def send_sprint_completion_email(
    recipient_email: str,
    recipient_name: str,
    sprint_title: str,
    company_name: str,
    frontend_url: Optional[str] = None,
) -> Dict[str, Any]:
    settings = _smtp_settings()
    app_frontend_url = frontend_url or settings["frontend_url"]
    email_payload = _build_sprint_completion_email(recipient_name, sprint_title, company_name, app_frontend_url)

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
        return {"success": True, "email": recipient_email, "subject": email_payload["subject"]}
    except Exception as exc:
        logger.error("Failed to send sprint completion email to %s: %s", recipient_email, exc)
        return {"success": False, "email": recipient_email, "error": str(exc)}