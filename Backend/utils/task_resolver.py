from utils.auth_bridge import get_service_supabase_client

def resolve_task_details(task_id: str, company_id: str) -> dict:
    """
    Resolves task details by checking:
    1. Direct task_id in tasks table
    2. child_task_id in child_tasks table (for bundle subtasks)
    3. Composite task_id with suffix like '<uuid>-<index>' or '<uuid>-<format>'
    """
    if not task_id:
        return {}

    db = get_service_supabase_client()
    resolved_id = str(task_id).strip()
    child_index = None

    # Check if task_id has a synthetic composite suffix: <uuid>-<index> or <uuid>-<format>
    if "-" in resolved_id and len(resolved_id) > 36:
        parts = resolved_id.rsplit("-", 1)
        if len(parts) == 2 and len(parts[0]) == 36:
            if parts[1].isdigit():
                resolved_id = parts[0]
                child_index = int(parts[1])
            elif parts[1] in ["image", "text", "audio", "video", "multiple_choice"]:
                resolved_id = parts[0]

    try:
        # 1. Try querying tasks table directly
        res = (
            db.table("tasks")
            .select("task_id,assignment_id,company_id,title,description,submission_format,questions,expected_answer,analyzing_parameters,status,bundle_tasks")
            .eq("task_id", resolved_id)
            .maybe_single()
            .execute()
        )
        task_row = (res.data if res else None) or {}

        # If resolved task is found and a child_index was extracted:
        if task_row and child_index is not None:
            bundle_tasks = task_row.get("bundle_tasks") or []
            if 0 <= child_index < len(bundle_tasks):
                child_task = bundle_tasks[child_index]
                return {
                    "task_id": task_id,
                    "parent_task_id": resolved_id,
                    "company_id": task_row.get("company_id") or company_id,
                    "assignment_id": task_row.get("assignment_id"),
                    "title": child_task.get("title", ""),
                    "description": child_task.get("description", ""),
                    "submission_format": child_task.get("submission_format") or "text",
                    "questions": child_task.get("questions") or [],
                    "expected_answer": child_task.get("expected_answer") or task_row.get("expected_answer"),
                    "analyzing_parameters": child_task.get("analyzing_parameters") or task_row.get("analyzing_parameters"),
                    "status": task_row.get("status", "active"),
                    "bundle_tasks": [],
                }
            return task_row

        if task_row:
            return task_row

        # 2. If not found in tasks, check child_tasks table (for bundle subtasks)
        c_res = (
            db.table("child_tasks")
            .select("child_task_id,parent_task_id,company_id,title,description,submission_format,expected_answer,analyzing_parameters,questions,order_index")
            .eq("child_task_id", resolved_id)
            .maybe_single()
            .execute()
        )
        child_row = (c_res.data if c_res else None) or {}

        if child_row:
            parent_id = child_row.get("parent_task_id")
            parent_row = {}
            if parent_id:
                p_res = (
                    db.table("tasks")
                    .select("task_id,assignment_id,company_id,status,title,description,expected_answer,analyzing_parameters")
                    .eq("task_id", parent_id)
                    .maybe_single()
                    .execute()
                )
                parent_row = (p_res.data if p_res else None) or {}

            return {
                "task_id": child_row.get("child_task_id"),
                "parent_task_id": parent_id,
                "company_id": child_row.get("company_id") or parent_row.get("company_id") or company_id,
                "assignment_id": parent_row.get("assignment_id"),
                "title": child_row.get("title") or parent_row.get("title", ""),
                "description": child_row.get("description") or parent_row.get("description", ""),
                "submission_format": child_row.get("submission_format") or "text",
                "questions": child_row.get("questions") or [],
                "expected_answer": child_row.get("expected_answer") or parent_row.get("expected_answer"),
                "analyzing_parameters": child_row.get("analyzing_parameters") or parent_row.get("analyzing_parameters"),
                "status": parent_row.get("status", "active"),
                "bundle_tasks": [],
            }

        return {}
    except Exception as e:
        print(f"[task-resolver] Error resolving task {task_id}: {e}")
        return {}
