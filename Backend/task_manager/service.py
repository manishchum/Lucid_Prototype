import base64
import json
import os
import re
import tempfile
import urllib.request
from typing import Optional
from uuid import uuid4

import google.generativeai as genai

from utils.supabase_client import supabase

from .models import SubmissionCreate, TaskCreate
from audio_analysis.scoring import generate_audio_score
from audio_analysis.services.acoustic_analysis import analyze_audio_features
from audio_analysis.services.gemini_audio import analyze_audio_with_gemini
from audio_analysis.services.speech_quality import analyze_speech_quality


def _gemini_model():
    api_key = os.getenv("GEMINI_API_KEY") or ""
    if not api_key:
        return None

    genai.configure(api_key=api_key)
    return genai.GenerativeModel("gemini-3-pro-preview")


def _extract_audio_bytes(audio_input: str | None) -> tuple[bytes, str]:
    if not audio_input:
        raise ValueError("Missing audio payload")

    value = audio_input.strip()
    if value.startswith("data:"):
        header, encoded = value.split(",", 1)
        mime_type = header.split("data:", 1)[1].split(";", 1)[0] or "audio/webm"
        return base64.b64decode(encoded), mime_type

    if value.startswith("http://") or value.startswith("https://"):
        request = urllib.request.Request(value, headers={"User-Agent": "LucidBackend/1.0"})
        with urllib.request.urlopen(request, timeout=30) as response:
            mime_type = response.headers.get_content_type() or "audio/mpeg"
            return response.read(), mime_type

    return base64.b64decode(value), "audio/webm"


def _audio_suffix(mime_type: str) -> str:
    if "mpeg" in mime_type or "mp3" in mime_type:
        return ".mp3"
    if "wav" in mime_type:
        return ".wav"
    if "ogg" in mime_type:
        return ".ogg"
    if "mp4" in mime_type or "m4a" in mime_type:
        return ".m4a"
    return ".webm"


def _store_audio_media(payload: SubmissionCreate, company_id: str, submission_id: str) -> str | None:
    audio_input = payload.audio_url or payload.text_response
    if not audio_input:
        return None

    try:
        audio_bytes, mime_type = _extract_audio_bytes(audio_input)
    except Exception as exc:
        print("[task-manager] audio storage decode failed:", exc)
        return None

    bucket = os.getenv("TASK_SUBMISSIONS_BUCKET") or os.getenv("SUPABASE_TASK_SUBMISSIONS_BUCKET") or "task-submissions"
    path = "/".join([
        str(company_id),
        str(payload.assignment_id or "unassigned"),
        str(payload.user_id),
        f"{submission_id}{_audio_suffix(mime_type)}",
    ])

    try:
        supabase.storage.from_(bucket).upload(
            path,
            audio_bytes,
            file_options={
                "content-type": mime_type,
                "upsert": "true",
            },
        )
        public_url = supabase.storage.from_(bucket).get_public_url(path)
        return str(public_url) if public_url else None
    except Exception as exc:
        print("[task-manager] audio storage upload failed:", exc)
        return None


def _analyze_audio_submission(payload: SubmissionCreate, task: dict) -> dict:
    audio_input = payload.audio_url or payload.text_response
    audio_bytes, mime_type = _extract_audio_bytes(audio_input)
    prompt = (
        "You are validating an employee audio task submission.\n\n"
        f"Task title: {task.get('title', '')}\n"
        f"Task description: {task.get('description', '')}\n\n"
        "Transcribe the speech and evaluate whether the response satisfies the task. "
        "Analyze tone, professionalism, communication quality, sentence structure, "
        "language confidence, filler words, strengths, weaknesses, feedback, and "
        "improvement suggestions. Return STRICT JSON ONLY with keys: transcript, "
        "tone, communication_score, filler_words, strengths, weaknesses, feedback, "
        "improvement_suggestions. Scores must be 0-100."
    )

    gemini_result = analyze_audio_with_gemini(audio_bytes, mime_type, prompt)

    temp_path = ""
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=_audio_suffix(mime_type)) as tmp:
            tmp.write(audio_bytes)
            temp_path = tmp.name

        acoustic_result = analyze_audio_features(temp_path)
        speech_result = analyze_speech_quality(temp_path)
    finally:
        if temp_path:
            try:
                os.unlink(temp_path)
            except Exception:
                pass

    return generate_audio_score(gemini_result, acoustic_result, speech_result)


