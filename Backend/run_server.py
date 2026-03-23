#!/usr/bin/env python3
"""
Simplified backend launcher to test CORS configuration.
This script starts the FastAPI server with essential features only.
"""

import os
import sys
import asyncio

# Add current directory to path
sys.path.insert(0, os.path.dirname(__file__))

# Set minimal environment variables
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "https://fmkikkebrxyzjsffqgex.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZta2lra2Vicnh5empzZmZxZ2V4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2Mjg2MDA3NCwiZXhwIjoyMDc4NDM2MDc0fQ.BW4EuoovrQINKrSqj9ILBbCOo3_PCp61VTfAPz9IEso")

# Initialize FastAPI with CORS
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Lucid Backend API",
    version="1.0.0"
)

# Configure CORS to allow requests from localhost:3000
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "localhost:3000",
        "127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add health check endpoints
@app.get("/")
async def root():
    return {"message": "Lucid Backend API is running"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

# Minimal schedule-email endpoint for testing CORS
@app.post("/api/dispatch/schedule-email")
async def schedule_email(request: dict):
    """Test endpoint to verify CORS is working"""
    return {
        "status": "scheduled",
        "message": "CORS is working! This is a test response.",
        "received_data": request
    }

if __name__ == "__main__":
    import uvicorn
    print("🚀 Starting FastAPI server with CORS enabled...")
    print("Backend URL: http://127.0.0.1:8000")
    print("Frontend URL (allowed): http://localhost:3000")
    print("API endpoint: POST http://127.0.0.1:8000/api/dispatch/schedule-email")
    print("\nServer is running. Press Ctrl+C to stop.")
    
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
