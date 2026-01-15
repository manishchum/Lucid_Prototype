from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import FRONTEND_URL
from openai_upload.route import router as openai_upload_router
from start_content_generation.route import router as start_content_generation_router
from learning_style.route import router as learning_style_router

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

if __name__ == "__main__":
    import uvicorn
    from config import HOST, PORT
    uvicorn.run("main:app", host=HOST, port=PORT, reload=True)