def resolve_company_id(user_id: str | None, fallback_company_id: Optional[str]) -> Optional[str]:
    if fallback_company_id:
        return fallback_company_id

    if not user_id:
        return None

    try:
        company_res = (
            supabase.table("users")
            .select("company_id")
            .eq("user_id", user_id)
            .single()
            .execute()
        )
        if company_res.data:
            return company_res.data.get("company_id")
    except Exception as lookup_error:
        print("[task-manager] Failed to resolve company_id:", lookup_error)

    return None


def get_active_tasks(company_id: str, user_id: str | None = None) -> list:
    """
    Returns active tasks with audience resolved and completion count.
    Uses v_active_assignments view (created in migration).
    """
    def _select_assignments(source_name: str, table_name: str) -> list:
        try:
            response = (
                supabase.table(table_name)
                .select("*")
                .eq("company_id", company_id)
                .execute()
            )
            return response.data or []
        except Exception as exc:
            print(f"[task-manager] {source_name} query failed:", exc)
            return []

    try:
        assignments = _select_assignments("v_active_assignments", "v_active_assignments")
    except Exception as view_error:
        print("[task-manager] Falling back to task_assignments:", view_error)
        assignments = []

    if not assignments:
        assignments = _select_assignments("task_assignments", "task_assignments")

    if not assignments:
        return []

    assignment_ids = [str(a.get("assignment_id")) for a in assignments if a.get("assignment_id")]
    if not assignment_ids:
        return []

    try:
        tasks = (
            supabase.table("tasks")
            .select(
                "task_id, assignment_id, title, description, submission_format, questions, status"
            )
            .in_("assignment_id", assignment_ids)
            .eq("company_id", company_id)
            .execute()
        ).data or []
    except Exception as task_error:
        print("[task-manager] tasks query with company filter failed, retrying without company_id:", task_error)
        try:
            tasks = (
                supabase.table("tasks")
                .select(
                    "task_id, assignment_id, title, description, submission_format, questions, status"
                )
                .in_("assignment_id", assignment_ids)
                .execute()
            ).data or []
        except Exception as retry_error:
            print("[task-manager] tasks query failed completely:", retry_error)
            tasks = []

    user_submission_map = {}
    completion_map = {}
    try:
        submission_query = (
            supabase.table("task_submissions")
            .select("*")
            .in_("assignment_id", assignment_ids)
            .eq("company_id", company_id)
        )
        if user_id:
            submission_query = submission_query.eq("user_id", user_id)
        submissions = submission_query.execute().data or []
    except Exception as submission_error:
        print("[task-manager] submissions query with company filter failed, retrying without company_id:", submission_error)
        try:
            submission_query = supabase.table("task_submissions").select("*").in_("assignment_id", assignment_ids)
            if user_id:
                submission_query = submission_query.eq("user_id", user_id)
            submissions = submission_query.execute().data or []
        except Exception as retry_error:
            print("[task-manager] submissions query failed completely:", retry_error)
            submissions = []

    for submission in submissions:
        assignment_id = submission.get("assignment_id")
        if not assignment_id:
            continue
        completion_map[assignment_id] = completion_map.get(assignment_id, 0) + 1
        if user_id and str(submission.get("user_id") or "") == str(user_id):
            user_submission_map[str(assignment_id)] = submission

    task_map = {}
    for task in tasks:
        assignment_id = str(task.get("assignment_id") or "")
        if not assignment_id:
            continue
        task_map.setdefault(assignment_id, []).append(task)

    result = []
    for assignment in assignments:
        assignment_id = str(assignment.get("assignment_id") or "")
        if not assignment_id:
            continue
        for task in task_map.get(assignment_id, []):
            # Normalize submission_format to a list for response validation
            raw_submission_format = task.get("submission_format", "text")
            if isinstance(raw_submission_format, list):
                submission_format_list = raw_submission_format
            elif raw_submission_format is None:
                submission_format_list = []
            else:
                # Coerce single-string formats into a single-item list
                submission_format_list = [raw_submission_format]

            result.append({
                "task_id": task.get("task_id"),
                "assignment_id": assignment_id,
                "company_id": company_id,
                "title": task.get("title", ""),
                "description": task.get("description", ""),
                "submission_format": submission_format_list,
                "questions": task.get("questions") or [],
                "status": assignment.get("status", "active"),
                "due_date": str(assignment.get("due_date", "")),
                "recurrence": assignment.get("recurrence", "none"),
                "level": assignment.get("level", ""),
                "audience_display_name": assignment.get("audience_display_name") or assignment.get("level", ""),
                "total_target_count": assignment.get("total_target_count", 0),
                "completion_count": completion_map.get(assignment_id, 0),
                "created_at": str(assignment.get("created_at", "")),
                "submitted": assignment_id in user_submission_map,
                "submission": user_submission_map.get(assignment_id),
            })

    return result


