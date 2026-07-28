from utils.supabase_client import supabase

def resolve_task_details(task_id: str, company_id: str) -> dict:
    """
    Resolves task details by checking if the task_id is a child task of a bundle
    (e.g., has a suffix like '-[index]' or '-[format]').
    """
    resolved_id = task_id
    child_index = None
    
    if "-" in task_id:
        parts = task_id.rsplit("-", 1)
        if parts[1].isdigit():
            resolved_id = parts[0]
            child_index = int(parts[1])
        elif parts[1] in ["image", "text", "audio", "video", "multiple_choice"]:
            resolved_id = parts[0]
            
    try:
        res = (
            supabase.table("tasks")
            .select("id,assignment_id,company_id,title,description,submission_format,questions,expected_answer,status,bundle_tasks")
            .eq("task_id", resolved_id)
            .eq("company_id", company_id)
            .maybe_single()
            .execute()
        )
        task_row = res.data or {}
        
        if task_row and child_index is not None:
            bundle_tasks = task_row.get("bundle_tasks") or []
            if 0 <= child_index < len(bundle_tasks):
                child_task = bundle_tasks[child_index]
                return {
                    "task_id": task_id,
                    "parent_task_id": resolved_id,
                    "company_id": company_id,
                    "assignment_id": task_row.get("assignment_id"),
                    "title": child_task.get("title", ""),
                    "description": child_task.get("description", ""),
                    "submission_format": child_task.get("submission_format") or "text",
                    "questions": child_task.get("questions") or [],
                    "expected_answer": child_task.get("expected_answer") or task_row.get("expected_answer"),
                    "status": task_row.get("status", "active"),
                    "bundle_tasks": [],
                }
        return task_row
    except Exception as e:
        print(f"[task-resolver] Error resolving task {task_id}: {e}")
        return {}
