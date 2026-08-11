import os
import json
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from utils.auth import get_request_auth_required_from_request
from utils.auth_bridge import get_service_supabase_client
from ai.ai_gateway import AI
from ai.types import AIRequest
# from supabase import create_client, Client
from utils.supabase_client import supabase
# import google.generativeai as genai
from utils.redis_limiter import check_rate_limit
from utils.redis_client import delete_cache_pattern


router = APIRouter()

# Supabase client (same role as '@/lib/supabase')
# supabaseUrl = os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL") or ""
# supabaseKey = (
#     os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
#     or os.getenv("SUPABASE_ANON_KEY")
#     or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
#     or ""
# )
# supabase: Client = create_client(supabaseUrl, supabaseKey)

# Gemini init
# genAI = genai  # keep same naming intent
# genai.configure(api_key=os.getenv("GEMINI_API_KEY") or "")

baseUrl = os.getenv("NEXT_PUBLIC_BACKEND_URL")


@router.post("/submit-assessment")
async def POST(request: Request):
    assessmentRes = None
    try:
        auth_ctx = get_request_auth_required_from_request(request)
        user_supabase = supabase
        if auth_ctx.claims:
            user_supabase = get_service_supabase_client()
        body = await request.json()

        user_id = body.get("user_id")
        assessment_id = body.get("assessment_id")
        answers = body.get("answers")
        type = body.get("type")

        if (not user_id) or (not assessment_id) or (answers is None):
            return JSONResponse(
                content={"error": "Missing required fields: user_id, assessment_id, and answers are required"},
                status_code=400
            )

        if str(user_id) != str(auth_ctx.user_id):
            return JSONResponse(
                content={"error": "user_id does not match authenticated token"},
                status_code=403
            )
        await check_rate_limit(user_id=user_id, endpoint="gpt-feedback")
        # Fetch the assessment questions
        assessmentRes = (
            user_supabase
            .table("assessments")
            .select("questions, type, processed_module_id, company_id")
            .eq("assessment_id", assessment_id)
            .single()
            .execute()
        )
    except HTTPException as e:
        print("❌ [submit-assessment] HTTP error:", e.detail)
        return JSONResponse(content={"error": e.detail}, status_code=e.status_code)
    except Exception as e:
        print("❌ Error in assessment submission (early stage):", e)
        return JSONResponse(
            content={
                "error": "Failed to process assessment submission",
                "details": str(e) if str(e) else "Unknown error"
            },
            status_code=500
        )

    assessment = getattr(assessmentRes, "data", None)
    assessmentError = getattr(assessmentRes, "error", None)

    if assessmentError or (not assessment):
        print("❌ Error fetching assessment:", assessmentError)
        return JSONResponse(content={"error": "Assessment not found"}, status_code=404)

    # Parse questions
    questions: Any = None
    try:
        raw_questions = assessment.get("questions") if isinstance(assessment, dict) else None

        questions = json.loads(raw_questions) if isinstance(raw_questions, str) else raw_questions

        # Handle double-encoded JSON (e.g., "[ {...} ]" stored as a JSON string)
        if isinstance(questions, str):
            try:
                questions = json.loads(questions)
            except Exception:
                pass

    except Exception as parseError:
        print("❌ Error parsing assessment questions:", parseError)
        return JSONResponse(content={"error": "Invalid assessment questions format"}, status_code=500)

    if (not isinstance(questions, list)) or len(questions) == 0:
        print("❌ No valid questions found in assessment")
        return JSONResponse(content={"error": "No questions found in assessment"}, status_code=500)

    # Calculate score and generate feedback
    score = 0
    maxScore = len(questions)
    questionFeedback: List[Any] = []
    correctAnswers: List[Any] = []
    userAnswers = answers if isinstance(answers, list) else []

    # Score each question
    for i in range(len(questions)):
        question = questions[i]
        userAnswer = userAnswers[i] if i < len(userAnswers) else None
        correctIndex = question.get("correctIndex") if isinstance(question, dict) else None

        isCorrect = False
        userAnswerText = ""
        correctAnswerText = ""

        # Ensure options array exists and correctIndex is valid
        options = question.get("options") if isinstance(question, dict) else None
        options = options if isinstance(options, list) else []

        validCorrectIndex = (
            isinstance(correctIndex, int)
            and correctIndex >= 0
            and correctIndex < len(options)
        )

        if validCorrectIndex:
            try:
                correctAnswerText = str(options[correctIndex]).strip()
            except Exception:
                correctAnswerText = "Invalid correct answer"
        else:
            correctAnswerText = "Invalid correct answer"
            print(f"⚠️ Question {i + 1}: Invalid correctIndex", correctIndex, "for options", options)

        # Handle string-based answers (what frontend actually sends)
        if isinstance(userAnswer, str) and userAnswer.strip() != "":
            userAnswerText = userAnswer.strip()
            isCorrect = bool(validCorrectIndex and (userAnswerText == correctAnswerText))

        # Handle index-based answers (fallback for compatibility)
        elif isinstance(userAnswer, int) and userAnswer >= 0 and userAnswer < len(options):
            userAnswerText = str(options[userAnswer]).strip()
            isCorrect = bool(validCorrectIndex and (userAnswer == correctIndex))

        # Handle case where no answer was provided
        else:
            userAnswerText = "No answer provided"
            isCorrect = False

        if isCorrect:
            score += 1

        correctAnswers.append({
            "questionIndex": i,
            "question": question.get("question") if isinstance(question, dict) else None,
            "userAnswer": userAnswerText,
            "correctAnswer": correctAnswerText,
            "isCorrect": isCorrect,
            "explanation": question.get("explanation") if isinstance(question, dict) else None,
            "bloomLevel": question.get("bloomLevel") if isinstance(question, dict) else None
        })

        # Generate question-level feedback
        if isCorrect:
            questionFeedback.append("Correct! Well done.")
        else:
            explanation = question.get("explanation") if isinstance(question, dict) else None
            feedback = explanation or f'Incorrect. The correct answer is: "{correctAnswerText}". You answered: "{userAnswerText}".'
            questionFeedback.append(feedback)

    scorePercentage = round((score / maxScore) * 100) if maxScore > 0 else 0

    # Generate AI feedback using Gemini
