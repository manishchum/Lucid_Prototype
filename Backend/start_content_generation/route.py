import os
# from supabase import create_client, Client
from utils.auth_bridge import get_service_supabase_client
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from ingestion.ingest_from_upload import ingest_by_module_id

router = APIRouter()

# Supabase admin client
# supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
# supabase_service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
# supabaseAdmin: Client = create_client(supabase_url, supabase_service_role_key)


# Enqueue content generation for a training module
# POST body: { module_id: string }
@router.post("/start-content-generation")
async def POST(req: Request):
    try:
        print("Received start-content-generation request")
        try:
            body = await req.json()
        except Exception:
            body = {}

        module_id = body.get("moduleId")
        print("Received start-content-generation for module_id:", module_id)
        if (not module_id) or (not isinstance(module_id, str)) or module_id.strip() == "":
            print("Invalid module_id in request")
            
            return JSONResponse(content={"error": "Missing or invalid module_id"}, status_code=400)

        db = get_service_supabase_client()
        # Prevent duplicate jobs for the same module while pending/in-progress
        existing_resp = (
            db
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
            msg = existingError.get("message") if isinstance(existingError, dict) else getattr(existingError, "message", None)
            return JSONResponse(content={"error": msg or str(existingError)}, status_code=500)

        if existing and len(existing) > 0:
            return JSONResponse(content={
                "message": "Job already queued or in progress",
                "module_id": module_id,
                "job_status": existing[0].get("status"),
            })

        # Check if caller explicitly requested synchronous execution
        is_sync = req.query_params.get("sync", "").lower() in ("true", "1") or body.get("sync") is True
        user_id = req.headers.get("X-User-ID") or body.get("user_id")

        if is_sync:
            try:
                ingest_by_module_id(module_id)
            except Exception as ingest_error:
                print(f"[RAG ERROR] Synchronous ingestion error: {ingest_error}")

            inserted_resp = (
                db.table("content_jobs")
                .insert({"module_id": module_id, "status": "pending"})
                .execute()
            )
            inserted_data = getattr(inserted_resp, "data", None)
            inserted_id = inserted_data[0].get("id") if (isinstance(inserted_data, list) and inserted_data) else None

            return JSONResponse(content={
                "started": True,
                "module_id": module_id,
                "job_id": inserted_id,
                "job_status": "pending",
                "sync": True,
            })

        # Offload RAG ingestion and content job trigger to distributed ARQ queue
        from utils.ai_job_manager import create_ai_job
        from utils.arq_client import enqueue_job

        job_id = await create_ai_job(
            job_type="content_generation",
            user_id=user_id,
            params={"moduleId": module_id},
        )

        await enqueue_job(
            "run_ai_content_generation_task",
            job_id,
            user_id,
            module_id,
        )

        return JSONResponse(content={
            "started": True,
            "module_id": module_id,
            "job_id": job_id,
            "job_status": "pending",
            "message": "Content generation and RAG ingestion queued in background worker",
        }, status_code=202)

    except Exception as error:
        print("start-content-generation error:", error)
        return JSONResponse(content={"error": "Failed to enqueue content generation"}, status_code=500)
