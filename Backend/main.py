from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import FRONTEND_URL
from openai_upload.route import router as openai_upload_router
from start_content_generation.route import router as start_content_generation_router
from learning_style.route import router as learning_style_router
from gpt_mcq_quiz.route import router as gpt_mcq_quiz_router
from gpt_feedback.route import router as gpt_feedback_router
from submit_assessment.route import router as submit_assessment_router

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

# Include routers
app.include_router(openai_upload_router, prefix="/api", tags=["openai-upload"])
app.include_router(start_content_generation_router, prefix="/api", tags=["content-generation"])
app.include_router(learning_style_router, prefix="/api", tags=["learning-style"])
app.include_router(gpt_mcq_quiz_router, prefix="/api", tags=["gpt-mcq-quiz"])
app.include_router(gpt_feedback_router, prefix="/api", tags=["gpt-feedback"])
app.include_router(submit_assessment_router, prefix="/api", tags=["submit-assessment"])

if __name__ == "__main__":
    import uvicorn
    from config import HOST, PORT
    uvicorn.run("main:app", host=HOST, port=PORT, reload=True)