#     aiFeedback: Optional[str] = None
#     try:
#         if os.getenv("GEMINI_API_KEY"):
#             feedbackPrompt = f"""You are an expert educational assessment analyst. Generate a structured quiz feedback report using EXACTLY this format:

# ## Quiz Feedback Report

# **Assessment:** {assessment.get("type") or "Module"} Quiz
# **Score:** {score}/{maxScore} ({scorePercentage}%)

# User Performance Summary:
# {''.join([
# f'''
# Question {index + 1}: {answer.get("question")}
# User Answer: {answer.get("userAnswer")}
# Correct Answer: {answer.get("correctAnswer")}
# Result: {'✓ Correct' if answer.get("isCorrect") else '✗ Incorrect'}
# Bloom's Level: {answer.get("bloomLevel") or 'N/A'}
# {('Explanation: ' + str(answer.get("explanation"))) if (answer.get("explanation") and (not answer.get("isCorrect"))) else ''}
# '''
# for index, answer in enumerate(correctAnswers)
# ])}

# Please provide:
# 1. A brief congratulatory or encouraging opening
# 2. Overall performance summary
# 3. Strengths identified (areas where user performed well)
# 4. Areas for improvement (specific topics to focus on)
# 5. Actionable study recommendations
# 6. Encouraging closing remarks

# Keep the feedback constructive, specific, and encouraging. Format it as a structured report with clear sections.

# IMPORTANT: Use this EXACT format with these headings. Do not add extra sections or change the structure."""

#             model = genai.GenerativeModel("gemini-3.1-pro-preview")
#             result = model.generate_content(feedbackPrompt)
#             rawFeedback = result.text if result else None

#             # Standardize the response format
#             if rawFeedback:
#                 # Remove any markdown code blocks
#                 import re
#                 rawFeedback = re.sub(r"```[\s\S]*?```", "", rawFeedback)

#                 # Ensure consistent header format
#                 rawFeedback = re.sub(r"^#+\s*", "## ", rawFeedback, flags=re.MULTILINE)

#                 # Clean up extra whitespace
#                 rawFeedback = re.sub(r"\n{3,}", "\n\n", rawFeedback)

#                 aiFeedback = rawFeedback.strip()

#     except Exception as feedbackError:
#         print("🤖 Error generating AI feedback:", feedbackError)

#         incorrectLines = "\n".join([
#             f"* Question {a.get('questionIndex') + 1}: {a.get('question')}"
#             for a in correctAnswers
#             if not a.get("isCorrect")
#         ])

