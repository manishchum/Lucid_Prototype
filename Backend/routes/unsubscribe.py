"""
Unsubscribe Router

Implements GDPR/CAN-SPAM compliant email unsubscribe endpoints:
- GET /api/unsubscribe?token=<TOKEN> — browser link from emails
- POST /api/unsubscribe — API endpoint with token
- POST /api/resubscribe — re-subscribe users
- POST /api/unsubscribe-manual — fallback unsubscribe without token

All endpoints update the `users` table:
- email_unsubscribed: Boolean flag (default False)
- unsubscribed_at: DateTime when user unsubscribed (nullable)
"""

import logging
import os
from datetime import datetime
from typing import Optional, Dict, Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, EmailStr

from utils.unsubscribe_token import (
    generate_token,
    verify_token,
    InvalidTokenError,
    ExpiredTokenError,
    MissingSecretError,
)
from utils.supabase_client import supabase

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/unsubscribe", tags=["unsubscribe"])


# ── Request Models ──────────────────────────────────────────────


class UnsubscribeTokenRequest(BaseModel):
    """Request body for POST /api/unsubscribe"""
    token: str


class ResubscribeRequest(BaseModel):
    """Request body for POST /api/resubscribe"""
    email: EmailStr


class UnsubscribeManualRequest(BaseModel):
    """Request body for POST /api/unsubscribe-manual"""
    email: EmailStr


# ── Helper Functions ────────────────────────────────────────────


async def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    """
    Fetch user from database by email.
    
    Args:
        email: User's email address
        
    Returns:
        dict: User record with user_id, email, company_id, etc.
              Returns None if user not found
    """
    try:
        logger.debug(f"Looking up user by email: {email}")
        
        result = supabase.table("users").select(
            "user_id, email, company_id, email_unsubscribed, unsubscribed_at"
        ).eq("email", email).execute()
        
        if result.data and len(result.data) > 0:
            user = result.data[0]
            logger.debug(f"Found user: {user.get('user_id')} with email_unsubscribed={user.get('email_unsubscribed')}")
            return user
        
        logger.warning(f"User not found for email: {email}")
        return None
    except Exception as e:
        logger.error(f"Failed to fetch user by email {email}: {e}", exc_info=True)
        return None


