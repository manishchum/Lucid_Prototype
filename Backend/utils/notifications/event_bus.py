import uuid
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
from utils.auth_bridge import get_service_supabase_client
from utils.redis_client import redis_client
from utils.notifications.contract_validator import EventContractValidator, normalize_payload_keys

logger = logging.getLogger("lucid.event_bus")


from utils.notifications.registry_contracts import get_system_event_preset


def get_cached_event_preset(event_key: str) -> Optional[Dict[str, Any]]:
    """Fetches event preset from the standardized system contract registry."""
    return get_system_event_preset(event_key)


def get_cached_disabled_event_keys() -> List[str]:
    """Fetches disabled event keys set by developer role."""
    cache_key = "settings:disabled_events"
    try:
        import json
        cached = redis_client.get(cache_key)
        if cached:
            return json.loads(cached)
    except Exception:
        pass

    try:
        _db = get_service_supabase_client()
        res = (
            _db.table("global_notification_settings")
            .select("disabled_event_keys")
            .eq("id", "global_default")
            .maybe_single()
            .execute()
        )
        data = getattr(res, "data", None) or {}
        disabled = data.get("disabled_event_keys", []) or []
        try:
            import json
            redis_client.setex(cache_key, 60, json.dumps(disabled))
        except Exception:
            pass
        return disabled
    except Exception as e:
        logger.warning(f"Failed to fetch disabled event keys: {e}")
        return []


