from fastapi import APIRouter, Depends, HTTPException, Query, Header, Response
from typing import Optional, Dict, Any, List
import asyncio
import hashlib
import json
from datetime import datetime
from utils.auth_bridge import get_service_supabase_client
from utils.supabase_client import supabase
from utils.auth import RequestAuth, get_request_auth_required, get_effective_company_id
from utils.db.permissions import check_user_permission
from utils.db.leaderboard_db import get_user_rank
from utils.redis_client import get_cache, set_cache, redis_client
import traceback

router = APIRouter(prefix="/api/employee", tags=["employee-dashboard"])

from task_manager.service import get_tasks_for_user

@router.get("/dashboard_summary/{user_id}")
async def get_dashboard_summary(
    user_id: str,
    response: Response,
    x_company_id: Optional[str] = Header(None, alias="X-Company-ID"),
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    effective_company_id: str = Depends(get_effective_company_id),
):
    try:
        service_supabase = get_service_supabase_client()

        if auth_ctx.user_id != user_id:
            is_manager = await check_user_permission(auth_ctx.user_id, "manager")
            if not is_manager:
                raise HTTPException(status_code=403, detail="Permission denied")

        def _get_data(res):
            return getattr(res, "data", None)

        user_company_res = (
            service_supabase
            .table("users")
            .select("company_id")
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
        user_company_data = _get_data(user_company_res)
        if not isinstance(user_company_data, dict) or not user_company_data.get("company_id"):
            raise HTTPException(status_code=404, detail="User not found")

        user_company_id = str(user_company_data.get("company_id"))
        if str(effective_company_id) != user_company_id:
            raise HTTPException(status_code=403, detail="User does not belong to this company")

        x_company_id = str(effective_company_id)
        
        cache_key = f"dashboard_summary:{user_id}"
        cached = get_cache(cache_key)
        
        if cached:
            print("Dashboard Summary Cache Hit", {"cache_key": cache_key, "user_id": user_id})
            response.headers["Cache-Control"] = "private, no-cache, stale-while-revalidate=300"
            return cached
        
        print(f"Dashboard Summary Cache Miss for user {user_id}")
        start_time = datetime.now()

        # Batch 1: Execute single Postgres RPC, leaderboard rank, and assigned tasks concurrently
        rpc_res, rank_res, tasks_res = await asyncio.gather(
            asyncio.to_thread(
                lambda: service_supabase.rpc(
                    "get_employee_dashboard_summary",
                    {"p_user_id": user_id, "p_company_id": x_company_id}
                ).execute()
            ),
            get_user_rank(user_id, x_company_id, requesting_user_id=user_id),
            get_tasks_for_user(user_id, x_company_id, requesting_user_id=user_id),
        )

        summary_data = rpc_res.data if isinstance(rpc_res.data, dict) else {}

        company_data = summary_data.get("company") or {}
        total_users = summary_data.get("total_users") or 0
        learning_style = summary_data.get("learning_style")
        plans = summary_data.get("learning_plans") or []
        modules = summary_data.get("training_modules") or []
        progress = summary_data.get("module_progress") or []
        employee_assessments = summary_data.get("employee_assessments") or []
        task_submissions = summary_data.get("task_submissions") or []
        all_processed_modules = summary_data.get("processed_modules") or []
        assessment_details = summary_data.get("assessments") or []

        # Feature Gating: Off by default. Only enabled if company.subscription_addons specifically contains "tasks" or "task_manager"
        company_addons = company_data.get("subscription_addons") or []
        if isinstance(company_addons, str):
            try:
                company_addons = json.loads(company_addons)
            except Exception:
                company_addons = [company_addons]
        if not isinstance(company_addons, list):
            company_addons = []

        tasks_enabled = any(
            str(addon).strip().lower() in ("tasks", "task_manager", "task-manager", "task_management")
            for addon in company_addons
        )

        assigned_tasks = tasks_res if tasks_enabled else []

        rank_info = rank_res.get("data") if (rank_res and not rank_res.get("error")) else None
        user_rank_data = {
            "rank": rank_info.get("rank", 1) if rank_info else 1,
            "top_percentile": rank_info.get("percentile", 10) if rank_info else 10,
            "modules_completed": rank_info.get("modules_completed", 0) if rank_info else 0,
            "total_score": rank_info.get("total_points", 0) if rank_info else 0,
        }

        # Pre-resolve processed_module_ids and embed into plans
        company_module_ids = {str(m.get("module_id")) for m in modules if isinstance(m, dict) and m.get("module_id")}
        pm_by_original = {}
        for pm in all_processed_modules:
            orig_id = str(pm.get("original_module_id") or "")
            if orig_id and (not company_module_ids or orig_id in company_module_ids):
                if orig_id not in pm_by_original:
                    pm_by_original[orig_id] = []
                pm_by_original[orig_id].append(pm)

        for plan in plans:
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

        processed_modules = all_processed_modules

        # Construct assessmentEvidenceByModuleId and baselineEvidenceByModuleId
        assessment_evidence_by_module_id = {}
        baseline_evidence_by_module_id = {}

        assessment_detail_by_id = {
            str(d.get("assessment_id")): d for d in assessment_details
        }
        processed_module_by_id = {
            str(pm.get("processed_module_id")): pm for pm in processed_modules
        }

        for ea in employee_assessments:
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

            if original_module_id not in assessment_evidence_by_module_id:
                assessment_evidence_by_module_id[original_module_id] = []

            assessment_evidence_by_module_id[original_module_id].append(
                {
                    "scorePercent": score_percent,
                    "completedAt": ea.get("completed_at"),
                }
            )

            if detail.get("type") == "baseline":
                if original_module_id not in baseline_evidence_by_module_id:
                    baseline_evidence_by_module_id[original_module_id] = []
                baseline_evidence_by_module_id[original_module_id].append(
                    {
                        "scorePercent": score_percent,
                        "completedAt": ea.get("completed_at"),
                    }
                )

        # Build response payload
        response_payload = {
            "plans": plans,
            "modules": modules,
            "progress": progress,
            "company": company_data,
            "total_users": total_users,
            "learning_style": learning_style,
            "user_rank": user_rank_data,
            "assessment_evidence_by_module_id": assessment_evidence_by_module_id,
            "baseline_evidence_by_module_id": baseline_evidence_by_module_id,
            "task_submissions": task_submissions,
            "processed_modules": processed_modules,
            "assigned_tasks": assigned_tasks,
            "tasks_enabled": tasks_enabled,
        }

        elapsed_ms = round((datetime.now() - start_time).total_seconds() * 1000, 2)
        print(f"[Dashboard Summary] [OK] Concurrent fetch completed in {elapsed_ms}ms for user {user_id}")

        set_cache(cache_key, response_payload, ttl=300)
        
        response.headers["Cache-Control"] = "private, no-cache, stale-while-revalidate=300"
        etag_val = f'"{hashlib.md5(json.dumps(response_payload, default=str).encode()).hexdigest()}"'
        response.headers["ETag"] = etag_val

        return response_payload
          
    # except Exception as e:
    #     print(f"[Dashboard Summary Error] {e}")
    #     raise HTTPException(status_code=500, detail=str(e))
    except Exception:
        traceback.print_exc()
        raise
    finally:
        print(f"[Dashboard Summary] Request completed for user {user_id}")
