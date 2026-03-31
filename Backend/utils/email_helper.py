"""
Email Helper Utilities

Provides utilities for sending compliant emails with unsubscribe links.
Checks user unsubscribe status before sending and injects unsubscribe URLs.
"""

import logging
from typing import Optional, Dict, Any, Tuple
from datetime import datetime

from utils.supabase_client import supabase
from utils.unsubscribe_token import (
    generate_token,
    MissingSecretError,
)

logger = logging.getLogger(__name__)


class EmailSendError(Exception):
    """Raised when email sending fails."""
    pass


class UserUnsubscribedError(EmailSendError):
    """Raised when attempting to send email to unsubscribed user."""
    pass


async def check_user_email_unsubscribed(email: str) -> bool:
    """
    Check if a user is unsubscribed from emails.
    
    Args:
        email: User's email address
        
    Returns:
        bool: True if user is unsubscribed, False if subscribed or not found
    """
    try:
        result = supabase.table("users").select("email_unsubscribed").eq(
            "email", email.lower()
        ).execute()
        
        if result.data and len(result.data) > 0:
            return result.data[0].get("email_unsubscribed", False)
        return False
    except Exception as e:
        logger.error(f"Failed to check unsubscribe status for {email}: {e}")
        # Fail safe: don't send if we can't verify status
        return True


async def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    """
    Fetch user record by email.
    
    Args:
        email: User's email address
        
    Returns:
        dict: User record with user_id, email, email_unsubscribed, etc.
              Returns None if user not found
    """
    try:
        result = supabase.table("users").select(
            "user_id, email, email_unsubscribed, company_id, name"
        ).eq("email", email.lower()).execute()
        
        if result.data and len(result.data) > 0:
            return result.data[0]
        return None
    except Exception as e:
        logger.error(f"Failed to fetch user by email {email}: {e}")
        return None


async def generate_unsubscribe_url(email: str, user_id: str, frontend_url: str) -> str:
    """
    Generate a complete unsubscribe URL for inclusion in emails.
    
    Args:
        email: User's email address
        user_id: User's UUID
        frontend_url: Base frontend URL (e.g., https://app.example.com)
        
    Returns:
        str: Complete unsubscribe URL with signed token
        
    Raises:
        MissingSecretError: If UNSUBSCRIBE_SECRET is not configured
    """
    try:
        token = generate_token(email, user_id)
        return f"{frontend_url}/api/unsubscribe?token={token}"
    except MissingSecretError:
        raise


def inject_unsubscribe_link(
    html_content: str,
    unsubscribe_url: str
) -> str:
    """
    Replace placeholder unsubscribe links in HTML email with actual URL.
    
    Replaces:
        <a href="#">Unsubscribe</a>
        <a href="javascript:void(0);">Unsubscribe</a>
        <a href="">Unsubscribe</a>
    
    With:
        <a href="{unsubscribe_url}">Unsubscribe</a>
    
    Args:
        html_content: Email HTML content
        unsubscribe_url: The actual unsubscribe URL
        
    Returns:
        str: Modified HTML with working unsubscribe links
    """
    import re
    
    # Pattern to match placeholder unsubscribe links in email HTML
    # Matches: <a href="#" ...>Unsubscribe</a> and variations
    # This handles:
    #   - <a href="#">Unsubscribe</a>
    #   - <a href="#" style="...">Unsubscribe</a>
    #   - <a href="">Unsubscribe</a>
    #   - <a href="javascript:void(0);">Unsubscribe</a>
    
    # Use a more flexible pattern that captures the full tag and replaces href value
    pattern = r'<a\s+href=["\']?[^"\']*["\']?([^>]*)>([Uu]nsubscribe)</a>'
    
    modified = re.sub(
        pattern,
        f'<a href="{unsubscribe_url}"\\1>\\2</a>',
        html_content,
        flags=re.IGNORECASE | re.DOTALL
    )
    
    return modified


def inject_unsubscribe_plaintext(
    text_content: str,
    unsubscribe_url: str
) -> str:
    """
    Inject unsubscribe URL into plain text email.
    
    Adds a footer line if not already present:
        "To unsubscribe, visit: {unsubscribe_url}"
    
    Args:
        text_content: Email plain text content
        unsubscribe_url: The actual unsubscribe URL
        
    Returns:
        str: Modified text with unsubscribe information
    """
    footer = f"\n\nTo manage your email preferences, visit: {unsubscribe_url}"
    
    # Check if unsubscribe info already present
    if "unsubscribe" in text_content.lower():
        return text_content
    
    return text_content + footer


async def should_send_email(email: str, reason: str = "") -> Tuple[bool, Optional[str]]:
    """
    Determine if an email should be sent to a user.
    
    Checks:
    1. User exists
    2. User is not unsubscribed
    
    Args:
        email: User's email address
        reason: Optional reason for logging (e.g., "module_notification", "sprint_email")
        
    Returns:
        tuple: (should_send: bool, reason_if_blocked: Optional[str])
               If should_send=True, reason_if_blocked is None
               If should_send=False, reason_if_blocked explains why
    """
    try:
        user = await get_user_by_email(email)
        
        if not user:
            msg = f"User not found for email {email}"
            logger.warning(f"Skipping email send: {msg}")
            return False, msg
        
        if user.get("email_unsubscribed", False):
            msg = f"User unsubscribed: {email}"
            logger.info(f"Skipping email send: {msg} (reason: {reason})" if reason else f"Skipping email send: {msg}")
            return False, msg
        
        return True, None
        
    except Exception as e:
        msg = f"Error checking email eligibility for {email}: {e}"
        logger.error(msg)
        return False, msg


async def prepare_email_html(
    template_html: str,
    email: str,
    user_id: str,
    frontend_url: str
) -> str:
    """
    Prepare HTML email content with unsubscribe link.
    
    Args:
        template_html: Email HTML template with placeholder unsubscribe links
        email: Recipient email address
        user_id: Recipient user ID
        frontend_url: Base frontend URL
        
    Returns:
        str: Final HTML ready to send
        
    Raises:
        MissingSecretError: If token generation fails
    """
    try:
        unsubscribe_url = await generate_unsubscribe_url(email, user_id, frontend_url)
        return inject_unsubscribe_link(template_html, unsubscribe_url)
    except MissingSecretError:
        raise


async def prepare_email_text(
    template_text: str,
    email: str,
    user_id: str,
    frontend_url: str
) -> str:
    """
    Prepare plain text email content with unsubscribe information.
    
    Args:
        template_text: Email plain text template
        email: Recipient email address
        user_id: Recipient user ID
        frontend_url: Base frontend URL
        
    Returns:
        str: Final text ready to send
        
    Raises:
        MissingSecretError: If token generation fails
    """
    try:
        unsubscribe_url = await generate_unsubscribe_url(email, user_id, frontend_url)
        return inject_unsubscribe_plaintext(template_text, unsubscribe_url)
    except MissingSecretError:
        raise


async def log_email_skipped(email: str, user_id: Optional[str], reason: str) -> None:
    """
    Log when an email send is skipped due to unsubscription.
    
    Args:
        email: Recipient email
        user_id: Recipient user ID (if available)
        reason: Why email was skipped
    """
    logger.info(
        f"Email skipped: {email}",
        extra={
            "email": email,
            "user_id": user_id,
            "reason": reason,
            "timestamp": datetime.utcnow().isoformat(),
        }
    )
