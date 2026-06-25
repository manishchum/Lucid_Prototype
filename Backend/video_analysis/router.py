from fastapi import (
    APIRouter,
    UploadFile,
    File,
    Form,
    Depends
)

import tempfile
import os


from video_analysis.services.video_analyzer import analyze_video

from utils.auth import get_request_auth_required
from utils.supabase_client import supabase


router = APIRouter(
    prefix="/api/video-analysis",
    tags=["Video Analysis"]
)


@router.post("/submit")
async def submit_video_task(

    task_id: str = Form(...),

    video: UploadFile = File(...),

    auth = Depends(get_request_auth_required)

):


    suffix = video.filename.split(".")[-1]


    with tempfile.NamedTemporaryFile(
        delete=False,
        suffix=f".{suffix}"
    ) as tmp:

        tmp.write(
            await video.read()
        )

        video_path = tmp.name


    result = analyze_video(
        video_path,
        task_id
    )


    supabase.table(
        "task_submissions"
    ).insert({

        "task_id": task_id,

        "user_id": auth.user_id,

        "submission_type": "video",

        "score": result["overall_score"],

        "ai_result": result,

        "status": "completed"

    }).execute()


    os.remove(video_path)


    return result