def get_tasks_for_user(user_id: str, company_id: str) -> list:
    """Employee view — tasks assigned to this user with urgency."""
    rows = (
        supabase.table("v_employee_task_list")
        .select("*")
        .eq("company_id", company_id)
        .execute()
    ).data or []

    # Fetch existing submissions for this user (group by assignment_id)
    try:
        submissions_res = (
            supabase.table("task_submissions")
            .select("*")
            .eq("company_id", company_id)
            .eq("user_id", user_id)
            .order("submitted_at", ascending=False)
            .execute()
        )
        submissions = submissions_res.data or []
    except Exception:
        submissions = []

    submission_by_assignment = {}
    for s in submissions:
        aid = str(s.get("assignment_id") or "")
        if not aid or aid in submission_by_assignment:
            continue
        submission_by_assignment[aid] = s

    # Only include assignments where either submitted_by matches user or submitted_by is None
    filtered = []
    for row in rows:
        try:
            if not (row.get("submitted_by") == user_id or row.get("submitted_by") is None):
                continue
        except Exception:
            continue

        assignment_id = str(row.get("assignment_id") or "")
        # Default: no submission attached
        row["submitted"] = False
        row["submission"] = None

        if assignment_id and assignment_id in submission_by_assignment:
            # Attach submission details and mark status as completed
            sub = submission_by_assignment[assignment_id]
            # Attach the entire submission row (consumer can read needed fields)
            row["submission"] = sub
            row["submitted"] = True
            # Normalize status for frontend
            row["status"] = "completed"
        else:
            row["submitted"] = False
            row["submission"] = None

        filtered.append(row)

    return filtered


def resolve_audience_count(payload: TaskCreate, company_id: str) -> int:
    base = (
        supabase.table("users")
        .select("user_id", count="exact")
        .eq("company_id", company_id)
        .eq("is_active", True)
        .eq("employment_status", "ACTIVE")
    )

    if payload.level == "cohort" and payload.target_module_id:
        learning_plan = (
            supabase.table("learning_plan")
            .select("user_id")
            .eq("module_id", payload.target_module_id)
            .in_("status", ["ASSIGNED", "IN_PROGRESS"])
            .execute()
        ).data or []
        ids = [row["user_id"] for row in learning_plan]
        if not ids:
            return 0
        res = base.in_("user_id", ids).execute()
        return res.count or 0

    if payload.level == "function" and payload.target_function_id:
        return base.eq("function_id", payload.target_function_id).execute().count or 0

    if payload.level == "sub_function" and payload.target_sub_function_id:
        return base.eq("sub_function_id", payload.target_sub_function_id).execute().count or 0

    if payload.level == "individual" and payload.target_user_ids:
        return len(payload.target_user_ids)

    if payload.level == "org":
        return base.execute().count or 0

    return 0


