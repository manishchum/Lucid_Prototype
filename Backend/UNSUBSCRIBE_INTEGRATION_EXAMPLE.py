"""
Integration Example: Using Unsubscribe System with Email Sending

This example shows how to integrate the unsubscribe system into actual
email sending functions. Copy and adapt to your email sending code.
"""

import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional, Dict, Any
import logging

from utils.email_helper import (
    should_send_email,
    prepare_email_html,
    prepare_email_text,
    log_email_skipped,
)

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# EXAMPLE 1: Send Email to Single User (with Unsubscribe Check)
# ─────────────────────────────────────────────────────────────────────────────

async def send_module_notification_email(
    user_email: str,
    user_id: str,
    user_name: str,
    module_title: str,
    html_template: str,
    text_template: str,
) -> bool:
    """
    Send a module notification email with unsubscribe link.

    Args:
        user_email: Recipient email address
        user_id: Recipient user ID (UUID)
        user_name: Recipient name
        module_title: Title of module being notified about
        html_template: Email HTML template (can contain placeholder unsubscribe links)
        text_template: Email plain text template

    Returns:
        bool: True if email sent, False if skipped (unsubscribed) or failed
    """
    # Step 1: Check if user is unsubscribed
    should_send, reason = await should_send_email(
        user_email,
        reason="module_notification"
    )

    if not should_send:
        # User is unsubscribed, log and return
        await log_email_skipped(user_email, user_id, reason or "unsubscribed")
        return False

    try:
        # Step 2: Prepare email content with unsubscribe link injected
        frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")

        html_content = await prepare_email_html(
            template_html=html_template,
            email=user_email,
            user_id=user_id,
            frontend_url=frontend_url
        )

        text_content = await prepare_email_text(
            template_text=text_template,
            email=user_email,
            user_id=user_id,
            frontend_url=frontend_url
        )

        # Step 3: Send via SMTP
        smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
        smtp_port = int(os.getenv("SMTP_PORT", "587"))
        smtp_user = os.getenv("SMTP_USER")
        smtp_pass = os.getenv("SMTP_PASS")

        if not smtp_user or not smtp_pass:
            logger.error("SMTP credentials not configured")
            return False

        server = smtplib.SMTP(smtp_host, smtp_port)
        server.starttls()
        server.login(smtp_user, smtp_pass)

        # Create multipart message (text + html)
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"New Module: {module_title}"
        msg["From"] = smtp_user
        msg["To"] = user_email

        # Add plain text and HTML parts
        msg.attach(MIMEText(text_content, "plain"))
        msg.attach(MIMEText(html_content, "html"))

        # Send
        server.sendmail(smtp_user, user_email, msg.as_string())
        server.quit()

        logger.info(
            f"Email sent to {user_email}",
            extra={
                "user_id": user_id,
                "user_name": user_name,
                "module_title": module_title,
            }
        )
        return True

    except Exception as e:
        logger.error(
            f"Failed to send email to {user_email}: {e}",
            extra={"user_id": user_id}
        )
        return False


# ─────────────────────────────────────────────────────────────────────────────
# EXAMPLE 2: Bulk Email Send (Multiple Users with Filtering)
# ─────────────────────────────────────────────────────────────────────────────

async def send_bulk_notification_email(
    company_id: str,
    subject: str,
    html_template: str,
    text_template: str,
) -> Dict[str, Any]:
    """
    Send notification email to all active, subscribed users in a company.

    This example shows how to:
    1. Query only subscribed users (email_unsubscribed = false)
    2. Generate personalized unsubscribe links for each user
    3. Handle failures gracefully
    4. Return summary statistics

    Args:
        company_id: Company UUID
        subject: Email subject
        html_template: HTML template (can contain {unsubscribe_url} placeholder)
        text_template: Text template

    Returns:
        dict with keys: sent_count, failed_count, skipped_count, failed_emails
    """
    from utils.supabase_client import supabase
    from utils.email_helper import prepare_email_html, prepare_email_text

    # Step 1: Fetch only SUBSCRIBED users from company
    # This is the key difference - filter by email_unsubscribed = false
    try:
        result = supabase.table("users").select(
            "user_id, email, name"
        ).eq("company_id", company_id).eq(
            "is_active", True
        ).eq("email_unsubscribed", False).execute()

        users = result.data or []

    except Exception as e:
        logger.error(f"Failed to fetch users for company {company_id}: {e}")
        return {
            "sent_count": 0,
            "failed_count": 0,
            "skipped_count": 0,
            "failed_emails": [],
            "error": str(e),
        }

    if not users:
        logger.warning(f"No subscribed users found in company {company_id}")
        return {
            "sent_count": 0,
            "failed_count": 0,
            "skipped_count": len(users),
            "failed_emails": [],
        }

    # Step 2: Send to each user
    sent_count = 0
    failed_count = 0
    failed_emails = []
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")

    # Setup SMTP once for efficiency
    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER")
    smtp_pass = os.getenv("SMTP_PASS")

    if not smtp_user or not smtp_pass:
        logger.error("SMTP credentials not configured")
        return {
            "sent_count": 0,
            "failed_count": len(users),
            "skipped_count": 0,
            "failed_emails": [u["email"] for u in users],
            "error": "SMTP credentials not configured",
        }

    try:
        server = smtplib.SMTP(smtp_host, smtp_port)
        server.starttls()
        server.login(smtp_user, smtp_pass)

        for user in users:
            try:
                # Prepare personalized content with unsubscribe link
                html = await prepare_email_html(
                    template_html=html_template,
                    email=user["email"],
                    user_id=user["user_id"],
                    frontend_url=frontend_url
                )

                text = await prepare_email_text(
                    template_text=text_template,
                    email=user["email"],
                    user_id=user["user_id"],
                    frontend_url=frontend_url
                )

                # Create message
                msg = MIMEMultipart("alternative")
                msg["Subject"] = subject
                msg["From"] = smtp_user
                msg["To"] = user["email"]
                msg.attach(MIMEText(text, "plain"))
                msg.attach(MIMEText(html, "html"))

                # Send
                server.sendmail(smtp_user, user["email"], msg.as_string())
                sent_count += 1

                logger.info(f"Email sent to {user['email']}")

            except Exception as e:
                failed_count += 1
                failed_emails.append(user["email"])
                logger.error(f"Failed to send email to {user['email']}: {e}")

        server.quit()

    except Exception as e:
        logger.error(f"SMTP error: {e}")
        return {
            "sent_count": sent_count,
            "failed_count": failed_count + (len(users) - sent_count - failed_count),
            "skipped_count": 0,
            "failed_emails": failed_emails + [
                u["email"] for u in users[sent_count + failed_count:]
            ],
            "error": str(e),
        }

    return {
        "sent_count": sent_count,
        "failed_count": failed_count,
        "skipped_count": 0,
        "failed_emails": failed_emails,
    }


