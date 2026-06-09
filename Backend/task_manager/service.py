import json
import os
import re
from typing import Optional
from uuid import uuid4

import google.generativeai as genai

from utils.supabase_client import supabase

from .models import SubmissionCreate, TaskCreate


def _gemini_model():
    api_key = os.getenv("GEMINI_API_KEY") or ""
    if not api_key:
        return None

    genai.configure(api_key=api_key)
    return genai.GenerativeModel("gemini-3-pro-preview")


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


def get_active_tasks(company_id: str) -> list:
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

    try:
        submissions = (
            supabase.table("task_submissions")
            .select("assignment_id")
            .in_("assignment_id", assignment_ids)
            .eq("company_id", company_id)
            .execute()
        ).data or []
    except Exception as submission_error:
        print("[task-manager] submissions query with company filter failed, retrying without company_id:", submission_error)
        try:
            submissions = (
                supabase.table("task_submissions")
                .select("assignment_id")
                .in_("assignment_id", assignment_ids)
                .execute()
            ).data or []
        except Exception as retry_error:
            print("[task-manager] submissions query failed completely:", retry_error)
            submissions = []

    completion_map = {}
    for submission in submissions:
        assignment_id = submission["assignment_id"]
        completion_map[assignment_id] = completion_map.get(assignment_id, 0) + 1

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
        # keep latest submission per assignment
        if not aid:
            continue
        if aid not in submission_by_assignment:
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
                payload.audio_url,


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