def create_task_and_assignment(payload: TaskCreate, company_id: str) -> dict:
    assignment_id = str(uuid4())
    task_id = str(uuid4())
    audience_count = resolve_audience_count(payload, company_id)
    # frontend sends ["image"], DB needs "image"
    submission_format = (
        payload.submission_format[0]
        if isinstance(payload.submission_format, list)
        else payload.submission_format
    )

    supabase.table("task_assignments").insert({
        "assignment_id": assignment_id,
        "company_id": company_id,
        "created_by": payload.created_by,
        "level": payload.level,
        "target_module_id": payload.target_module_id,
        "target_function_id": payload.target_function_id,
        "target_sub_function_id": payload.target_sub_function_id,
        "target_user_ids": payload.target_user_ids or None,
        "due_date": str(payload.due_date),
        "recurrence": payload.recurrence,
        "status": "active",
        "total_target_count": audience_count,
    }).execute()

    supabase.table("tasks").insert({
    "task_id": task_id,
    "company_id": company_id,
    "assignment_id": assignment_id,
    "created_by": payload.created_by,
    "title": payload.title,
    "description": payload.description,
    "submission_format": submission_format,
    "questions": [q.model_dump() for q in (payload.questions or [])],
    "status": "active",
}).execute()

    return {
        "task_id": task_id,
        "assignment_id": assignment_id,
        "company_id": company_id,
        "title": payload.title,
        "description": payload.description,
        "submission_format": submission_format,
        "questions": [q.model_dump() for q in (payload.questions or [])],
        "status": "active",
        "due_date": str(payload.due_date),
        "recurrence": payload.recurrence,
        "level": payload.level,
        "audience_display_name": payload.level,
        "total_target_count": audience_count,
        "completion_count": 0,
        "created_at": "",
    }