async def publish_event(
    event_key: str,
    recipient_user_id: str,
    payload: Dict[str, Any],
    correlation_id: Optional[str] = None,
    scheduled_at: Optional[Any] = None,
    entity_id: Optional[str] = None,
    bypass_throttle: bool = False,
) -> Dict[str, Any]:
    """
    Universal Event Ingestion Gateway.
    Strict 8-Stage Execution Pipeline:
    1. Global Governance Check (Matrix Kill-Switch & Cooldown)
    2. Strict Schema Validation (Contract Pre-Render)
    3. Variable Resolution & Fallback Application
    4. Deterministic Idempotency & Queueing
    """
    correlation_id = correlation_id or f"evt_{uuid.uuid4().hex[:12]}"
    db = get_service_supabase_client()

    # Stage 1: Global Governance & Kill-switch Check
    disabled_keys = get_cached_disabled_event_keys()
    if event_key in disabled_keys:
        logger.info(f"[{correlation_id}] Event '{event_key}' is disabled globally by Developer. Dropping.")
        return {
            "success": False,
            "status": "SUPPRESSED_BY_GLOBAL_POLICY",
            "correlation_id": correlation_id,
        }

    preset = get_cached_event_preset(event_key)
    if preset and preset.get("is_enabled") is False:
        logger.info(f"[{correlation_id}] Event preset '{event_key}' is paused. Dropping.")
        return {
            "success": False,
            "status": "SUPPRESSED_BY_EVENT_PAUSE",
            "correlation_id": correlation_id,
        }

    # Throttle / Cooldown Window Check
    throttle_window = (preset or {}).get("throttle_window_seconds", 0)
    if throttle_window > 0 and not bypass_throttle:
        throttle_key = f"throttle:{recipient_user_id}:{event_key}"
        try:
            if redis_client.exists(throttle_key):
                logger.info(f"[{correlation_id}] Event '{event_key}' throttled for user {recipient_user_id}.")
                return {
                    "success": False,
                    "status": "THROTTLED",
                    "correlation_id": correlation_id,
                }
            redis_client.setex(throttle_key, throttle_window, "1")
        except Exception as th_err:
            logger.warning(f"Redis throttle check error: {th_err}")

    # Stage 1b: Strict Tenant Boundary & Company Entitlement Hard Gate
    from utils.notifications.policy_evaluator import NotificationPolicyEvaluator

    event_company = payload.get("company_id")
    tenant_ok, tenant_reason, user_row = NotificationPolicyEvaluator.evaluate_tenant_isolation(
        event_company_id=event_company,
        recipient_user_id=recipient_user_id,
        manager_id=payload.get("manager_id"),
    )
    if not tenant_ok:
        logger.warning(f"[{correlation_id}] Event '{event_key}' tenant boundary violation: {tenant_reason}")
        NotificationPolicyEvaluator.record_policy_audit(
            correlation_id=correlation_id,
            notification_type=event_key,
            recipient_user_id=recipient_user_id,
            company_id=event_company,
            status="REJECTED" if "LEAKAGE" in tenant_reason else "SUPPRESSED",
            suppression_reason=tenant_reason,
            details=payload,
        )
        return {
            "success": False,
            "status": tenant_reason,
            "error_code": tenant_reason,
            "correlation_id": correlation_id,
        }

    recipient_company_id = user_row.get("company_id")

    # Hard Gate: Company Feature Entitlement via companies.subscription_addons
    entitled, req_addon, ent_reason = NotificationPolicyEvaluator.evaluate_company_entitlement(
        company_id=recipient_company_id,
        trigger_or_event=event_key,
        category=payload.get("category"),
    )
    if not entitled:
        logger.info(
            f"[{correlation_id}] Event '{event_key}' suppressed for company {recipient_company_id}: "
            f"{ent_reason} (Requires add-on: {req_addon})"
        )
        NotificationPolicyEvaluator.record_policy_audit(
            correlation_id=correlation_id,
            notification_type=event_key,
            recipient_user_id=recipient_user_id,
            company_id=recipient_company_id,
            status="SUPPRESSED",
            suppression_reason=ent_reason,
            details={"required_addon": req_addon, "event_key": event_key},
        )
        return {
            "success": False,
            "status": ent_reason,
            "error_code": ent_reason,
            "required_addon": req_addon,
            "correlation_id": correlation_id,
        }

    # Stage 2: Variable Resolution, Recipient Context & Fallback Application
    schema = (preset or {}).get("parameter_schema") or {}
    enriched_payload = EventContractValidator.apply_fallbacks(payload, schema)

    # Populate recipient profile details from verified user_row
    full_name = user_row.get("name") or ""
    first_name = (full_name.split()[0] if full_name else "there")
    if "subscriber.first_name" not in enriched_payload or not enriched_payload["subscriber.first_name"]:
        enriched_payload["subscriber.first_name"] = first_name
        enriched_payload["first_name"] = first_name
    if "subscriber.full_name" not in enriched_payload:
        enriched_payload["subscriber.full_name"] = full_name
        enriched_payload["full_name"] = full_name
    if "subscriber.email" not in enriched_payload:
        enriched_payload["subscriber.email"] = user_row.get("email") or ""
        enriched_payload["email"] = user_row.get("email") or ""
    enriched_payload["company_id"] = recipient_company_id

    # Stage 3: Strict Contract Validation
    is_valid, validation_errors, failure_cat = EventContractValidator.validate_payload(
        event_key=event_key,
        payload=enriched_payload,
        schema=schema,
    )

    if not is_valid:
        # Route directly to Dead-Letter Queue / Audit (Permanent failure - No retries)
        logger.error(
            f"[{correlation_id}] Contract validation violation for '{event_key}': {validation_errors}"
        )
        try:
            db.table("notification_dispatch_audit").insert({
                "correlation_id": correlation_id,
                "notification_type": event_key,
                "channel": (preset or {}).get("default_channels", ["ALL"])[0] if (preset and preset.get("default_channels")) else "ALL",
                "recipient_user_id": recipient_user_id,
                "status": "FAILED_VALIDATION",
                "validation_errors": validation_errors,
                "failure_reason": f"Contract Schema Violation: {'; '.join(validation_errors[:3])}",
                "resolved_variables": {k: str(v) for k, v in enriched_payload.items() if not any(s in k.lower() for s in ["token", "password", "secret"])},
                "is_test": False,
            }).execute()
        except Exception as audit_err:
            logger.warning(f"Failed to write audit record: {audit_err}")

        return {
            "success": False,
            "status": "REJECTED_SCHEMA_VIOLATION",
            "error_code": "SCHEMA_VALIDATION_FAILED",
            "errors": validation_errors,
            "correlation_id": correlation_id,
        }

    # Stage 4: Deterministic Idempotency & Queueing
    eid = (
        entity_id
        or payload.get("task_id")
        or payload.get("sprint_id")
        or payload.get("scenario_id")
        or payload.get("module_id")
        or str(int(datetime.now().timestamp()))
    )
    schema_ver = (preset or {}).get("schema_version", 1)
    idempotency_key = f"{recipient_user_id}:{event_key}:{eid}:v{schema_ver}"

    if isinstance(scheduled_at, datetime):
        scheduled_iso = scheduled_at.isoformat()
    elif scheduled_at is None:
        scheduled_iso = datetime.now(timezone.utc).isoformat()
    else:
        scheduled_iso = str(scheduled_at)

    try:
        # Check existing job for idempotency
        existing = db.table("notification_jobs").select("id,status").eq("idempotency_key", idempotency_key).maybe_single().execute()
        existing_job = getattr(existing, "data", None)
        if existing_job:
            if existing_job.get("status") in ["SENT", "FAILED", "CANCELLED"]:
                # Evict old finished job so user re-attempts succeed
                db.table("notification_jobs").delete().eq("id", existing_job["id"]).execute()
            else:
                logger.info(f"[{correlation_id}] Duplicate job suppressed by idempotency_key {idempotency_key}")
                return {
                    "success": True,
                    "status": "ALREADY_QUEUED",
                    "idempotency_key": idempotency_key,
                    "correlation_id": correlation_id,
                }

        rpc_res = db.rpc("schedule_notification_job_rpc", {
            "p_user_id": recipient_user_id,
            "p_notification_type": event_key,
            "p_metadata": enriched_payload,
            "p_scheduled_at": scheduled_iso,
        }).execute()

        logger.info(f"[{correlation_id}] Event '{event_key}' enqueued successfully for {recipient_user_id}")
        return {
            "success": True,
            "status": "QUEUED",
            "correlation_id": correlation_id,
            "idempotency_key": idempotency_key,
        }
    except Exception as q_err:
        logger.error(f"[{correlation_id}] Failed to enqueue notification job: {q_err}")
        return {
            "success": False,
            "status": "QUEUE_ERROR",
            "error": str(q_err),
            "correlation_id": correlation_id,
        }


async def publish_bulk_events(
    event_key: str,
    recipient_user_ids: List[str],
    payload: Dict[str, Any],
    scheduled_at: Optional[Any] = None,
) -> Dict[str, Any]:
    """Bulk publisher for batch assignments and broadcast events."""
    if not recipient_user_ids:
        return {"queued_count": 0, "failed_count": 0}

    results = []
    queued_count = 0
    failed_count = 0

    for uid in recipient_user_ids:
        res = await publish_event(
            event_key=event_key,
            recipient_user_id=uid,
            payload=payload,
            scheduled_at=scheduled_at,
        )
        if res.get("success"):
            queued_count += 1
        else:
            failed_count += 1
        results.append(res)

    return {
        "queued_count": queued_count,
        "failed_count": failed_count,
        "results": results,
    }
