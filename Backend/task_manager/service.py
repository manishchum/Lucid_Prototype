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
from video_analysis.services.video_analyzer import analyze_video


def _gemini_model():
    api_key = os.getenv("GEMINI_API_KEY") or ""
    if not api_key:
        return None

    genai.configure(api_key=api_key)
    return genai.GenerativeModel("gemini-1.5-flash")


def _normalize_submission_format(raw_submission_format) -> list:
    if isinstance(raw_submission_format, list):
        return raw_submission_format
    if raw_submission_format is None:
        return []
    if isinstance(raw_submission_format, str):
        raw_submission_format = raw_submission_format.strip()
        if raw_submission_format.startswith("["):
            try:
                val = json.loads(raw_submission_format)
                if isinstance(val, list):
                    return val
            except Exception:
                pass
        return [raw_submission_format]
    return [str(raw_submission_format)]


def _extract_audio_bytes(audio_input: str | None) -> tuple[bytes, str]:
    if not audio_input:
        raise ValueError("Missing audio payload")

    value = audio_input.strip()
    if value.startswith("data:"):
        header, encoded = value.split(",", 1)
        mime_type = header.split("data:", 1)[1].split(";", 1)[0] or "audio/webm"
        return base64.b64decode(encoded), mime_type

    if value.startswith("http://") or value.startswith("https://"):
        import httpx
        headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
        with httpx.Client(timeout=30.0, follow_redirects=True) as client:
            resp = client.get(value, headers=headers)
            resp.raise_for_status()
            mime_type = resp.headers.get("content-type", "audio/mpeg").split(";")[0]
            return resp.content, mime_type

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


def _extract_image_bytes(image_input: str | None) -> tuple[bytes, str]:
    if not image_input:
        raise ValueError("Missing image payload")

    value = image_input.strip()
    if value.startswith("data:"):
        header, encoded = value.split(",", 1)
        mime_type = header.split("data:", 1)[1].split(";", 1)[0] or "image/jpeg"
        return base64.b64decode(encoded), mime_type

    if value.startswith("http://") or value.startswith("https://"):
        import httpx
        headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
        with httpx.Client(timeout=30.0, follow_redirects=True) as client:
            resp = client.get(value, headers=headers)
            resp.raise_for_status()
            mime_type = resp.headers.get("content-type", "image/jpeg").split(";")[0]
            return resp.content, mime_type

    return base64.b64decode(value), "image/jpeg"


def _image_suffix(mime_type: str) -> str:
    if "png" in mime_type:
        return ".png"
    if "gif" in mime_type:
        return ".gif"
    if "webp" in mime_type:
        return ".webp"
    return ".jpg"


def _store_image_media(payload: SubmissionCreate, company_id: str, submission_id: str) -> str | None:
    image_input = payload.image_url
    if not image_input:
        return None

    try:
        image_bytes, mime_type = _extract_image_bytes(image_input)
    except Exception as exc:
        print("[task-manager] image storage decode failed:", exc)
        return None

    bucket = os.getenv("TASK_SUBMISSIONS_BUCKET") or os.getenv("SUPABASE_TASK_SUBMISSIONS_BUCKET") or "task-submissions"
    path = "/".join([
        str(company_id),
        str(payload.assignment_id or "unassigned"),
        str(payload.user_id),
        f"{submission_id}{_image_suffix(mime_type)}",
    ])

    try:
        supabase.storage.from_(bucket).upload(
            path,
            image_bytes,
            file_options={
                "content-type": mime_type,
                "upsert": "true",
            },
        )
        public_url = supabase.storage.from_(bucket).get_public_url(path)
        return str(public_url) if public_url else None
    except Exception as exc:
        print("[task-manager] image storage upload failed:", exc)
        return None


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


def _extract_video_bytes(video_input: str | None) -> tuple[bytes, str]:
    if not video_input:
        raise ValueError("Missing video payload")

    value = video_input.strip()
    if value.startswith("data:"):
        header, encoded = value.split(",", 1)
        mime_type = header.split("data:", 1)[1].split(";", 1)[0] or "video/mp4"
        return base64.b64decode(encoded), mime_type

    if value.startswith("http://") or value.startswith("https://"):
        import httpx
        headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
        with httpx.Client(timeout=30.0, follow_redirects=True) as client:
            resp = client.get(value, headers=headers)
            resp.raise_for_status()
            mime_type = resp.headers.get("content-type", "video/mp4").split(";")[0]
            return resp.content, mime_type

    return base64.b64decode(value), "video/mp4"


