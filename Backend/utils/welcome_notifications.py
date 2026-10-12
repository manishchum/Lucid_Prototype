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
    phone: Optional[str] = None,
    platform_type: str = "web",
) -> Dict[str, str]:
    display_name = recipient_name.strip() if recipient_name else "there"
    safe_company_name = company_name.strip() if company_name else "your organization"
    subject = f"Welcome to {safe_company_name}"
    web_portal_url = "https://lucid.workfloww.ai/"
    cta_url = "https://lucid.workfloww.ai/"
    playstore_url = "https://play.google.com/store/apps/details?id=com.workfloww.lucidmobile&pcampaignid=web_share"
    phone_display = phone.strip() if phone and str(phone).strip() else "Your registered mobile number"
    portal_domain = "lucid.workfloww.ai"

    normalized_platform = (platform_type or "web").strip().lower()
    if normalized_platform not in ("web", "mobile", "both"):
        normalized_platform = "web"

    # Shared HTML styles
    html_styles = """
    body { margin: 0; padding: 0; background: #f4f7fb; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1f2937; }
    .container { max-width: 640px; margin: 0 auto; padding: 32px 20px; }
    .card { background: #ffffff; border-radius: 18px; overflow: hidden; box-shadow: 0 18px 48px rgba(15, 23, 42, 0.10); }
    .header { background: linear-gradient(135deg, #0f766e 0%, #2563eb 100%); color: #ffffff; padding: 28px 32px; }
    .header h1 { margin: 0; font-size: 28px; line-height: 1.2; font-weight: 700; }
    .header p { margin: 8px 0 0; opacity: 0.92; font-size: 15px; }
    .content { padding: 32px; background: #ffffff; }
    .highlight { background: #f8fafc; border: 1px solid #e2e8f0; border-left: 5px solid #0f766e; border-radius: 14px; padding: 22px; margin: 20px 0; }
    .highlight-mobile { background: #f8fafc; border: 1px solid #e2e8f0; border-left: 5px solid #2563eb; border-radius: 14px; padding: 22px; margin: 20px 0; }
    .button { display: inline-block; padding: 13px 26px; background: #0f766e; color: #ffffff !important; text-decoration: none; border-radius: 999px; font-weight: 700; font-size: 14px; }
    .button-blue { display: inline-block; padding: 13px 26px; background: #2563eb; color: #ffffff !important; text-decoration: none; border-radius: 999px; font-weight: 700; font-size: 14px; }
    .footer { padding: 18px 32px 28px; font-size: 12px; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; background: #ffffff; }
    .cred-row { margin-top: 8px; color: #334155; font-size: 14px; }
    .cred-label { font-weight: 600; color: #1e293b; display: inline-block; min-width: 130px; }
    """

    if normalized_platform == "web":
        # Format 1: Web based (matches image)
        body_content = f"""
        <p style="margin: 0 0 16px; font-size: 15px; color: #1e293b;">Hello {display_name},</p>
        <p style="margin: 0 0 20px; font-size: 15px; line-height: 1.5; color: #334155;">Your account for <strong>{safe_company_name}</strong> has been created successfully.</p>

        <div class="highlight">
          <div style="font-size: 16px; font-weight: 700; color: #0f172a; margin-bottom: 14px;">Your login credentials</div>
          <div class="cred-row"><span class="cred-label">Platform:</span> Lucid</div>
          <div class="cred-row"><span class="cred-label">Web Portal:</span> <a href="{web_portal_url}" style="color: #2563eb; text-decoration: none;">{portal_domain}</a></div>
          <div class="cred-row"><span class="cred-label">Username:</span> <a href="mailto:{login_email}" style="color: #2563eb; text-decoration: none;">{login_email}</a></div>
          <div class="cred-row"><span class="cred-label">Default Password:</span> <span style="font-family: monospace; font-weight: 600; color: #0f172a;">{default_password}</span></div>
          <div style="margin-top: 14px; font-size: 13px; line-height: 1.5; color: #64748b;">
            Please log in using the above credentials. We recommend changing your password after your first login to ensure the security of your account.
          </div>
        </div>

        <p style="margin: 24px 0 12px; font-size: 14px; color: #334155;">Access your account here:</p>
        <a href="{cta_url}" class="button">Go to Login</a>
        """

        text = (
            f"Hello {display_name},\n\n"
            f"Your account for {safe_company_name} has been created successfully.\n\n"
            f"Your login credentials:\n"
            f"Platform: Lucid\n"
            f"Web Portal: {portal_domain}\n"
            f"Username: {login_email}\n"
            f"Default Password: {default_password}\n\n"
            f"Please log in using the above credentials. We recommend changing your password after your first login to ensure the security of your account.\n\n"
            f"Access your account here: {cta_url}\n\n"
            f"This is an automated message from Lucid Platform."
        )

    elif normalized_platform == "mobile":
        # Format 2: Mobile based (download link & phone number for OTP)
        body_content = f"""
        <p style="margin: 0 0 16px; font-size: 15px; color: #1e293b;">Hello {display_name},</p>
        <p style="margin: 0 0 20px; font-size: 15px; line-height: 1.5; color: #334155;">Your account for <strong>{safe_company_name}</strong> has been created successfully.</p>

        <div class="highlight">
          <div style="font-size: 16px; font-weight: 700; color: #0f172a; margin-bottom: 14px;">Your login credentials</div>
          <div class="cred-row"><span class="cred-label">Platform:</span> Lucid Mobile</div>
          <div class="cred-row"><span class="cred-label">Username:</span> <strong style="color: #0f172a;">{phone_display}</strong></div>
          <div style="margin-top: 14px; font-size: 13px; line-height: 1.5; color: #64748b;">
            Please log in with OTP using your registered mobile number.
          </div>
        </div>

        <p style="margin: 24px 0 12px; font-size: 14px; font-weight: 600; color: #334155;">Download Mobile App:</p>
        <a href="{playstore_url}" class="button">Get It On Google Play</a>
        """

        text = (
            f"Hello {display_name},\n\n"
            f"Your account for {safe_company_name} has been created successfully.\n\n"
            f"Your login credentials:\n"
            f"Platform: Lucid Mobile\n"
            f"Username (Mobile Number): {phone_display}\n\n"
            f"Please log in with OTP using your mobile number.\n\n"
            f"Download our mobile app: {playstore_url}\n\n"
            f"This is an automated message from Lucid Platform."
        )

    else:
        # Format 3: Both (Web & Mobile information)
        body_content = f"""
        <p style="margin: 0 0 16px; font-size: 15px; color: #1e293b;">Hello {display_name},</p>
        <p style="margin: 0 0 20px; font-size: 15px; line-height: 1.5; color: #334155;">Your account for <strong>{safe_company_name}</strong> has been created successfully. You can access your account via our web portal or mobile application.</p>

        <!-- Web Credentials -->
        <div class="highlight">
          <div style="font-size: 16px; font-weight: 700; color: #0f172a; margin-bottom: 14px;">Web Portal Credentials</div>
          <div class="cred-row"><span class="cred-label">Platform:</span> Lucid Web</div>
          <div class="cred-row"><span class="cred-label">Web Portal:</span> <a href="{web_portal_url}" style="color: #2563eb; text-decoration: none;">{portal_domain}</a></div>
          <div class="cred-row"><span class="cred-label">Username:</span> <a href="mailto:{login_email}" style="color: #2563eb; text-decoration: none;">{login_email}</a></div>
          <div class="cred-row"><span class="cred-label">Default Password:</span> <span style="font-family: monospace; font-weight: 600; color: #0f172a;">{default_password}</span></div>
          <div style="margin-top: 14px; font-size: 13px; line-height: 1.5; color: #64748b;">
            Please log in using the above credentials. We recommend changing your password after your first login to ensure the security of your account.
          </div>
          <div style="margin-top: 18px;">
            <a href="{cta_url}" class="button">Go to Login</a>
          </div>
        </div>

        <!-- Mobile Credentials -->
        <div class="highlight-mobile">
          <div style="font-size: 16px; font-weight: 700; color: #0f172a; margin-bottom: 14px;">Mobile App Access</div>
          <div class="cred-row"><span class="cred-label">Platform:</span> Lucid Mobile</div>
          <div class="cred-row"><span class="cred-label">Username:</span> <strong style="color: #0f172a;">{phone_display}</strong></div>
          <div style="margin-top: 14px; font-size: 13px; line-height: 1.5; color: #64748b;">
            Please log in with OTP using your registered mobile number.
          </div>
          <p style="margin: 18px 0 10px; font-size: 14px; font-weight: 600; color: #334155;">Download Mobile App:</p>
          <a href="{playstore_url}" class="button-blue">Get It On Google Play</a>
        </div>
        """

        text = (
            f"Hello {display_name},\n\n"
            f"Your account for {safe_company_name} has been created successfully. You can access your account via our web portal or mobile application.\n\n"
            f"--- WEB PORTAL CREDENTIALS ---\n"
            f"Platform: Lucid Web\n"
            f"Web Portal: {portal_domain}\n"
            f"Username: {login_email}\n"
            f"Default Password: {default_password}\n"
            f"Go to login: {cta_url}\n\n"
            f"--- MOBILE APP ACCESS ---\n"
            f"Platform: Lucid Mobile\n"
            f"Username (Mobile Number): {phone_display}\n"
            f"Please log in with OTP using your mobile number.\n"
            f"Download our mobile app: {playstore_url}\n\n"
            f"This is an automated message from Lucid Platform."
        )

    html = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"> 
  <meta name="viewport" content="width=device-width, initial-scale=1.0"> 
  <title>{subject}</title>
  <style>
{html_styles}
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="header">
        <h1>Your account is ready</h1>
        <p>Welcome To The Lucid Platform.</p>
      </div>
      <div class="content">
{body_content}
      </div>
      <div class="footer">
        <p>This is an automated message from Lucid Platform.</p>
      </div>
    </div>
  </div>
</body>
</html>"""

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
    phone: Optional[str] = None,
    platform_type: str = "web",
    default_password: Optional[str] = None,
) -> Dict[str, Any]:
    settings = _smtp_settings()
    app_frontend_url = frontend_url or settings["frontend_url"]
    pwd = default_password or os.getenv("DEFAULT_PASSWORD") or "workfloww@2025"
    email_payload = _build_welcome_email(
        recipient_name=recipient_name,
        company_name=company_name,
        frontend_url=app_frontend_url,
        login_email=recipient_email,
        default_password=pwd,
        phone=phone,
        platform_type=platform_type,
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