import os
import json
import httpx
from datetime import datetime
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from supabase import create_client, Client
import google.generativeai as genai

router = APIRouter()

# Supabase initialization
supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL") or ""
supabase_key = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY") or os.getenv("SUPABASE_ANON_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
supabase: Client = create_client(supabase_url, supabase_key)

# Gemini initialization
genai.configure(api_key=os.getenv("GEMINI_API_KEY") or "")

@router.post("/submit-assessment")
async def submit_assessment(request: Request):
    try:
        body = await request.json()
        user_id = body.get("user_id")
        assessment_id = body.get("assessment_id")
        answers = body.get("answers")
        assessment_type = body.get("type")

        if not user_id or not assessment_id or not answers:
            return JSONResponse(
                content={"error": "Missing required fields: user_id, assessment_id, and answers are required"},
                status_code=400
            )

        # Fetch the assessment questions
        res = (
            supabase.table("assessments")
            .select("questions, type, processed_module_id")
            .eq("assessment_id", assessment_id)
            .single()
            .execute()
        )
        
        assessment = getattr(res, "data", None)
        assessment_error = getattr(res, "error", None)

        if assessment_error or not assessment:
            print(f"❌ Error fetching assessment: {assessment_error}")
            return JSONResponse(content={"error": "Assessment not found"}, status_code=404)

        questions = assessment.get("questions")
        if isinstance(questions, str):
            try:
                questions = json.loads(questions)
                # Handle double-encoded JSON
                if isinstance(questions, str):
                    questions = json.loads(questions)
            except Exception as parse_error:
                print(f"❌ Error parsing assessment questions: {parse_error}")
                return JSONResponse(content={"error": "Invalid assessment questions format"}, status_code=500)

        if not isinstance(questions, list) or len(questions) == 0:
            print("❌ No valid questions found in assessment")
            return JSONResponse(content={"error": "No questions found in assessment"}, status_code=500)

        # Calculate score and generate feedback
        score = 0
        max_score = len(questions)
        question_feedback = []
        correct_answers_details = []
        user_answers = answers if isinstance(answers, list) else []

        for i, question in enumerate(questions):
            user_answer = user_answers[i] if i < len(user_answers) else None
            correct_index = question.get("correctIndex")
            options = question.get("options", [])
            
            if not isinstance(options, list):
                options = []
            
            is_valid_correct_index = (
                isinstance(correct_index, int) and 
                0 <= correct_index < len(options)
            )

            correct_answer_text = ""
            if is_valid_correct_index:
                correct_answer_text = str(options[correct_index]).strip()
            else:
                correct_answer_text = "Invalid correct answer"
                print(f"⚠️ Question {i + 1}: Invalid correctIndex {correct_index}")

            user_answer_text = ""
            is_correct = False

            if isinstance(user_answer, str) and user_answer.strip() != "":
                user_answer_text = user_answer.strip()
                is_correct = is_valid_correct_index and user_answer_text == correct_answer_text
            elif isinstance(user_answer, int) and 0 <= user_answer < len(options):
                user_answer_text = str(options[user_answer]).strip()
                is_correct = is_valid_correct_index and user_answer == correct_index
            else:
                user_answer_text = "No answer provided"
                is_correct = False

            if is_correct:
                score += 1

            correct_answers_details.append({
                "questionIndex": i,
                "question": question.get("question"),
                "userAnswer": user_answer_text,
                "correctAnswer": correct_answer_text,
                "isCorrect": is_correct,
                "explanation": question.get("explanation"),
                "bloomLevel": question.get("bloomLevel")
            })

            if is_correct:
                question_feedback.append("Correct! Well done.")
            else:
                feedback = question.get("explanation") or \
                    f"Incorrect. The correct answer is: \"{correct_answer_text}\". You answered: \"{user_answer_text}\"."
                question_feedback.append(feedback)

        score_percentage = round((score / max_score) * 100) if max_score > 0 else 0

        # Generate AI feedback using Gemini
        ai_feedback = None
        gemini_api_key = os.getenv("GEMINI_API_KEY")
        
        if gemini_api_key:
            try:
                perf_summary = []
                for idx, ans in enumerate(correct_answers_details):
                    line = (
                        f"Question {idx + 1}: {ans['question']}\n"
                        f"User Answer: {ans['userAnswer']}\n"
                        f"Correct Answer: {ans['correctAnswer']}\n"
                        f"Result: {'✓ Correct' if ans['isCorrect'] else '✗ Incorrect'}\n"
                        f"Bloom's Level: {ans['bloomLevel'] or 'N/A'}\n"
                    )
                    if ans['explanation'] and not ans['isCorrect']:
                        line += f"Explanation: {ans['explanation']}\n"
                    perf_summary.append(line)

                feedback_prompt = f"""You are an expert educational assessment analyst. Generate a structured quiz feedback report using EXACTLY this format:

## Quiz Feedback Report

**Assessment:** {assessment.get('type') or 'Module'} Quiz
**Score:** {score}/{max_score} ({score_percentage}%)

User Performance Summary:
{"".join(perf_summary)}

Please provide:
1. A brief congratulatory or encouraging opening
2. Overall performance summary
3. Strengths identified (areas where user performed well)
4. Areas for improvement (specific topics to focus on)
5. Actionable study recommendations
6. Encouraging closing remarks

Keep the feedback constructive, specific, and encouraging. Format it as a structured report with clear sections.

IMPORTANT: Use this EXACT format with these headings. Do not add extra sections or change the structure."""

                model = genai.GenerativeModel("gemini-2.5-flash-lite")
                result = model.generate_content(feedback_prompt)
                raw_feedback = result.text if result else ""

                if raw_feedback:
                    import re
                    # Remove any markdown code blocks
                    raw_feedback = re.sub(r'```[\s\S]*?```', '', raw_feedback)
                    # Ensure consistent header format
                    raw_feedback = re.sub(r'^#+\s*', '## ', raw_feedback, flags=re.MULTILINE)
                    # Clean up extra whitespace
                    raw_feedback = re.sub(r'\n{3,}', '\n\n', raw_feedback)
                    ai_feedback = raw_feedback.strip()

            except Exception as feedback_error:
                print(f"🤖 Error generating AI feedback: {feedback_error}")

        if not ai_feedback:
            # Fallback feedback
            areas_for_review = "\n".join([f"* Question {a['questionIndex'] + 1}: {a['question']}" for a in correct_answers_details if not a['isCorrect']])
            ai_feedback = f"""## Quiz Feedback Report

**Assessment:** {assessment.get('type') or 'Module'} Quiz
**Score:** {score}/{max_score} ({score_percentage}%)

### Overall Performance Summary
You scored {score_percentage}% on this assessment. {'Well done!' if score_percentage >= 70 else 'Keep studying to improve your understanding.'}

### Areas for Review
{areas_for_review}

### Next Steps
Review the questions you missed and study the related concepts to improve your understanding."""

        # Save the assessment result
        row_to_save = {
            "user_id": user_id,
            "assessment_id": assessment_id,
            "score": score,
            "max_score": max_score,
            "answers": json.dumps(user_answers),
            "feedback": ai_feedback,
            "question_feedback": json.dumps(question_feedback),
            "completed_at": datetime.utcnow().isoformat() + "Z"
        }

        saved_result = None
        save_error = None

        try:
            # Upsert logic
            upsert_res = (
                supabase.table("employee_assessments")
                .upsert(row_to_save, on_conflict="user_id,assessment_id")
                .execute()
            )
            data = getattr(upsert_res, "data", None)
            error = getattr(upsert_res, "error", None)
            
            if data and len(data) > 0:
                saved_result = data[0]
            save_error = error
        except Exception as e:
            save_error = str(e)

        # Fallback for missing unique constraint (if code 42P10)
        if save_error and ("42P10" in str(save_error)):
            print("⚠️ employee_assessments upsert fell back (missing unique constraint)")
            try:
                existing_res = (
                    supabase.table("employee_assessments")
                    .select("employee_assessment_id")
                    .eq("user_id", user_id)
                    .eq("assessment_id", assessment_id)
                    .order("completed_at", desc=True)
                    .limit(1)
                    .execute()
                )
                existing_data = getattr(existing_res, "data", None)
                
                if existing_data and len(existing_data) > 0:
                    emp_ast_id = existing_data[0].get("employee_assessment_id")
                    update_res = (
                        supabase.table("employee_assessments")
                        .update(row_to_save)
                        .eq("employee_assessment_id", emp_ast_id)
                        .execute()
                    )
                    saved_result = getattr(update_res, "data", [{}])[0]
                    save_error = getattr(update_res, "error", None)
                else:
                    insert_res = (
                        supabase.table("employee_assessments")
                        .insert(row_to_save)
                        .execute()
                    )
                    saved_result = getattr(insert_res, "data", [{}])[0]
                    save_error = getattr(insert_res, "error", None)
            except Exception as e:
                save_error = str(e)

        if save_error:
            print(f"❌ Error saving assessment result: {save_error}")
            return JSONResponse(content={"error": "Failed to save assessment result"}, status_code=500)

        # Update module progress if applicable
        if assessment.get("type") == "module" and assessment.get("processed_module_id"):
            try:
                app_url = os.getenv("NEXT_PUBLIC_APP_URL") or "http://localhost:3000"
                complete_module_url = f"{app_url}/api/complete-module"
                
                async with httpx.AsyncClient(timeout=10.0) as client:
                    await client.post(
                        complete_module_url,
                        json={
                            "user_id": user_id,
                            "processed_module_id": assessment.get("processed_module_id"),
                            "quiz_score": score,
                            "max_score": max_score,
                            "quiz_feedback": ai_feedback
                        }
                    )
            except Exception as module_error:
                print(f"📚 Error updating module completion: {module_error}")

        return JSONResponse(content={
            "success": True,
            "score": score,
            "maxScore": max_score,
            "percentage": score_percentage,
            "feedback": ai_feedback,
            "questionFeedback": question_feedback,
            "correctAnswers": correct_answers_details,
            "assessment_id": assessment_id,
            "type": assessment.get("type"),
            "employee_assessment_id": saved_result.get("employee_assessment_id") if saved_result else None,
            "message": f"Assessment completed! You scored {score}/{max_score} ({score_percentage}%)"
        })

    except Exception as error:
        print(f"❌ Error in assessment submission: {error}")
        return JSONResponse(
            content={
                "error": "Failed to process assessment submission",
                "details": str(error)
            },
            status_code=500
        )
