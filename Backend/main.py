import asyncio
import sys

if sys.platform.startswith("win"):
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())


# Import FastAPI and middleware Routes
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import FRONTEND_URL
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
from routes import users  # add this line

# Import user routes
# from routes.users import router as users_router
from roleplay.assessment.route import router as roleplay_assessment_router
from roleplay.assessment.conversation.route import router as roleplay_conversation_router

# Create FastAPI app
app = FastAPI(
    title="Lucid Backend API",
    description="Backend API for Lucid Learning Platform",
    version="1.0.0"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL, "http://localhost:3000"],
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

@app.get("/debug/user/{user_id}")
async def debug_user(user_id: str):
    """Debug endpoint to check user permissions"""
    from utils.db_operations import check_user_permission, check_company_access
    from utils.supabase_client import supabase
    
    # Get user info
    user = supabase.table('users').select('company_id, name').eq('user_id', user_id).single().execute()
    
    # Get role assignments
    roles = supabase.table('user_role_assignments').select('*, role:roles(*)').eq('user_id', user_id).eq('is_active', True).execute()
    
    # Check permissions
    has_manager = await check_user_permission(user_id, 'manager')
    company_id = user.data.get('company_id') if user.data else None
    has_company = await check_company_access(user_id, company_id) if company_id else False
    
    return {
        "user": user.data,
        "roles": roles.data,
        "has_manager_permission": has_manager,
        "has_company_access": has_company
    }

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
app.include_router(roleplay_assessment_router, prefix="/api", tags=["roleplay-assessment"])
app.include_router(roleplay_conversation_router, prefix="/api", tags=["roleplay-conversation"])


# Router Includes are here
# app.include_router(users_router, prefix="/api/users", tags=["users Router"])
app.include_router(users.router)  # add this line (place with other app.include_router calls)

if __name__ == "__main__":
    import uvicorn
    from config import HOST, PORT
    uvicorn.run("main:app", host=HOST, port=PORT, reload=True)
