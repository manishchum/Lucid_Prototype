from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from utils.supabase_client import supabase

router = APIRouter()


@router.get("/assistant/chat")
async def GET(request: Request):
    try:
        # const searchParams = request.nextUrl.searchParams;
        # const userId = searchParams.get('user_id') || '';

        searchParams = request.query_params
        userId = searchParams.get("user_id") or ""

        if not userId:
            return JSONResponse(
                {"error": "user_id required"},
                status_code=400
            )

        res = supabase.table("chatbot_user_interactions") \
            .select("ask_doubt") \
            .eq("user_id", userId) \
            .limit(1) \
            .execute()

        rows = res.data if hasattr(res, 'data') else []
        data = rows[0] if rows else None

        chat = data["ask_doubt"] if (data and isinstance(data.get("ask_doubt"), list)) else []

        return JSONResponse({"chat": chat})

    except Exception as e:
        print("[assistant/chat] unexpected error", e)

        return JSONResponse(
            {"error": "unexpected error"},
            status_code=500
        )