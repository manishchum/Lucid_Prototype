from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request

from utils.auth import RequestAuth, get_request_auth_required
from .models import SubmissionCreate, TaskCreate, TaskListResponse, TaskReassignPayload
from . import service

router = APIRouter()


def get_company_id(
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    x_company_id: Optional[str] = Header(None, alias="X-Company-ID"),
) -> str:
    company_id = service.resolve_company_id(auth_ctx.user_id, x_company_id)
    if not company_id:
        raise HTTPException(status_code=400, detail="Company ID is required")
    return company_id


@router.get("/task-manager/tasks", response_model=TaskListResponse)
def list_tasks(
    request: Request,
    company_id: str = Depends(get_company_id),
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    try:
        tasks = service.get_active_tasks(company_id, auth_ctx.user_id)
        return {"tasks": tasks, "total": len(tasks)}
    except Exception as exc:
        # Enhanced logging to assist debugging when browser requests produce 500.
        import traceback
        tb = traceback.format_exc()
        try:
            headers = {k: v for k, v in request.headers.items()}
        except Exception:
            headers = {}
        print("[task-manager] list_tasks exception:\n", tb)
        print("[task-manager] request headers:", headers)
        # Re-raise as HTTPException so FastAPI returns a JSON response (global handler will apply CORS)
        raise HTTPException(status_code=500, detail="Internal Server Error") from exc


@router.get("/task-manager/tasks/user/{user_id}")
def list_tasks_for_user(
    user_id: str,
    company_id: str = Depends(get_company_id),
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    if auth_ctx.user_id and str(user_id) != str(auth_ctx.user_id):
        raise HTTPException(status_code=403, detail="user_id does not match authenticated token")

    try:
        tasks = service.get_tasks_for_user(user_id, company_id)
        return {"tasks": tasks, "total": len(tasks)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/task-manager/tasks", status_code=201)
def create_task(
    payload: TaskCreate,
    company_id: str = Depends(get_company_id),
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    try:
        if not payload.created_by and auth_ctx.user_id:
            payload.created_by = auth_ctx.user_id
        created = service.create_task_and_assignment(payload, company_id)
        return created
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/task-manager/tasks/submit", status_code=201)
def submit_task(
    payload: SubmissionCreate,
    company_id: str = Depends(get_company_id),
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    if auth_ctx.user_id and str(payload.user_id) != str(auth_ctx.user_id):
        raise HTTPException(
            status_code=403,
            detail="user_id does not match authenticated token"
        )

    try:
        result = service.submit_task_response(
            payload,
            company_id
        )

        return result

    except Exception as exc:

        if "already submitted" in str(exc).lower():
            raise HTTPException(
                status_code=409,
                detail=str(exc)
            )

        raise HTTPException(
            status_code=500,
            detail=str(exc)
        )


@router.get("/task-manager/tasks/report/{assignment_id}")
def get_report(
    assignment_id: str,
    company_id: str = Depends(get_company_id),
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    try:
        return service.get_report_summary(assignment_id, company_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/task-manager/tasks/submissions")
def list_submissions(
    assignment_id: Optional[str] = None,
    user_id: Optional[str] = None,
    company_id: str = Depends(get_company_id),
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    # Validate user_id if provided — ensure caller is requesting their own data
    if user_id and auth_ctx.user_id and str(user_id) != str(auth_ctx.user_id):
        # Allow admins/managers in future, but for now enforce same-user access
        raise HTTPException(status_code=403, detail="user_id does not match authenticated token")

    try:
        rows = service.fetch_task_submissions(company_id, assignment_id, user_id)
        return {"submissions": rows, "total": len(rows)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/task-manager/audience/functions")
def list_functions(
    company_id: str = Depends(get_company_id), 
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    try:
        return service.get_audience_functions(company_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/task-manager/audience/sub-functions/{function_id}")
def list_sub_functions(
    function_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    try:
        return service.get_audience_sub_functions(
            function_id
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=str(exc)
        )


@router.get("/task-manager/audience/cohorts")
def list_cohorts(
    company_id: str = Depends(get_company_id), 
    auth_ctx: RequestAuth = Depends(get_request_auth_required),):
    try:
        return service.get_audience_cohorts(company_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/task-manager/audience/members")
def list_members(
    company_id: str = Depends(get_company_id), 
    auth_ctx: RequestAuth = Depends(get_request_auth_required),):
    try:
        return service.get_audience_members(company_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/task-manager/tasks/{assignment_id}", status_code=200)
def delete_task(
    assignment_id: str,
    company_id: str = Depends(get_company_id),
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    try:
        success = service.delete_task_assignment(assignment_id, company_id)
        return {"success": success}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/task-manager/tasks/reassign", status_code=200)
def reassign_task(
    payload: TaskReassignPayload,
    company_id: str = Depends(get_company_id),
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    try:
        updated = service.reassign_task_assignment(
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
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

