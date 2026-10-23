from fastapi import APIRouter, Depends, HTTPException, Header, Query
from pydantic import BaseModel
from typing import Optional
from utils.auth import RequestAuth, get_request_auth_required, get_effective_company_id
from utils.redis_client import redis_client, set_cache, get_cache, invalidate_dashboard_cache
from utils.notification_dispatcher import schedule_notification_job

from utils.db.module_progress_db import (
    get_progress_by_id,
    get_progress_by_user,
    get_progress_by_processed_module,
    get_progress_by_user_and_module,
    get_progress_by_company,
    create_or_update_progress,
    update_progress,
    delete_progress,
    get_completion_stats
)

router = APIRouter(prefix="/api/module-progress", tags=["module-progress"])


class CreateOrUpdateProgressRequest(BaseModel):
    user_id: str
    processed_module_id: str
    quiz_score: Optional[int] = None
    max_score: Optional[int] = None
    quiz_feedback: Optional[str] = None
    audio_listen_duration: Optional[int] = None
    completed_at: Optional[str] = None
    pass_status: Optional[bool] = None
    viewOnly: Optional[bool] = False
    module_id: Optional[str] = None  # Original module ID for threshold lookup


class UpdateProgressRequest(BaseModel):
    quiz_score: Optional[int] = None
    quiz_feedback: Optional[str] = None
    audio_listen_duration: Optional[int] = None
    completed_at: Optional[str] = None
    pass_status: Optional[bool] = None
    viewed_at: Optional[str] = None


