# from fastapi import (
#     APIRouter,
#     UploadFile,
#     File,
#     Form,
#     Depends
# )

# import tempfile
# import os
# from typing import Dict, Any

# from video_analysis.services.frame_extractor import extract_frames
# from video_analysis.services.gemini_video import analyze_video_frames

# from utils.auth import get_request_auth_required
# from utils.supabase_client import supabase


# router = APIRouter(prefix="/api/video-analysis", tags=["Video Analysis"])


# @router.post("/submit")
# async def submit_video_task(
#     task_id: str = Form(...),
#     video: UploadFile = File(...),
#     auth = Depends(get_request_auth_required),
# ):
#     """Endpoint to accept an uploaded video, analyze it, and store the AI result."""

#     # save temp video
#     suffix = video.filename.split(".")[-1]
#     with tempfile.NamedTemporaryFile(delete=False, suffix=f".{suffix}") as tmp:
#         tmp.write(await video.read())
#         video_path = tmp.name

#     # get task details (graceful if missing)
#     from utils.task_resolver import resolve_task_details
#     task = resolve_task_details(task_id, auth.company_id)
#     task_description = task.get("description", "")

#     resolved_task_id = task.get("parent_task_id") or task_id
#     db_answers = []
#     if task.get("parent_task_id"):
#         db_answers.append({"child_task_id": task_id})

#     result = analyze_video(video_path, task_description)

#     # save result
#     supabase.table("task_submissions").insert(
#         {
#             "task_id": resolved_task_id,
#             "user_id": auth.user_id,
#             "submission_type": "video",
#             "score": result.get("overall_score", 0),
#             "ai_analysis": result,
#             "status": "completed",
#             "answers": db_answers,
#         }
#     ).execute()

#     try:
#         os.remove(video_path)
#     except Exception:
#         pass

#     return result


# def analyze_video(video_path: str, task_description: str) -> Dict[str, Any]:
#     """Extract frames from a video and call the gemini analyzer.

#     Returns the parsed JSON result as a dict. Ensures an `overall_score` key exists.
#     """

#     frames = extract_frames(video_path, max_frames=20)
#     result = analyze_video_frames(frames, task_description)

#     if isinstance(result, dict) and "overall_score" not in result:
#         vs = result.get("visual_score") or 0
#         try:
#             result["overall_score"] = int(vs)
#         except Exception:
#             result["overall_score"] = 0

#     return result