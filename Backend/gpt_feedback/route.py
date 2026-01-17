import os
import json

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from supabase import create_client, Client
import google.generativeai as genai


# from config import HOST, PORT
router = APIRouter()

# Keep same initialization behavior
genAI = genai
genai.configure(api_key=os.getenv("GEMINI_API_KEY") or "")
API_BASE=os.getenv("NEXT_PUBLIC_BACKEND_URL")

# Default to local backend if not specified
# default_base_url = f"http://{HOST}:{PORT}" if HOST and PORT else "http://localhost:8000"
# baseUrl = os.getenv("INTERNAL_API_BASE_URL") or os.getenv("NEXT_PUBLIC_BASE_URL") or default_base_url

# Optional supabase init to match original imports (not used in this handler, but preserved)
supabaseUrl = os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL") or ""
supabaseKey = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY") or os.getenv("SUPABASE_ANON_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
supabase: Client = create_client(supabaseUrl, supabaseKey)


@router.post("/gpt-feedback")
async def POST(request: Request):
    try:
        body = await request.json()

        user_id = body.get("user_id")
        assessment_id = body.get("assessment_id")
        answers = body.get("answers")
        userId = body.get("userId")
        assessmentId = body.get("assessmentId")
        userAnswers = body.get("userAnswers")

        # Legacy parameters that might be sent
        employeeId = body.get("employeeId")
        moduleId = body.get("moduleId")
        processedModuleId = body.get("processedModuleId")

        print("Outside First IF. Succesfull")
        
        # Normalize parameters for the new API
        normalizedUserId = user_id or userId or employeeId
        normalizedAssessmentId = assessment_id or assessmentId
        normalizedAnswers = answers or userAnswers

        if (not normalizedUserId) or (not normalizedAssessmentId) or (not normalizedAnswers):
            return JSONResponse(
                content={"error": "Missing required fields: user_id, assessment_id, and answers are required"},
                status_code=400
            )

        submit_url = f"{API_BASE}/api/submit-assessment"
        print("Submit URL:", submit_url)

        payload = {
            "user_id": normalizedUserId,
            "assessment_id": normalizedAssessmentId,
            "answers": normalizedAnswers,
            "type": "module" if (moduleId or processedModuleId) else "baseline",
            "module_id": moduleId or processedModuleId
        }

        print("Payload prepared:", payload)
        
        # Call the new submit-assessment API internally
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                submitAssessmentResponse = await client.post(
                    submit_url,
                    headers={"Content-Type": "application/json"},
                    content=json.dumps(payload)
                )
        except Exception as http_err:
            print("❌ httpx request failed:", repr(http_err))
            return JSONResponse(
                content={
                    "error": "Failed to process assessment submission",
                    "details": str(http_err) if str(http_err) else repr(http_err),
                },
                status_code=500
            )

        if submitAssessmentResponse.status_code < 200 or submitAssessmentResponse.status_code >= 300:
            errorText = submitAssessmentResponse.text
            print("❌ Submit assessment failed:", errorText)
            return JSONResponse(
                content={"error": "Failed to process assessment submission", "details": errorText},
                status_code=submitAssessmentResponse.status_code
            )

        assessmentResult = submitAssessmentResponse.json()
        
        print("Assessment result:", assessmentResult)

        # Return response in the format expected by legacy clients
        return JSONResponse(content={
            "success": True,
            "score": assessmentResult.get("score"),
            "maxScore": assessmentResult.get("maxScore"),
            "percentage": assessmentResult.get("percentage"),
            "feedback": assessmentResult.get("feedback"),
            "questionFeedback": assessmentResult.get("questionFeedback"),
            "correctAnswers": assessmentResult.get("correctAnswers"),
            "message": assessmentResult.get("message"),
            # Legacy format compatibility
            "aiGeneratedFeedback": assessmentResult.get("feedback"),
            "detailedFeedback": assessmentResult.get("questionFeedback"),
            "result": {
                "score": assessmentResult.get("score"),
                "totalQuestions": assessmentResult.get("maxScore"),
                "percentage": assessmentResult.get("percentage"),
                "correctAnswers": assessmentResult.get("correctAnswers"),
                "feedback": assessmentResult.get("feedback")
            }
        })

    except Exception as error:
        print("❌ Error in GPT feedback API:", repr(error))
        return JSONResponse(
            content={
                "error": "Failed to process feedback request",
                "details": str(error) if str(error) else repr(error)
            },
            status_code=500
        )
