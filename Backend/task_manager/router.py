from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, BackgroundTasks

from utils.auth import RequestAuth, get_request_auth_required, get_effective_company_id, require_addon
from utils.exceptions import ApiException
from .models import SubmissionCreate, TaskCreate, TaskListResponse, TaskReassignPayload
from . import service

router = APIRouter(dependencies=[Depends(require_addon("task_management"))])


@router.get("/task-manager/tasks", response_model=TaskListResponse)
async def list_tasks(
    request: Request,
    company_id: str = Depends(get_effective_company_id),
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    try:
        tasks = await service.get_active_tasks(company_id, auth_ctx.user_id)
        return {"tasks": tasks, "total": len(tasks)}
    except ApiException:
        raise
    except Exception as exc:
        import traceback
        tb = traceback.format_exc()
        try:
            headers = {k: v for k, v in request.headers.items()}
        except Exception:
            headers = {}
        print("[task-manager] list_tasks exception:\n", tb)
        print("[task-manager] request headers:", headers)
        raise HTTPException(status_code=500, detail="Internal Server Error") from exc


@router.get("/task-manager/tasks/user/{user_id}")
async def list_tasks_for_user(
    user_id: str,
    company_id: str = Depends(get_effective_company_id),
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    try:
        tasks = await service.get_tasks_for_user(user_id, company_id, auth_ctx.user_id)
        return {"tasks": tasks, "total": len(tasks)}
    except ApiException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/task-manager/tasks", status_code=201)
async def create_task(
    payload: TaskCreate,
    company_id: str = Depends(get_effective_company_id),
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    try:
        if not payload.created_by and auth_ctx.user_id:
            payload.created_by = auth_ctx.user_id
        created = await service.create_task_and_assignment(payload, company_id, auth_ctx.user_id)
        return created
    except ApiException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/task-manager/tasks/submit", status_code=201)
async def submit_task(
    payload: SubmissionCreate,
    background_tasks: BackgroundTasks,
    company_id: str = Depends(get_effective_company_id),
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    if auth_ctx.user_id and str(payload.user_id) != str(auth_ctx.user_id):
        raise HTTPException(
            status_code=403,
            detail="user_id does not match authenticated token"
        )

    try:
        result = await service.submit_task_response(
            payload,
            company_id,
            background_tasks,
            auth_ctx.user_id
        )
        return result
    except ApiException:
        raise
    except Exception as exc:
        if "already submitted" in str(exc).lower() or "already completed" in str(exc).lower():
            raise HTTPException(
                status_code=409,
                detail=str(exc)
            )
        raise HTTPException(
            status_code=500,
            detail=str(exc)
        )


@router.get("/task-manager/tasks/report/{assignment_id}")
async def get_report(
    assignment_id: str,
    company_id: str = Depends(get_effective_company_id),
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    try:
        return await service.get_report_summary(assignment_id, company_id, auth_ctx.user_id)
    except ApiException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/task-manager/tasks/submissions")
async def list_submissions(
    assignment_id: Optional[str] = None,
    user_id: Optional[str] = None,
    company_id: str = Depends(get_effective_company_id),
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    caller_is_admin = await service.is_user_admin(auth_ctx.user_id)
    try:
        rows = await service.fetch_task_submissions(
            company_id=company_id,
            assignment_id=assignment_id,
            user_id=user_id,
            caller_is_admin=caller_is_admin,
            requesting_user_id=auth_ctx.user_id
        )
        return {"submissions": rows, "total": len(rows)}
    except ApiException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))



@router.get("/task-manager/audience/functions")
async def list_functions(
    company_id: str = Depends(get_effective_company_id), 
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    try:
        return await service.get_audience_functions(company_id, auth_ctx.user_id)
    except ApiException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/task-manager/audience/sub-functions/{function_id}")
async def list_sub_functions(
    function_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    try:
        return await service.get_audience_sub_functions(function_id, auth_ctx.user_id)
    except ApiException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=str(exc)
        )


@router.get("/task-manager/audience/cohorts")
async def list_cohorts(
    company_id: str = Depends(get_effective_company_id), 
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    try:
        return await service.get_audience_cohorts(company_id, auth_ctx.user_id)
    except ApiException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/task-manager/audience/members")
async def list_members(
    company_id: str = Depends(get_effective_company_id), 
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    try:
        return await service.get_audience_members(company_id, auth_ctx.user_id)
    except ApiException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/task-manager/tasks/{assignment_id}", status_code=200)
async def delete_task(
    assignment_id: str,
    company_id: str = Depends(get_effective_company_id),
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    try:
        success = await service.delete_task_assignment(assignment_id, company_id, auth_ctx.user_id)
        return {"success": success}
    except ApiException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/task-manager/tasks/reassign", status_code=200)
async def reassign_task(
    payload: TaskReassignPayload,
    company_id: str = Depends(get_effective_company_id),
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    try:
        updated = await service.reassign_task_assignment(
            company_id=company_id,
            original_assignment_id=payload.original_assignment_id,
            mode=payload.mode,
            level=payload.level,
            target_sprints=payload.target_sprints,
            target_orgs=payload.target_orgs,
            target_functions=payload.target_functions,
            target_sub_functions=payload.target_sub_functions,
            target_individuals=payload.target_individuals,
            due_date=str(payload.due_date),
            recurrence=payload.recurrence,
            created_by=auth_ctx.user_id,
        )
        return updated
    except ApiException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
