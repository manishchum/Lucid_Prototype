from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from utils.auth import RequestAuth, get_request_auth_required, get_effective_company_id
from utils.auth_bridge import get_service_supabase_client

router = APIRouter()

@router.get("/")
async def get_all_functions(
    request: Request,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    company_id: str = Depends(get_effective_company_id)
):
    try:
        query_client = get_service_supabase_client()
        res = query_client.table("function").select("*, sub_functions:sub_function(*)").eq("company_id", company_id).order("function_name").execute()
        return JSONResponse(content={"data": res.data})
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)
