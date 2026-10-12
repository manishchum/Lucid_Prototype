import asyncio
from datetime import datetime
import hashlib
import json
import traceback
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, Header, HTTPException, Response

from task_manager.route import get_tasks_for_user
from utils.auth import RequestAuth, get_effective_company_id, get_request_auth_required
from utils.auth_bridge import get_service_supabase_client
from utils.db.leaderboard_db import get_user_rank
from utils.db.permissions import check_user_permission
from utils.redis_client import get_cache, set_cache

router = APIRouter(prefix="/api/employee", tags=["employee-dashboard"])

TASK_ADDON_ALIASES = frozenset({"tasks", "task_manager", "task-manager", "task_management"})
COMPANY_STATIC_TTL = 3600  # 1 hour
USER_COMPANY_TTL = 3600    # 1 hour
DASHBOARD_CACHE_TTL = 300  # 5 minutes
DASHBOARD_L1_TTL = 30.0    # 30 seconds local in-memory L1 cache

_DASHBOARD_L1_CACHE: Dict[str, Tuple[float, Any]] = {}
_IN_FLIGHT_DASHBOARDS: Dict[str, asyncio.Future] = {}
_IN_FLIGHT_LOCK = asyncio.Lock()



# ==============================================================================
# Helper Functions: Business Logic & Data Transformation
# ==============================================================================

def invalidate_dashboard_l1_cache(user_id: Optional[str]) -> None:
    """
    Safely invalidates the thread-safe L1 in-memory dashboard cache for a user.
    """
    if not user_id:
        return
    cache_key = f"dashboard_summary:{user_id}"
    _DASHBOARD_L1_CACHE.pop(cache_key, None)


def has_tasks_addon(addons: Any) -> bool:
    """
    Safely checks if tasks/task management addon is enabled for a company.
    Supports JSON strings, lists, tuples, or sets.
    """
    if not addons:
        return False
    if isinstance(addons, str):
        try:
            addons = json.loads(addons)
        except Exception:
            addons = [addons]
    if not isinstance(addons, (list, tuple, set)):
        return False
    return any(str(addon).strip().lower() in TASK_ADDON_ALIASES for addon in addons)


