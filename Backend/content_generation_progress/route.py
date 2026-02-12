import os
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from utils.supabase_client import supabase


router = APIRouter()

# # Supabase init (same behavior as "@/lib/supabase")
# supabaseUrl = os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL") or ""
# supabaseKey = (
#     os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
#     or os.getenv("SUPABASE_ANON_KEY")
#     or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
#     or ""
# )
# supabase: Client = create_client(supabaseUrl, supabaseKey)


@router.get("/processing-status")
async def GET(req: Request):
    module_id = req.query_params.get("module_id")
    if not module_id:
        return JSONResponse(content={"error": "Missing module_id"}, status_code=400)

    # Get processed_modules progress
    pmRes = (
        supabase
        .table("processed_modules")
        .select("content")
        .eq("original_module_id", module_id)
        .execute()
    )

    rows = getattr(pmRes, "data", None)
    error = getattr(pmRes, "error", None)

    if error:
        msg = error.get("message") if isinstance(error, dict) else str(error)
        return JSONResponse(content={"error": msg}, status_code=500)

    total = len(rows) if isinstance(rows, list) else 0
    completed = (
        len([r for r in rows if isinstance(r, dict) and r.get("content") and str(r.get("content")).strip() != ""])
        if isinstance(rows, list)
        else 0
    )
    percent = round((completed / total) * 100) if total else 0

    # Get job status from content_jobs
    jobStatus = None
    jobsRes = (
        supabase
        .table("content_jobs")
        .select("status")
        .eq("module_id", module_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    jobs = getattr(jobsRes, "data", None)
    jobError = getattr(jobsRes, "error", None)

    if (not jobError) and jobs and isinstance(jobs, list) and len(jobs) > 0:
        jobStatus = jobs[0].get("status")

    return JSONResponse(content={"total": total, "completed": completed, "percent": percent, "jobStatus": jobStatus})