def submit_task_response(payload: SubmissionCreate, company_id: str) -> dict:
    submission_id = str(uuid4())

    # Prevent duplicate submissions
    # Check by assignment_id + user_id to avoid duplicate submissions for same assignment
    if payload.assignment_id:
        existing = (
            supabase
            .table("task_submissions")
            .select("submission_id")
            .eq("company_id", company_id)
            .eq("assignment_id", payload.assignment_id)
            .eq("user_id", payload.user_id)
            .execute()
        )

        if existing.data:
            raise Exception("Task already completed")

    # Fetch task details for AI evaluation
    task_res = (
        supabase
        .table("tasks")
        .select(
            "task_id, assignment_id, title, description, submission_format, questions"
        )
        .eq("task_id", payload.task_id)
        .eq("company_id", company_id)
        .maybe_single()
        .execute()
    )

    task = task_res.data or {}

    # default values
    score = int(payload.score or 0)
    max_score = int(payload.max_score or 0)

    ai_validation_pass = payload.ai_validation_pass
    ai_validation_verdict = payload.ai_validation_verdict
    ai_validation_reason = payload.ai_validation_reason
    ai_validation_suggestion = payload.ai_validation_suggestion
    ai_validation_confidence = payload.ai_validation_confidence
    ai_status = payload.ai_status
    stored_audio_url = None


    # Gemini evaluation
    if task and (
        ai_validation_pass is None
        or ai_validation_verdict is None
        or ai_validation_reason is None
    ):

        submission_type = (
            payload.submission_type or ""
        ).lower()

        model = _gemini_model()


        if model and submission_type in {
            "text",
            "multiple_choice"
        }:

            try:

                prompt = {

                    "task_title":
                        task.get("title", ""),

                    "task_description":
                        task.get(
                            "description",
                            ""
                        ),

                    "submission_type":
                        submission_type,

                    "questions":
                        task.get(
                            "questions"
                        ) or [],


                    "text_response":
                        payload.text_response,


                    "answers":
                        payload.answers or [],


                    "instructions": (
                        "Return ONLY JSON with "
                        "score,max_score,"
                        "ai_validation_pass,"
                        "ai_validation_verdict,"
                        "ai_validation_reason,"
                        "ai_validation_suggestion,"
                        "ai_validation_confidence"
                    )
                }


                response = model.generate_content(
                    json.dumps(
                        prompt,
                        ensure_ascii=False
                    )
                )

                raw_text = (
                    getattr(
                        response,
                        "text",
                        ""
                    )
                    or ""
                )

                match = re.search(
                    r"\{[\s\S]*\}",
                    raw_text
                )

                cleaned = (
                    match.group(0)
                    if match
                    else raw_text
                )

                parsed = json.loads(cleaned)


                score = int(
                    parsed.get(
                        "score",
                        score
                    )
                )


                max_score = int(
                    parsed.get(
                        "max_score",
                        max_score or 10
                    )
                )


                ai_validation_pass = bool(
                    parsed.get(
                        "ai_validation_pass"
                    )
                )


                ai_validation_verdict = str(
                    parsed.get(
                        "ai_validation_verdict"
                    )
                    or (
                        "PASS"
                        if ai_validation_pass
                        else "REVIEW"
                    )
                )


                ai_validation_reason = str(
                    parsed.get(
                        "ai_validation_reason"
                    )
                    or ""
                )


                ai_validation_suggestion = str(
                    parsed.get(
                        "ai_validation_suggestion"
                    )
                    or ""
                )


                ai_validation_confidence = str(
                    parsed.get(
                        "ai_validation_confidence"
                    )
                    or "medium"
                )

                ai_status = str(
                    parsed.get(
                        "ai_status"
                    )
                    or "completed"
                )


            except Exception as exc:

                print(
                    "[task-manager] Gemini failed:",
                    exc
                )

        if submission_type == "audio" and (payload.audio_url or payload.text_response):
            try:
                stored_audio_url = _store_audio_media(payload, company_id, submission_id)
                audio_report = _analyze_audio_submission(payload, task)
                scores = audio_report.get("scores") or {}
                overall_score = int(scores.get("overall") or score or 0)
                score = overall_score
                max_score = 100
                ai_validation_pass = overall_score >= 60
                ai_validation_verdict = "PASS" if ai_validation_pass else "REVIEW"
                ai_validation_reason = (
                    audio_report.get("feedback")
                    or "Audio submission analyzed successfully."
                )
                ai_validation_suggestion = json.dumps(
                    {
                        "transcript": audio_report.get("transcript", ""),
                        "scores": scores,
                        "audio_features": audio_report.get("audio_features", {}),
                        "tone": audio_report.get("tone", ""),
                        "filler_words": audio_report.get("filler_words", []),
                        "strengths": audio_report.get("strengths", []),
                        "weaknesses": audio_report.get("weaknesses", []),
                        "improvement_suggestions": audio_report.get("improvement_suggestions", []),
                    },
                    ensure_ascii=False,
                )
                ai_validation_confidence = (
                    "high"
                    if overall_score >= 80
                    else "medium"
                    if overall_score >= 50
                    else "low"
                )
                ai_status = "completed"
            except Exception as exc:
                print("[task-manager] audio analysis failed:", exc)
                ai_validation_pass = True
                ai_validation_verdict = "REVIEW"
                ai_validation_reason = (
                    "Audio submission recorded. AI audio analysis could not be completed."
                )
                ai_validation_suggestion = str(exc)
                ai_validation_confidence = "low"
                ai_status = "failed"


    # fallback validation

    if ai_validation_pass is None:

        if max_score > 0:

            ai_validation_pass = (
                score >= max_score
            )

        else:

            ai_validation_pass = bool(
                payload.text_response
                or payload.answers
                or payload.image_url
                or payload.audio_url
                or payload.video_url
            )


    if ai_validation_verdict is None:
        ai_validation_verdict = (
            "PASS"
            if ai_validation_pass
            else "REVIEW"
        )


    if ai_validation_reason is None:
        ai_validation_reason = (
            "Submission recorded successfully."
        )


    if ai_validation_suggestion is None:
        ai_validation_suggestion = ""


    if ai_validation_confidence is None:
        ai_validation_confidence = "medium"



    # save submission

    result = (
        supabase
        .table("task_submissions")
        .insert({

            "submission_id":
                submission_id,

            "company_id":
                company_id,

            "task_id":
                payload.task_id,

            "user_id":
                payload.user_id,

            "assignment_id":
                payload.assignment_id,


            "submission_type":
                payload.submission_type,


            # submissions

            "text_response":
                payload.text_response,


            "image_url":
                payload.image_url,


            "audio_url":
                stored_audio_url or payload.audio_url or (
                    payload.text_response
                    if payload.submission_type == "audio"
                    else None
                ),


            "video_url":
                payload.video_url,


            "answers":
                payload.answers,



            # AI

            "score":
                score,

            "max_score":
                max_score,

            "ai_validation_pass":
                ai_validation_pass,


            "ai_validation_verdict":
                ai_validation_verdict,


            "ai_validation_reason":
                ai_validation_reason,


            "ai_validation_suggestion":
                ai_validation_suggestion,


            "ai_validation_confidence":
                ai_validation_confidence,

            "ai_status":
                ai_status or "completed",


            "status":
                "submitted"

        })
        .execute()
    )


    row = (
        result.data[0]
        if result.data
        else {
            "submission_id":
                submission_id
        }
    )


    row.update({

        "score":
            score,


        "max_score":
            max_score,


        "ai_validation_pass":
            ai_validation_pass,


        "ai_validation_verdict":
            ai_validation_verdict,


        "ai_validation_reason":
            ai_validation_reason,


        "ai_validation_suggestion":
            ai_validation_suggestion,


        "ai_validation_confidence":
            ai_validation_confidence,

        "ai_status":
            ai_status or "completed",
        "ai_validation": {
            "pass": ai_validation_pass,
            "verdict": ai_validation_verdict,
            "reason": ai_validation_reason,
            "suggestion": ai_validation_suggestion,
            "confidence": ai_validation_confidence,
            "status": ai_status or "completed",
            "scores": {"overall": score, "max_score": max_score},
        },

    })


    return row