def _video_suffix(mime_type: str) -> str:
    if "webm" in mime_type:
        return ".webm"
    if "ogg" in mime_type:
        return ".ogg"
    if "quicktime" in mime_type or "mov" in mime_type:
        return ".mov"
    return ".mp4"


def _store_video_media(payload: SubmissionCreate, company_id: str, submission_id: str) -> str | None:
    video_input = payload.video_url or payload.text_response
    if not video_input:
        return None

    try:
        video_bytes, mime_type = _extract_video_bytes(video_input)
    except Exception as exc:
        print("[task-manager] video storage decode failed:", exc)
        return None

    bucket = os.getenv("TASK_SUBMISSIONS_BUCKET") or os.getenv("SUPABASE_TASK_SUBMISSIONS_BUCKET") or "task-submissions"
    path = "/".join([
        str(company_id),
        str(payload.assignment_id or "unassigned"),
        str(payload.user_id),
        f"{submission_id}{_video_suffix(mime_type)}",
    ])

    try:
        supabase.storage.from_(bucket).upload(
            path,
            video_bytes,
            file_options={
                "content-type": mime_type,
                "upsert": "true",
            },
        )
        public_url = supabase.storage.from_(bucket).get_public_url(path)
        return str(public_url) if public_url else None
    except Exception as exc:
        print("[task-manager] video storage upload failed:", exc)
        return None


def _analyze_video_submission(payload: SubmissionCreate, task: dict) -> dict:
    video_input = payload.video_url or payload.text_response
    video_bytes, mime_type = _extract_video_bytes(video_input)
    
    temp_path = ""
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=_video_suffix(mime_type)) as tmp:
            tmp.write(video_bytes)
            temp_path = tmp.name
        
        task_description = task.get("description", "")
        analysis_result = analyze_video(temp_path, task_description)
        return analysis_result
    finally:
        if temp_path:
            try:
                os.unlink(temp_path)
            except Exception:
                pass


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


def is_user_admin(user_id: str | None) -> bool:
    if not user_id:
        return False
    try:
        res = (
            supabase.table("user_role_assignments")
            .select("role:roles(name)")
            .eq("user_id", user_id)
            .eq("is_active", True)
            .execute()
        )
        if res.data:
            for row in res.data:
                role_dict = row.get("role")
                if role_dict:
                    role_name = str(role_dict.get("name") or "").lower()
                    if role_name in ("admin", "manager", "super_admin", "developer"):
                        return True
        return False
    except Exception as exc:
        print("[task-manager] Error checking admin status:", exc)
        return False


def scrub_submission_for_employee(sub: dict) -> dict:
    if not sub:
        return sub
    clean_sub = dict(sub)
    for field in [
        "score", "max_score", "ai_validation_pass", "ai_validation_verdict", 
        "ai_validation_reason", "ai_validation_suggestion", "ai_validation_confidence",
        "ai_status", "transcript", "audio_analysis", "ai_analysis", "ai_validation",
        "analysis_status"
    ]:
        clean_sub.pop(field, None)
    return clean_sub


