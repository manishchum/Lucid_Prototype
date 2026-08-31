import os
import json

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

# from supabase import create_client, Client
# from utils.supabase_client import supabase
# import google.generativeai as genai
from utils.redis_limiter import check_rate_limit
from utils.redis_client import delete_cache_pattern


router = APIRouter()

# Keep same initialization behavior
# genAI = genai
# genai.configure(api_key=os.getenv("GEMINI_API_KEY") or "")
API_BASE=os.getenv("NEXT_PUBLIC_BACKEND_URL")

# Optional supabase init to match original imports (not used in this handler, but preserved)
# supabaseUrl = os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL") or ""
# supabaseKey = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY") or os.getenv("SUPABASE_ANON_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
# supabase: Client = create_client(supabaseUrl, supabaseKey)


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
        
        #Assessment type information
        isBaseline = body.get("isBaseline")
        assessmentType = body.get("assessmentType")

        # Legacy parameters that might be sent
        employeeId = body.get("employeeId")
        moduleId = body.get("moduleId")
        processedModuleId = body.get("processedModuleId")
        
        # Extract module_id from modules array if present
        modules = body.get("modules")
        moduleIdFromArray = None
        if isinstance(modules, list) and len(modules) > 0:
            first_module = modules[0]
            if isinstance(first_module, dict):
                moduleIdFromArray = first_module.get("module_id")

        print("Outside First IF. Succesfull")
        
        # Normalize parameters for the new API
        normalizedUserId = user_id or userId or employeeId
        normalizedAssessmentId = assessment_id or assessmentId
        normalizedAnswers = answers or userAnswers
        normalizedModuleId = moduleId or processedModuleId or moduleIdFromArray
        normalizedIsBaseline = (isBaseline is True or str(assessmentType or "").lower() == "baseline")
        
        print(f"📋 Extracted module_id: {normalizedModuleId} (from moduleId={moduleId}, processedModuleId={processedModuleId}, modules array={moduleIdFromArray})")

        if (not normalizedUserId) or (not normalizedAssessmentId) or (not normalizedAnswers):
            return JSONResponse(
                content={"error": "Missing required fields: user_id, assessment_id, and answers are required"},
                status_code=400
            )
        # await check_rate_limit(user_id=normalizedUserId, endpoint="gpt-feedback")
        submit_url = f"{API_BASE}/api/submit-assessment"
        print("Submit URL:", submit_url)

        payload = {
            "user_id": normalizedUserId,
            "assessment_id": normalizedAssessmentId,
            "answers": normalizedAnswers,
            "type": "baseline" if normalizedIsBaseline else "module",
            "module_id": None if normalizedIsBaseline else normalizedModuleId
        }

        print("Payload prepared:", payload)

        auth_headers = {"Content-Type": "application/json"}
        incoming_auth = request.headers.get("Authorization")
        incoming_user_id = request.headers.get("X-User-ID")
        if incoming_auth:
            auth_headers["Authorization"] = incoming_auth
        if incoming_user_id:
            auth_headers["X-User-ID"] = incoming_user_id
        
        # Call the new submit-assessment API internally (with extended timeout for AI feedback generation)
        print(f"📤 Calling submit-assessment API: {submit_url}")
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                submitAssessmentResponse = await client.post(
                    submit_url,
                    headers=auth_headers,
                    content=json.dumps(payload)
                )
            print(f"✅ Received response from submit-assessment: {submitAssessmentResponse.status_code}")
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
        if not isinstance(assessmentResult, dict):
            return JSONResponse(
                content={
                    "error": "Failed to process assessment submission",
                    "details": "submit-assessment returned an unexpected response payload",
                },
                status_code=500,
            )
        
        # print("Assessment result:", assessmentResult)

        # Return response in the format expected by legacy clients
        
        delete_cache_pattern(f"dashboard_summary:{user_id}*")
        delete_cache_pattern(f"module_progress:{user_id}*")
        delete_cache_pattern(f"user_module_progress:{user_id}*")
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