async def update_unsubscribe_status(
    user_id: str, 
    is_unsubscribed: bool
) -> bool:
    """
    Update user's unsubscribe status in database.
    
    Args:
        user_id: User's UUID
        is_unsubscribed: True to unsubscribe, False to resubscribe
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        update_data = {
            "email_unsubscribed": is_unsubscribed,
            "unsubscribed_at": datetime.utcnow().isoformat() if is_unsubscribed else None,
        }
        
        logger.debug(f"Updating user {user_id}: {update_data}")
        
        result = supabase.table("users").update(update_data).eq(
            "user_id", user_id
        ).execute()
        
        # Check if the update affected any rows
        if result.data and len(result.data) > 0:
            logger.info(f"Successfully updated unsubscribe status for user {user_id}: {update_data}")
            return True
        else:
            logger.warning(f"Update returned no rows for user {user_id}. Result: {result}")
            return False
            
    except Exception as e:
        logger.error(f"Failed to update unsubscribe status for user {user_id}: {e}", exc_info=True)
        return False


async def check_if_already_unsubscribed(user_id: str) -> bool:
    """Check if user is already unsubscribed."""
    try:
        result = supabase.table("users").select("email_unsubscribed").eq(
            "user_id", user_id
        ).execute()
        
        if result.data and len(result.data) > 0:
            return result.data[0].get("email_unsubscribed", False)
        return False
    except Exception as e:
        logger.error(f"Failed to check unsubscribe status for user {user_id}: {e}")
        return False


# ── GET /api/unsubscribe?token=<TOKEN> ──────────────────────────
# Used when users click the unsubscribe link directly in email


@router.get("")
async def unsubscribe_get(token: str = Query(..., description="Unsubscribe token from email link")):
    """
    Handle unsubscribe requests from email links (browser-based).
    
    Verifies the token, looks up the user, marks as unsubscribed, 
    and redirects to a success/error page.
    
    Query Parameters:
        token: The signed unsubscribe token generated when sending the email
        
    Returns:
        Redirect to frontend: /unsubscribe-success?email=<email>
        or /unsubscribe-error?reason=<reason>
    """
    if not token:
        logger.warning("Unsubscribe GET request missing token")
        error_url = f"{os.getenv('FRONTEND_URL', 'http://localhost:3000')}/unsubscribe-error?reason=missing_token"
        raise HTTPException(status_code=302, detail=error_url, headers={"Location": error_url})
    
    try:
        # Verify and decode token
        payload = verify_token(token)
        
        if not payload:
            logger.warning("Unsubscribe GET request failed token verification")
            error_url = f"{os.getenv('FRONTEND_URL', 'http://localhost:3000')}/unsubscribe-error?reason=invalid_token"
            raise HTTPException(status_code=302, detail=error_url, headers={"Location": error_url})
        
        email = payload.get("email")
        user_id = payload.get("user_id")
        
        # Look up user in database
        user = await get_user_by_email(email)
        
        if not user:
            logger.warning(f"Unsubscribe GET: User not found for email {email}")
            error_url = f"{os.getenv('FRONTEND_URL', 'http://localhost:3000')}/unsubscribe-error?reason=user_not_found"
            raise HTTPException(status_code=302, detail=error_url, headers={"Location": error_url})
        
        # Check if already unsubscribed
        already_unsubscribed = user.get("email_unsubscribed", False)
        
        # Update unsubscribe status
        success = await update_unsubscribe_status(user["user_id"], True)
        
        if not success:
            logger.error(f"Failed to update unsubscribe status for user {user['user_id']}")
            error_url = f"{os.getenv('FRONTEND_URL', 'http://localhost:3000')}/unsubscribe-error?reason=update_failed"
            raise HTTPException(status_code=302, detail=error_url, headers={"Location": error_url})
        
        # Log the unsubscribe action
        logger.info(
            f"User unsubscribed via email link",
            extra={
                "user_id": user["user_id"],
                "email": email,
                "was_already_unsubscribed": already_unsubscribed,
            }
        )
        
        # Redirect to success page
        success_url = f"{os.getenv('FRONTEND_URL', 'http://localhost:3000')}/unsubscribe-success?email={email}"
        raise HTTPException(status_code=302, detail=success_url, headers={"Location": success_url})
        
    except (InvalidTokenError, ExpiredTokenError) as e:
        logger.warning(f"Token verification failed: {e}")
        error_url = f"{os.getenv('FRONTEND_URL', 'http://localhost:3000')}/unsubscribe-error?reason=invalid_token"
        raise HTTPException(status_code=302, detail=error_url, headers={"Location": error_url})
    except Exception as e:
        logger.error(f"Unsubscribe GET error: {e}")
        error_url = f"{os.getenv('FRONTEND_URL', 'http://localhost:3000')}/unsubscribe-error?reason=server_error"
        raise HTTPException(status_code=302, detail=error_url, headers={"Location": error_url})


# ── POST /api/unsubscribe ────────────────────────────────────────
# Used for API integrations, mobile apps, etc.


@router.post("")
async def unsubscribe_post(request: UnsubscribeTokenRequest):
    """
    Handle programmatic unsubscribe requests with JSON body.
    
    Request Body:
        {
            "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
        }
        
    Returns:
        {
            "success": true,
            "message": "You have been unsubscribed from email notifications",
            "email": "user@example.com"
        }
    """
    if not request.token:
        logger.warning("Unsubscribe POST request missing token")
        raise HTTPException(
            status_code=400,
            detail="Token is required"
        )
    
    try:
        # Verify and decode token
        payload = verify_token(request.token)
        
        if not payload:
            logger.warning("Unsubscribe POST request failed token verification")
            raise HTTPException(
                status_code=400,
                detail="Invalid or expired unsubscribe token"
            )
        
        email = payload.get("email")
        user_id = payload.get("user_id")
        
        # Look up user in database
        user = await get_user_by_email(email)
        
        if not user:
            logger.warning(f"Unsubscribe POST: User not found for email {email}")
            raise HTTPException(
                status_code=404,
                detail="User not found"
            )
        
        # Update unsubscribe status
        success = await update_unsubscribe_status(user["user_id"], True)
        
        if not success:
            logger.error(f"Failed to update unsubscribe status for user {user['user_id']}")
            raise HTTPException(
                status_code=500,
                detail="Failed to process unsubscribe"
            )
        
        # Log the unsubscribe action
        logger.info(
            f"User unsubscribed via API",
            extra={
                "user_id": user["user_id"],
                "email": email,
            }
        )
        
        return {
            "success": True,
            "message": "You have been unsubscribed from email notifications",
            "email": email,
        }
        
    except (InvalidTokenError, ExpiredTokenError) as e:
        logger.warning(f"Token verification failed: {e}")
        raise HTTPException(
            status_code=400,
            detail="Invalid or expired unsubscribe token"
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unsubscribe POST error: {e}")
        raise HTTPException(
            status_code=500,
            detail="Internal server error"
        )


# ── POST /api/resubscribe ────────────────────────────────────────


@router.post("/resubscribe")
async def resubscribe(request: ResubscribeRequest):
    """
    Re-subscribe a user to email notifications.
    
    Used when user clicks "Re-subscribe" on the unsubscribe-success page.
    Accepts email directly (no token required for resubscription).
    
    Request Body:
        {
            "email": "user@example.com"
        }
        
    Returns:
        {
            "success": true,
            "message": "You have been re-subscribed to email notifications",
            "email": "user@example.com"
        }
    """
    email = request.email.lower().strip()
    
    try:
        # Look up user by email
        user = await get_user_by_email(email)
        
        if not user:
            logger.warning(f"Resubscribe: User not found for email {email}")
            raise HTTPException(
                status_code=404,
                detail="User not found"
            )
        
        # Check if already subscribed
        if not user.get("email_unsubscribed", False):
            # Already subscribed, just return success
            return {
                "success": True,
                "message": "You are already subscribed to email notifications",
                "email": email,
            }
        
        # Update subscription status
        success = await update_unsubscribe_status(user["user_id"], False)
        
        if not success:
            logger.error(f"Failed to update resubscribe status for user {user['user_id']}")
            raise HTTPException(
                status_code=500,
                detail="Failed to process resubscribe"
            )
        
        # Log the resubscribe action
        logger.info(
            f"User re-subscribed",
            extra={
                "user_id": user["user_id"],
                "email": email,
            }
        )
        
        return {
            "success": True,
            "message": "You have been re-subscribed to email notifications",
            "email": email,
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Resubscribe error: {e}")
        raise HTTPException(
            status_code=500,
            detail="Internal server error"
        )


# ── POST /api/unsubscribe-manual ─────────────────────────────────
# Fallback for when token is invalid/expired


@router.post("/unsubscribe-manual")
async def unsubscribe_manual(request: UnsubscribeManualRequest):
    """
    Unsubscribe a user without requiring a valid token.
    
    Used as fallback on /unsubscribe-error page when:
    - Token is invalid
    - Token is expired
    - User lost/didn't receive the token
    
    Request Body:
        {
            "email": "user@example.com"
        }
        
    Returns:
        {
            "success": true,
            "message": "You have been unsubscribed from email notifications",
            "email": "user@example.com"
        }
        
    Security: Returns success even if user not found (prevents email enumeration).
    """
    email = request.email.lower().strip()
    
    try:
        # Look up user by email
        user = await get_user_by_email(email)
        
        if not user:
            # Return success anyway to prevent email enumeration attacks
            logger.warning(f"Unsubscribe-manual: User not found for email {email}")
            return {
                "success": True,
                "message": "If this email exists in our system, you have been unsubscribed",
                "email": email,
            }
        
        # Check if already unsubscribed
        if user.get("email_unsubscribed", False):
            # Already unsubscribed, just return success
            return {
                "success": True,
                "message": "You are already unsubscribed from email notifications",
                "email": email,
            }
        
        # Update unsubscribe status
        success = await update_unsubscribe_status(user["user_id"], True)
        
        if not success:
            logger.error(f"Failed to update unsubscribe status for user {user['user_id']}")
            # Still return success to prevent information leakage
            return {
                "success": True,
                "message": "If this email exists in our system, you have been unsubscribed",
                "email": email,
            }
        
        # Log the unsubscribe action
        logger.info(
            f"User unsubscribed manually (fallback)",
            extra={
                "user_id": user["user_id"],
                "email": email,
            }
        )
        
        return {
            "success": True,
            "message": "You have been unsubscribed from email notifications",
            "email": email,
        }
        
    except Exception as e:
        logger.error(f"Unsubscribe-manual error: {e}")
        # Return success anyway to prevent information leakage
        return {
            "success": True,
            "message": "If this email exists in our system, you have been unsubscribed",
            "email": email,
        }


# ── Utility endpoint: Generate unsubscribe token ──────────────────
# Used internally by email sending functions


@router.post("/generate-token")
async def generate_unsubscribe_token(request: Dict[str, str]):
    """
    Internal endpoint to generate an unsubscribe token.
    
    Called by email sending functions (dispatch, notifications, etc.)
    to generate tokens that will be embedded in unsubscribe links.
    
    Request Body:
        {
            "email": "user@example.com",
            "user_id": "550e8400-e29b-41d4-a716-446655440000"
        }
        
    Returns:
        {
            "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
            "unsubscribe_url": "https://example.com/api/unsubscribe?token=..."
        }
    """
    email = request.get("email", "").lower().strip()
    user_id = request.get("user_id", "").strip()
    
    if not email or not user_id:
        raise HTTPException(
            status_code=400,
            detail="Both 'email' and 'user_id' are required"
        )
    
    try:
        token = generate_token(email, user_id)
        
        frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
        unsubscribe_url = f"{frontend_url}/api/unsubscribe?token={token}"
        
        return {
            "token": token,
            "unsubscribe_url": unsubscribe_url,
        }
        
    except MissingSecretError as e:
        logger.error(f"Token generation failed: {e}")
        raise HTTPException(
            status_code=500,
            detail="Unsubscribe token generation is not configured"
        )
    except Exception as e:
        logger.error(f"Token generation error: {e}")
        raise HTTPException(
            status_code=500,
            detail="Failed to generate unsubscribe token"
        )