def get_report_summary(assignment_id: str, company_id: str) -> dict:
    result = (
        supabase.table("task_report_summaries")
        .select("*")
        .eq("assignment_id", assignment_id)
        .eq("company_id", company_id)
        .maybe_single()
        .execute()
    )
    return result.data or {}


def get_audience_functions(company_id: str) -> list:
    return (
        supabase.table("function")
        .select("function_id, function_name")
        .eq("company_id", company_id)
        .eq("is_active", True)
        .execute()
    ).data or []


def get_audience_sub_functions(function_id: str) -> list:
    return (
        supabase.table("sub_function")
        .select("sub_function_id, sub_function_name")
        .eq("function_id", function_id)
        .eq("is_active", True)
        .execute()
    ).data or []


def get_audience_cohorts(company_id: str) -> list:
    return (
        supabase.table("training_modules")
        .select("module_id, title")
        .eq("company_id", company_id)
        .in_("processing_status", ["completed", "ready"])
        .execute()
    ).data or []


def get_audience_members(company_id: str) -> list:
    users = (
        supabase.table("users")
        .select("user_id, name, email, company_id, function_id, sub_function_id")
        .eq("company_id", company_id)
        .eq("is_active", True)
        .execute()
    ).data or []

    function_ids = list({row.get("function_id") for row in users if row.get("function_id")})
    sub_function_ids = list({row.get("sub_function_id") for row in users if row.get("sub_function_id")})

    functions = {}
    if function_ids:
        function_rows = (
            supabase.table("function")
            .select("function_id, function_name")
            .in_("function_id", function_ids)
            .execute()
        ).data or []
        functions = {row["function_id"]: row.get("function_name", "") for row in function_rows}

    sub_functions = {}
    if sub_function_ids:
        sub_function_rows = (
            supabase.table("sub_function")
            .select("sub_function_id, sub_function_name")
            .in_("sub_function_id", sub_function_ids)
            .execute()
        ).data or []
        sub_functions = {
            row["sub_function_id"]: row.get("sub_function_name", "")
            for row in sub_function_rows
        }

    return [
        {
            "user_id": row.get("user_id"),
            "name": row.get("name") or row.get("email") or "Unnamed User",
            "email": row.get("email") or "",
            "company": company_id,
            "function_name": functions.get(row.get("function_id"), ""),
            "sub_function_name": sub_functions.get(row.get("sub_function_id"), ""),
        }
        for row in users
    ]


def delete_task_assignment(assignment_id: str, company_id: str) -> bool:
    """
    Deletes a task assignment, its associated tasks, and any submissions for it.
    """
    # 1. Delete associated submissions
    supabase.table("task_submissions").delete().eq("assignment_id", assignment_id).eq("company_id", company_id).execute()
    # 2. Delete tasks
    supabase.table("tasks").delete().eq("assignment_id", assignment_id).eq("company_id", company_id).execute()
    # 3. Delete the assignment
    supabase.table("task_assignments").delete().eq("assignment_id", assignment_id).eq("company_id", company_id).execute()
    return True


