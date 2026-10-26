"""
AI Asynchronous Job Manager
Provides dual-layer persistence (Redis for high-speed in-flight status + Supabase for durable history)
and hybrid real-time notification dispatch via WebSocket / Redis Pub/Sub.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from utils.auth_bridge import get_service_supabase_client
from utils.redis_client import get_cache, set_cache, redis_client
from utils.websocket_manager import manager as notification_manager

logger = logging.getLogger("lucid.ai_job_manager")

JOB_KEY_PREFIX = "ai_job:"
JOB_CACHE_TTL = 86400  # 24 hours


async def create_ai_job(
    job_type: str,
    user_id: Optional[str] = None,
    params: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Creates and initializes a new AI background job.
    Saves in-flight state to Redis with 24h TTL and persists to Supabase ai_jobs table.
    """
    job_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()

    job_data = {
        "id": job_id,
        "job_type": job_type,
        "user_id": user_id,
        "status": "pending",
        "progress": 0,
        "params": params or {},
        "result": None,
        "error": None,
        "created_at": now_iso,
        "updated_at": now_iso,
    }

    # 1. Store in Redis for sub-millisecond status polling
    try:
        set_cache(f"{JOB_KEY_PREFIX}{job_id}", job_data, ttl=JOB_CACHE_TTL)
    except Exception as e:
        logger.warning(f"[AI Job Manager] Failed to write job {job_id} to Redis: {e}")

    # 2. Persist to Supabase ai_jobs table (resilient fallback if table does not yet exist)
    try:
        db = get_service_supabase_client()
        db.table("ai_jobs").insert({
            "id": job_id,
            "job_type": job_type,
            "user_id": user_id,
            "status": "pending",
            "progress": 0,
            "params": params or {},
            "created_at": now_iso,
            "updated_at": now_iso,
        }).execute()
    except Exception as e:
        logger.warning(f"[AI Job Manager] Could not persist job {job_id} to Supabase: {e}")

    logger.info(f"[AI Job Manager] Created job {job_id} of type '{job_type}' for user {user_id}")
    return job_id


async def update_ai_job(
    job_id: str,
    status: Optional[str] = None,
    progress: Optional[int] = None,
    result: Optional[Dict[str, Any]] = None,
    error: Optional[str] = None,
    user_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Updates the status, progress, result, or error of an AI background job.
    Synchronizes Redis and Supabase, and publishes real-time WebSocket events on state change.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    existing = await get_ai_job(job_id) or {"id": job_id}

    if status is not None:
        existing["status"] = status
    if progress is not None:
        existing["progress"] = progress
    if result is not None:
        existing["result"] = result
    if error is not None:
        existing["error"] = error
    if user_id is not None:
        existing["user_id"] = user_id
    existing["updated_at"] = now_iso

    # 1. Update Redis cache
    try:
        set_cache(f"{JOB_KEY_PREFIX}{job_id}", existing, ttl=JOB_CACHE_TTL)
    except Exception as e:
        logger.warning(f"[AI Job Manager] Failed to update job {job_id} in Redis: {e}")

    # 2. Update Supabase ai_jobs table
    try:
        db = get_service_supabase_client()
        update_payload: Dict[str, Any] = {"updated_at": now_iso}
        if status is not None:
            update_payload["status"] = status
        if progress is not None:
            update_payload["progress"] = progress
        if result is not None:
            update_payload["result"] = result
        if error is not None:
            update_payload["error"] = error

        db.table("ai_jobs").update(update_payload).eq("id", job_id).execute()
    except Exception as e:
        logger.warning(f"[AI Job Manager] Could not update job {job_id} in Supabase: {e}")

    # 3. Publish real-time event via WebSocket / Redis Pub/Sub if terminal status
    resolved_user_id = existing.get("user_id")
    if resolved_user_id and status in ("completed", "failed", "processing"):
        try:
            event_payload = {
                "type": "ai_job_update",
                "job_id": job_id,
                "job_type": existing.get("job_type"),
                "status": existing.get("status"),
                "progress": existing.get("progress", 0),
                "result": existing.get("result"),
                "error": existing.get("error"),
            }
            await notification_manager.send_personal_message(resolved_user_id, event_payload)
        except Exception as ws_err:
            logger.debug(f"[AI Job Manager] WebSocket notification error for job {job_id}: {ws_err}")

    return existing


async def get_ai_job(job_id: str) -> Optional[Dict[str, Any]]:
    """
    Retrieves job data by ID. First checks Redis cache; falls back to Supabase if cache miss.
    """
    # 1. Check Redis
    try:
        cached = get_cache(f"{JOB_KEY_PREFIX}{job_id}")
        if cached and isinstance(cached, dict):
            return cached
    except Exception as e:
        logger.debug(f"[AI Job Manager] Redis lookup exception for job {job_id}: {e}")

    # 2. Fallback to Supabase
    try:
        db = get_service_supabase_client()
        resp = db.table("ai_jobs").select("*").eq("id", job_id).maybe_single().execute()
        data = getattr(resp, "data", None)
        if data:
            # Re-populate Redis
            try:
                set_cache(f"{JOB_KEY_PREFIX}{job_id}", data, ttl=JOB_CACHE_TTL)
            except Exception:
                pass
            return data
    except Exception as e:
        logger.debug(f"[AI Job Manager] Supabase lookup exception for job {job_id}: {e}")

    return None
