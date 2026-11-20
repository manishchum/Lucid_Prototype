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
    import time
    import traceback

    client_ip = getattr(req.client, "host", "unknown")
    t0 = time.time()
    print(f"\n[START-CONTENT-GEN] >>> POST /start-content-generation received from {client_ip}")

    try:
        try:
            body = await req.json()
        except Exception as json_err:
            print(f"[START-CONTENT-GEN] ❌ Failed to parse JSON request body: {json_err}")
            body = {}

        module_id = body.get("moduleId") or body.get("module_id")
        print(f"[START-CONTENT-GEN] Extracted module_id: '{module_id}' from body: {body}")

        if (not module_id) or (not isinstance(module_id, str)) or module_id.strip() == "":
            print(f"[START-CONTENT-GEN] ❌ Missing or invalid module_id: {module_id}")
            return JSONResponse(content={"error": "Missing or invalid module_id"}, status_code=400)

        module_id = module_id.strip()
        db = get_service_supabase_client()

        # Prevent duplicate jobs for the same module while pending/in-progress
        print(f"[START-CONTENT-GEN] Checking existing jobs for module_id={module_id}...")
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
            print(f"[START-CONTENT-GEN] ❌ Failed to check existing jobs: {existingError}")
            msg = existingError.get("message") if isinstance(existingError, dict) else getattr(existingError, "message", None)
            return JSONResponse(content={"error": msg or str(existingError)}, status_code=500)

        if existing and len(existing) > 0:
            print(f"[START-CONTENT-GEN] ℹ️ Job already queued/in-progress for module_id={module_id} (job_id={existing[0].get('id')}, status={existing[0].get('status')})")
            return JSONResponse(content={
                "message": "Job already queued or in progress",
                "module_id": module_id,
                "job_status": existing[0].get("status"),
                "job_id": existing[0].get("id")
            })

        # Run RAG ingestion
        print(f"[START-CONTENT-GEN] Starting RAG vector ingestion (ingest_by_module_id) for module_id={module_id}...")
        t_rag = time.time()
        try:
            ingest_by_module_id(module_id)
            print(f"[START-CONTENT-GEN] ✅ [RAG] Ingestion completed in {time.time() - t_rag:.2f}s for module_id={module_id}")
        except Exception as ingest_error:
            print(f"[START-CONTENT-GEN] ⚠️ [RAG ERROR] Ingestion exception after {time.time() - t_rag:.2f}s: {type(ingest_error).__name__}: {ingest_error}")
            print(f"[START-CONTENT-GEN] Traceback:\n{traceback.format_exc()}")
            # We log but continue to enqueue job so processing can still proceed

        # Enqueue new job
        print(f"[START-CONTENT-GEN] Enqueuing new job into content_jobs for module_id={module_id}...")
        inserted_resp = (
            db
            .table("content_jobs")
            .insert({"module_id": module_id, "status": "pending"}, returning="representation")
            .execute()
        )

        inserted_data = getattr(inserted_resp, "data", None)
        insertError = getattr(inserted_resp, "error", None)

        if insertError:
            print(f"[START-CONTENT-GEN] ❌ Failed to enqueue job: {insertError}")
            msg = insertError.get("message") if isinstance(insertError, dict) else getattr(insertError, "message", None)
            return JSONResponse(content={"error": msg or str(insertError)}, status_code=500)

        inserted = None
        if isinstance(inserted_data, list) and len(inserted_data) > 0:
            inserted = inserted_data[0]
        elif isinstance(inserted_data, dict):
            inserted = inserted_data

        # Fallback query if returning representation was not returned
        if not inserted:
            print(f"[START-CONTENT-GEN] Representation not returned, querying inserted job...")
            requery_resp = (
                db
                .table("content_jobs")
                .select("id, status")
                .eq("module_id", module_id)
                .order("id", desc=True)
                .limit(1)
                .execute()
            )
            requery_data = getattr(requery_resp, "data", None)
            if isinstance(requery_data, list) and len(requery_data) > 0:
                inserted = requery_data[0]

        job_id = inserted.get("id") if inserted else None
        job_status = inserted.get("status") if inserted and inserted.get("status") else "pending"
        elapsed_total = time.time() - t0

        print(f"[START-CONTENT-GEN] ✅ Successfully enqueued job_id={job_id} (status={job_status}) in {elapsed_total:.2f}s total.")
        return JSONResponse(content={
            "started": True,
            "module_id": module_id,
            "job_id": job_id,
            "job_status": job_status,
        })

    except Exception as error:
        print(f"[START-CONTENT-GEN] ❌ Critical error in start-content-generation:")
        print(f"  Type: {type(error).__name__}")
        print(f"  Error: {error}")
        print(f"  Traceback:\n{traceback.format_exc()}")
        return JSONResponse(content={"error": f"Failed to enqueue content generation: {type(error).__name__}: {error}"}, status_code=500)