@router.get("/{progress_id}")
async def get_progress_record(
    progress_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Get a single module progress record by ID.
    Permission: Self OR manager+ in same company.
    """
    result = await get_progress_by_id(user_id, progress_id)
    
    if result["error"]:
        status_code = 404 if "not found" in result["error"].lower() else 403
        raise HTTPException(status_code=status_code, detail=result["error"])
    
    return {"progress": result["data"]}


@router.get("/user/{target_user_id}")
async def get_user_progress(
    target_user_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    completed_only: bool = Query(False),
    limit: int = Query(50, ge=1, le=200, description="Max records to return (1-200)"),
    offset: int = Query(0, ge=0, description="Number of records to skip")
):
    """
    Get all module progress records for a specific user.
    Permission: Self OR manager+ in same company.
    """
    safe_limit = max(1, min(limit, 200))
    safe_offset = max(0, offset)
    cache_key = (
        f"module_progress:"
        f"{target_user_id}:"
        f"{completed_only}:"
        f"{safe_limit}:"
        f"{safe_offset}"
    )
    cached = get_cache(cache_key)
    if cached:
        print(f"Module progress cache hit for user {target_user_id} {cache_key}")
        return cached
    print(f"Module progress cache miss for user {target_user_id} {cache_key}")
    result = await get_progress_by_user(
        auth_ctx.user_id,
        target_user_id,
        completed_only,
        auth_claims=auth_ctx.claims,
        limit=safe_limit,
        offset=safe_offset,
    )
    
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    
    response_payload = {
        "progress": result["data"],
        "count": len(result["data"] or []),
        "limit": safe_limit,
        "offset": safe_offset,
    }

    set_cache(
        cache_key,
        response_payload,
        ttl=120
    )

    return response_payload


@router.get("/module/{processed_module_id}")
async def get_module_progress(
    processed_module_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    limit: int = Query(50, ge=1, le=200, description="Max records to return (1-200)"),
    offset: int = Query(0, ge=0, description="Number of records to skip")
):
    user_id = auth_ctx.user_id
    """
    Get all progress records for a specific processed module.
    Permission: Manager+ in the company that owns the module.
    """
    safe_limit = max(1, min(limit, 200))
    safe_offset = max(0, offset)
    result = await get_progress_by_processed_module(
        user_id,
        processed_module_id,
        limit=safe_limit,
        offset=safe_offset
    )
    
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    
    return {
        "progress": result["data"],
        "count": len(result["data"] or []),
        "limit": safe_limit,
        "offset": safe_offset,
    }


@router.get("/user/{target_user_id}/module/{processed_module_id}")
async def get_user_module_progress(
    target_user_id: str,
    processed_module_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Get progress record for a specific user and processed module.
    Permission: Self OR manager+ in same company.
    """
    cache_key = (
        f"user_module_progress:"
        f"{target_user_id}:"
        f"{processed_module_id}"
    )

    cached = get_cache(cache_key)

    if cached:
        print(
            f"USER MODULE PROGRESS CACHE HIT {cache_key}"
        )
        return cached
    
    result = await get_progress_by_user_and_module(user_id, target_user_id, processed_module_id)
    
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    
    response_payload = {
        "progress": result["data"]
    }

    set_cache(
        cache_key,
        response_payload,
        ttl=120
    )

    return response_payload


@router.get("/company/{company_id}")
async def get_company_progress(
    company_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    effective_company_id: str = Depends(get_effective_company_id),
    target_user_id: Optional[str] = Query(None),
    completed_only: bool = Query(False),
    limit: int = Query(50, ge=1, le=200, description="Max records to return (1-200)"),
    offset: int = Query(0, ge=0, description="Number of records to skip")
):
    user_id = auth_ctx.user_id
    """
    Get all module progress records for a company (paginated).
    Optionally filter by user.
    Permission: Manager+ in the company.
    """
    safe_limit = max(1, min(limit, 200))
    safe_offset = max(0, offset)
    result = await get_progress_by_company(
        user_id,
        effective_company_id,
        target_user_id,
        completed_only,
        limit=safe_limit,
        offset=safe_offset
    )
    
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    
    return {
        "progress": result["data"],
        "count": len(result["data"] or []),
        "limit": safe_limit,
        "offset": safe_offset,
    }


@router.get("/company/{company_id}/stats")
async def get_company_completion_stats(
    company_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    effective_company_id: str = Depends(get_effective_company_id)
):
    user_id = auth_ctx.user_id
    """
    Get completion statistics for a company.
    Permission: Manager+ in the company.
    """
    result = await get_completion_stats(user_id, effective_company_id)
    
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    
    return {"stats": result["data"]}


async def _trigger_quiz_completion_notifications(
    user_id: str,
    module_id: Optional[str],
    processed_module_id: Optional[str],
    quiz_score: Optional[int],
    max_score: Optional[int],
    pass_status: Optional[bool],
    company_id: Optional[str]
):
    try:
        from utils.auth_bridge import get_service_supabase_client
        _db = get_service_supabase_client()

        # 1. Fetch user first name
        first_name = "there"
        try:
            u_res = _db.table("users").select("name").eq("user_id", user_id).maybe_single().execute()
            full_name = (getattr(u_res, "data", None) or {}).get("name")
            if full_name:
                first_name = full_name.strip().split()[0]
        except Exception:
            pass

        # 2. Fetch module title
        module_title = "Module"
        target_mod_id = processed_module_id or module_id
        if processed_module_id:
            try:
                m_res = _db.table("processed_modules").select("title").eq("processed_module_id", processed_module_id).maybe_single().execute()
                t = (getattr(m_res, "data", None) or {}).get("title")
                if t:
                    module_title = t
            except Exception:
                pass
        if module_title == "Module" and module_id:
            try:
                m_res = _db.table("training_modules").select("title").eq("module_id", module_id).maybe_single().execute()
                t = (getattr(m_res, "data", None) or {}).get("title")
                if t:
                    module_title = t
            except Exception:
                pass

        score_pct = round((quiz_score / (max_score or 10)) * 100) if quiz_score is not None else 100

        meta = {
            "module_id": target_mod_id,
            "target_id": target_mod_id,
            "target_screen": "Reports",
            "module_name": module_title,
            "first_name": first_name,
            "score": str(score_pct),
            "assessment_name": module_title,
            "result_message": "Outstanding work!" if pass_status else "Keep practicing!",
        }

        # Module completed notification (Legacy static template)
        await schedule_notification_job(
            user_id=user_id,
            company_id=company_id,
            notification_type="MODULE_COMPLETED",
            metadata=meta
        )

        # Trigger Automated Notification Workflows via WorkflowEngine
        try:
            import asyncio
            from utils.notifications.workflow_engine import WorkflowEngine

            wf_payload = {
                "module_id": target_mod_id,
                "curriculum.module_id": target_mod_id,
                "curriculum.module_name": module_title,
                "module_name": module_title,
                "curriculum.progress_percentage": 100,
                "progress_percentage": 100,
                "curriculum.minutes_remaining": 0,
                "assessment.score": score_pct,
                "score": score_pct,
                "assessment.passed": bool(pass_status),
                "gamification.xp_points": 50 if pass_status else 10,
            }

            # 1. Assessment Evaluation & Pacing Updates
            asyncio.create_task(
                WorkflowEngine.trigger_lifecycle(
                    trigger_lifecycle="ASSESSMENT_COMPLETED",
                    user_id=user_id,
                    payload=wf_payload,
                    company_id=company_id,
                )
            )
            asyncio.create_task(
                WorkflowEngine.trigger_lifecycle(
                    trigger_lifecycle="MODULE_PROGRESS_UPDATED",
                    user_id=user_id,
                    payload=wf_payload,
                    company_id=company_id,
                )
            )

            # 2. Quiz Passed or Failed
            if pass_status is True:
                asyncio.create_task(
                    WorkflowEngine.trigger_lifecycle(
                        trigger_lifecycle="QUIZ_PASSED",
                        user_id=user_id,
                        payload=wf_payload,
                        company_id=company_id,
                    )
                )
                asyncio.create_task(
                    WorkflowEngine.trigger_lifecycle(
                        trigger_lifecycle="POST_COMPLETION_FEEDBACK",
                        user_id=user_id,
                        payload=wf_payload,
                        company_id=company_id,
                    )
                )
            elif pass_status is False:
                asyncio.create_task(
                    WorkflowEngine.trigger_lifecycle(
                        trigger_lifecycle="QUIZ_FAILED",
                        user_id=user_id,
                        payload={**wf_payload, "assessment.weak_topic": "Foundational Principles"},
                        company_id=company_id,
                    )
                )
        except Exception as wf_err:
            import logging
            logging.getLogger("lucid.module_progress").warning(f"WorkflowEngine trigger failed in module_progress: {wf_err}")

        # Quiz passed notification (if passed - legacy job)
        if pass_status is True:
            await schedule_notification_job(
                user_id=user_id,
                company_id=company_id,
                notification_type="QUIZ_PASSED",
                metadata=meta
            )

            # Post-completion CSAT feedback notification
            feedback_meta = {
                "module_id": target_mod_id,
                "target_id": target_mod_id,
                "target_screen": "Feedback",
                "module_type": "quiz",
                "module_name": module_title,
                "first_name": first_name,
            }
            await schedule_notification_job(
                user_id=user_id,
                company_id=company_id,
                notification_type="POST_COMPLETION_FEEDBACK",
                metadata=feedback_meta
            )
    except Exception as e:
        import logging
        logging.getLogger("lucid.module_progress").error(f"Failed to trigger quiz completion notifications: {e}")


@router.post("")
async def create_or_update_progress_record(
    request: CreateOrUpdateProgressRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Create or update a module progress record (upsert).
    
    This endpoint handles both creating new progress records and updating existing ones.
    If viewOnly=true and record exists, it won't update - just returns existing.
    
    Permission: Self (for own progress) OR manager+ in same company.
    
    The endpoint automatically:
    - Sets started_at on first creation
    - Calculates pass_status based on quiz_score, max_score, and module threshold
    - Sets completed_at when quiz is submitted
    """
    progress_data = request.dict()
    result = await create_or_update_progress(user_id, progress_data)
    
    if result["error"]:
        raise HTTPException(status_code=400, detail=result["error"])
    
    target_user_id = request.user_id
    invalidate_dashboard_cache(target_user_id)

    # Trigger Notifications if Quiz was just submitted
    if request.quiz_score is not None:
        is_passed = (
            request.pass_status is True
            or (result.get("data") and result["data"].get("pass_status") is True)
        )
        import asyncio
        asyncio.create_task(_trigger_quiz_completion_notifications(
            user_id=target_user_id,
            module_id=request.module_id,
            processed_module_id=request.processed_module_id,
            quiz_score=request.quiz_score,
            max_score=request.max_score,
            pass_status=is_passed,
            company_id=auth_ctx.claims.get("company_id") if auth_ctx.claims else None
        ))

    action = result.get("action", "updated")
    message_map = {
        "created": "Module progress created successfully",
        "updated": "Module progress updated successfully",
        "view": "Module view logged (already started)",
        "no_change": "No changes to apply"
    }
    
    return {
        "message": message_map.get(action, "Module progress recorded successfully"),
        "progress": result["data"],
        "action": action
    }


@router.put("/{progress_id}")
async def update_progress_record(
    progress_id: str,
    request: UpdateProgressRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Update an existing module progress record.
    Permission: Self (for own progress) OR manager+ in same company.
    """
    update_data = request.dict(exclude_none=True)
    
    if not update_data:
        raise HTTPException(status_code=400, detail="No update data provided")
    
    result = await update_progress(user_id, progress_id, update_data)
    
    if result["error"]:
        status_code = 404 if "not found" in result["error"].lower() else 403
        raise HTTPException(status_code=status_code, detail=result["error"])
    
    progress = result["data"]

    target_user_id = progress.get("user_id")
    processed_module_id = progress.get("processed_module_id")

    if target_user_id:
        invalidate_dashboard_cache(target_user_id)
        
        # Trigger Notifications if Quiz was just submitted
        if request.quiz_score is not None:
            is_passed = (
                request.pass_status is True
                or (progress and progress.get("pass_status") is True)
            )
            import asyncio
            asyncio.create_task(_trigger_quiz_completion_notifications(
                user_id=target_user_id,
                module_id=progress.get("module_id"),
                processed_module_id=processed_module_id,
                quiz_score=request.quiz_score,
                max_score=request.max_score if hasattr(request, "max_score") else None,
                pass_status=is_passed,
                company_id=auth_ctx.claims.get("company_id") if auth_ctx.claims else None
            ))
    
    return {
        "message": "Module progress updated successfully",
        "progress": result["data"]
    }


@router.delete("/{progress_id}")
async def delete_progress_record(
    progress_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Delete a module progress record.
    Permission: Manager+ in same company (for data cleanup).
    """
    existing_progress = await get_progress_by_id(
        user_id,
        progress_id
    )
    result = await delete_progress(user_id, progress_id)
    target_user_id = None
    processed_module_id = None

    if existing_progress.get("data"):
        target_user_id = (
            existing_progress["data"]
            .get("user_id")
        )

        processed_module_id = (
            existing_progress["data"]
            .get("processed_module_id")
        )
    
    if result["error"]:
        status_code = 404 if "not found" in result["error"].lower() else 403
        raise HTTPException(status_code=status_code, detail=result["error"])
    
    if target_user_id:
        invalidate_dashboard_cache(target_user_id)
    
    return {
        "message": "Module progress deleted successfully",
        "progress": result["data"]
    }