def _format_submission_row(sub: dict, caller_is_admin: bool = False) -> dict:
    if not sub:
        return sub
    if not caller_is_admin:
        return scrub_submission_for_employee(sub)

    stype = str(sub.get("submission_type") or "").lower()
    if stype in ("text", "multiple_choice") and sub.get("audio_analysis"):
        val = sub["audio_analysis"]
        if isinstance(val, str):
            try:
                sub["ai_validation"] = json.loads(val)
            except Exception:
                sub["ai_validation"] = val
        else:
            sub["ai_validation"] = val
    else:
        sub["ai_validation"] = {
            "pass": sub.get("ai_validation_pass"),
            "verdict": sub.get("ai_validation_verdict"),
            "reason": sub.get("ai_validation_reason"),
            "suggestion": sub.get("ai_validation_suggestion"),
            "confidence": sub.get("ai_validation_confidence"),
            "status": sub.get("ai_status") or "completed",
            "scores": {"overall": sub.get("score"), "max_score": sub.get("max_score")},
        }
    return sub


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
        if assignments:
            # Supplement missing target fields from task_assignments
            assignment_ids = [a.get("assignment_id") for a in assignments if a.get("assignment_id")]
            if assignment_ids:
                try:
                    ta_res = (
                        supabase.table("task_assignments")
                        .select("assignment_id, target_user_ids, target_function_id, target_sub_function_id, target_module_id")
                        .in_("assignment_id", assignment_ids)
                        .execute()
                    )
                    ta_data = ta_res.data or []
                    ta_map = {row["assignment_id"]: row for row in ta_data if "assignment_id" in row}
                    for a in assignments:
                        aid = a.get("assignment_id")
                        if aid in ta_map:
                            a["target_user_ids"] = ta_map[aid].get("target_user_ids")
                            a["target_function_id"] = ta_map[aid].get("target_function_id")
                            a["target_sub_function_id"] = ta_map[aid].get("target_sub_function_id")
                            a["target_module_id"] = ta_map[aid].get("target_module_id")
                except Exception as ta_error:
                    print("[task-manager] Supplementing target fields failed:", ta_error)
    except Exception as view_error:
        print("[task-manager] Falling back to task_assignments:", view_error)
        assignments = []

    if not assignments:
        assignments = _select_assignments("task_assignments", "task_assignments")

    if not assignments:
        return []

    caller_is_admin = is_user_admin(user_id) if user_id else False

    # Secure role visibility mapping
    if user_id and not caller_is_admin:
        user_func = None
        user_subfunc = None
        assigned_modules = set()
        try:
            user_res = supabase.table("users").select("function_id, sub_function_id").eq("user_id", user_id).maybe_single().execute()
            user_data = user_res.data if (user_res and hasattr(user_res, 'data')) else {}
            if not user_data:
                user_data = {}
            user_func = user_data.get("function_id")
            user_subfunc = user_data.get("sub_function_id")
            
            lp_res = supabase.table("learning_plan").select("module_id").eq("user_id", user_id).execute()
            if lp_res.data:
                assigned_modules = {row["module_id"] for row in lp_res.data}
        except Exception as e:
            print("[task-manager] Failed to fetch user target validation criteria:", e)

        assigned_ids = set()
        for a in assignments:
            level = a.get("level")
            assignment_id = a.get("assignment_id")
            if not assignment_id:
                continue
            if level == "org":
                assigned_ids.add(assignment_id)
            elif level == "individual":
                target_users = a.get("target_user_ids") or []
                if user_id in target_users:
                    assigned_ids.add(assignment_id)
            elif level == "function":
                target_func = a.get("target_function_id")
                if target_func and target_func == user_func:
                    assigned_ids.add(assignment_id)
            elif level == "sub_function":
                target_subfunc = a.get("target_sub_function_id")
                if target_subfunc and target_subfunc == user_subfunc:
                    assigned_ids.add(assignment_id)
            elif level == "cohort":
                target_module = a.get("target_module_id")
                if target_module and target_module in assigned_modules:
                    assigned_ids.add(assignment_id)
                    
        assignments = [a for a in assignments if a.get("assignment_id") in assigned_ids]

    assignment_ids = [str(a.get("assignment_id")) for a in assignments if a.get("assignment_id")]
    if not assignment_ids:
        return []

    try:
        tasks = (
            supabase.table("tasks")
            .select(
                "task_id, assignment_id, title, description, expected_answer, submission_format, questions, status"
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
                    "task_id, assignment_id, title, description, expected_answer, submission_format, questions, status"
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
            user_submission_map[str(assignment_id)] = _format_submission_row(submission, caller_is_admin)

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
            submission_format_list = _normalize_submission_format(task.get("submission_format", "text"))

            result.append({
                "task_id": task.get("task_id"),
                "assignment_id": assignment_id,
                "company_id": company_id,
                "title": task.get("title", ""),
                "description": task.get("description", ""),
                "expected_answer": task.get("expected_answer") if caller_is_admin else None,
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
    caller_is_admin = is_user_admin(user_id)

    # 1. Fetch active assignments to determine assigned_ids for the employee
    try:
        assignments_res = (
            supabase.table("task_assignments")
            .select("*")
            .eq("company_id", company_id)
            .eq("status", "active")
            .execute()
        )
        assignments = assignments_res.data or []
    except Exception as e:
        print("[task-manager] assignments query failed:", e)
        assignments = []

    user_func = None
    user_subfunc = None
    assigned_modules = set()
    if not caller_is_admin:
        try:
            user_res = supabase.table("users").select("function_id, sub_function_id").eq("user_id", user_id).maybe_single().execute()
            user_data = user_res.data if (user_res and hasattr(user_res, 'data')) else {}
            if not user_data:
                user_data = {}
            user_func = user_data.get("function_id")
            user_subfunc = user_data.get("sub_function_id")
            
            lp_res = supabase.table("learning_plan").select("module_id").eq("user_id", user_id).execute()
            if lp_res.data:
                assigned_modules = {row["module_id"] for row in lp_res.data}
        except Exception as e:
            print("[task-manager] Failed to fetch user target validation criteria:", e)

    assigned_ids = set()
    for a in assignments:
        level = a.get("level")
        assignment_id = a.get("assignment_id")
        if not assignment_id:
            continue
        if caller_is_admin:
            assigned_ids.add(assignment_id)
            continue
        if level == "org":
            assigned_ids.add(assignment_id)
        elif level == "individual":
            target_users = a.get("target_user_ids") or []
            if user_id in target_users:
                assigned_ids.add(assignment_id)
        elif level == "function":
            target_func = a.get("target_function_id")
            if target_func and target_func == user_func:
                assigned_ids.add(assignment_id)
        elif level == "sub_function":
            target_subfunc = a.get("target_sub_function_id")
            if target_subfunc and target_subfunc == user_subfunc:
                assigned_ids.add(assignment_id)
        elif level == "cohort":
            target_module = a.get("target_module_id")
            if target_module and target_module in assigned_modules:
                assigned_ids.add(assignment_id)

    rows = (
        supabase.table("v_employee_task_list")
        .select("*")
        .eq("company_id", company_id)
        .execute()
    ).data or []

    # 2. Filter rows based on assigned_ids
    rows = [r for r in rows if r.get("assignment_id") in assigned_ids]

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
        submission_by_assignment[aid] = _format_submission_row(s, caller_is_admin)

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
        # Normalize submission_format to a list
        row["submission_format"] = _normalize_submission_format(row.get("submission_format", "text"))

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
    # Storing list as JSON string or single string
    db_submission_format = payload.submission_format
    if isinstance(db_submission_format, list):
        if len(db_submission_format) == 1:
            db_submission_format = db_submission_format[0]
        else:
            db_submission_format = json.dumps(db_submission_format)

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
    "submission_format": db_submission_format,
    "questions": [q.model_dump() for q in (payload.questions or [])],
    "status": "active",
}).execute()

    returned_submission_format = payload.submission_format
    if not isinstance(returned_submission_format, list):
        returned_submission_format = [returned_submission_format]

    return {
        "task_id": task_id,
        "assignment_id": assignment_id,
        "company_id": company_id,
        "title": payload.title,
        "description": payload.description,
        "submission_format": returned_submission_format,
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


def submit_task_response(payload: SubmissionCreate, company_id: str, background_tasks) -> dict:
    from datetime import datetime
    from analysis.background import run_ai_pipeline_bg

    submission_id = str(uuid4())

    # Fetch existing submission to check if already completed for this format
    existing_row = None
    if payload.task_id and payload.user_id:
        existing_res = (
            supabase
            .table("task_submissions")
            .select("*")
            .eq("task_id", payload.task_id)
            .eq("user_id", payload.user_id)
            .execute()
        )
        existing_row = existing_res.data[0] if existing_res.data else None

    if existing_row:
        # Check if the specific format is already submitted in the existing row
        is_completed = False
        stype = (payload.submission_type or "").lower()
        if stype == "video" and existing_row.get("video_url"):
            is_completed = True
        elif stype == "image" and existing_row.get("image_url"):
            is_completed = True
        elif stype == "audio" and existing_row.get("audio_url"):
            is_completed = True
        elif stype == "text" and existing_row.get("text_response"):
            is_completed = True
        elif stype == "multiple_choice" and existing_row.get("answers"):
            is_completed = True
            
        if is_completed:
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

    # Define scratch/saved_submissions directory
    saved_dir = "scratch/saved_submissions"
    os.makedirs(saved_dir, exist_ok=True)

    input_data = None
    stored_audio_url = None
    stored_video_url = None
    stored_image_url = None

    submission_type = (payload.submission_type or "").lower()

    if submission_type == "image" and payload.image_url:
        try:
            image_bytes, mime_type = _extract_image_bytes(payload.image_url)
            suffix = _image_suffix(mime_type)
            local_path = os.path.join(saved_dir, f"{submission_id}{suffix}")
            with open(local_path, "wb") as f:
                f.write(image_bytes)
            input_data = local_path
            # Upload to Supabase Storage
            stored_image_url = _store_image_media(payload, company_id, submission_id)
        except Exception as e:
            print("[task-manager] image extraction/storage failed:", e)
            
    elif submission_type == "audio" and (payload.audio_url or payload.text_response):
        try:
            audio_input = payload.audio_url or payload.text_response
            audio_bytes, mime_type = _extract_audio_bytes(audio_input)
            suffix = _audio_suffix(mime_type)
            local_path = os.path.join(saved_dir, f"{submission_id}{suffix}")
            with open(local_path, "wb") as f:
                f.write(audio_bytes)
            input_data = local_path
            # Upload to Supabase Storage
            stored_audio_url = _store_audio_media(payload, company_id, submission_id)
        except Exception as e:
            print("[task-manager] audio extraction/storage failed:", e)

    elif submission_type == "video" and (payload.video_url or payload.text_response):
        try:
            video_input = payload.video_url or payload.text_response
            video_bytes, mime_type = _extract_video_bytes(video_input)
            suffix = _video_suffix(mime_type)
            local_path = os.path.join(saved_dir, f"{submission_id}{suffix}")
            with open(local_path, "wb") as f:
                f.write(video_bytes)
            input_data = local_path
            # Upload to Supabase Storage
            stored_video_url = _store_video_media(payload, company_id, submission_id)
        except Exception as e:
            print("[task-manager] video extraction/storage failed:", e)

    elif submission_type == "text":
        input_data = payload.text_response

    elif submission_type == "multiple_choice":
        input_data = [ans.model_dump() if hasattr(ans, "model_dump") else dict(ans) for ans in (payload.answers or [])]

    # Save submission record with pending status
    insert_data = {
        "submission_id": submission_id,
        "company_id": company_id,
        "task_id": payload.task_id,
        "user_id": payload.user_id,
        "assignment_id": payload.assignment_id,
        "submission_type": payload.submission_type,
        "text_response": payload.text_response if submission_type not in ("video", "audio") else None,
        "image_url": stored_image_url or payload.image_url,
        "audio_url": stored_audio_url or payload.audio_url or (
            payload.text_response
            if submission_type == "audio"
            else None
        ),
        "video_url": stored_video_url or payload.video_url or (
            payload.text_response
            if submission_type == "video"
            else None
        ),
        "answers": [ans.model_dump() if hasattr(ans, "model_dump") else dict(ans) for ans in (payload.answers or [])],
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
                    .eq("task_id", payload.task_id)
                    .eq("user_id", payload.user_id)
                    .execute()
                )
                existing_row = existing_res.data[0] if existing_res.data else None
                if not existing_row:
                    raise e
            else:
                raise e

    if existing_row:
        update_data = {}
        for field in ["text_response", "image_url", "audio_url", "video_url", "answers",
                      "score", "max_score", "ai_validation_pass", "ai_validation_verdict",
                      "ai_validation_reason", "ai_validation_suggestion", "ai_validation_confidence",
                      "ai_status", "analysis_status", "status", "submission_type", "submitted_at"]:
            val = insert_data.get(field)
            if val is not None:
                update_data[field] = val
        
        result = (
            supabase
            .table("task_submissions")
            .update(update_data)
            .eq("submission_id", existing_row["submission_id"])
            .execute()
        )
        submission_id = existing_row["submission_id"]

    # Queue background task
    background_tasks.add_task(
        run_ai_pipeline_bg,
        submission_id,
        company_id,
        payload.task_id,
        payload.submission_type,
        input_data
    )

    return {
        "status": "success",
        "message": "Task submitted successfully",
        "submission_id": submission_id
    }



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
    user_id: str | None = None,
    caller_is_admin: bool = False
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
            _format_submission_row(submission, caller_is_admin)


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
            "submission_format": _normalize_submission_format(primary_task.get("submission_format", "text")),
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
            "submission_format": _normalize_submission_format(primary_task.get("submission_format", "text")),
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
