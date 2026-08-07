import asyncio
import sys
import os

if sys.platform.startswith("win"):
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())


# Import FastAPI and middleware Routes
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import HTTPException
from config import FRONTEND_URL
from utils.exceptions import ApiException
from utils.logging import ErrorLogger
from openai_upload.route import router as openai_upload_router
from start_content_generation.route import router as start_content_generation_router
from learning_style.route import router as learning_style_router
from gpt_mcq_quiz.route import router as gpt_mcq_quiz_router
from gpt_feedback.route import router as gpt_feedback_router
from submit_assessment.route import router as submit_assessment_router
from training_plan.route import router as training_plan_router
from content_generation_progress.route import router as content_generation_progress_router
from tts.route import router as tts_router
from gpt_video_generation.route import router as gpt_video_generation_router
from generate_infographic.route import router as generate_infographic_router
from flashcard_generation.route import router as flashcard_generation_router
from generate_mindmap.route import router as generate_mindmap_router
from module_chat.route import router as module_chat
# from assistant.route import router as assistant_router
# from assistant.chat.route import router as assistant_chat_router
from change_password.route import router as change_password_router
from task_manager.router import router as task_manager_router
from text_analysis.route import router as text_analysis_router
from stt.route import router as stt_router
from routes import users, roles, assessments, companies, content_jobs, learning_plan, learning_style, training_modules, dispatch, processed_modules, module_progress, content_generation_history, employee_assessment, notifications, employees, reports, content_library, auth
from routes.analytics_export import router as analytics_export_router
from routes.career_journeys import router as career_journeys_router
from routes.employee_dashboard import router as employee_dashboard_router
from routes.analytics import router as analytics_router
from routes.admin_uploads import router as admin_uploads_router
from voice_document.route import router as voice_document_router
from voice_document.transcripts import router as voice_transcripts_router
from routes.uploads import router as uploads_router
from roleplay.route import router as roleplay_router

# Import user routes
# from routes.users import router as users_router
# from roleplay.assessment.route import router as roleplay_assessment_router
# from roleplay.assessment.conversation.route import router as roleplay_conversation_router
# from roleplay.realtime_ws.route import router as roleplay_realtime_router
# from roleplay.scenario.route import router as roleplay_scenario_router
# from roleplay.page.route import router as roleplay_page_router
# from roleplay.sessions.route import router as roleplay_sessions_router
from ingestion.embedder import router as embed_router
from routes import functions
from config import IS_PRODUCTION