def fetch_task_submissions(
    company_id: str,
    assignment_id: str | None = None,
    user_id: str | None = None
) -> list:
    """
    Fetch task submissions for reports.
    Includes:
    - submission response
    - AI validation
    - task details
    - user details
    """

    try:
        print("========== REPORT DEBUG ==========")
        print("company_id:", company_id)
        print("user_id:", user_id)
        print("assignment_id:", assignment_id)

        # 1. Fetch submissions only
        query = (
            supabase
            .table("task_submissions")
            .select("*")
        )

        if company_id:
            query = query.eq(
                "company_id",
                company_id
            )

        if user_id:
            query = query.eq(
                "user_id",
                user_id
            )

        if assignment_id:
            query = query.eq(
                "assignment_id",
                assignment_id
            )


        result = (
            query
            .order(
                "submitted_at",
                desc=True
            )
            .execute()
        )


        submissions = result.data or []

        print(
            "SUBMISSIONS FOUND:",
            len(submissions)
        )


        # 2. Attach task + user manually
        for submission in submissions:


            # attach task details
            task_id = submission.get("task_id")

            if task_id:
                try:
                    task_res = (
                        supabase
                        .table("tasks")
                        .select("*")
                        .eq(
                            "task_id",
                            task_id
                        )
                        .single()
                        .execute()
                    )

                    submission["tasks"] = task_res.data

                except Exception as e:
                    print(
                        "task fetch failed:",
                        e
                    )
                    submission["tasks"] = None



            # attach employee details
            uid = submission.get("user_id")

            if uid:
                try:
                    user_res = (
                        supabase
                        .table("users")
                        .select("*")
                        .eq(
                            "user_id",
                            uid
                        )
                        .single()
                        .execute()
                    )

                    submission["users"] = user_res.data

                except Exception as e:
                    print(
                        "user fetch failed:",
                        e
                    )
                    submission["users"] = None


        return submissions


    except Exception as exc:

        print(
            "[task-manager] fetch_task_submissions failed:",
            exc
        )

        return []


