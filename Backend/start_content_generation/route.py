import os
from supabase import create_client, Client
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter()

# Supabase admin client
supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
supabase_service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabaseAdmin: Client = create_client(supabase_url, supabase_service_role_key)


# Enqueue content generation for a training module
# POST body: { module_id: string }
@router.post("/start-content-generation")
async def POST(req: Request):
    try:
        try:
            body = await req.json()
        except Exception:
            body = {}

        module_id = body.get("module_id") or body.get("moduleId")

        if (not module_id) or (not isinstance(module_id, str)) or module_id.strip() == "":
            return JSONResponse(content={"error": "Missing or invalid module_id"}, status_code=400)

        # Prevent duplicate jobs for the same module while pending/in-progress
        existing_resp = (
            supabaseAdmin
            .table("content_jobs")
            .select("id, status")
            .eq("module_id", module_id)
            .in_("status", ["pending", "in-progress"])
            .limit(1)
            .execute()
        )

        existing = getattr(existing_resp, "data", None)
        existingError = getattr(existing_resp, "error", None)

        if existingError:
            print("Failed to check existing jobs:", existingError)
            return JSONResponse(content={"error": existingError.message}, status_code=500)

        if existing and len(existing) > 0:
            return JSONResponse(content={
                "message": "Job already queued or in progress",
                "module_id": module_id,
                "job_status": existing[0].get("status"),
            })

        # Enqueue new job
        inserted_resp = (
            supabaseAdmin
            .table("content_jobs")
            .insert({"module_id": module_id, "status": "pending"})
            .select("id, status")
            .maybe_single()
            .execute()
        )

        inserted = getattr(inserted_resp, "data", None)
        insertError = getattr(inserted_resp, "error", None)

        if insertError:
            print("Failed to enqueue job:", insertError)
            return JSONResponse(content={"error": insertError.message}, status_code=500)

        return JSONResponse(content={
            "started": True,
            "module_id": module_id,
            "job_id": (inserted.get("id") if inserted else None),
            "job_status": (inserted.get("status") if inserted and inserted.get("status") else "pending"),
        })

    except Exception as error:
        print("start-content-generation error:", error)
        return JSONResponse(content={"error": "Failed to enqueue content generation"}, status_code=500)
