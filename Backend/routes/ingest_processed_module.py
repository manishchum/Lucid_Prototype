from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from utils.supabase_client import supabase_admin
from ingestion.processed_module_rag import ingest_processed_module_vectors

router = APIRouter()

@router.post("/api/ingest-processed-module")
async def ingest_processed_module_endpoint(req: Request):
    """
    Triggers Q&A chunking and vector embedding for a processed module or all processed modules of a sprint.
    JSON Body:
      - processed_module_id (optional): ID of specific processed module
      - module_id (optional): original sprint module ID
    """
    try:
        body = await req.json()
    except Exception:
        body = {}

    processed_module_id = body.get("processed_module_id")
    module_id = body.get("module_id")

    if not processed_module_id and not module_id:
        return JSONResponse(
            content={"error": "Missing required field: processed_module_id or module_id"},
            status_code=400
        )

    target_ids = []
    if processed_module_id:
        target_ids.append(processed_module_id)
    elif module_id:
        # Fetch all processed_module_ids for this original_module_id
        res = (
            supabase_admin
            .table("processed_modules")
            .select("processed_module_id")
            .eq("original_module_id", module_id)
            .execute()
        )
        data = getattr(res, "data", []) or []
        target_ids = [row["processed_module_id"] for row in data if row.get("processed_module_id")]

    if not target_ids:
        return JSONResponse(
            content={"success": False, "message": "No processed modules found to ingest."},
            status_code=44
        )

    results = []
    for pid in target_ids:
        try:
            res = await ingest_processed_module_vectors(pid)
            results.append(res)
        except Exception as e:
            print(f"[INGEST_EP_ERROR] Failed for processed_module_id {pid}: {e}")
            results.append({"processed_module_id": pid, "status": "error", "error": str(e)})

    return JSONResponse(content={
        "success": True,
        "processed_count": len(results),
        "details": results
    })
