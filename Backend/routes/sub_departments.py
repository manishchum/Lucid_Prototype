from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from utils.auth import RequestAuth, get_request_auth_required
from utils.auth_bridge import get_service_supabase_client

router = APIRouter()

@router.get("/")
async def get_all_sub_departments(
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    try:
        query_client = get_service_supabase_client()
        res = query_client.table("sub_department").select("*").order("department_name").order("sub_department_name").execute()
        return JSONResponse(content={"data": res.data})
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)
