import base64
import json
import os
import tempfile
from typing import Optional
from uuid import uuid4
# from utils.supabase_client import supabase
from utils.auth_bridge import get_service_supabase_client
from utils.db.permissions import check_user_permission, check_company_access
from utils.exceptions import AuthorizationError, NotFoundError
from .models import SubmissionCreate, TaskCreate
# from audio_analysis.scoring import generate_audio_score
# from audio_analysis.services.acoustic_analysis import analyze_audio_features
# from audio_analysis.services.gemini_audio import analyze_audio_with_gemini
# from audio_analysis.services.speech_quality import analyze_speech_quality
# from video_analysis.services.video_analyzer import analyze_video


# def _gemini_model():
#     api_key = os.getenv("GEMINI_API_KEY") or ""
#     if not api_key:
#         return None

#     genai.configure(api_key=api_key)
#     return genai.GenerativeModel("gemini-1.5-flash")


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


def _extract_media_bytes(media_input: str | None, default_mime: str) -> tuple[bytes, str]:
    if not media_input:
        raise ValueError("Missing media payload")

    value = media_input.strip()
    if value.startswith("data:"):
        header, encoded = value.split(",", 1)
        mime_type = header.split("data:", 1)[1].split(";", 1)[0] or default_mime
        return base64.b64decode(encoded), mime_type

    if value.startswith("http://") or value.startswith("https://"):
        import httpx
        headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
        with httpx.Client(timeout=30.0, follow_redirects=True) as client:
            resp = client.get(value, headers=headers)
            resp.raise_for_status()
            mime_type = resp.headers.get("content-type", default_mime).split(";")[0]
            return resp.content, mime_type

    return base64.b64decode(value), default_mime


def _media_suffix(mime_type: str, fallback: str) -> str:
    if "mpeg" in mime_type or "mp3" in mime_type: return ".mp3"
    if "wav" in mime_type: return ".wav"
    if "ogg" in mime_type: return ".ogg"
    if "m4a" in mime_type: return ".m4a"
    if "png" in mime_type: return ".png"
    if "gif" in mime_type: return ".gif"
    if "webp" in mime_type: return ".webp"
    if "jpeg" in mime_type or "jpg" in mime_type: return ".jpg"
    if "webm" in mime_type: return ".webm"
    if "quicktime" in mime_type or "mov" in mime_type: return ".mov"
    if "mp4" in mime_type: return ".mp4"
    return fallback


def _store_media(payload: SubmissionCreate, company_id: str, submission_id: str, media_input: str | None, media_type: str, default_mime: str, fallback_suffix: str) -> str | None:
    if not media_input:
        return None

    try:
        media_bytes, mime_type = _extract_media_bytes(media_input, default_mime)
    except Exception as exc:
        print(f"[task-manager] {media_type} storage decode failed:", exc)
        return None

    bucket = os.getenv("TASK_SUBMISSIONS_BUCKET") or os.getenv("SUPABASE_TASK_SUBMISSIONS_BUCKET") or "task-submissions"
    path = "/".join([
        str(company_id),
        str(payload.assignment_id or "unassigned"),
        str(payload.user_id),
        f"{submission_id}{_media_suffix(mime_type, fallback_suffix)}",
    ])

    try:
        db = get_service_supabase_client()
        db.storage.from_(bucket).upload(
            path,
            media_bytes,
            file_options={
                "content-type": mime_type,
                "upsert": "true",
            },
        )
        public_url = db.storage.from_(bucket).get_public_url(path)
        return str(public_url) if public_url else None
    except Exception as exc:
        print(f"[task-manager] {media_type} storage upload failed:", exc)
        return None


def _extract_audio_bytes(audio_input: str | None) -> tuple[bytes, str]:
    return _extract_media_bytes(audio_input, "audio/webm")

def _audio_suffix(mime_type: str) -> str:
    return _media_suffix(mime_type, ".webm")

def _store_audio_media(payload: SubmissionCreate, company_id: str, submission_id: str) -> str | None:
    audio_input = payload.audio_url or payload.text_response
    return _store_media(payload, company_id, submission_id, audio_input, "audio", "audio/webm", ".webm")


def _extract_image_bytes(image_input: str | None) -> tuple[bytes, str]:
    return _extract_media_bytes(image_input, "image/jpeg")

def _image_suffix(mime_type: str) -> str:
    return _media_suffix(mime_type, ".jpg")

def _store_image_media(payload: SubmissionCreate, company_id: str, submission_id: str) -> str | None:
    return _store_media(payload, company_id, submission_id, payload.image_url, "image", "image/jpeg", ".jpg")


def _extract_video_bytes(video_input: str | None) -> tuple[bytes, str]:
    return _extract_media_bytes(video_input, "video/mp4")

def _video_suffix(mime_type: str) -> str:
    return _media_suffix(mime_type, ".mp4")

def _store_video_media(payload: SubmissionCreate, company_id: str, submission_id: str) -> str | None:
    video_input = payload.video_url or payload.text_response
    return _store_media(payload, company_id, submission_id, video_input, "video", "video/mp4", ".mp4")


