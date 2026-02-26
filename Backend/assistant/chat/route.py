from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from supabase import create_client, Client
import os

router = APIRouter()

supabase: Client = create_client(
    os.environ["NEXT_PUBLIC_SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_ROLE_KEY"]
)


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
            .single() \
            .execute()

        data = res.data
        error = res.error

        if error:
            print("[assistant/chat] supabase select error", {
                "user": userId,
                "error": error
            })

            # return empty array instead of failure
            return JSONResponse({"chat": []})

        chat = data["chat"] if (data and isinstance(data.get("chat"), list)) else []

        return JSONResponse({"chat": chat})

    except Exception as e:
        print("[assistant/chat] unexpected error", e)

        return JSONResponse(
            {"error": "unexpected error"},
            status_code=500
        )