# ─────────────────────────────────────────────────────────────────────────────
# EXAMPLE 3: Integration with Dispatch System (Backend)
# ─────────────────────────────────────────────────────────────────────────────

# This is how you would integrate into Backend/routes/dispatch.py


async def send_email_to_sprint_users(
    sprint_id: str,
    subject: str,
    body_html: str,
    body_text: str,
) -> Dict[str, Any]:
    """
    Example of integrating unsubscribe system into dispatch endpoint.

    Before:
        - Sent to all users regardless of unsubscribe status
        - No unsubscribe link in emails

    After:
        - Filters out unsubscribed users automatically
        - Injects unsubscribe link into each email
        - Logs skipped users
    """
    from utils.supabase_client import supabase

    try:
        # Get sprint details
        sprint_result = supabase.table("training_modules").select(
            "module_id, title"
        ).eq("module_id", sprint_id).execute()

        if not sprint_result.data:
            return {"error": "Sprint not found", "sent": 0}

        sprint = sprint_result.data[0]

        # Get users assigned to sprint who are subscribed
        # ⭐ KEY: Filter by email_unsubscribed = false
        users_result = supabase.table("users").select(
            "user_id, email, name"
        ).in_("user_id", []).eq(
            "email_unsubscribed", False  # ⭐ Only subscribed users
        ).eq(
            "is_active", True
        ).execute()

        users = users_result.data or []

        # Send emails (using send_bulk_notification_email above)
        result = await send_bulk_notification_email(
            company_id="",  # Get from sprint
            subject=subject,
            html_template=body_html,
            text_template=body_text,
        )

        return {
            "status": "success",
            "sprint_id": sprint_id,
            "sprint_title": sprint["title"],
            **result,
        }

    except Exception as e:
        logger.error(f"Failed to send sprint email: {e}")
        return {"error": str(e), "sent": 0}


# ─────────────────────────────────────────────────────────────────────────────
# EXAMPLE 4: Email Template with Unsubscribe Link
# ─────────────────────────────────────────────────────────────────────────────

def get_email_template() -> tuple[str, str]:
    """
    Example email templates with unsubscribe link.

    The {unsubscribe_url} placeholder will be replaced by prepare_email_html/text.
    """
    html_template = """
    <html>
    <body style="font-family: Arial, sans-serif;">
        <h1>Welcome to Lucid Learning!</h1>
        
        <p>Hi,</p>
        
        <p>We're excited to have you onboard. Check out your personalized learning path.</p>
        
        <p><a href="https://app.example.com">Start Learning</a></p>
        
        <hr style="margin: 40px 0;">
        
        <footer style="font-size: 12px; color: #666;">
            <p>
                <a href="{unsubscribe_url}">Unsubscribe from emails</a> | 
                <a href="https://app.example.com/preferences">Manage preferences</a>
            </p>
            <p>&copy; 2024 Lucid Learning. All rights reserved.</p>
        </footer>
    </body>
    </html>
    """

    text_template = """
    Welcome to Lucid Learning!

    Hi,

    We're excited to have you onboard. Check out your personalized learning path.

    Start Learning: https://app.example.com

    ────────────────────────────────────────────────

    To unsubscribe from emails, visit: {unsubscribe_url}
    To manage your preferences: https://app.example.com/preferences

    © 2024 Lucid Learning. All rights reserved.
    """

    return html_template, text_template


# ─────────────────────────────────────────────────────────────────────────────
# Testing the Integration
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import asyncio

    async def test_integration():
        """Quick test of the integration"""
        print("Testing unsubscribe integration...")

        # Test 1: Single email with unsubscribe
        result = await send_module_notification_email(
            user_email="test@example.com",
            user_id="550e8400-e29b-41d4-a716-446655440000",
            user_name="Test User",
            module_title="Python Basics",
            html_template="""
            <h1>Welcome {name}</h1>
            <p>Check out {module_title}</p>
            <a href="#">Unsubscribe</a>
            """,
            text_template="""
            Welcome {name}
            Check out {module_title}
            To unsubscribe: visit the link in the footer
            """
        )

        print(f"Email send result: {result}")

        # Test 2: Get templates
        html, text = get_email_template()
        print(f"\nHTML template length: {len(html)} chars")
        print(f"Text template length: {len(text)} chars")

    # Run test
    asyncio.run(test_integration())
