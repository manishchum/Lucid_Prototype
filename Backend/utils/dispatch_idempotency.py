import json
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any, Tuple
from fastapi import HTTPException
from utils.redis_client import redis_client
from utils.supabase_client import supabase_admin

logger = logging.getLogger(__name__)

# Default deduplication TTL:
# - Immediate send deduplication window: 300 seconds (5 minutes)
# - Scheduled dispatch deduplication window: 86400 seconds (24 hours)
IMMEDIATE_DEDUPLICATION_TTL = 300
SCHEDULED_DEDUPLICATION_TTL = 86400


class DispatchIdempotency:
    """
    Enterprise-grade distributed idempotency control for Email and WhatsApp dispatches.
    Uses Redis atomic SET NX EX for in-flight locking and completed result caching,
    paired with database verification against duplicate scheduled records.
    """

    @staticmethod
    def build_key(
        channel: str,
        module_id: Optional[str],
        company_id: Optional[str],
        scheduled_date: Optional[str] = None,
        custom_key: Optional[str] = None,
    ) -> Tuple[str, int]:
        """
        Builds a deterministic idempotency key.
        If custom_key is provided (via header or request body), use that.
        Otherwise, default to {module_id}:{company_id}:{scheduled_date or 'immediate'}.
        Returns (idempotency_key, ttl_seconds).
        """
        if custom_key and custom_key.strip():
            clean_key = custom_key.strip()
            return f"dispatch:idempotency:{clean_key}", SCHEDULED_DEDUPLICATION_TTL

        mod_part = (module_id or "unknown").strip()
        comp_part = (company_id or "unknown").strip()

        if scheduled_date and scheduled_date.strip():
            date_part = scheduled_date.strip()
            ttl = SCHEDULED_DEDUPLICATION_TTL
        else:
            date_part = "immediate"
            ttl = IMMEDIATE_DEDUPLICATION_TTL

        key = f"dispatch:idempotency:{channel}:{mod_part}:{comp_part}:{date_part}"
        return key, ttl

    @staticmethod
    def acquire(redis_key: str, ttl: int, metadata: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        """
        Attempts to acquire the idempotency lock in Redis atomically using SET NX EX.
        - If acquired: returns None (caller proceeds with execution).
        - If key exists and status is 'processing': raises HTTPException 409 Conflict.
        - If key exists and status is 'completed': returns the cached result dict (for idempotent replay).
        """
        try:
            payload = {
                "status": "processing",
                "started_at": datetime.now(timezone.utc).isoformat(),
                "metadata": metadata or {},
            }
            # Atomic set with NX (only if not exists) and EX (expiry)
            acquired = redis_client.set(
                redis_key,
                json.dumps(payload),
                nx=True,
                ex=ttl,
            )
            if acquired:
                return None  # Successfully acquired! Proceed.

            # Key already exists, inspect status
            cached_data = redis_client.get(redis_key)
            if cached_data:
                try:
                    record = json.loads(cached_data)
                    status = record.get("status")
                    if status == "processing":
                        raise HTTPException(
                            status_code=409,
                            detail="A dispatch is currently being processed for this request. Please do not submit duplicate requests.",
                        )
                    if status == "completed":
                        result = record.get("result", {})
                        if isinstance(result, dict):
                            return {
                                **result,
                                "idempotent_replay": True,
                                "idempotency_key": redis_key,
                            }
                        return result
                except json.JSONDecodeError:
                    pass

            raise HTTPException(
                status_code=409,
                detail="A dispatch with this idempotency key is already in progress or completed.",
            )
        except HTTPException:
            raise
        except Exception as e:
            # Fallback if Redis is momentarily unavailable to avoid blocking legitimate operations
            logger.warning(f"[DispatchIdempotency.acquire] Redis check warning (proceeding): {e}")
            return None

    @staticmethod
    def complete(redis_key: str, ttl: int, result: Any) -> None:
        """Marks the idempotency key as completed with the response result in Redis."""
        try:
            payload = {
                "status": "completed",
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "result": result,
            }
            redis_client.setex(redis_key, ttl, json.dumps(payload))
        except Exception as e:
            logger.warning(f"[DispatchIdempotency.complete] Redis setex error: {e}")

    @staticmethod
    def release_on_failure(redis_key: str) -> None:
        """Releases the lock if an unhandled error occurred so retries can proceed."""
        try:
            cached = redis_client.get(redis_key)
            if cached:
                record = json.loads(cached)
                if record.get("status") == "processing":
                    redis_client.delete(redis_key)
        except Exception as e:
            logger.warning(f"[DispatchIdempotency.release_on_failure] Redis delete error: {e}")

    @staticmethod
    def check_db_scheduled_email(
        company_id: str,
        module_id: str,
        scheduled_date: str,
    ) -> Optional[Dict[str, Any]]:
        """
        Checks DB if a scheduled email already exists for this (company_id, module_id, scheduled_date).
        """
        try:
            resp = (
                supabase_admin.table("scheduled_emails")
                .select("scheduled_email_id, status, scheduled_date, scheduled_time")
                .eq("company_id", company_id)
                .eq("processed_module_id", module_id)
                .eq("scheduled_date", scheduled_date)
                .eq("is_active", True)
                .execute()
            )
            if resp.data and len(resp.data) > 0:
                return resp.data[0]
        except Exception as e:
            logger.warning(f"[check_db_scheduled_email] DB check warning: {e}")
        return None

    @staticmethod
    def check_db_scheduled_whatsapp(
        company_id: str,
        module_id: str,
        scheduled_date: str,
    ) -> Optional[Dict[str, Any]]:
        """
        Checks DB if a scheduled WhatsApp message already exists for this (company_id, module_id, scheduled_date).
        """
        try:
            resp = (
                supabase_admin.table("scheduled_whatsapp")
                .select("scheduled_whatsapp_id, scheduled_date, scheduled_time")
                .eq("company_id", company_id)
                .eq("processed_module_id", module_id)
                .eq("scheduled_date", scheduled_date)
                .eq("is_active", True)
                .execute()
            )
            if resp.data and len(resp.data) > 0:
                return resp.data[0]
        except Exception as e:
            logger.warning(f"[check_db_scheduled_whatsapp] DB check warning: {e}")
        return None
