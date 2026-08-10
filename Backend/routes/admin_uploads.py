from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from utils.supabase_client import supabase_admin
from typing import List, Optional
import asyncio, httpx
from utils.auth import (
    RequestAuth,
    get_request_auth_required
)
router = APIRouter(
    prefix="/api/admin/uploads",
    tags=["Admin Uploads"]
)


@router.get("/validate-reviewer")
async def validate_reviewer(
    email: str,
    company_id: str
):
    """
    Validate reviewer email belongs to company
    """
    cleaned_email = (email or "").strip().lower()
    if not cleaned_email:
        raise HTTPException(
            status_code=400,
            detail="Email is required"
        )

    try:
        # Try matching email case-insensitively for the company
        result = (
            supabase_admin
            .table("users")
            .select("user_id,name,email,company_id,is_active")
            .ilike("email", cleaned_email)
            .eq("company_id", company_id)
            .neq("is_active", False)
            .limit(1)
            .execute()
        )

        if not result.data:
            # Fallback: check without is_active filter in company
            result = (
                supabase_admin
                .table("users")
                .select("user_id,name,email,company_id")
                .ilike("email", cleaned_email)
                .eq("company_id", company_id)
                .limit(1)
                .execute()
            )

        if not result.data:
            # Fallback: system-wide lookup by email (e.g. superadmin/cross-company reviewer)
            result = (
                supabase_admin
                .table("users")
                .select("user_id,name,email,company_id")
                .ilike("email", cleaned_email)
                .limit(1)
                .execute()
            )

        if not result.data:
            raise HTTPException(
                status_code=404,
                detail="Reviewer not found"
            )

        user = result.data[0]

        return {
            "valid": True,
            "reviewer": {
                "user_id": user["user_id"],
                "name": user.get("name"),
                "email": user["email"]
            }
        }

    except HTTPException:
        raise

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=str(e)
        )
        
@router.get("/modules/{module_id}/assignment-count")
async def get_module_assignment_count(
    module_id: str
):
    """
    Returns number of users assigned to a sprint
    """

    try:

        result = (
            supabase_admin
            .table("learning_plan")
            .select(
                "learning_plan_id",
                count="exact"
            )
            .eq("module_id", module_id)
            .execute()
        )

        return {
            "count": result.count or 0
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch assignment count: {str(e)}"
        )
        
@router.get("/company/{company_id}/modules")
async def get_company_modules(
    company_id: str
):
    """
    Returns training modules with computed processing status
    """

    try:

        modules_result = (
            supabase_admin
            .table("training_modules")
            .select("""
                module_id, company_id, title, description, content_type, content_url, gpt_summary, created_at, ai_modules, ai_topics, ai_objectives, processing_status, threshold_value, review_stage, reviewer_id, uploaded_by, additional_readings, source_files, ingestion_status, page_count, match_chunks,
                reviewer:users!training_modules_reviewer_id_fkey(user_id, name, email),
                uploader:users!training_modules_uploaded_by_fkey(user_id, name, email)
            """)
            .eq("company_id", company_id)
            .order("created_at", desc=True)
            .execute()
        )

        modules = modules_result.data or []

        jobs_result = (
            supabase_admin
            .table("content_jobs")
            .select("id, module_id, status, created_at, updated_at")
            .limit(1000)
            .execute()
        )

        jobs = jobs_result.data or []

        jobs_map = {
            job["module_id"]: job
            for job in jobs
            if job.get("module_id")
        }

        modules_with_status = []

        for module in modules:

            final_status = module.get("processing_status")

            job = jobs_map.get(
                module.get("module_id")
            )

            if job:

                if job["status"] == "completed":
                    final_status = "completed"

                elif job["status"] == "failed":
                    final_status = "failed"

                elif job["status"] in [
                    "in_progress",
                    "in-progress"
                ]:
                    final_status = "processing"

                else:
                    final_status = "pending"

            else:
                final_status = (
                    final_status
                    or "processing"
                )

            if final_status != module.get("processing_status"):

                (
                    supabase_admin
                    .table("training_modules")
                    .update({
                        "processing_status": final_status
                    })
                    .eq(
                        "module_id",
                        module["module_id"]
                    )
                    .execute()
                )

                module["processing_status"] = final_status

            modules_with_status.append(
                module
            )

        return {
            "modules": modules_with_status
        }

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=f"Failed to load modules: {str(e)}"
        )
        
@router.post("/create-sprint")
async def create_sprint(
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    company_id: str = Form(...),
    title: str = Form(...),
    description: str = Form(""),
    threshold_value: int = Form(70),
    reviewer_id: Optional[str] = Form(None),
    additional_readings: Optional[str] = Form(None),
    files: List[UploadFile] = File(...)
):
    """
    Sprint creation orchestration endpoint
    """

    try:

        source_files = []

        for file in files:

            source_files.append(
                file.filename
            )

        module_insert = (
            supabase_admin
            .table("training_modules")
            .insert({
                "company_id": company_id,
                "title": title,
                "description": description,
                "processing_status": "pending",
                "threshold_value": threshold_value,
                "uploaded_by": auth_ctx.user_id,
                "reviewer_id": reviewer_id,
                "additional_readings": additional_readings,
                "source_files": source_files
            })
            .execute()
        )

        if not module_insert.data:
            raise HTTPException(
                status_code=500,
                detail="Failed to create sprint"
            )
            
        file_payloads = []
        for file in files:
            file.file.seek(0)
            file_payloads.append({
                "filename": file.filename,
                "content_type": file.content_type,
                "content": await file.read()
            })

        module = module_insert.data[0]
        
        asyncio.create_task(
            process_sprint(
                module["module_id"],
                file_payloads
            )
        )

        return {
            "success": True,
            "module_id": module["module_id"],
            "module": module
        }

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )
        
async def process_sprint(
    module_id: str,
    files: List[dict]
):

    try:

        # ---------------------------------
        # processing
        # ---------------------------------

        (
            supabase_admin
            .table("training_modules")
            .update({
                "processing_status": "processing"
            })
            .eq("module_id", module_id)
            .execute()
        )

        # ---------------------------------
        # call existing OpenAI/Gemini pipeline
        # ---------------------------------

        form_data = httpx.AsyncClient()

        async with httpx.AsyncClient(
            timeout=None
        ) as client:

            multipart_files = []

            for file in files:
                multipart_files.append(
                    (
                        "files",
                        (
                            file["filename"],
                            file["content"],
                            file["content_type"]
                        )
                    )
                )
            
            response = await client.post(
                "http://127.0.0.1:8000/api/openai-upload/file",
                data={
                    "moduleId": module_id
                },
                files=multipart_files
            )

            if response.status_code >= 400:

                raise Exception(
                    response.text
                )

        # ---------------------------------
        # completed
        # ---------------------------------

        (
            supabase_admin
            .table("training_modules")
            .update({
                "processing_status": "completed"
            })
            .eq("module_id", module_id)
            .execute()
        )

    except Exception as e:

        (
            supabase_admin
            .table("training_modules")
            .update({
                "processing_status": "failed"
            })
            .eq("module_id", module_id)
            .execute()
        )

        raise e