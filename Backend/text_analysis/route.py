import os
import json
import uuid
from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException, BackgroundTasks
from pydantic import BaseModel
from google import genai
from google.genai import types

from utils.supabase_client import supabase
from utils.auth import RequestAuth, get_request_auth_required
from task_manager import service

router = APIRouter()

# Initialize Gemini Client using GEMINI_API_KEY
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY") or "") if os.getenv("GEMINI_API_KEY") else None

def get_company_id(
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    x_company_id: Optional[str] = Header(None, alias="X-Company-ID"),
) -> str:
    company_id = service.resolve_company_id(auth_ctx.user_id, x_company_id)
    if not company_id:
        raise HTTPException(status_code=400, detail="Company ID is required")
    return company_id

class AnswerItem(BaseModel):
    question_id: str
    question: str
    selected_option: str
    correct_answer: str

class TextAnalysisRequest(BaseModel):
    assignment_id: str
    task_id: str
    submission_type: str  # "text" or "multiple_choice"
    text_response: Optional[str] = None
    answers: Optional[List[AnswerItem]] = None

@router.post("/submit")
async def submit_text_analysis(
    payload: TextAnalysisRequest,
    background_tasks: BackgroundTasks,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    company_id: str = Depends(get_company_id)
):
    user_id = auth_ctx.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="User not authenticated")

    submission_type = payload.submission_type.lower()
    
    resolved_task_id = payload.task_id
    is_bundle_submission = False
    if payload.task_id and "-" in payload.task_id:
        parts = payload.task_id.rsplit("-", 1)
        if parts[1].isdigit() or parts[1] in ["image", "text", "audio", "video", "multiple_choice"]:
            resolved_task_id = parts[0]
            is_bundle_submission = True
    if submission_type not in ("text", "multiple_choice"):
        raise HTTPException(status_code=400, detail="Invalid submission type. Must be 'text' or 'multiple_choice'.")

    # 1. Fetch existing submission to check if already completed for this format
    existing_row = None
    if payload.task_id and user_id:
        existing_res = (
            supabase
            .table("task_submissions")
            .select("*")
            .eq("task_id", resolved_task_id)
            .eq("user_id", user_id)
            .execute()
        )
        rows = existing_res.data or []
        if is_bundle_submission:
            for row in rows:
                answers = row.get("answers") or []
                if any(isinstance(ans, dict) and ans.get("child_task_id") == payload.task_id for ans in answers):
                    existing_row = row
                    break
            if not existing_row and rows:
                existing_row = rows[0]
        else:
            existing_row = rows[0] if rows else None

    if existing_row:
        is_completed = False
        if is_bundle_submission:
            answers = existing_row.get("answers") or []
            if any(isinstance(ans, dict) and ans.get("child_task_id") == payload.task_id for ans in answers):
                is_completed = True
        else:
            if submission_type == "text" and existing_row.get("text_response"):
                is_completed = True
            elif submission_type == "multiple_choice" and existing_row.get("answers"):
                is_completed = True
            
        if is_completed:
            raise HTTPException(status_code=409, detail="Task already completed")

    submission_id = existing_row["submission_id"] if existing_row else str(uuid.uuid4())

    # 2. Prepare insert/update data with pending status
    insert_data = {
        "submission_id": submission_id,
        "company_id": company_id,
        "task_id": resolved_task_id,
        "user_id": user_id,
        "assignment_id": payload.assignment_id,
        "submission_type": payload.submission_type,
        "text_response": payload.text_response if submission_type == "text" else None,
        "answers": [a.model_dump() for a in payload.answers] + ([{"child_task_id": payload.task_id}] if is_bundle_submission else []) if submission_type == "multiple_choice" and payload.answers else ([{"child_task_id": payload.task_id}] if is_bundle_submission else []),
        "score": 0,
        "max_score": len(payload.answers) if submission_type == "multiple_choice" and payload.answers else 100,
        "ai_validation_pass": False,
        "ai_validation_verdict": "PENDING",
        "ai_validation_reason": "AI evaluation is running in background...",
        "ai_validation_suggestion": "",
        "ai_validation_confidence": "medium",
        "ai_status": "pending",
        "analysis_status": "pending",
        "status": "submitted",
        "submitted_at": datetime.utcnow().isoformat()
    }

    if not existing_row:
        try:
            result = (
                supabase
                .table("task_submissions")
                .insert(insert_data)
                .execute()
            )
        except Exception as e:
            err_msg = str(e).lower()
            if "duplicate key" in err_msg or "23505" in err_msg or "already exists" in err_msg:
                # Retrieve the row that was just inserted by the concurrent request
                existing_res = (
                    supabase
                    .table("task_submissions")
                    .select("*")
                    .eq("task_id", resolved_task_id)
                    .eq("user_id", user_id)
                    .execute()
                )
                rows = existing_res.data or []
                if is_bundle_submission:
                    for row in rows:
                        answers = row.get("answers") or []
                        if any(isinstance(ans, dict) and ans.get("child_task_id") == payload.task_id for ans in answers):
                            existing_row = row
                            break
                    if not existing_row and rows:
                        existing_row = rows[0]
                else:
                    existing_row = rows[0] if rows else None
                if not existing_row:
                    raise HTTPException(status_code=500, detail=str(e))
            else:
                raise HTTPException(status_code=500, detail=str(e))

    if existing_row:
        update_data = {}
        for field in ["text_response", "answers", "score", "max_score", "ai_validation_pass",
                      "ai_validation_verdict", "ai_validation_reason", "ai_validation_suggestion",
                      "ai_validation_confidence", "ai_status", "analysis_status", "status",
                      "submission_type", "submitted_at"]:
            val = insert_data.get(field)
            if val is not None:
                # Merge answers to avoid overwriting existing ones for other subtasks
                if field == "answers" and is_bundle_submission and existing_row.get("answers"):
                    existing_answers = existing_row.get("answers") or []
                    # Keep old answers, but filter out the ones for this child_task_id if updating
                    merged_answers = [a for a in existing_answers if not (isinstance(a, dict) and a.get("child_task_id") == payload.task_id)]
                    merged_answers.extend(val)
                    update_data[field] = merged_answers
                else:
                    update_data[field] = val
        
        result = (
            supabase
            .table("task_submissions")
            .update(update_data)
            .eq("submission_id", existing_row["submission_id"])
            .execute()
        )
        submission_id = existing_row["submission_id"]

    # 3. Queue background task
    from analysis.background import run_ai_pipeline_bg
    background_tasks.add_task(
        run_ai_pipeline_bg,
        submission_id,
        company_id,
        payload.task_id,
        payload.submission_type,
        payload.text_response if submission_type == "text" else [a.model_dump() for a in payload.answers] if payload.answers else []
    )

    return {
        "status": "success",
        "message": "Task submitted successfully",
        "submission_id": submission_id
    }