# Create FastAPI app
app = FastAPI(
    title="Lucid Backend API",
    description="Backend API for Lucid Learning Platform",
    version="1.0.0",
    
    docs_url=None if IS_PRODUCTION else "/docs",
    redoc_url=None if IS_PRODUCTION else "/redoc",
    openapi_url=None if IS_PRODUCTION else "/openapi.json"
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Catch-all exception handler that returns a JSONResponse and ensures CORS headers are present.

    This is a safety net: it avoids opaque CORS failures in the browser when an internal
    server error would otherwise return a response without the expected CORS headers.
    """
    import traceback
    from utils.exceptions import ApiException

    # Log the traceback to stdout/stderr so it's visible in server logs
    tb = traceback.format_exc()
    print("[global error]", tb)

    # If this is a FastAPI HTTPException, preserve its status code and detail
    if isinstance(exc, HTTPException):
        # exc.detail can be str or dict
        content = {"detail": exc.detail}
        status_code = exc.status_code
    # If we have a known ApiException, use its structured payload and status
    elif isinstance(exc, ApiException):
        content = exc.to_dict()
        status_code = exc.status_code
    else:
        # Generic error payload
        content = {"detail": "Internal Server Error"}
        status_code = 500

    # Ensure we return CORS headers matching configured frontend origin or request Origin
    origin = request.headers.get("origin") or FRONTEND_URL
    headers = {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
    }

    return JSONResponse(status_code=status_code, content=content, headers=headers)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        FRONTEND_URL,
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "localhost:3000",
        "127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {"message": "Lucid Backend API is running"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.on_event("startup")
async def startup_event():
    from analysis.models import load_all_models
    load_all_models()

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    from fastapi import Response
    return Response(status_code=204)

# @app.get("/debug/user/{user_id}")
# async def debug_user(user_id: str):
#     """Debug endpoint to check user permissions"""
#     from utils.db.permissions import check_user_permission, check_company_access
#     from utils.supabase_client import supabase
    
#     # Get user info
#     user = supabase.table('users').select('company_id, name').eq('user_id', user_id).single().execute()
    
#     # Get role assignments
#     roles = supabase.table('user_role_assignments').select(', role:roles()').eq('user_id', user_id).eq('is_active', True).execute()
    
#     # Check permissions
#     has_manager = await check_user_permission(user_id, 'manager')
#     company_id = user.data.get('company_id') if user.data else None
#     has_company = await check_company_access(user_id, company_id) if company_id else False
    
#     return {
#         "user": user.data,
#         "roles": roles.data,
#         "has_manager_permission": has_manager,
#         "has_company_access": has_company
#     }


# @app.get("/api/debug/whoami")
# async def debug_whoami(request: Request):
#     """Return the raw request headers and a resolved RequestAuth using the optional auth helper.

#     Useful for debugging what the backend actually receives from the browser (headers,
#     resolved user id via X-User-ID or Authorization bearer token, etc.).
#     """
#     try:
#         from utils.auth import get_request_auth_optional

#         auth_ctx = get_request_auth_optional(
#             authorization=request.headers.get("Authorization"),
#             x_user_id=request.headers.get("X-User-ID"),
#         )
#         auth_data = {
#             "user_id": getattr(auth_ctx, "user_id", None),
#             "email": getattr(auth_ctx, "email", None),
#             "source": getattr(auth_ctx, "source", None),
#         }
#     except Exception as exc:  # pragma: no cover - debugging helper
#         auth_data = {"error": str(exc)}

#     # Return a subset of headers for readability
#     hdrs = {k: v for k, v in request.headers.items()}
#     return {"headers": hdrs, "auth": auth_data}

# Include routers
app.include_router(openai_upload_router, prefix="/api", tags=["openai-upload"])
app.include_router(start_content_generation_router, prefix="/api", tags=["content-generation"])
app.include_router(learning_style_router, prefix="/api", tags=["learning-style"])
app.include_router(gpt_mcq_quiz_router, prefix="/api", tags=["gpt-mcq-quiz"])
app.include_router(gpt_feedback_router, prefix="/api", tags=["gpt-feedback"])
app.include_router(submit_assessment_router, prefix="/api", tags=["submit-assessment"])
app.include_router(training_plan_router, prefix="/api", tags=["training-plan"])
app.include_router(content_generation_progress_router, prefix="/api", tags=["content-generation-progress"])
app.include_router(tts_router, prefix="/api", tags=["text-to-speech"])
app.include_router(gpt_video_generation_router, prefix="/api", tags=["gpt-video-generation"])
app.include_router(generate_infographic_router, prefix="/api", tags=["generate-infographic"])
app.include_router(flashcard_generation_router, prefix="/api", tags=["flashcard-generation"])
app.include_router(generate_mindmap_router, prefix="/api", tags=["generate-mindmap"])
# app.include_router(roleplay_assessment_router, prefix="/api", tags=["roleplay-assessment"])
# # app.include_router(roleplay_conversation_router, prefix="/api", tags=["roleplay-conversation"])
# app.include_router(roleplay_scenario_router, prefix="/api", tags=["roleplay-scenarios"])
# app.include_router(roleplay_page_router, prefix="/api", tags=["roleplay-page"])
# app.include_router(roleplay_sessions_router, prefix="/api", tags=["roleplay-sessions"])
# app.include_router(roleplay_realtime_router, tags=["roleplay-realtime"])
app.include_router(roleplay_router, prefix="/api", tags=["roleplay"])
app.include_router(embed_router, prefix="/api", tags=["embeddings"])
app.include_router(module_chat, prefix="/api", tags=["module-chat"])
# app.include_router(assistant_router, prefix="/api", tags=["assistant"])
# app.include_router(assistant_chat_router, prefix="/api", tags=["assistant-chat"])
app.include_router(change_password_router, prefix="/api", tags=["change-password"])
app.include_router(task_manager_router, prefix="/api", tags=["task-manager"])
app.include_router(career_journeys_router, prefix="/api", tags=["career-journeys"])
app.include_router(stt_router, prefix="/api", tags=["speech-to-text"])
app.include_router(text_analysis_router, prefix="/api/text-analysis", tags=["text-analysis"])
app.include_router(employee_dashboard_router)  # employee dashboard summary router
app.include_router(analytics_router)  # analytics router with dashboard and other analytics endpoints
app.include_router(admin_uploads_router)  # admin uploads router
app.include_router(voice_document_router)  # voice-to-document agent router
app.include_router(voice_transcripts_router)  # voice transcript / daily report router


# Router Includes are here
# app.include_router(users_router, prefix="/api/users", tags=["users Router"])
app.include_router(users.router)  # add this line (place with other app.include_router calls)
app.include_router(functions.router, prefix="/api/functions", tags=["functions"])
app.include_router(roles.router)  # roles router
app.include_router(assessments.router)  # assessments router
app.include_router(companies.router)  # companies router
app.include_router(content_jobs.router)  # content jobs router
app.include_router(content_generation_history.router)  # content generation history router
app.include_router(learning_plan.router)  # learning plan router
app.include_router(learning_style.router)  # learning style router
app.include_router(training_modules.router)  # training modules router
app.include_router(employees.router)  # employees bootstrap router
app.include_router(processed_modules.router)  # processed modules router
app.include_router(dispatch.router)  # dispatch router
app.include_router(module_progress.router)  # module progress router
app.include_router(employee_assessment.router)  # employee assessment router
app.include_router(analytics_export_router)  # analytics export router
app.include_router(notifications.router)
app.include_router(reports.router)  # notifications router
app.include_router(content_library.router)  # content library router
app.include_router(uploads_router, prefix="/api")
app.include_router(auth.router)


if __name__ == "__main__":
    import uvicorn
    from config import HOST, PORT
    uvicorn.run("main:app", host=HOST, port=PORT, reload=True)