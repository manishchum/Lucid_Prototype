from fastapi import (
APIRouter,
UploadFile,
File,
Header,
HTTPException
)
from utils.auth import _extract_bearer_token
from utils.supabase_client import get_rls_client
from .services.gemini_audio import analyze_audio_with_gemini

router=APIRouter(
prefix="/api/audio",
tags=["audio"]
)


@router.post("/analyze")
async def analyze(
file:UploadFile=File(...),
authorization:str=Header(...),
x_company_id:str=Header(...)
):
    token = _extract_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")

    get_rls_client(token)
    audio=await file.read()
    analysis=analyze_audio_with_gemini(
        audio,
        file.content_type
    )
    return {
    "success":True,
    "company_id":x_company_id,
    "analysis":analysis
    }
