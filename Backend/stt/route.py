import os
import io
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from openai import OpenAI

from utils.auth import (
    RequestAuth,
    get_request_auth_required,
)
from utils.redis_limiter import check_rate_limit

router = APIRouter()

client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY")
)

MAX_AUDIO_SIZE = 25 * 1024 * 1024  # 25 MB


@router.post("/speech-to-text")
async def speech_to_text(
    audio: UploadFile = File(...),
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    
   
    await check_rate_limit(
        user_id=auth_ctx.user_id,
        endpoint="speech-to-text"
    )

    
    if not os.getenv("OPENAI_API_KEY"):
        raise HTTPException(
            status_code=500,
            detail="OpenAI API key not configured"
        )


    if not audio:
        raise HTTPException(
            status_code=400,
            detail="No audio file provided"
        )

    file_bytes = await audio.read()

    file_size = len(file_bytes)

    print(
        f"[STT] Received: "
        f'name="{audio.filename}", '
        f"size={file_size / 1024:.2f} KB, "
        f'type="{audio.content_type}"'
    )

    if file_size < 1000:
        raise HTTPException(
            status_code=400,
            detail="Audio file too small — likely no audio captured"
        )

    if file_size > MAX_AUDIO_SIZE:
        raise HTTPException(
            status_code=413,
            detail="Audio exceeds 25MB limit"
        )

    
    await audio.seek(0)

    print(
        f"[STT] Sending {file_size / 1024:.2f} KB to GPT-4o Mini Transcribe..."
    )

   
    buffer = io.BytesIO(file_bytes)
    buffer.name = audio.filename or "audio.webm"
    transcription = client.audio.transcriptions.create(
        model="gpt-4o-mini-transcribe",
        file=audio.file,
    )

    print("[STT] Transcription:", transcription.text)

    if not transcription.text or not transcription.text.strip():
        raise HTTPException(
            status_code=400,
            detail="No speech detected"
        )

    return JSONResponse(
        {
            "text": transcription.text.strip(),
            "processingMethod": "gpt-4o-mini-transcribe",
        }
    )