def format_user_rank(rank_res: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Extracts and normalizes leaderboard rank details with safe fallbacks.
    Guarantees no KeyError or crash even if leaderboard service fails.
    """
    rank_info = (
        rank_res.get("data")
        if (isinstance(rank_res, dict) and not rank_res.get("error"))
        else None
    )
    return {
        "rank": rank_info.get("rank", 1) if rank_info else 1,
        "top_percentile": rank_info.get("percentile", 10) if rank_info else 10,
        "modules_completed": rank_info.get("modules_completed", 0) if rank_info else 0,
        "total_score": rank_info.get("total_points", 0) if rank_info else 0,
    }


def embed_processed_module_ids(
    plans: List[Dict[str, Any]],
    all_processed_modules: List[Dict[str, Any]],
    modules: List[Dict[str, Any]],
) -> None:
    """
    Pre-resolves and embeds processed_module_ids directly into learning plan objects
    in-memory. Preserves existing assigned processed_module_ids from learning_plan
    if present, while cleanly resolving missing module IDs.
    """
    company_module_ids = {
        str(m.get("module_id"))
        for m in modules
        if isinstance(m, dict) and m.get("module_id")
    }

    # Group processed modules by original_module_id
    pm_by_original: Dict[str, List[Dict[str, Any]]] = {}
    for pm in all_processed_modules:
        if not isinstance(pm, dict):
            continue
        orig_id = str(pm.get("original_module_id") or "")
        if orig_id and (not company_module_ids or orig_id in company_module_ids):
            pm_by_original.setdefault(orig_id, []).append(pm)

    for plan in plans:
        if not isinstance(plan, dict):
            continue

        # If learning_plan already has populated processed_module_ids assigned to user, preserve them
        existing_assigned_ids = plan.get("processed_module_ids")
        if isinstance(existing_assigned_ids, list) and len(existing_assigned_ids) > 0:
            clean_existing = [str(pid) for pid in existing_assigned_ids if pid]
            if clean_existing:
                plan["processed_module_ids"] = clean_existing
                continue

        orig_id = str(plan.get("module_id") or "")
        matching_pms = pm_by_original.get(orig_id, [])
        matching_pms.sort(key=lambda x: x.get("order") or x.get("order_index") or 0)

        title_to_pm_id = {
            (pm.get("title") or "").strip().lower(): str(pm.get("processed_module_id"))
            for pm in matching_pms
            if pm.get("processed_module_id")
        }

        plan_json = plan.get("plan_json") or {}
        plan_modules = plan_json.get("modules") if isinstance(plan_json, dict) else []

        if isinstance(plan_modules, list):
            for idx, m in enumerate(plan_modules):
                if isinstance(m, dict) and not m.get("processed_module_id"):
                    m_title = (m.get("title") or "").strip().lower()
                    if m_title in title_to_pm_id:
                        m["processed_module_id"] = title_to_pm_id[m_title]
                    elif idx < len(matching_pms) and matching_pms[idx].get("processed_module_id"):
                        m["processed_module_id"] = str(matching_pms[idx]["processed_module_id"])

        embedded_ids = [
            str(m.get("processed_module_id"))
            for m in (plan_modules if isinstance(plan_modules, list) else [])
            if isinstance(m, dict) and m.get("processed_module_id")
        ]
        if not embedded_ids and matching_pms:
            embedded_ids = [str(pm.get("processed_module_id")) for pm in matching_pms if pm.get("processed_module_id")]

        plan["processed_module_ids"] = embedded_ids


def build_assessment_evidence(
    employee_assessments: List[Dict[str, Any]],
    assessment_details: List[Dict[str, Any]],
    processed_modules: List[Dict[str, Any]],
) -> Tuple[Dict[str, List[Dict[str, Any]]], Dict[str, List[Dict[str, Any]]]]:
    """Builds lookup tables for module assessment and baseline evidence scores."""
    assessment_evidence: Dict[str, List[Dict[str, Any]]] = {}
    baseline_evidence: Dict[str, List[Dict[str, Any]]] = {}

    assessment_detail_by_id = {
        str(d.get("assessment_id")): d for d in assessment_details if isinstance(d, dict)
    }
    processed_module_by_id = {
        str(pm.get("processed_module_id")): pm for pm in processed_modules if isinstance(pm, dict)
    }

    for ea in employee_assessments:
        if not isinstance(ea, dict):
            continue
        detail = assessment_detail_by_id.get(str(ea.get("assessment_id")))
        if not detail:
            continue

        processed_module = processed_module_by_id.get(
            str(detail.get("processed_module_id"))
            )
        original_module_id = str(
            detail.get("original_module_id")
            or (
                processed_module.get("original_module_id")
                if processed_module
                else ""
                )
        )
        if not original_module_id:
            continue

        score = ea.get("score")
        max_score = ea.get("max_score")
        score_percent = None

        if score is not None:
            if max_score and max_score > 0:
                score_percent = round((score / max_score) * 100, 2)
            else:
                score_percent = score

        entry = {
            "scorePercent": score_percent,
            "completedAt": ea.get("completed_at"),
        }
        assessment_evidence.setdefault(original_module_id, []).append(entry)

        if detail.get("type") == "baseline":
            baseline_evidence.setdefault(original_module_id, []).append(entry)

    return assessment_evidence, baseline_evidence


async def resolve_user_company_id(
    service_supabase,
    auth_ctx: RequestAuth,
    user_id: str,
) -> str:
    """
    Resolves the company ID for a given user using fast memory context or Redis cache,
    falling back to database lookup only when cache misses.
    """
    if auth_ctx.user_id == user_id and auth_ctx.company_id:
        return str(auth_ctx.company_id)

    cache_key = f"user_company:{user_id}"
    cached_company_id = get_cache(cache_key)
    if cached_company_id:
        return str(cached_company_id)

    user_company_res = (
        service_supabase
        .table("users")
        .select("company_id")
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    user_company_data = getattr(user_company_res, "data", None)
    if not isinstance(user_company_data, dict) or not user_company_data.get("company_id"):
        raise HTTPException(status_code=404, detail="User not found")

    user_company_id = str(user_company_data["company_id"])
    set_cache(cache_key, user_company_id, ttl=USER_COMPANY_TTL)
    return user_company_id


# ==============================================================================
# Endpoint: Employee Dashboard Summary
# ==============================================================================

@router.get("/dashboard_summary/{user_id}")
async def get_dashboard_summary(
    user_id: str,
    response: Response,
    x_company_id: Optional[str] = Header(None, alias="X-Company-ID"),
    cache_control: Optional[str] = Header(None, alias="Cache-Control"),
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    effective_company_id: str = Depends(get_effective_company_id),
):
    """
    High-performance employee dashboard summary endpoint.
    Aggregates learning plans, modules, progress, user rank, and assigned tasks
    with multi-tier caching (Redis + HTTP ETag) and concurrent batch fetching.
    """
    t_entry = datetime.now()
    bypass_cache = bool(cache_control and "no-cache" in cache_control.lower())
    try:
        service_supabase = get_service_supabase_client()

        # 1. Authorization & Tenant Security Checks
        if auth_ctx.user_id != user_id:
            is_manager = await check_user_permission(auth_ctx.user_id, "manager")
            if not is_manager:
                raise HTTPException(status_code=403, detail="Permission denied")

        user_company_id = await resolve_user_company_id(service_supabase, auth_ctx, user_id)
        if str(effective_company_id) != user_company_id:
            raise HTTPException(status_code=403, detail="User does not belong to this company")

        x_company_id = str(effective_company_id)

        # 2. Tier 0 Cache: In-Process L1 Memory Cache (< 1ms)
        cache_key = f"dashboard_summary:{user_id}"
        now_ts = datetime.now().timestamp()
        if not bypass_cache:
            l1_entry = _DASHBOARD_L1_CACHE.get(cache_key)
            if l1_entry and (now_ts - l1_entry[0] < DASHBOARD_L1_TTL):
                latency_ms = round((datetime.now() - t_entry).total_seconds() * 1000, 2)
                print(f"[Dashboard Summary] [L1 MEMORY HIT] Served in {latency_ms}ms for user {user_id}")
                response.headers["Cache-Control"] = "private, no-cache, stale-while-revalidate=300"
                return l1_entry[1]

            # 3. Tier 1 Cache: Per-User Full Dashboard Cache Hit (< 15ms)
            cached_dashboard = get_cache(cache_key)
            if cached_dashboard:
                _DASHBOARD_L1_CACHE[cache_key] = (now_ts, cached_dashboard)
                latency_ms = round((datetime.now() - t_entry).total_seconds() * 1000, 2)
                print(f"[Dashboard Summary] [CACHE HIT] Served in {latency_ms}ms for user {user_id}")
                response.headers["Cache-Control"] = "private, no-cache, stale-while-revalidate=300"
                return cached_dashboard
        else:
            print(f"[Dashboard Summary] [CACHE BYPASS] no-cache requested for user {user_id}")

        # 4. Singleflight Request Deduplication (Coalescing concurrent calls for the same user)
        is_initiator = False
        async with _IN_FLIGHT_LOCK:
            if user_id in _IN_FLIGHT_DASHBOARDS:
                in_flight_future = _IN_FLIGHT_DASHBOARDS[user_id]
            else:
                loop = asyncio.get_running_loop()
                in_flight_future = loop.create_future()
                _IN_FLIGHT_DASHBOARDS[user_id] = in_flight_future
                is_initiator = True

        if not is_initiator:
            print(f"[Dashboard Summary] [SINGLEFLIGHT ATTACH] Awaiting in-flight execution for user {user_id}...")
            result = await in_flight_future
            response.headers["Cache-Control"] = "private, no-cache, stale-while-revalidate=300"
            return result

        # 5. Fetch Execution (Unified Single RPC + Precomputed Rank)
        try:
            print(f"[Dashboard Summary] [CACHE MISS] Executing single unified fetch for user {user_id}...")
            start_fetch_time = datetime.now()

            # Rank is read from precomputed Redis (<2ms)
            rank_task = asyncio.create_task(get_user_rank(user_id, x_company_id, requesting_user_id=user_id))

            # Unified Single RPC call to Supabase
            rpc_res = await asyncio.to_thread(
                lambda: service_supabase.rpc(
                    "get_employee_dashboard_summary",
                    {"p_user_id": user_id, "p_company_id": x_company_id},
                ).execute()
            )
            data = rpc_res.data if isinstance(rpc_res.data, dict) else {}

            company_data = data.get("company") or {}
            total_users = data.get("total_users") or 0
            learning_style = data.get("learning_style")
            plans = data.get("learning_plans") or []
            modules = data.get("training_modules") or []
            progress = data.get("module_progress") or []
            employee_assessments = data.get("employee_assessments") or []
            task_submissions = data.get("task_submissions") or []
            all_processed_modules = data.get("processed_modules") or []
            assessment_details = data.get("assessments") or []
            rpc_assigned_tasks = data.get("assigned_tasks") or []

            # Feature Gating & Normalization
            tasks_enabled = has_tasks_addon(company_data.get("subscription_addons"))
            if tasks_enabled:
                assigned_tasks = rpc_assigned_tasks
                # If RPC didn't populate assigned tasks, fallback gracefully
                if not assigned_tasks:
                    try:
                        assigned_tasks = await get_tasks_for_user(user_id, x_company_id, requesting_user_id=user_id)
                    except Exception as e:
                        print(f"[Dashboard Summary] [WARN] get_tasks_for_user fallback: {e}")
                        assigned_tasks = []
            else:
                assigned_tasks = []

            # Await fast rank result
            try:
                rank_res = await rank_task
            except Exception as e:
                print(f"[Dashboard Summary] [WARN] get_user_rank failed gracefully: {e}")
                rank_res = None
            user_rank_data = format_user_rank(rank_res)

            # In-Memory Transformations
            embed_processed_module_ids(plans, all_processed_modules, modules)
            assessment_evidence, baseline_evidence = build_assessment_evidence(
                employee_assessments, assessment_details, all_processed_modules
            )

            # Construct Response Payload
            response_payload = {
                "plans": plans,
                "modules": modules,
                "progress": progress,
                "company": company_data,
                "total_users": total_users,
                "learning_style": learning_style,
                "user_rank": user_rank_data,
                "assessment_evidence_by_module_id": assessment_evidence,
                "baseline_evidence_by_module_id": baseline_evidence,
                "task_submissions": task_submissions,
                "processed_modules": all_processed_modules,
                "assigned_tasks": assigned_tasks,
                "tasks_enabled": tasks_enabled,
            }

            elapsed_ms = round((datetime.now() - start_fetch_time).total_seconds() * 1000, 2)
            print(f"[Dashboard Summary] [OK] Single unified fetch completed in {elapsed_ms}ms for user {user_id}")

            # Cache in Redis and L1 Memory
            set_cache(cache_key, response_payload, ttl=DASHBOARD_CACHE_TTL)
            _DASHBOARD_L1_CACHE[cache_key] = (datetime.now().timestamp(), response_payload)

            response.headers["Cache-Control"] = "private, no-cache, stale-while-revalidate=300"
            etag_val = f'"{hashlib.md5(json.dumps(response_payload, default=str).encode()).hexdigest()}"'
            response.headers["ETag"] = etag_val

            if not in_flight_future.done():
                in_flight_future.set_result(response_payload)

            return response_payload

        except Exception as exc:
            if not in_flight_future.done():
                in_flight_future.set_exception(exc)
            raise
        finally:
            async with _IN_FLIGHT_LOCK:
                _IN_FLIGHT_DASHBOARDS.pop(user_id, None)

    except HTTPException:
        raise
    except Exception:
        traceback.print_exc()
        raise
    finally:
        total_request_ms = round((datetime.now() - t_entry).total_seconds() * 1000, 2)
        print(f"[Dashboard Summary] Request finished for {user_id} in {total_request_ms}ms")
