from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query

from utils.auth import RequestAuth, get_request_auth_required, get_request_auth_optional
from utils.db.permissions import check_company_access, check_user_permission
from utils.db.leaderboard_db import (
    get_company_leaderboard,
    get_user_rank,
    get_leaderboard_with_user_highlight
)
from utils.supabase_client import supabase

router = APIRouter(prefix="/api/analytics", tags=["analytics-export"])


def _safe_str(value: Any) -> Optional[str]:
    if value is None:
        return None
    return str(value)


def _build_user_row(user: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "user_id": _safe_str(user.get("user_id")),
        "user_name": user.get("name"),
        "user_email": user.get("email"),
        "function_id": _safe_str(user.get("function_id")),
        "sub_function_id": _safe_str(user.get("sub_function_id")),
        "employment_status": user.get("employment_status"),
        "position": user.get("position"),
        "phone": user.get("phone"),
        "hire_date": _safe_str(user.get("hire_date")),
        "last_login": _safe_str(user.get("last_login")),
    }


def _format_conversation(conversation: Any) -> Optional[str]:
    if not conversation:
        return None
    if isinstance(conversation, list):
        lines = []
        for entry in conversation:
            if not isinstance(entry, dict):
                continue
            role = entry.get("role") or ""
            content = entry.get("content")
            if content is None:
                continue
            prefix = "User" if role == "user" else "Assistant"
            lines.append(f"{prefix}: {content}")
        return "\n".join(lines) if lines else None
    if isinstance(conversation, str):
        return conversation
    return str(conversation)