def resolve_company_id(user_id: str | None, fallback_company_id: Optional[str]) -> Optional[str]:
    if fallback_company_id:
        import uuid
        try:
            uuid.UUID(str(fallback_company_id))
            return fallback_company_id
        except ValueError:
            pass

    if not user_id:
        return None

    try:
        db = get_service_supabase_client()
        company_res = (
            db.table("users")
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


async def is_user_admin(user_id: str | None) -> bool:
    if not user_id:
        return False
    try:
        db = get_service_supabase_client()
        res = (
            db.table("user_role_assignments")
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
    val = sub.get("ai_analysis") or sub.get("audio_analysis")
    
    if val:
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


async def get_active_tasks(company_id: str, user_id: str | None = None) -> list:
    """
    Returns active tasks with audience resolved and completion count.
    Uses v_active_assignments view (created in migration).
    """
    if user_id:
        if not await check_company_access(user_id, company_id):
            raise AuthorizationError("Access denied to this company")

    db = get_service_supabase_client()

    def _select_assignments(source_name: str, table_name: str) -> list:
        try:
            if table_name == "v_active_assignments":
                cols = "assignment_id, company_id, level, status, due_date, recurrence, total_target_count, created_at, audience_display_name"
            else:
                cols = "assignment_id, company_id, created_by, level, target_module_id, target_function_id, target_sub_function_id, target_user_ids, due_date, recurrence, status, total_target_count, created_at, updated_at"
            response = (
                db.table(table_name)
                .select(cols)
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
                        db.table("task_assignments")
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

    caller_is_admin = await is_user_admin(user_id) if user_id else False

    # Secure role visibility mapping
    if user_id and not caller_is_admin:
        user_func = None
        user_subfunc = None
        assigned_modules = set()
        try:
            user_res = db.table("users").select("function_id, sub_function_id").eq("user_id", user_id).maybe_single().execute()
            user_data = user_res.data if (user_res and hasattr(user_res, 'data')) else {}
            if not user_data:
                user_data = {}
            user_func = user_data.get("function_id")
            user_subfunc = user_data.get("sub_function_id")
            
            lp_res = db.table("learning_plan").select("module_id").eq("user_id", user_id).execute()
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
            db.table("tasks")
            .select(
                "task_id, assignment_id, title, description, expected_answer, submission_format, questions, status, bundle_tasks"
            )
            .in_("assignment_id", assignment_ids)
            .eq("company_id", company_id)
            .execute()
        ).data or []
    except Exception as task_error:
        print("[task-manager] tasks query with company filter failed, retrying without company_id:", task_error)
        try:
            tasks = (
                db.table("tasks")
                .select(
                    "task_id, assignment_id, title, description, expected_answer, submission_format, questions, status, bundle_tasks"
                )
                .in_("assignment_id", assignment_ids)
                .execute()
            ).data or []
        except Exception as retry_error:
            print("[task-manager] tasks query failed completely:", retry_error)
            tasks = []

    try:
        submission_query = (
            db.table("task_submissions")
            .select("submission_id, assignment_id, company_id, user_id, task_id, submission_type, text_response, image_url, audio_url, video_url, answers, score, max_score, ai_validation_pass, ai_validation_verdict, ai_validation_reason, ai_validation_suggestion, ai_validation_confidence, ai_status, analysis_status, status, submitted_at")
            .in_("assignment_id", assignment_ids)
            .eq("company_id", company_id)
        )
        child_submission_query = (
            db.table("child_task_submissions")
            .select("submission_id, assignment_id, company_id, user_id, child_task_id, parent_task_id, submission_type, text_response, image_url, audio_url, video_url, answers, score, max_score, ai_validation_pass, ai_validation_verdict, ai_validation_reason, ai_validation_suggestion, ai_validation_confidence, ai_status, analysis_status, status, submitted_at")
            .in_("assignment_id", assignment_ids)
            .eq("company_id", company_id)
        )
        if user_id and not caller_is_admin:
            submission_query = submission_query.eq("user_id", user_id)
            child_submission_query = child_submission_query.eq("user_id", user_id)
        submissions = submission_query.execute().data or []
        submissions.extend(child_submission_query.execute().data or [])
    except Exception as submission_error:
        print("[task-manager] submissions query with company filter failed, retrying without company_id:", submission_error)
        try:
            submission_query = db.table("task_submissions").select("submission_id, assignment_id, company_id, user_id, task_id, submission_type, text_response, image_url, audio_url, video_url, answers, score, max_score, ai_validation_pass, ai_validation_verdict, ai_validation_reason, ai_validation_suggestion, ai_validation_confidence, ai_status, analysis_status, status, submitted_at").in_("assignment_id", assignment_ids)
            child_submission_query = db.table("child_task_submissions").select("submission_id, assignment_id, company_id, user_id, child_task_id, parent_task_id, submission_type, text_response, image_url, audio_url, video_url, answers, score, max_score, ai_validation_pass, ai_validation_verdict, ai_validation_reason, ai_validation_suggestion, ai_validation_confidence, ai_status, analysis_status, status, submitted_at").in_("assignment_id", assignment_ids)
            if user_id and not caller_is_admin:
                submission_query = submission_query.eq("user_id", user_id)
                child_submission_query = child_submission_query.eq("user_id", user_id)
            submissions = submission_query.execute().data or []
            submissions.extend(child_submission_query.execute().data or [])
        except Exception as retry_error:
            print("[task-manager] submissions query failed completely:", retry_error)
            submissions = []


    # Group submissions by assignment_id and user_id to correctly count child submissions
    submissions_by_assign_user = {}
    for submission in submissions:
        assignment_id = submission.get("assignment_id")
        sub_user_id = submission.get("user_id")
        if not assignment_id or not sub_user_id:
            continue
        submissions_by_assign_user.setdefault(str(assignment_id), {}).setdefault(str(sub_user_id), []).append(submission)

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
            submission_format_list = _normalize_submission_format(task.get("submission_format", "text"))
            
            # Determine required submissions
            is_bundle = "bundle" in submission_format_list
            bundle_tasks_list = task.get("bundle_tasks") or []
            num_required = len(bundle_tasks_list) if is_bundle else 1
            if num_required == 0:
                num_required = 1

            assign_users_subs = submissions_by_assign_user.get(assignment_id, {})
            
            # Count users who have completed ALL child tasks in the bundle
            comp_count = 0
            for uid, user_subs in assign_users_subs.items():
                if user_subs:
                    if is_bundle:
                        completed_children = set()
                        for sub in user_subs:
                            if sub.get("child_task_id"):
                                completed_children.add(sub.get("child_task_id"))
                            for a in (sub.get("answers") or []):
                                if isinstance(a, dict) and a.get("child_task_id"):
                                    completed_children.add(a.get("child_task_id"))
                        if len(completed_children) >= num_required:
                            comp_count += 1
                    else:
                        comp_count += 1

            # Check if active user has completed the entire bundle
            user_completed = False
            user_sub_row = None
            if user_id:
                user_subs = assign_users_subs.get(str(user_id), [])
                if user_subs:
                    if is_bundle:
                        completed_children = set()
                        for sub in user_subs:
                            if sub.get("child_task_id"):
                                completed_children.add(sub.get("child_task_id"))
                            for a in (sub.get("answers") or []):
                                if isinstance(a, dict) and a.get("child_task_id"):
                                    completed_children.add(a.get("child_task_id"))
                        if len(completed_children) >= num_required:
                            user_completed = True
                            user_sub_row = _format_submission_row(user_subs[0], caller_is_admin)
                    else:
                        user_completed = True
                        user_sub_row = _format_submission_row(user_subs[0], caller_is_admin)

            result.append({
                "task_id": task.get("task_id"),
                "assignment_id": assignment_id,
                "company_id": company_id,
                "title": task.get("title", ""),
                "description": task.get("description", ""),
                "expected_answer": task.get("expected_answer") if caller_is_admin else None,
                "submission_format": submission_format_list,
                "questions": task.get("questions") or [],
                "bundle_tasks": task.get("bundle_tasks") or [],
                "status": assignment.get("status", "active"),
                "due_date": str(assignment.get("due_date", "")),
                "recurrence": assignment.get("recurrence", "none"),
                "level": assignment.get("level", ""),
                "target_user_ids": assignment.get("target_user_ids"),
                "audience_display_name": assignment.get("audience_display_name") or assignment.get("level", ""),
                "total_target_count": assignment.get("total_target_count", 0),
                "completion_count": comp_count,
                "created_at": str(assignment.get("created_at", "")),
                "submitted": user_completed,
                "submission": user_sub_row,
            })

    return result


async def get_tasks_for_user(user_id: str, company_id: str, requesting_user_id: str | None = None) -> list:
    """Employee view — tasks assigned to this user."""
    req_uid = requesting_user_id or user_id
    if not await check_company_access(req_uid, company_id):
        raise AuthorizationError("Access denied to this company")

    if req_uid != user_id:
        if not await check_user_permission(req_uid, 'manager'):
            raise AuthorizationError("Permission denied: Manager role required to view other user's tasks")
        if not await check_company_access(user_id, company_id):
            raise AuthorizationError("Target user does not belong to this company")

    db = get_service_supabase_client()
    caller_is_admin = await is_user_admin(user_id)

    # 1. Fetch active assignments to determine assigned_ids for the employee
    try:
        assignments_res = (
            db.table("task_assignments")
            .select("assignment_id, company_id, created_by, level, target_module_id, target_function_id, target_sub_function_id, target_user_ids, due_date, recurrence, status, total_target_count, created_at, updated_at")
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
    try:
        user_res = db.table("users").select("function_id, sub_function_id").eq("user_id", user_id).maybe_single().execute()
        user_data = user_res.data if (user_res and hasattr(user_res, 'data')) else {}
        if not user_data:
            user_data = {}
        user_func = user_data.get("function_id")
        user_subfunc = user_data.get("sub_function_id")
        
        lp_res = db.table("learning_plan").select("module_id").eq("user_id", user_id).execute()
        if lp_res.data:
            assigned_modules = {row["module_id"] for row in lp_res.data}
    except Exception as e:
        print("[task-manager] Failed to fetch user target validation criteria:", e)

    assigned_ids = set()
    assignment_map = {}
    for a in assignments:
        level = a.get("level")
        assignment_id = a.get("assignment_id")
        if not assignment_id:
            continue
        
        # Check audience alignment
        is_assigned = False
        if level == "org":
            is_assigned = True
        elif level == "individual":
            target_users = a.get("target_user_ids") or []
            if user_id in target_users:
                is_assigned = True
        elif level == "function":
            target_func = a.get("target_function_id")
            if target_func and target_func == user_func:
                is_assigned = True
        elif level == "sub_function":
            target_subfunc = a.get("target_sub_function_id")
            if target_subfunc and target_subfunc == user_subfunc:
                is_assigned = True
        elif level == "cohort":
            target_module = a.get("target_module_id")
            if target_module and target_module in assigned_modules:
                is_assigned = True
                
        if is_assigned:
            assigned_ids.add(assignment_id)
            assignment_map[str(assignment_id)] = a

    if not assigned_ids:
        return []

    # 2. Fetch tasks corresponding to assigned_ids directly from tasks table
    try:
        tasks_res = (
            db.table("tasks")
            .select("task_id, assignment_id, company_id, title, description, submission_format, questions, status, bundle_tasks, expected_answer")
            .in_("assignment_id", list(assigned_ids))
            .eq("company_id", company_id)
            .execute()
        )
        tasks = tasks_res.data or []
    except Exception as e:
        print("[task-manager] Failed to fetch tasks:", e)
        tasks = []

    # 3. Fetch existing submissions for this user (group by assignment_id)
    try:
        submissions_res = (
            db.table("task_submissions")
            .select("submission_id, assignment_id, company_id, user_id, task_id, submission_type, text_response, image_url, audio_url, video_url, answers, score, max_score, ai_validation_pass, ai_validation_verdict, ai_validation_reason, ai_validation_suggestion, ai_validation_confidence, ai_status, analysis_status, status, submitted_at")
            .eq("company_id", company_id)
            .eq("user_id", user_id)
            .order("submitted_at", desc=True)
            .execute()
        )
        child_submissions_res = (
            db.table("child_task_submissions")
            .select("submission_id, assignment_id, company_id, user_id, child_task_id, parent_task_id, submission_type, text_response, image_url, audio_url, video_url, answers, score, max_score, ai_validation_pass, ai_validation_verdict, ai_validation_reason, ai_validation_suggestion, ai_validation_confidence, ai_status, analysis_status, status, submitted_at")
            .eq("company_id", company_id)
            .eq("user_id", user_id)
            .order("submitted_at", desc=True)
            .execute()
        )
        submissions = submissions_res.data or []
        submissions.extend(child_submissions_res.data or [])
    except Exception as e:
        print("[task-manager] submissions query failed:", e)
        submissions = []

    user_submissions_by_assignment = {}
    for s in submissions:
        aid = str(s.get("assignment_id") or "")
        if not aid:
            continue
        user_submissions_by_assignment.setdefault(aid, []).append(s)

    # 4. Construct response objects matching frontend expectations
    filtered = []
    for task in tasks:
        assignment_id = str(task.get("assignment_id") or "")
        assignment = assignment_map.get(assignment_id) or {}
        
        submission_format_list = _normalize_submission_format(task.get("submission_format", "text"))
        is_bundle = "bundle" in submission_format_list
        bundle_tasks_list = task.get("bundle_tasks") or []
        num_required = len(bundle_tasks_list) if is_bundle else 1
        if num_required == 0:
            num_required = 1

        user_subs = user_submissions_by_assignment.get(assignment_id, [])
        user_completed = False
        if user_subs:
            if is_bundle:
                completed_children = set()
                for sub in user_subs:
                    if sub.get("child_task_id"):
                        completed_children.add(sub.get("child_task_id"))
                    for a in (sub.get("answers") or []):
                        if isinstance(a, dict) and a.get("child_task_id"):
                            completed_children.add(a.get("child_task_id"))
                user_completed = len(completed_children) >= num_required
            else:
                user_completed = True
        user_sub_row = _format_submission_row(user_subs[0], caller_is_admin) if (user_completed and user_subs) else None

        # Hide expected_answer from end users unless caller is admin
        safe_bundle_tasks = []
        for bt in (task.get("bundle_tasks") or []):
            safe_bt = dict(bt)
            if not caller_is_admin and "expected_answer" in safe_bt:
                del safe_bt["expected_answer"]
            safe_bundle_tasks.append(safe_bt)

        row = {
            "task_id": task.get("task_id"),
            "assignment_id": assignment_id,
            "company_id": company_id,
            "title": task.get("title", ""),
            "description": task.get("description", ""),
            "submission_format": submission_format_list,
            "questions": task.get("questions") or [],
            "bundle_tasks": safe_bundle_tasks,
            "due_date": str(assignment.get("due_date", "")),
            "assignment_status": assignment.get("status", "active"),
            "status": "completed" if user_completed else assignment.get("status", "active"),
            "submitted": user_completed,
            "submission": user_sub_row,
            "target_user_ids": assignment.get("target_user_ids")
        }
        
        if caller_is_admin and "expected_answer" in task:
            row["expected_answer"] = task["expected_answer"]
            
        filtered.append(row)

    return filtered


async def resolve_audience_count(payload: TaskCreate, company_id: str, requesting_user_id: str) -> int:
    if not await check_company_access(requesting_user_id, company_id):
        raise AuthorizationError("Access denied to this company")

    db = get_service_supabase_client()
    base = (
        db.table("users")
        .select("user_id", count="exact")
        .eq("company_id", company_id)
        .eq("is_active", True)
        .eq("employment_status", "ACTIVE")
    )

    if payload.level == "cohort" and payload.target_module_id:
        learning_plan = (
            db.table("learning_plan")
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


async def create_task_and_assignment(payload: TaskCreate, company_id: str, requesting_user_id: str) -> dict:
    if not await check_user_permission(requesting_user_id, 'manager'):
        raise AuthorizationError("Permission denied: Manager role required to create tasks")
    if not await check_company_access(requesting_user_id, company_id):
        raise AuthorizationError("Access denied to this company")

    assignment_id = str(uuid4())
    task_id = str(uuid4())
    audience_count = await resolve_audience_count(payload, company_id, requesting_user_id)
    # Storing list as JSON string or single string
    db_submission_format = payload.submission_format
    if isinstance(db_submission_format, list):
        if len(db_submission_format) == 1:
            db_submission_format = db_submission_format[0]
        else:
            db_submission_format = json.dumps(db_submission_format)

    db = get_service_supabase_client()

    db.table("task_assignments").insert({
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

    is_bundle = False
    if isinstance(payload.submission_format, list):
        is_bundle = "bundle" in payload.submission_format
    elif isinstance(payload.submission_format, str):
        is_bundle = payload.submission_format == "bundle"

    db_bundle_tasks = []
    if is_bundle:
        db_bundle_tasks = [t.model_dump() if hasattr(t, "model_dump") else dict(t) for t in (payload.bundle_tasks or [])]

    db.table("tasks").insert({
        "task_id": task_id,
        "company_id": company_id,
        "assignment_id": assignment_id,
        "created_by": payload.created_by,
        "title": payload.title,
        "description": payload.description,
        "expected_answer": payload.expected_answer,
        "submission_format": db_submission_format,
        "questions": [q.model_dump() for q in (payload.questions or [])],
        "status": "active",
        "bundle_tasks": db_bundle_tasks,
    }).execute()

    if is_bundle and db_bundle_tasks:
        child_inserts = []
        for idx, ct in enumerate(db_bundle_tasks):
            child_inserts.append({
                "parent_task_id": task_id,
                "company_id": company_id,
                "title": ct.get("title", ""),
                "description": ct.get("description", ""),
                "submission_format": ct.get("submission_format", "text"),
                "expected_answer": ct.get("expected_answer", ""),
                "questions": ct.get("questions") or [],
                "order_index": idx
            })
        if child_inserts:
            db.table("child_tasks").insert(child_inserts).execute()


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
        "bundle_tasks": db_bundle_tasks,
        "status": "active",
        "due_date": str(payload.due_date),
        "recurrence": payload.recurrence,
        "level": payload.level,
        "audience_display_name": payload.level,
        "total_target_count": audience_count,
        "completion_count": 0,
        "created_at": "",
    }


async def submit_task_response(payload: SubmissionCreate, company_id: str, background_tasks, requesting_user_id: str) -> dict:
    from datetime import datetime
    from analysis.background import run_ai_pipeline_bg

    if not await check_company_access(requesting_user_id, company_id):
        raise AuthorizationError("Access denied to this company")

    submission_id = str(uuid4())

    # Resolve child task ID
    is_bundle_submission = payload.child_task_id is not None
    resolved_task_id = payload.task_id

    db = get_service_supabase_client()

    if is_bundle_submission:
        cid = payload.child_task_id
        if cid == payload.task_id:
            payload.child_task_id = None
            is_bundle_submission = False
        elif cid and "-" in cid:
            parts = cid.rsplit("-", 1)
            if len(parts) == 2 and len(parts[0]) == 36:
                parent_id = parts[0]
                suffix = parts[1]
                if suffix.isdigit():
                    idx = int(suffix)
                    ct_res = db.table("child_tasks").select("child_task_id").eq("parent_task_id", parent_id).eq("order_index", idx).execute()
                    if ct_res.data:
                        payload.child_task_id = ct_res.data[0]["child_task_id"]
                    else:
                        import uuid
                        payload.child_task_id = str(uuid.uuid5(uuid.NAMESPACE_OID, cid))
                else:
                    # It's a single task with multiple formats (pseudo child task). Drop it.
                    payload.child_task_id = None
                    is_bundle_submission = False
            else:
                # cid is likely a raw UUID. If it's not found in child_tasks, we let the DB constraint handle it,
                # or if we know it's a pseudo-child, we should drop it. 
                # Since we already handled cid == task_id, we leave it as is.
                pass

    table_name = "child_task_submissions" if is_bundle_submission else "task_submissions"
    print(f"DEBUG: table_name={table_name}, is_bundle={is_bundle_submission}, cid={getattr(payload, 'child_task_id', None)}")
    print("IN SERVICE, table_name:", table_name, "cid:", getattr(payload, "child_task_id", "None"))

    # Fetch existing submission to check if already completed for this format
    existing_row = None
    if payload.task_id and payload.user_id:
        if is_bundle_submission:
            query = db.table(table_name).select("submission_id, assignment_id, company_id, user_id, child_task_id, parent_task_id, submission_type, text_response, image_url, audio_url, video_url, answers, score, max_score, ai_validation_pass, ai_validation_verdict, ai_validation_reason, ai_validation_suggestion, ai_validation_confidence, ai_status, analysis_status, status, submitted_at").eq("user_id", payload.user_id)
        else:
            query = db.table(table_name).select("submission_id, assignment_id, company_id, user_id, task_id, submission_type, text_response, image_url, audio_url, video_url, answers, score, max_score, ai_validation_pass, ai_validation_verdict, ai_validation_reason, ai_validation_suggestion, ai_validation_confidence, ai_status, analysis_status, status, submitted_at").eq("user_id", payload.user_id)
        if is_bundle_submission:
            query = query.eq("child_task_id", payload.child_task_id)
        else:
            query = query.eq("task_id", resolved_task_id)
            
        existing_res = query.execute()
        rows = existing_res.data or []
        existing_row = rows[0] if rows else None

    if existing_row:
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
            return {"submission_id": "already_completed", "message": "Task already completed"}

    # Fetch task details for AI evaluation (we don't strictly need it here unless checking questions)
    # Background worker will fetch again anyway.
    
    saved_dir = os.path.join(tempfile.gettempdir(), "lucid_saved_submissions")
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
            stored_video_url = _store_video_media(payload, company_id, submission_id)
        except Exception as e:
            print("[task-manager] video extraction/storage failed:", e)

    elif submission_type == "text":
        input_data = payload.text_response

    elif submission_type == "multiple_choice":
        input_data = [ans.model_dump() if hasattr(ans, "model_dump") else dict(ans) for ans in (payload.answers or [])]

    db_answers = [ans.model_dump() if hasattr(ans, "model_dump") else dict(ans) for ans in (payload.answers or [])]

    insert_data = {
        "submission_id": submission_id,
        "company_id": company_id,
        "user_id": payload.user_id,
        "assignment_id": payload.assignment_id,
        "submission_type": payload.submission_type,
        "text_response": payload.text_response if submission_type not in ("video", "audio") else None,
        "image_url": stored_image_url or payload.image_url,
        "audio_url": stored_audio_url or payload.audio_url or (
            payload.text_response if submission_type == "audio" else None
        ),
        "video_url": stored_video_url or payload.video_url or (
            payload.text_response if submission_type == "video" else None
        ),
        "answers": db_answers,
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
    
    if is_bundle_submission:
        insert_data["child_task_id"] = payload.child_task_id
        insert_data["parent_task_id"] = resolved_task_id
    else:
        insert_data["task_id"] = resolved_task_id

    if not existing_row:
        try:
            db.table(table_name).insert(insert_data).execute()
        except Exception as e:
            err_msg = str(e).lower()
            if "duplicate key" in err_msg or "23505" in err_msg or "already exists" in err_msg:
                if is_bundle_submission:
                    query = db.table(table_name).select("submission_id, assignment_id, company_id, user_id, child_task_id, parent_task_id, submission_type, text_response, image_url, audio_url, video_url, answers, score, max_score, ai_validation_pass, ai_validation_verdict, ai_validation_reason, ai_validation_suggestion, ai_validation_confidence, ai_status, analysis_status, status, submitted_at").eq("user_id", payload.user_id)
                    query = query.eq("child_task_id", payload.child_task_id)
                else:
                    query = db.table(table_name).select("submission_id, assignment_id, company_id, user_id, task_id, submission_type, text_response, image_url, audio_url, video_url, answers, score, max_score, ai_validation_pass, ai_validation_verdict, ai_validation_reason, ai_validation_suggestion, ai_validation_confidence, ai_status, analysis_status, status, submitted_at").eq("user_id", payload.user_id)
                    query = query.eq("task_id", resolved_task_id)
                
                rows = query.execute().data or []
                existing_row = rows[0] if rows else None
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
        
        db.table(table_name).update(update_data).eq("submission_id", existing_row["submission_id"]).execute()
        submission_id = existing_row["submission_id"]

    # Queue background task
    target_task_id = payload.child_task_id if is_bundle_submission else resolved_task_id
    # run_ai_pipeline_bg.delay(
    background_tasks.add_task(
        run_ai_pipeline_bg,
        submission_id,
        company_id,
        target_task_id,
        submission_type,
        input_data,
        is_bundle_submission=is_bundle_submission
    )

    return {
        "status": "success",
        "message": "Task submitted successfully",
        "submission_id": submission_id
    }


async def get_report_summary(assignment_id: str, company_id: str, requesting_user_id: str) -> dict:
    if not await check_user_permission(requesting_user_id, 'manager'):
        raise AuthorizationError("Permission denied: Manager role required to view reports")
    if not await check_company_access(requesting_user_id, company_id):
        raise AuthorizationError("Access denied to this company")

    db = get_service_supabase_client()
    result = (
        db.table("task_report_summaries")
        .select("assignment_id, company_id")
        .eq("assignment_id", assignment_id)
        .eq("company_id", company_id)
        .maybe_single()
        .execute()
    )
    return result.data or {}


async def get_audience_functions(company_id: str, requesting_user_id: str) -> list:
    if not await check_company_access(requesting_user_id, company_id):
        raise AuthorizationError("Access denied to this company")

    db = get_service_supabase_client()
    
    # Fetch unique function_ids assigned to active users of this company
    users_res = (
        db.table("users")
        .select("function_id")
        .eq("company_id", company_id)
        .eq("is_active", True)
        .execute()
    )
    user_function_ids = list({u["function_id"] for u in (users_res.data or []) if u.get("function_id")})

    # Fetch functions explicitly owned by this company
    company_funcs_res = (
        db.table("function")
        .select("function_id, function_name")
        .eq("company_id", company_id)
        .eq("is_active", True)
        .execute()
    )
    funcs = company_funcs_res.data or []
    existing_ids = {f["function_id"] for f in funcs}

    # Fetch any additional functions that are referenced by the company's active users (e.g. global ones)
    additional_ids = [fid for fid in user_function_ids if fid not in existing_ids]
    if additional_ids:
        additional_funcs_res = (
            db.table("function")
            .select("function_id, function_name")
            .in_("function_id", additional_ids)
            .eq("is_active", True)
            .execute()
        )
        funcs.extend(additional_funcs_res.data or [])

    # Fetch all sub-functions for the collected functions in a single batch query
    func_ids = [f["function_id"] for f in funcs if f.get("function_id")]
    if func_ids:
        try:
            sub_funcs_res = (
                db.table("sub_function")
                .select("sub_function_id, sub_function_name, function_id")
                .in_("function_id", func_ids)
                .eq("is_active", True)
                .execute()
            )
            sub_funcs_by_func = {}
            for sf in (sub_funcs_res.data or []):
                fid = sf.get("function_id")
                if fid:
                    sub_funcs_by_func.setdefault(fid, []).append({
                        "sub_function_id": sf.get("sub_function_id"),
                        "sub_function_name": sf.get("sub_function_name"),
                    })
            for f in funcs:
                f["sub_functions"] = sub_funcs_by_func.get(f.get("function_id"), [])
        except Exception as exc:
            print("[task-manager] Batch fetch sub_functions failed:", exc)
            for f in funcs:
                f["sub_functions"] = []
    else:
        for f in funcs:
            f["sub_functions"] = []

    return funcs


async def get_audience_sub_functions(function_id: str, requesting_user_id: str) -> list:
    db = get_service_supabase_client()
    func_res = (
        db.table("function")
        .select("company_id")
        .eq("function_id", function_id)
        .maybe_single()
        .execute()
    )
    if not func_res.data:
        raise NotFoundError("Function", function_id)
    company_id = func_res.data.get("company_id")
    if company_id:
        if not await check_company_access(requesting_user_id, company_id):
            raise AuthorizationError("Access denied to this company")

    return (
        db.table("sub_function")
        .select("sub_function_id, sub_function_name")
        .eq("function_id", function_id)
        .eq("is_active", True)
        .execute()
    ).data or []


async def get_audience_cohorts(company_id: str, requesting_user_id: str) -> list:
    if not await check_company_access(requesting_user_id, company_id):
        raise AuthorizationError("Access denied to this company")

    db = get_service_supabase_client()
    return (
        db.table("training_modules")
        .select("module_id, title")
        .eq("company_id", company_id)
        .in_("processing_status", ["completed", "ready"])
        .execute()
    ).data or []


async def get_audience_members(company_id: str, requesting_user_id: str) -> list:
    if not await check_company_access(requesting_user_id, company_id):
        raise AuthorizationError("Access denied to this company")

    db = get_service_supabase_client()
    users = (
        db.table("users")
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
            db.table("function")
            .select("function_id, function_name")
            .in_("function_id", function_ids)
            .execute()
        ).data or []
        functions = {row["function_id"]: row.get("function_name", "") for row in function_rows}

    sub_functions = {}
    if sub_function_ids:
        sub_function_rows = (
            db.table("sub_function")
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


async def delete_task_assignment(assignment_id: str, company_id: str, requesting_user_id: str) -> bool:
    """
    Deletes a task assignment, its associated tasks, and any submissions for it.
    """
    if not await check_user_permission(requesting_user_id, 'manager'):
        raise AuthorizationError("Permission denied: Manager role required to delete task assignments")
    if not await check_company_access(requesting_user_id, company_id):
        raise AuthorizationError("Access denied to this company")

    db = get_service_supabase_client()
    # 1. Delete associated submissions
    db.table("task_submissions").delete().eq("assignment_id", assignment_id).eq("company_id", company_id).execute()
    # 2. Delete tasks
    db.table("tasks").delete().eq("assignment_id", assignment_id).eq("company_id", company_id).execute()
    # 3. Delete the assignment
    db.table("task_assignments").delete().eq("assignment_id", assignment_id).eq("company_id", company_id).execute()
    return True


async def fetch_task_submissions(
    company_id: str,
    assignment_id: str | None = None,
    user_id: str | None = None,
    caller_is_admin: bool = False,
    requesting_user_id: str | None = None
) -> list:
    """
    Fetch task submissions for reports.
    Includes:
    - submission response
    - AI validation
    - task details
    - user details
    """
    if not requesting_user_id:
        raise AuthorizationError("Authentication required")
    if not await check_company_access(requesting_user_id, company_id):
        raise AuthorizationError("Access denied to this company")

    if user_id and str(user_id) != str(requesting_user_id):
        if not await check_user_permission(requesting_user_id, 'manager'):
            raise AuthorizationError("Permission denied: Manager role required to view other user's submissions")

    db = get_service_supabase_client()

    try:
        print("========== REPORT DEBUG ==========")
        print("company_id:", company_id)
        print("user_id:", user_id)
        print("assignment_id:", assignment_id)

        # 1. Fetch submissions only
        query = (
            db
            .table("task_submissions")
            .select("submission_id, assignment_id, company_id, user_id, task_id, submission_type, text_response, image_url, audio_url, video_url, answers, score, max_score, ai_validation_pass, ai_validation_verdict, ai_validation_reason, ai_validation_suggestion, ai_validation_confidence, ai_status, analysis_status, status, submitted_at")
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


        # 2. Bulk fetch tasks and users
        task_ids = list(set([s.get("task_id") for s in submissions if s.get("task_id")]))
        user_ids = list(set([s.get("user_id") for s in submissions if s.get("user_id")]))

        tasks_map = {}
        if task_ids:
            try:
                task_res = db.table("tasks").select("task_id, assignment_id, company_id, created_by, title, description, submission_format, questions, status, created_at, updated_at, expected_answer, bundle_tasks").in_("task_id", task_ids).execute()
                for t in (task_res.data or []):
                    tasks_map[t["task_id"]] = t
            except Exception as e:
                print("Bulk task fetch failed:", e)

        users_map = {}
        if user_ids:
            try:
                user_res = db.table("users").select("user_id, company_id, function_id, sub_function_id, name, email, is_active, created_at").in_("user_id", user_ids).execute()
                for u in (user_res.data or []):
                    users_map[u["user_id"]] = u
            except Exception as e:
                print("Bulk user fetch failed:", e)

        for submission in submissions:
            _format_submission_row(submission, caller_is_admin)

            tid = submission.get("task_id")
            submission["tasks"] = tasks_map.get(tid) if tid else None

            uid = submission.get("user_id")
            submission["users"] = users_map.get(uid) if uid else None

        return submissions


    except Exception as exc:

        print(
            "[task-manager] fetch_task_submissions failed:",
            exc
        )

        return []


async def reassign_task_assignment(
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
    if not created_by:
        raise AuthorizationError("Authentication required")
    if not await check_user_permission(created_by, 'manager'):
        raise AuthorizationError("Permission denied: Manager role required to reassign tasks")
    if not await check_company_access(created_by, company_id):
        raise AuthorizationError("Access denied to this company")

    db = get_service_supabase_client()

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
                db.table("training_modules")
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
                db.table("users")
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
                db.table("sub_function")
                .select("sub_function_id")
                .in_("sub_function_name", target_sub_functions)
                .execute()
            ).data
            if sub_funcs:
                target_sub_function_id = sub_funcs[0]["sub_function_id"]
        elif target_functions:
            db_level = "function"
            funcs = (
                db.table("function")
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
    audience_count = await resolve_audience_count(mock_payload, company_id, created_by)

    if mode == "copy":
        orig_assign = (
            db.table("task_assignments")
            .select("assignment_id, company_id, created_by, level, target_module_id, target_function_id, target_sub_function_id, target_user_ids, due_date, recurrence, status, total_target_count, created_at, updated_at")
            .eq("assignment_id", original_assignment_id)
            .eq("company_id", company_id)
            .maybe_single()
            .execute()
        ).data
        if not orig_assign:
            raise Exception("Original assignment not found")

        orig_tasks = (
            db.table("tasks")
            .select("task_id, assignment_id, company_id, created_by, title, description, submission_format, questions, status, created_at, updated_at, expected_answer, bundle_tasks")
            .eq("assignment_id", original_assignment_id)
            .eq("company_id", company_id)
            .execute()
        ).data or []

        new_assignment_id = str(uuid4())
        db.table("task_assignments").insert({
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
                db.table("tasks").insert({
                    "task_id": new_task_id,
                    "company_id": company_id,
                    "assignment_id": new_assignment_id,
                    "created_by": created_by or t.get("created_by"),
                    "title": t.get("title"),
                    "description": t.get("description"),
                    "submission_format": t.get("submission_format"),
                    "questions": t.get("questions") or [],
                    "status": "active",
                    "bundle_tasks": t.get("bundle_tasks") or [],
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
            "bundle_tasks": primary_task.get("bundle_tasks") or [],
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
        db.table("task_assignments").update({
            "level": db_level,
            "target_module_id": target_module_id,
            "target_function_id": target_function_id,
            "target_sub_function_id": target_sub_function_id,
            "target_user_ids": target_user_ids or None,
            "due_date": due_date,
            "recurrence": recurrence,
            "total_target_count": audience_count,
        }).eq("assignment_id", original_assignment_id).eq("company_id", company_id).execute()

        # Bugfix: Removed silent deletion of task_submissions to prevent data loss.

        updated_tasks = (
            db.table("tasks")
            .select("task_id, assignment_id, company_id, created_by, title, description, submission_format, questions, status, created_at, updated_at, expected_answer, bundle_tasks")
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
            "bundle_tasks": primary_task.get("bundle_tasks") or [],
            "status": "active",
            "due_date": due_date,
            "recurrence": recurrence,
            "level": db_level,
            "audience_display_name": audience_display_name,
            "total_target_count": audience_count,
            "completion_count": 0,
            "created_at": "",
        }