#         aiFeedback = f"""## Quiz Feedback Report

# **Assessment:** {assessment.get("type") or "Module"} Quiz
# **Score:** {score}/{maxScore} ({scorePercentage}%)

# ### Overall Performance Summary
# You scored {scorePercentage}% on this assessment. {"Well done!" if scorePercentage >= 70 else "Keep studying to improve your understanding."}

# ### Areas for Review
# {incorrectLines}

# ### Next Steps
# Review the questions you missed and study the related concepts to improve your understanding."""

        # Generate AI feedback through the centralized AI Gateway.
    aiFeedback: Optional[str] = None

    try:
        performanceSummary = "".join([
            f'''
Question {index + 1}: {answer.get("question")}
User Answer: {answer.get("userAnswer")}
Correct Answer: {answer.get("correctAnswer")}
Result: {'✓ Correct' if answer.get("isCorrect") else '✗ Incorrect'}
Bloom's Level: {answer.get("bloomLevel") or 'N/A'}
{('Explanation: ' + str(answer.get("explanation"))) if (answer.get("explanation") and (not answer.get("isCorrect"))) else ''}
'''
            for index, answer in enumerate(correctAnswers)
        ])

        ai_response = await AI.execute(
            AIRequest(
                feature="assessment_feedback",
                company_id=str(assessment.get("company_id") or ""),
                user_id=str(user_id),
                route="/submit-assessment",
                variables={
                    "assessmentType": assessment.get("type") or "Module",
                    "score": score,
                    "maxScore": maxScore,
                    "scorePercentage": scorePercentage,
                    "performanceSummary": performanceSummary,
                },
                response_format="text",
            )
        )

        if ai_response and ai_response.content:
            rawFeedback = ai_response.content

            # Standardize the response format.
            import re

            # Remove markdown code blocks.
            rawFeedback = re.sub(
                r"```[\s\S]*?```",
                "",
                rawFeedback
            )

            # Ensure consistent heading format.
            rawFeedback = re.sub(
                r"^#+\s*",
                "## ",
                rawFeedback,
                flags=re.MULTILINE
            )

            # Clean up extra whitespace.
            rawFeedback = re.sub(
                r"\n{3,}",
                "\n\n",
                rawFeedback
            )

            aiFeedback = rawFeedback.strip()

    except Exception as feedbackError:
        print("🤖 Error generating AI feedback:", feedbackError)

        incorrectLines = "\n".join([
            f"* Question {a.get('questionIndex') + 1}: {a.get('question')}"
            for a in correctAnswers
            if not a.get("isCorrect")
        ])

        aiFeedback = f"""## Quiz Feedback Report

**Assessment:** {assessment.get("type") or "Module"} Quiz
**Score:** {score}/{maxScore} ({scorePercentage}%)

### Overall Performance Summary

You scored {scorePercentage}% on this assessment. {"Well done!" if scorePercentage >= 70 else "Keep studying to improve your understanding."}

### Areas for Review

{incorrectLines}

### Next Steps

Review the questions you missed and study the related concepts to improve your understanding."""
    # Save the assessment result
    rowToSave = {
        "user_id": user_id,
        "assessment_id": assessment_id,
        "score": score,
        "max_score": maxScore,
        "answers": json.dumps(userAnswers),
        "feedback": aiFeedback,
        "question_feedback": json.dumps(questionFeedback),
        "completed_at": __import__("datetime").datetime.utcnow().isoformat()
    }

    savedResult: Any = None
    saveError: Any = None

    # Prefer deterministic upsert if a suitable unique constraint exists.
    upsertRes = (
        user_supabase
        .table("employee_assessments")
        .upsert(rowToSave, on_conflict="user_id, assessment_id")
        .execute()
    )
    savedResult = getattr(upsertRes, "data", None)
    saveError = getattr(upsertRes, "error", None)

    # If the DB doesn't have a unique constraint for ON CONFLICT, fall back to update-if-exists.
    if saveError and isinstance(saveError, dict) and saveError.get("code") == "42P10":
        print("⚠️ employee_assessments upsert fell back (missing unique constraint):", saveError)

        existingRes = (
            user_supabase
            .table("employee_assessments")
            .select("employee_assessment_id")
            .eq("user_id", user_id)
            .eq("assessment_id", assessment_id)
            .order("completed_at", desc=True)
            .limit(1)
            .maybe_single()
            .execute()
        )
        existing = getattr(existingRes, "data", None)
        existingErr = getattr(existingRes, "error", None)

        if existingErr:
            saveError = existingErr
        elif isinstance(existing, dict) and existing.get("employee_assessment_id"):
            updRes = (
                user_supabase
                .table("employee_assessments")
                .update(rowToSave)
                .eq("employee_assessment_id", existing.get("employee_assessment_id"))
                .execute()
            )
            savedResult = getattr(updRes, "data", None)
            saveError = getattr(updRes, "error", None)
        else:
            insRes = (
                user_supabase
                .table("employee_assessments")
                .insert(rowToSave)
                .execute()
            )
            savedResult = getattr(insRes, "data", None)
            saveError = getattr(insRes, "error", None)

    if saveError:
        print("❌ Error saving assessment result:", saveError)
        return JSONResponse(content={"error": "Failed to save assessment result"}, status_code=500)

    is_baseline_assessment = str(assessment.get("type") or "").lower() == "baseline"

    module_id_for_plan = (
        None
        if is_baseline_assessment
        else (body.get("module_id") or assessment.get("processed_module_id"))
    )

    ## Mark baseline assessment as completed on the existing learning plan row.
    if is_baseline_assessment and assessment.get("processed_module_id"):
        try:
            baseline_module_id = assessment.get("processed_module_id")

            baseline_completion_res = (
                supabase
                .table("learning_plan")
                .update({
                    "overall_status": True,
                    "status": "COMPLETED",
                    "completed_at": __import__("datetime").datetime.utcnow().isoformat(),
                })
                .eq("user_id", user_id)
                .eq("module_id", baseline_module_id)
                .execute()
            )

            baseline_completion_error = getattr(
                baseline_completion_res,
                "error",
                None
            )

            if baseline_completion_error:
                print(
                    "⚠️ Failed to mark baseline learning_plan as completed:",
                    baseline_completion_error
                )
            else:
                print(
                    f"✅ Baseline completed for user={user_id}, "
                    f"module={baseline_module_id}"
                )

        except Exception as baseline_completion_error:
            print(
                "⚠️ Unexpected error while recording baseline completion:",
                baseline_completion_error
            )

    # Extract employee_assessment_id from savedResult (supabase-py returns list usually)
    employee_assessment_id = None
    if isinstance(savedResult, list) and len(savedResult) > 0 and isinstance(savedResult[0], dict):
        employee_assessment_id = savedResult[0].get("employee_assessment_id")
    elif isinstance(savedResult, dict):
        employee_assessment_id = savedResult.get("employee_assessment_id")

    # If this is a module assessment, update module progress
    # if assessment.get("type") == "module" and assessment.get("processed_module_id"):
    #     try:
    #         moduleCompletionUrl = f"{baseUrl}/api/complete-module"
    #         async with httpx.AsyncClient(timeout=30.0) as client:
    #             moduleCompletionResponse = await client.post(
    #                 moduleCompletionUrl,
    #                 headers={"Content-Type": "application/json"},
    #                 content=json.dumps({
    #                     "user_id": user_id,
    #                     "processed_module_id": assessment.get("processed_module_id"),
    #                     "quiz_score": score,
    #                     "max_score": maxScore,
    #                     "quiz_feedback": aiFeedback
    #                 })
    #             )

    #         if moduleCompletionResponse.status_code < 200 or moduleCompletionResponse.status_code >= 300:
    #             errorText = moduleCompletionResponse.text
    #             print("📚 Module completion failed:", errorText)
    #         else:
    #             _ = moduleCompletionResponse.json()

    #     except Exception as moduleError:
    #         print("📚 Error updating module completion:", moduleError)
    #         # Don't fail the assessment if module update fails

    delete_cache_pattern(f"dashboard_summary:{user_id}*")
    delete_cache_pattern(f"module_progress:{user_id}*")
    delete_cache_pattern(f"user_module_progress:{user_id}*")
    # Return the complete result
    return JSONResponse(content={
        "success": True,
        "score": score,
        "maxScore": maxScore,
        "percentage": scorePercentage,
        "feedback": aiFeedback,
        "questionFeedback": questionFeedback,
        "correctAnswers": correctAnswers,
        "assessment_id": assessment_id,
        "type": assessment.get("type"),
        "employee_assessment_id": employee_assessment_id,
        "message": f"Assessment completed! You scored {score}/{maxScore} ({scorePercentage}%)"
    })
