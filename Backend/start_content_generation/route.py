import os
# from supabase import create_client, Client
from utils.supabase_client import supabase
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

        # Prevent duplicate jobs for the same module while pending/in-progress
        existing_resp = (
            supabase
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

        try:
            print("inside try")
            
            print("imported ingest_by_module_id")
            
            ingest_by_module_id(module_id)
            print("[RAG] Ingestion completed successfully")
             
        except Exception as ingest_error:
            print(f"[RAG ERROR] Error during ingestion: {type(ingest_error).__name__}")
            print(f"[RAG ERROR] Error message: {str(ingest_error)}")
            import traceback
            print(f"[RAG ERROR] Traceback:\n{traceback.format_exc()}") 

        # Enqueue new job
        inserted_resp = (
            supabase
            .table("content_jobs")
            .insert({"module_id": module_id, "status": "pending"}, returning="representation")
            .execute()
        )

        inserted_data = getattr(inserted_resp, "data", None)
        insertError = getattr(inserted_resp, "error", None)

        if insertError:
            print("Failed to enqueue job:", insertError)
            msg = insertError.get("message") if isinstance(insertError, dict) else getattr(insertError, "message", None)
            return JSONResponse(content={"error": msg or str(insertError)}, status_code=500)

        inserted = None
        if isinstance(inserted_data, list) and len(inserted_data) > 0:
            inserted = inserted_data[0]
        elif isinstance(inserted_data, dict):
            inserted = inserted_data

        # Some PostgREST setups may not return representation; fallback to lookup
        if not inserted:
            requery_resp = (
                supabase
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

        return JSONResponse(content={
            "started": True,
            "module_id": module_id,
            "job_id": (inserted.get("id") if inserted else None),
            "job_status": (inserted.get("status") if inserted and inserted.get("status") else "pending"),
        })

    except Exception as error:
        print("start-content-generation error:", error)
        return JSONResponse(content={"error": "Failed to enqueue content generation"}, status_code=500)
