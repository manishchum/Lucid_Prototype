from fastapi import APIRouter, Depends, HTTPException, Query, Header
from typing import Optional, Dict, Any, List
import asyncio
from datetime import datetime
from utils.auth_bridge import get_service_supabase_client
from utils.supabase_client import supabase
from utils.auth import RequestAuth, get_request_auth_required, get_effective_company_id
from utils.db.permissions import check_user_permission
from utils.db.leaderboard_db import get_user_rank
from utils.redis_client import get_cache, set_cache, redis_client
import traceback

router = APIRouter(prefix="/api/employee", tags=["employee-dashboard"])

@router.get("/dashboard_summary/{user_id}")
async def get_dashboard_summary(
    user_id: str,
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

        def _get_data(response):
            return getattr(response, "data", None)

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
            return cached
        
        print(f"Dashboard Summary Cache Miss for user {user_id}")
        

        # 1. Fetch Company details
        company_res = (
            service_supabase
            .table("companies")
            .select("*")
            .eq("company_id", x_company_id)
            .maybe_single()
            .execute()
        )
        company_data = _get_data(company_res) or {}
        
        # 2. Fetch User details & Count total users in company
        users_res = service_supabase.table("users").select("user_id").eq("company_id", x_company_id).execute()
        users_data = _get_data(users_res)
        total_users = len(users_data) if users_data else 0

        # 3. Fetch Learning Style
        learning_style_res = service_supabase.table("employee_learning_style").select("learning_style").eq("user_id", user_id).maybe_single().execute()
        learning_style_data = _get_data(learning_style_res)
        learning_style = learning_style_data.get("learning_style") if isinstance(learning_style_data, dict) else None
        print(f"Learning Style: {learning_style}")
        # 4. Fetch Learning Plans
        plans_res = service_supabase.table("learning_plan").select("*").eq("user_id", user_id).execute()
        plans = _get_data(plans_res) or []
        
        # 5. Fetch Training Modules for Company
        modules_res = service_supabase.table("training_modules").select("*").eq("company_id", x_company_id).execute()
        modules = _get_data(modules_res) or []

        # 6. Fetch Module Progress
        progress_res = service_supabase.table("module_progress").select("*").eq("user_id", user_id).execute()
        progress = _get_data(progress_res) or []
        # print(f"Module Progress: {progress}")

        # 7. Fetch Employee Assessments
        assessments_res = service_supabase.table("employee_assessments").select("*").eq("user_id", user_id).execute()
        employee_assessments = _get_data(assessments_res) or []
        # print(f"Employee Assessments: {employee_assessments}")

        # 8. Fetch Assessment Details mapped from Employee Assessments
        assessment_ids = list(set([str(ea.get("assessment_id")) for ea in employee_assessments if ea.get("assessment_id")]))
        
        assessment_details = []
        if assessment_ids:
            # We can use .in_() operator
            assessment_details_res = service_supabase.table("assessments").select("*").in_("assessment_id", assessment_ids).execute()
            assessment_details = _get_data(assessment_details_res) or []

        # Process mapping assessment to processed_module_ids
        processed_module_ids = list(set([str(d.get("processed_module_id")) for d in assessment_details if d.get("processed_module_id")]))
        processed_modules = []
        if processed_module_ids:
            pm_res = service_supabase.table("processed_modules").select("*").in_("processed_module_id", processed_module_ids).execute()
            processed_modules = _get_data(pm_res) or []

        # We construct the assessmentEvidenceByModuleId here in backend to save bandwidth
        assessment_evidence_by_module_id = {}
        baseline_evidence_by_module_id = {}
        
        # Build lookups
        assessment_detail_by_id = {str(d.get("assessment_id")): d for d in assessment_details}
        processed_module_by_id = {str(pm.get("processed_module_id")): pm for pm in processed_modules}
        
        for ea in employee_assessments:
            detail = assessment_detail_by_id.get(str(ea.get("assessment_id")))
            if not detail:
                continue

            processed_module = processed_module_by_id.get(str(detail.get("processed_module_id")))
            original_module_id = str(detail.get("original_module_id") or (processed_module.get("original_module_id") if processed_module else ""))
            
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
                
            assessment_evidence_by_module_id[original_module_id].append({
                "scorePercent": score_percent,
                "completedAt": ea.get("completed_at")
            })

            if detail.get("type") == "baseline":
                if original_module_id not in baseline_evidence_by_module_id:
                    baseline_evidence_by_module_id[original_module_id] = []
                baseline_evidence_by_module_id[original_module_id].append({
                    "scorePercent": score_percent,
                    "completedAt": ea.get("completed_at")
                })

            if detail.get("type") == "baseline":
                if original_module_id not in baseline_evidence_by_module_id:
                    baseline_evidence_by_module_id[original_module_id] = []
                baseline_evidence_by_module_id[original_module_id].append({
                    "scorePercent": score_percent,
                    "completedAt": ea.get("completed_at")
                })

        # 9. Fetch Task Submissions for task reports
        task_submissions_res = (
            supabase.table("task_submissions")
            .select("*")
            .eq("user_id", user_id)
            .eq("company_id", x_company_id)
            .execute()
        )
        task_submissions = task_submissions_res.data if task_submissions_res.data else []

        # 10. True user rank calculation from leaderboard service
        rank_res = await get_user_rank(user_id, x_company_id)
        rank_info = rank_res.get("data") if (rank_res and not rank_res.get("error")) else None

        user_rank_data = {
            "rank": rank_info.get("rank", 1) if rank_info else 1,
            "top_percentile": rank_info.get("percentile", 10) if rank_info else 10,
            "modules_completed": rank_info.get("modules_completed", 0) if rank_info else 0,
            "total_score": rank_info.get("total_points", 0) if rank_info else 0,
        }

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
            "task_submissions": task_submissions
        }
        
        set_cache(cache_key, response_payload, ttl=300)
        return response_payload
          
    # except Exception as e:
    #     print(f"[Dashboard Summary Error] {e}")
    #     raise HTTPException(status_code=500, detail=str(e))
    except Exception:
        traceback.print_exc()
        raise
    finally:
        print(f"[Dashboard Summary] Request completed for user {user_id}")
