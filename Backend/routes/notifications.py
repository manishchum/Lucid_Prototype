from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Literal

from utils.assignment_notifications import send_bulk_assignment_notification_emails
from utils.supabase_client import supabase


router = APIRouter(prefix="/api/notifications", tags=["notifications"])


class AssignmentNotificationRequest(BaseModel):
    assignment_type: Literal["sprint", "roleplay"]
    assignment_title: str
    company_id: str
    target_type: Literal["user", "department", "sub_department"]
    target_ids: List[str]
    frontend_url: str | None = None


@router.post("/assignment")
async def send_assignment_notification(request: AssignmentNotificationRequest):
    if not request.target_ids:
        raise HTTPException(status_code=400, detail="target_ids is required")

    try:
        query = (
            supabase
            .table("users")
            .select("user_id, email, name")
            .eq("company_id", request.company_id)
            .eq("is_active", True)
        )

        if request.target_type == "user":
            query = query.in_("user_id", request.target_ids)
        elif request.target_type == "sub_department":
            query = query.in_("department_id", request.target_ids)
        else:
            selected_departments = (
                supabase
                .table("sub_department")
                .select("department_name")
                .in_("department_id", request.target_ids)
                .execute()
            )
            department_names = list({
                row.get("department_name")
                for row in (selected_departments.data or [])
                if row.get("department_name")
            })

            if not department_names:
                return {
                    "success": True,
                    "sent_count": 0,
                    "failed_count": 0,
                    "message": "No matching departments found",
                }

            all_subdepartments = (
                supabase
                .table("sub_department")
                .select("department_id")
                .in_("department_name", department_names)
                .execute()
            )
            all_department_ids = [
                row.get("department_id")
                for row in (all_subdepartments.data or [])
                if row.get("department_id")
            ]

            if not all_department_ids:
                return {
                    "success": True,
                    "sent_count": 0,
                    "failed_count": 0,
                    "message": "No matching recipients found",
                }

            query = query.in_("department_id", all_department_ids)

        result = query.execute()
        recipients = result.data or []

        if not recipients:
            return {
                "success": True,
                "sent_count": 0,
                "failed_count": 0,
                "message": "No matching recipients found",
            }

        company_result = (
            supabase
            .table("companies")
            .select("name")
            .eq("company_id", request.company_id)
            .single()
            .execute()
        )
        company_name = (company_result.data or {}).get("name", "Your company")

        notification_result = await send_bulk_assignment_notification_emails(
            recipients=recipients,
            assignment_title=request.assignment_title,
            company_name=company_name,
            assignment_kind=request.assignment_type,
            frontend_url=request.frontend_url,
        )

        return {
            "success": True,
            "message": f"Sent assignment notifications to {notification_result['sent_count']} recipient(s)",
            **notification_result,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))