def reassign_task_assignment(
    company_id: str,
    original_assignment_id: str,
    mode: str,
    level: str,
    target_sprints: list,
    target_orgs: list,
    target_functions: list,
    target_sub_functions: list,
    target_individuals: list,
    due_date: str,
    recurrence: str,
    created_by: str | None = None
) -> dict:
    # 1. Resolve database level and target IDs
    db_level = "individual"
    target_module_id = None
    target_function_id = None
    target_sub_function_id = None
    target_user_ids = []

    if level == "sprint":
        db_level = "cohort"
        if target_sprints:
            modules = (
                supabase.table("training_modules")
                .select("module_id")
                .eq("company_id", company_id)
                .in_("title", target_sprints)
                .execute()
            ).data
            if modules:
                target_module_id = modules[0]["module_id"]
    else:
        if target_individuals:
            db_level = "individual"
            users = (
                supabase.table("users")
                .select("user_id")
                .eq("company_id", company_id)
                .in_("name", target_individuals)
                .execute()
            ).data
            if users:
                target_user_ids = [u["user_id"] for u in users]
        elif target_sub_functions:
            db_level = "sub_function"
            sub_funcs = (
                supabase.table("sub_function")
                .select("sub_function_id")
                .in_("sub_function_name", target_sub_functions)
                .execute()
            ).data
            if sub_funcs:
                target_sub_function_id = sub_funcs[0]["sub_function_id"]
        elif target_functions:
            db_level = "function"
            funcs = (
                supabase.table("function")
                .select("function_id")
                .eq("company_id", company_id)
                .in_("function_name", target_functions)
                .execute()
            ).data
            if funcs:
                target_function_id = funcs[0]["function_id"]
        elif target_orgs:
            db_level = "org"

    # Resolve target user count
    from types import SimpleNamespace
    mock_payload = SimpleNamespace(
        level=db_level,
        target_module_id=target_module_id,
        target_function_id=target_function_id,
        target_sub_function_id=target_sub_function_id,
        target_user_ids=target_user_ids
    )
    audience_count = resolve_audience_count(mock_payload, company_id)

    if mode == "copy":
        orig_assign = (
            supabase.table("task_assignments")
            .select("*")
            .eq("assignment_id", original_assignment_id)
            .eq("company_id", company_id)
            .maybe_single()
            .execute()
        ).data
        if not orig_assign:
            raise Exception("Original assignment not found")

        orig_tasks = (
            supabase.table("tasks")
            .select("*")
            .eq("assignment_id", original_assignment_id)
            .eq("company_id", company_id)
            .execute()
        ).data or []

        new_assignment_id = str(uuid4())
        supabase.table("task_assignments").insert({
            "assignment_id": new_assignment_id,
            "company_id": company_id,
            "created_by": created_by or orig_assign.get("created_by"),
            "level": db_level,
            "target_module_id": target_module_id,
            "target_function_id": target_function_id,
            "target_sub_function_id": target_sub_function_id,
            "target_user_ids": target_user_ids or None,
            "due_date": due_date,
            "recurrence": recurrence,
            "status": "active",
            "total_target_count": audience_count,
        }).execute()

        new_tasks = []
        for t in orig_tasks:
            new_task_id = str(uuid4())
            t_inserted = (
                supabase.table("tasks").insert({
                    "task_id": new_task_id,
                    "company_id": company_id,
                    "assignment_id": new_assignment_id,
                    "created_by": created_by or t.get("created_by"),
                    "title": t.get("title"),
                    "description": t.get("description"),
                    "submission_format": t.get("submission_format"),
                    "questions": t.get("questions") or [],
                    "status": "active",
                }).execute()
            ).data
            if t_inserted:
                new_tasks.append(t_inserted[0])

        audience_display_name = target_sprints[0] if target_sprints else db_level
        primary_task = new_tasks[0] if new_tasks else {}
        return {
            "task_id": primary_task.get("task_id"),
            "assignment_id": new_assignment_id,
            "company_id": company_id,
            "title": primary_task.get("title", ""),
            "description": primary_task.get("description", ""),
            "submission_format": [primary_task.get("submission_format", "text")] if not isinstance(primary_task.get("submission_format"), list) else primary_task.get("submission_format"),
            "questions": primary_task.get("questions") or [],
            "status": "active",
            "due_date": due_date,
            "recurrence": recurrence,
            "level": db_level,
            "audience_display_name": audience_display_name,
            "total_target_count": audience_count,
            "completion_count": 0,
            "created_at": "",
        }

    else:
        # Update existing assignment
        supabase.table("task_assignments").update({
            "level": db_level,
            "target_module_id": target_module_id,
            "target_function_id": target_function_id,
            "target_sub_function_id": target_sub_function_id,
            "target_user_ids": target_user_ids or None,
            "due_date": due_date,
            "recurrence": recurrence,
            "total_target_count": audience_count,
        }).eq("assignment_id", original_assignment_id).eq("company_id", company_id).execute()

        # Delete any existing submissions for this assignment so it becomes active again
        supabase.table("task_submissions").delete().eq("assignment_id", original_assignment_id).eq("company_id", company_id).execute()

        updated_tasks = (
            supabase.table("tasks")
            .select("*")
            .eq("assignment_id", original_assignment_id)
            .eq("company_id", company_id)
            .execute()
        ).data or []

        primary_task = updated_tasks[0] if updated_tasks else {}
        audience_display_name = target_sprints[0] if target_sprints else db_level
        return {
            "task_id": primary_task.get("task_id"),
            "assignment_id": original_assignment_id,
            "company_id": company_id,
            "title": primary_task.get("title", ""),
            "description": primary_task.get("description", ""),
            "submission_format": [primary_task.get("submission_format", "text")] if not isinstance(primary_task.get("submission_format"), list) else primary_task.get("submission_format"),
            "questions": primary_task.get("questions") or [],
            "status": "active",
            "due_date": due_date,
            "recurrence": recurrence,
            "level": db_level,
            "audience_display_name": audience_display_name,
            "total_target_count": audience_count,
            "completion_count": 0,
            "created_at": "",
        }