@router.get("/export/users/{company_id}")
async def export_company_user_analytics(
    company_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    if not auth_ctx.user_id:
        raise HTTPException(status_code=401, detail="Missing authentication context")

    has_permission = await check_user_permission(auth_ctx.user_id, "manager")
    has_access = await check_company_access(auth_ctx.user_id, company_id)
    if not has_permission or not has_access:
        raise HTTPException(status_code=403, detail="Permission denied")

    users_resp = (
        supabase.table("users")
        .select(
            "user_id, name, email, company_id, function_id, sub_function_id, employment_status, position, "
            "phone, hire_date, last_login, is_active"
        )
        .eq("company_id", company_id)
        .eq("is_active", True)
        .order("name")
        .execute()
    )
    users = users_resp.data or []

    if not users:
        return {
            "success": True,
            "data": {"columns": [], "rows": [], "count": 0},
            "error": None,
        }

    user_map = {str(u.get("user_id")): u for u in users if u.get("user_id")}
    user_ids = list(user_map.keys())

    modules_resp = (
        supabase.table("training_modules")
        .select("module_id, title, content_type, processing_status, threshold_value")
        .eq("company_id", company_id)
        .execute()
    )
    modules = modules_resp.data or []
    module_map = {str(m.get("module_id")): m for m in modules if m.get("module_id")}

    processed_resp = (
        supabase.table("processed_modules")
        .select("processed_module_id, original_module_id, title, learning_style, training_modules!inner(company_id)")
        .eq("training_modules.company_id", company_id)
        .execute()
    )
    processed_modules = processed_resp.data or []
    processed_map = {
        str(pm.get("processed_module_id")): pm for pm in processed_modules if pm.get("processed_module_id")
    }

    learning_plans_resp = (
        supabase.table("learning_plan")
        .select(
            "learning_plan_id, user_id, module_id, assigned_on, due_date, priority, status, "
            "started_at, completed_at, baseline_assessment"
        )
        .in_("user_id", user_ids)
        .execute()
    )
    learning_plans = learning_plans_resp.data or []

    module_progress_resp = (
        supabase.table("module_progress")
        .select(
            "module_progress_id, user_id, processed_module_id, quiz_score, quiz_feedback, "
            "audio_listen_duration, completed_at, viewed_at, pass_status"
        )
        .in_("user_id", user_ids)
        .execute()
    )
    module_progress = module_progress_resp.data or []

    module_chat_resp = (
        supabase.table("module_chat_conversations")
        .select("user_id, processed_module_id, conversation, created_at")
        .eq("company_id", company_id)
        .in_("user_id", user_ids)
        .execute()
    )
    module_chats = module_chat_resp.data or []

    assessments_resp = (
        supabase.table("employee_assessments")
        .select("employee_assessment_id, user_id, assessment_id, score, max_score, completed_at")
        .in_("user_id", user_ids)
        .execute()
    )
    employee_assessments = assessments_resp.data or []

    assessment_ids = [str(a.get("assessment_id")) for a in employee_assessments if a.get("assessment_id")]
    assessments_map: Dict[str, Dict[str, Any]] = {}
    if assessment_ids:
        assessments_details = (
            supabase.table("assessments")
            .select("assessment_id, type, original_module_id, processed_module_id")
            .in_("assessment_id", assessment_ids)
            .execute()
        )
        assessments_map = {
            str(a.get("assessment_id")): a for a in (assessments_details.data or []) if a.get("assessment_id")
        }

    rows_by_key: Dict[str, Dict[str, Any]] = {}

    def ensure_row(user_id: str, module_id: Optional[str]) -> Dict[str, Any]:
        key = f"{user_id}:{module_id or 'none'}"
        if key in rows_by_key:
            return rows_by_key[key]

        user = user_map.get(str(user_id), {})
        base = _build_user_row(user)
        module = module_map.get(str(module_id)) if module_id else None
        base.update(
            {
                "module_id": _safe_str(module_id),
                "module_title": module.get("title") if module else None,
                "module_content_type": module.get("content_type") if module else None,
                "learning_plan_status": None,
                "assigned_on": None,
                "due_date": None,
                "plan_started_at": None,
                "plan_completed_at": None,
                "baseline_assessment": None,
                "priority": None,
                "processed_module_id": None,
                "processed_module_title": None,
                "quiz_score": None,
                "quiz_feedback": None,
                "audio_listen_duration": None,
                "progress_completed_at": None,
                "progress_viewed_at": None,
                "pass_status": None,
                "assessment_count": 0,
                "assessment_types": None,
                "assessment_avg_score": None,
                "assessment_scores": None,
                "last_assessment_score": None,
                "last_assessment_completed_at": None,
                "chat_count": 0,
                "chat_last_at": None,
                "chat_transcript": None,
            }
        )
        rows_by_key[key] = base
        return base

    for plan in learning_plans:
        user_id = str(plan.get("user_id")) if plan.get("user_id") else None
        module_id = str(plan.get("module_id")) if plan.get("module_id") else None
        if not user_id:
            continue
        row = ensure_row(user_id, module_id)
        row.update(
            {
                "learning_plan_status": plan.get("status"),
                "assigned_on": _safe_str(plan.get("assigned_on")),
                "due_date": _safe_str(plan.get("due_date")),
                "plan_started_at": _safe_str(plan.get("started_at")),
                "plan_completed_at": _safe_str(plan.get("completed_at")),
                "baseline_assessment": plan.get("baseline_assessment"),
                "priority": plan.get("priority"),
            }
        )

    for progress in module_progress:
        user_id = str(progress.get("user_id")) if progress.get("user_id") else None
        processed_module_id = progress.get("processed_module_id")
        if not user_id:
            continue
        processed = processed_map.get(str(processed_module_id)) if processed_module_id else None
        module_id = None
        if processed and processed.get("original_module_id"):
            module_id = str(processed.get("original_module_id"))
        row = ensure_row(user_id, module_id)
        row.update(
            {
                "processed_module_id": _safe_str(processed_module_id),
                "processed_module_title": processed.get("title") if processed else None,
                "quiz_score": progress.get("quiz_score"),
                "quiz_feedback": progress.get("quiz_feedback"),
                "audio_listen_duration": progress.get("audio_listen_duration"),
                "progress_completed_at": _safe_str(progress.get("completed_at")),
                "progress_viewed_at": _safe_str(progress.get("viewed_at")),
                "pass_status": progress.get("pass_status"),
            }
        )

    chat_buckets: Dict[str, Dict[str, Any]] = {}
    for chat in module_chats:
        user_id = str(chat.get("user_id")) if chat.get("user_id") else None
        processed_module_id = chat.get("processed_module_id")
        if not user_id or not processed_module_id:
            continue
        processed = processed_map.get(str(processed_module_id))
        module_id = None
        if processed and processed.get("original_module_id"):
            module_id = str(processed.get("original_module_id"))
        key = f"{user_id}:{module_id or 'none'}"
        bucket = chat_buckets.setdefault(
            key,
            {"count": 0, "last_at": None, "transcripts": []},
        )
        bucket["count"] += 1
        created_at = _safe_str(chat.get("created_at"))
        if created_at and (bucket["last_at"] is None or created_at > bucket["last_at"]):
            bucket["last_at"] = created_at
        transcript = _format_conversation(chat.get("conversation"))
        if transcript:
            bucket["transcripts"].append(transcript)

    assessment_scores: Dict[str, List[Dict[str, Any]]] = {}
    for assessment in employee_assessments:
        user_id = str(assessment.get("user_id")) if assessment.get("user_id") else None
        if not user_id:
            continue
        assessment_id = assessment.get("assessment_id")
        details = assessments_map.get(str(assessment_id)) if assessment_id else None
        module_id = None
        if details:
            if details.get("original_module_id"):
                module_id = str(details.get("original_module_id"))
            elif details.get("processed_module_id"):
                processed = processed_map.get(str(details.get("processed_module_id")))
                if processed and processed.get("original_module_id"):
                    module_id = str(processed.get("original_module_id"))
        key = f"{user_id}:{module_id or 'none'}"
        assessment_scores.setdefault(key, []).append(
            {
                "score": assessment.get("score"),
                "max_score": assessment.get("max_score"),
                "completed_at": assessment.get("completed_at"),
                "type": details.get("type") if details else None,
            }
        )

    for key, items in assessment_scores.items():
        if not items:
            continue
        user_id, module_id = key.split(":", 1)
        module_id = module_id if module_id != "none" else None
        row = ensure_row(user_id, module_id)
        scores = [i.get("score") for i in items if i.get("score") is not None]
        max_scores = [i.get("max_score") for i in items if i.get("max_score")]
        avg_score = None
        if scores:
            avg_score = round(sum(scores) / len(scores), 2)
        types = [i.get("type") for i in items if i.get("type")]
        last_item = max(items, key=lambda x: str(x.get("completed_at") or ""))
        row.update(
            {
                "assessment_count": len(items),
                "assessment_types": ", ".join(sorted(set(types))) if types else None,
                "assessment_avg_score": avg_score,
                "assessment_scores": ", ".join([str(s) for s in scores]) if scores else None,
                "last_assessment_score": last_item.get("score"),
                "last_assessment_completed_at": _safe_str(last_item.get("completed_at")),
            }
        )

    for key, bucket in chat_buckets.items():
        user_id, module_id = key.split(":", 1)
        module_id = module_id if module_id != "none" else None
        row = ensure_row(user_id, module_id)
        transcripts = bucket.get("transcripts") or []
        row.update(
            {
                "chat_count": bucket.get("count", 0),
                "chat_last_at": bucket.get("last_at"),
                "chat_transcript": "\n\n".join(transcripts) if transcripts else None,
            }
        )

    for user_id in user_ids:
        ensure_row(user_id, None)

    columns = [
        "user_id",
        "user_name",
        "user_email",
        "function_id",
        "sub_function_id",
        "employment_status",
        "position",
        "phone",
        "hire_date",
        "last_login",
        "module_id",
        "module_title",
        "module_content_type",
        "learning_plan_status",
        "assigned_on",
        "due_date",
        "plan_started_at",
        "plan_completed_at",
        "baseline_assessment",
        "priority",
        "processed_module_id",
        "processed_module_title",
        "quiz_score",
        "quiz_feedback",
        "audio_listen_duration",
        "progress_completed_at",
        "progress_viewed_at",
        "pass_status",
        "assessment_count",
        "assessment_types",
        "assessment_avg_score",
        "assessment_scores",
        "last_assessment_score",
        "last_assessment_completed_at",
        "chat_count",
        "chat_last_at",
        "chat_transcript",
    ]

    rows = list(rows_by_key.values())
    return {
        "success": True,
        "data": {"columns": columns, "rows": rows, "count": len(rows)},
        "error": None,
    }


# ==================== LEADERBOARD ENDPOINTS ====================

@router.get("/leaderboard/{company_id}")
async def get_leaderboard(
    company_id: str,
    limit: int = Query(10, ge=1, le=100),
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """
    Get leaderboard for a company showing top performers.
    Permission: Any user in the company can view.
    
    Query Parameters:
    - limit: Number of top performers to return (1-100, default 10)
    
    Returns:
    - List of top performers with rank, name, total_points, modules_completed, avatar_url
    """
    # print(f"[leaderboard] Request received; company_id={company_id}; auth_source={auth_ctx.source}; user_id={auth_ctx.user_id}; email={auth_ctx.email}")
    
    if not auth_ctx.user_id:
        print(f"[leaderboard] ERROR: Missing user_id; auth_source={auth_ctx.source}; auth_ctx={vars(auth_ctx)}")
        raise HTTPException(status_code=401, detail="Missing authentication context")
    
    # Check if user belongs to the company
    has_access = await check_company_access(auth_ctx.user_id, company_id)
    if not has_access:
        print(f"[leaderboard] ERROR: User {auth_ctx.user_id} does not have access to company {company_id}; auth_source={auth_ctx.source}")
        raise HTTPException(status_code=403, detail="Permission denied: Not in this company")
    
    try:
        result = await get_company_leaderboard(company_id, limit=limit)
        
        if result.get("error"):
            raise HTTPException(status_code=400, detail=result["error"])
        
        return {
            "success": True,
            "data": result.get("data", []),
            "error": None
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch leaderboard: {str(e)}")


@router.get("/leaderboard/{company_id}/user-rank")
async def get_user_leaderboard_rank(
    company_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """
    Get requesting user's rank and statistics in the leaderboard.
    Permission: User can view only their own rank, or managers can view any user in their company.
    
    Returns:
    - rank: User's position in leaderboard (1 = top)
    - total_points: User's total points
    - modules_completed: Number of completed modules
    - percentile: User's percentile (0-100, 100 = top)
    - total_users: Total users in company
    - users_ahead: Number of users with more points
    """
    if not auth_ctx.user_id:
        raise HTTPException(status_code=401, detail="Missing authentication context")
    
    # Check if user belongs to the company
    has_access = await check_company_access(auth_ctx.user_id, company_id)
    if not has_access:
        raise HTTPException(status_code=403, detail="Permission denied: Not in this company")
    
    try:
        result = await get_user_rank(auth_ctx.user_id, company_id)
        
        if result.get("error"):
            raise HTTPException(status_code=400, detail=result["error"])
        
        return {
            "success": True,
            "data": result.get("data"),
            "error": None
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch user rank: {str(e)}")


@router.get("/leaderboard/{company_id}/highlight")
async def get_leaderboard_with_highlight(
    company_id: str,
    top_limit: int = Query(10, ge=1, le=100),
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """
    Get top performers plus requesting user's position if outside top N.
    Useful for UI display - shows top performers and where the user ranks.
    Permission: Any user in the company can view.
    
    Query Parameters:
    - top_limit: Number of top performers to show (1-100, default 10)
    
    Returns:
    - top_performers: List of top N users
    - user_rank_info: User's rank info (if not in top N)
    - total_users: Total users in company
    - user_in_top: Whether user is in top N
    """
    if not auth_ctx.user_id:
        raise HTTPException(status_code=401, detail="Missing authentication context")
    
    # Check if user belongs to the company
    has_access = await check_company_access(auth_ctx.user_id, company_id)
    if not has_access:
        raise HTTPException(status_code=403, detail="Permission denied: Not in this company")
    
    try:
        result = await get_leaderboard_with_user_highlight(auth_ctx.user_id, company_id, top_limit=top_limit)
        
        if result.get("error"):
            raise HTTPException(status_code=400, detail=result["error"])
        
        return {
            "success": True,
            "data": result.get("data"),
            "error": None
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch leaderboard: {str(e)}")
