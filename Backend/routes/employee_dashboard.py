from fastapi import APIRouter, Depends, HTTPException, Query, Header
from typing import Optional, Dict, Any, List
import asyncio
from datetime import datetime

from utils.supabase_client import supabase
from utils.auth import RequestAuth, get_request_auth_required

router = APIRouter(prefix="/api/employee", tags=["employee-dashboard"])

@router.get("/dashboard_summary/{user_id}")
async def get_dashboard_summary(
    user_id: str,
    x_company_id: Optional[str] = Header(None, alias="X-Company-ID")
):
    if not x_company_id:
        # Fallback to fetching company_id from user if not provided in header
        user_res = supabase.table("users").select("company_id").eq("user_id", user_id).execute()
        if user_res.data and len(user_res.data) > 0:
            x_company_id = user_res.data[0].get("company_id")
        else:
            raise HTTPException(status_code=400, detail="Company ID is required")

    try:
        # 1. Fetch Company details
        company_res = supabase.table("companies").select(
            "company_id, name, domain, learning_style, company_logo"
        ).eq("company_id", x_company_id).single().execute()
        company_data = company_res.data if company_res.data else {}

        # 2. Fetch User details & Count total users in company
        user_res = supabase.table("users").select(
            "user_id, name, email, company_id, department_id"
        ).eq("user_id", user_id).single().execute()
        user_data = user_res.data if user_res.data else {}

        users_in_company_res = supabase.table("users").select("user_id").eq("company_id", x_company_id).execute()
        total_users = len(users_in_company_res.data) if users_in_company_res.data else 0

        # 3. Fetch Learning Style
        learning_style_res = supabase.table("employee_learning_style").select("learning_style").eq("user_id", user_id).execute()
        learning_style = learning_style_res.data[0].get("learning_style") if learning_style_res.data else None

        # 4. Fetch Learning Plans
        plans_res = supabase.table("learning_plan").select(
            "learning_plan_id, user_id, module_id, plan_json, status, reasoning, assigned_on, overall_status, completed_at, baseline_assessment, processed_module_ids"
        ).eq("user_id", user_id).execute()
        plans = plans_res.data if plans_res.data else []
        
        # 5. Fetch Training Modules for Company
        modules_res = supabase.table("training_modules").select(
            "module_id, title, gpt_summary, company_id, created_at"
        ).eq("company_id", x_company_id).execute()
        modules = modules_res.data if modules_res.data else []

        # 6. Fetch Module Progress
        progress_res = supabase.table("module_progress").select(
            "module_progress_id, user_id, processed_module_id, completed_at, quiz_score, pass_status, started_at"
        ).eq("user_id", user_id).execute()
        progress = progress_res.data if progress_res.data else []

        # 7. Fetch Employee Assessments
        assessments_res = supabase.table("employee_assessments").select(
            "employee_assessment_id, user_id, assessment_id, score, max_score, completed_at"
        ).eq("user_id", user_id).execute()
        employee_assessments = assessments_res.data if assessments_res.data else []

        # 8. Fetch Assessment Details mapped from Employee Assessments
        assessment_ids = list(set([str(ea.get("assessment_id")) for ea in employee_assessments if ea.get("assessment_id")]))
        
        assessment_details = []
        if assessment_ids:
            # We can use .in_() operator
            assessment_details_res = supabase.table("assessments").select(
                "assessment_id, type, processed_module_id, original_module_id"
            ).in_("assessment_id", assessment_ids).execute()
            assessment_details = assessment_details_res.data if assessment_details_res.data else []

        # Process mapping assessment to processed_module_ids
        processed_module_ids = list(set([str(d.get("processed_module_id")) for d in assessment_details if d.get("processed_module_id")]))
        processed_modules = []
        if processed_module_ids:
            pm_res = supabase.table("processed_modules").select(
                "processed_module_id, original_module_id"
            ).in_("processed_module_id", processed_module_ids).execute()
            processed_modules = pm_res.data if pm_res.data else []

        # We construct the assessmentEvidenceByModuleId here in backend to save bandwidth
        assessment_evidence_by_module_id = {}
        
        # Build lookups
        assessment_detail_by_id = {str(d.get("assessment_id")): d for d in assessment_details}
        processed_module_by_id = {str(pm.get("processed_module_id")): pm for pm in processed_modules}
        
        for ea in employee_assessments:
            detail = assessment_detail_by_id.get(str(ea.get("assessment_id")))
            if not detail or detail.get("type") != "module":
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

        # 9. Fake or real user rank for now. Usually needs a separate leaderboard query, doing basic for now
        # Fetch completed modules for user_id to compute rank
        completed_modules_res = supabase.table("learning_plan").select("learning_plan_id").eq("user_id", user_id).in_("status", ["COMPLETED"]).execute()
        modules_completed = len(completed_modules_res.data) if completed_modules_res.data else 0
        
        user_rank_data = {
            "rank": 1, # Placeholder, true rank calculation usually heavier
            "top_percentile": 10,
            "modules_completed": modules_completed,
            "total_score": 0
        }

        # Build response payload
        return {
            "user": user_data,
            "plans": plans,
            "modules": modules,
            "progress": progress,
            "company": {
                **company_data,
                "learning_style_enabled": company_data.get("learning_style", False)
            },
            "total_users": total_users,
            "learning_style": learning_style,
            "assessment_evidence_by_module_id": assessment_evidence_by_module_id,
            "user_rank": user_rank_data
        }
    except Exception as e:
        print(f"[Dashboard Summary Error] {e}")
        raise HTTPException(status_code=500, detail=str(e))
