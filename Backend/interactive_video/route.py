"""
FastAPI router for interactive video operations.
Exposes endpoints for starting jobs, polling status, getting course manifests,
and submitting quiz attempts.
"""
from __future__ import annotations
import datetime
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from utils.auth import RequestAuth, get_request_auth_required
from utils.supabase_client import supabase

from .models import StartJobRequest, SubmitQuizRequest, QuizResult
from .pipeline import run_pipeline, WORKER_NAMES

router = APIRouter(prefix="/api/interactive-video", tags=["interactive-video"])

@router.post("/start")
async def start_job(
    request: StartJobRequest,
    background_tasks: BackgroundTasks,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    """
    Enqueues/starts an interactive video creation job for the given processed_module_id.
    """
    module_id = request.processed_module_id
    
    # 1. Verify module exists and user is manager+ in same company
    module_resp = supabase.table("processed_modules").select("processed_module_id").eq("processed_module_id", module_id).maybe_single().execute()
    if not module_resp.data:
        raise HTTPException(status_code=404, detail="Processed module not found")
        
    # 2. Check if a job is already running
    if not request.force_regenerate:
        existing = supabase.table("interactive_video_jobs").select("*")\
            .eq("processed_module_id", module_id)\
            .in_("status", ["pending", "w1_parsing", "w2_topics", "w3_designing", "w4_storyboarding", "w5_slides", "w6_voice", "w7_avatar", "w8_quiz", "w9_publishing"])\
            .limit(1).execute()
        if existing.data:
            return {
                "message": "Job already in progress",
                "job_id": existing.data[0]["id"],
                "status": existing.data[0]["status"]
            }

    # 3. Create a new job record
    job_resp = supabase.table("interactive_video_jobs").insert({
        "processed_module_id": module_id,
        "status": "pending",
        "current_worker": 1
    }).execute()
    
    if not job_resp.data:
        raise HTTPException(status_code=500, detail="Failed to create job record")
        
    job_id = job_resp.data[0]["id"]
    
    # 4. Trigger the background orchestrator task
    background_tasks.add_task(run_pipeline, job_id, module_id)
    
    return {
        "message": "Interactive video generation started",
        "job_id": job_id,
        "status": "pending"
    }

@router.get("/status/{job_id}")
async def get_job_status(
    job_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    """Returns the status and current worker progress of a job."""
    job_resp = supabase.table("interactive_video_jobs").select("*").eq("id", job_id).maybe_single().execute()
    if not job_resp.data:
        raise HTTPException(status_code=404, detail="Job not found")
        
    job = job_resp.data
    worker_name = WORKER_NAMES.get(job["current_worker"], "Unknown")
    
    return {
        "job_id": job["id"],
        "processed_module_id": job["processed_module_id"],
        "status": job["status"],
        "current_worker": job["current_worker"],
        "worker_name": worker_name,
        "error": job.get("error"),
        "job_metadata": job.get("job_metadata", {}),
        "created_at": job["created_at"],
        "updated_at": job["updated_at"]
    }

@router.get("/course/{module_id}")
async def get_course_manifest(
    module_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    """
    Fetches the interactive video course manifest for a module.
    Works with both original_module_id and processed_module_id.
    """
    # 1. Try directly fetching by processed_module_id
    course_resp = supabase.table("interactive_video_courses").select("*").eq("processed_module_id", module_id).maybe_single().execute()
    
    # 2. If not found, look up processed_module_id from original_module_id
    if not course_resp.data:
        pm_resp = supabase.table("processed_modules").select("processed_module_id").eq("original_module_id", module_id).limit(1).execute()
        if pm_resp.data:
            actual_id = pm_resp.data[0]["processed_module_id"]
            course_resp = supabase.table("interactive_video_courses").select("*").eq("processed_module_id", actual_id).maybe_single().execute()
            
    if not course_resp.data:
        # Check if there is an in-progress job
        job_resp = supabase.table("interactive_video_jobs").select("id, status")\
            .eq("processed_module_id", module_id)\
            .order("created_at", desc=True)\
            .limit(1).execute()
        
        job_status = job_resp.data[0] if job_resp.data else None
        
        return JSONResponse(
            status_code=404,
            content={
                "error": "Interactive course not found",
                "in_progress_job": job_status
            }
        )
        
    return course_resp.data["manifest"]

@router.post("/quiz-attempt")
async def submit_quiz_attempt(
    request: SubmitQuizRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    """
    Tracks and validates a user's quiz attempt on a course segment.
    Updates the user's module progress in the database.
    
    Gating Rules:
    - 80% and above correct -> passed = True
    - Less than 80% correct -> passed = False
    - If passed = False and attempts reach limit (e.g. 2 attempts) -> should_replay = True and returns replay_segment_id
    """
    user_id = auth_ctx.user_id
    module_id = request.processed_module_id
    segment_id = request.segment_id
    answers = request.answers  # list of {"question_id": str, "chosen_index": int}
    
    # 1. Fetch course manifest
    course_resp = supabase.table("interactive_video_courses").select("manifest").eq("processed_module_id", module_id).maybe_single().execute()
    if not course_resp.data:
        raise HTTPException(status_code=404, detail="Interactive course not found")
        
    manifest = course_resp.data["manifest"]
    segments = manifest.get("segments", [])
    
    # Find quiz segment
    quiz_segment = next((s for s in segments if s["id"] == segment_id and s["type"] == "quiz_gate"), None)
    if not quiz_segment:
        raise HTTPException(status_code=404, detail="Quiz segment not found")
        
    quiz_data = quiz_segment.get("quiz", {})
    questions = quiz_data.get("questions", [])
    pass_threshold = quiz_data.get("pass_threshold", 0.8)
    max_attempts = quiz_data.get("max_attempts", 2)
    replay_segment_id = quiz_data.get("replay_segment_id")
    
    # 2. Evaluate answers
    correct_count = 0
    feedback = []
    answers_dict = {a["question_id"]: a["chosen_index"] for a in answers}
    
    for q in questions:
        q_id = q["id"]
        correct_idx = q["correct"]
        chosen_idx = answers_dict.get(q_id)
        
        is_correct = chosen_idx == correct_idx
        if is_correct:
            correct_count += 1
            
        feedback.append({
            "question_id": q_id,
            "text": q["text"],
            "chosen_index": chosen_idx,
            "correct_index": correct_idx,
            "is_correct": is_correct,
            "explanation": q["explanation"]
        })
        
    total_questions = len(questions)
    score = correct_count / total_questions if total_questions > 0 else 1.0
    passed = score >= pass_threshold
    
    # 3. Retrieve or create module progress
    progress_resp = supabase.table("module_progress").select("*").eq("user_id", user_id).eq("processed_module_id", module_id).maybe_single().execute()
    
    if progress_resp.data:
        progress = progress_resp.data
        progress_id = progress["module_progress_id"]
        # Parse existing attempts/feedback
        try:
            feedback_data = progress.get("quiz_feedback")
            if isinstance(feedback_data, str):
                import json
                feedback_data = json.loads(feedback_data)
        except Exception:
            feedback_data = {}
            
        if not isinstance(feedback_data, dict):
            feedback_data = {}
            
        attempts_key = f"attempts_{segment_id}"
        attempts_history = feedback_data.get(attempts_key, [])
        attempt_num = len(attempts_history) + 1
        
        # Add new attempt
        attempts_history.append({
            "attempt_number": attempt_num,
            "score": score,
            "correct": correct_count,
            "passed": passed,
            "timestamp": datetime.datetime.utcnow().isoformat()
        })
        feedback_data[attempts_key] = attempts_history
        
        # Check replay condition
        should_replay = False
        if not passed and attempt_num >= max_attempts:
            should_replay = True
            # Reset attempts so they can try again after replay
            feedback_data[attempts_key] = []
            
        # Update progress record
        update_payload = {
            "quiz_feedback": feedback_data
        }
        
        # If passed all checks, or if it's the final module quiz, we can update overall pass/completed status
        # For simplicity, if this is the last quiz or all quizzes are passed, we mark module pass_status
        all_passed = True
        for s in segments:
            if s["type"] == "quiz_gate":
                s_id = s["id"]
                # It passes if the current attempt passes, or if a previous attempt passed
                is_this_passed = passed if s_id == segment_id else False
                prev_attempts = feedback_data.get(f"attempts_{s_id}", [])
                has_prev_passed = any(att.get("passed", False) for att in prev_attempts)
                if not (is_this_passed or has_prev_passed):
                    all_passed = False
                    break
                    
        if all_passed:
            update_payload["pass_status"] = True
            update_payload["completed_at"] = datetime.datetime.utcnow().isoformat()
            # Calculate composite score percentage
            update_payload["quiz_score"] = int(score * 100)
            
        supabase.table("module_progress").update(update_payload).eq("module_progress_id", progress_id).execute()
        
    else:
        # Create a new record
        attempt_num = 1
        feedback_data = {
            f"attempts_{segment_id}": [{
                "attempt_number": 1,
                "score": score,
                "correct": correct_count,
                "passed": passed,
                "timestamp": datetime.datetime.utcnow().isoformat()
            }]
        }
        
        should_replay = not passed and attempt_num >= max_attempts
        
        insert_payload = {
            "user_id": user_id,
            "processed_module_id": module_id,
            "started_at": datetime.datetime.utcnow().isoformat(),
            "quiz_feedback": feedback_data
        }
        
        # Check if this is the only quiz and is passed
        all_passed = passed and (quiz_gates_count := sum(1 for s in segments if s["type"] == "quiz_gate")) == 1
        if all_passed:
            insert_payload["pass_status"] = True
            insert_payload["completed_at"] = datetime.datetime.utcnow().isoformat()
            insert_payload["quiz_score"] = int(score * 100)
            
        supabase.table("module_progress").insert(insert_payload).execute()

    return {
        "segment_id": segment_id,
        "total_questions": total_questions,
        "correct": correct_count,
        "score": score,
        "passed": passed,
        "attempt_number": attempt_num,
        "should_replay": should_replay,
        "replay_segment_id": replay_segment_id,
        "feedback": feedback
    }
