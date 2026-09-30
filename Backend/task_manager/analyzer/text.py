import re
import numpy as np
from .models import bge_model
import time
from .gemini_usage import extract_gemini_usage

STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "to", "for", 
    "in", "on", "at", "by", "of", "with", "from", "as", "about", "this", "that", 
    "these", "those", "i", "you", "he", "she", "it", "we", "they", "me", "him", 
    "her", "us", "them", "my", "your", "his", "its", "our", "their", "be", "been", 
    "being", "have", "has", "had", "do", "does", "did", "will", "would", "shall", 
    "should", "can", "could", "may", "might", "must", "how", "what", "why", "where",
    "when", "who", "which", "there", "here", "then", "than", "so", "up", "out", "no"
}

def extract_keywords(text: str) -> set:
    if not text:
        return set()
    # Normalize: lowercase and replace punctuation with space
    cleaned = re.sub(r'[^\w\s]', ' ', text.lower())
    words = re.findall(r'\b[a-z]{3,}\b', cleaned)
    return {w for w in words if w not in STOPWORDS}

def cosine_similarity(v1: np.ndarray, v2: np.ndarray) -> float:
    dot = np.dot(v1, v2)
    norm1 = np.linalg.norm(v1)
    norm2 = np.linalg.norm(v2)
    if norm1 == 0 or norm2 == 0:
        return 0.0
    return float(dot / (norm1 * norm2))

def compute_clarity_score(text: str) -> int:
    if not text or not text.strip():
        return 0
    
    sentences = [s.strip() for s in re.split(r'[.!?]+', text) if s.strip()]
    if not sentences:
        sentences = [text]
        
    words = [w.strip() for w in re.split(r'\s+', text) if w.strip()]
    if not words:
        return 0
        
    avg_sentence_len = len(words) / len(sentences)
    avg_word_len = sum(len(w) for w in words) / len(words)
    
    score = 100
    
    # Penalize too long or too short sentences
    if avg_sentence_len > 25:
        score -= (avg_sentence_len - 25) * 2
    elif avg_sentence_len < 6:
        score -= (6 - avg_sentence_len) * 3
        
    # Penalize too long or too short words
    if avg_word_len > 7:
        score -= (avg_word_len - 7) * 8
    elif avg_word_len < 3.2:
        score -= (3.2 - avg_word_len) * 12
        
    return int(max(20, min(100, score)))

def analyze_text(task_title: str, task_description: str, expected_answer: str | None, analyzing_parameters: str | None, employee_response: str) -> dict:
    """
    Perform text submission evaluation using Gemini as the primary qualitative evaluator,
    supported by BGE for semantic relevance and clarity metrics.
    """
    if not employee_response or not employee_response.strip():
        return {
            "overall_score": 0,
            "metrics": {
                "ai_quality_score": 0,
                "bge_relevance_score": 0,
                "clarity_score": 0,
            },
            "strengths": [],
            "weaknesses": ["Empty submission received."],
            "detected_issues": ["No response content provided."],
            "improvement_points": ["Please write a complete answer."],
            "model_output": {"error": "Empty response"}
        }

    clarity_score = compute_clarity_score(employee_response)
    
    # --- Deduplicate Task Context ---
    tt = (task_title or "").strip()
    td = (task_description or "").strip()
    if tt and td:
        if tt.lower() == td.lower() or tt in td or td in tt:
            task_context = tt if len(tt) > len(td) else td
        else:
            task_context = f"{tt}\n\n{td}"
    else:
        task_context = tt or td

    # --- 1. BGE Relevance Score ---
    comparison_text = f"Task:\n{task_context}"

    try:
        emb_comp = bge_model.encode(comparison_text)
        emb_resp = bge_model.encode(employee_response)
        sim = cosine_similarity(emb_comp, emb_resp)
        bge_relevance_score = int(max(0, sim) * 100)
    except Exception as e:
        print("[Text Analyzer] BGE embedding failed:", e)
        bge_relevance_score = 50
        sim = 0.5
        
    # --- 2. Gemini Evaluation (Primary) ---
    import os
    api_key = os.getenv("GEMINI_API_KEY")
    
    gemini_score = 0
    res_json = {}
    
    input_tokens = 0
    output_tokens = 0
    total_tokens = 0
    usage_dict = {}
    
    if api_key:
        try:
            import json
            from google import genai
            from google.genai import types
            
            client = genai.Client(api_key=api_key)
            
            # --- Prompt Construction ---
            prompt_parts = [
                "You are evaluating an employee's response.",
                f"\nTASK:\n{task_context}"
            ]
            
            if analyzing_parameters and analyzing_parameters.strip():
                prompt_parts.append(f"\nEVALUATION CRITERIA:\n{analyzing_parameters.strip()}")
            
            if expected_answer and expected_answer.strip():
                prompt_parts.append(f"\nREFERENCE ANSWER:\n{expected_answer.strip()}")
                
            prompt_parts.append(f"\nEMPLOYEE RESPONSE:\n{employee_response.strip()}")
            prompt_parts.append("\nEvaluate only the employee response based on the task and supplied evaluation criteria.")
            prompt_parts.append("Do not infer information not explicitly present.")
            prompt_parts.append("Score the response according to completeness, relevance, specificity, and actionability unless custom evaluation criteria are provided.")
            prompt_parts.append("""
Scoring guidance:
90-100: Complete, specific, relevant, and actionable.
70-89: Good response with minor gaps.
40-69: Partially complete, vague, or missing important details.
1-39: Poor, substantially incomplete, or minimally relevant.
0: Does not answer the task.

Return valid JSON only:
{
  "overall_score": 0,
  "sentiment": "positive|neutral|negative|mixed",
  "key_themes": [],
  "strengths": [],
  "concerns": [],
  "action_orientation": "high|medium|low",
  "engagement": "high|medium|low",
  "summary": "",
  "recommendations": [],
  "measurable_outcomes": [],
  "actions_taken": [],
  "unique_methods": [],
  "challenges": [],
  "learnings": [],
  "missing_information": [],
  "extraction_confidence": "high|medium|low"
}
""")
            
            prompt = "\n".join(prompt_parts)
            prompt_len = len(prompt)
            
            start_time = time.perf_counter()
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
                config=types.GenerateContentConfig(
                    thinking_config=types.ThinkingConfig(thinking_budget=1024)
                )
            )
            end_time = time.perf_counter()
            
            # --- Token Logging via helper ---
            usage_dict = extract_gemini_usage(response, "gemini-2.5-flash", start_time, end_time)
            
            input_tokens = usage_dict["prompt_tokens"]
            output_tokens = usage_dict["output_tokens"]
            total_tokens = usage_dict["total_tokens"]
            
            print("\n========== GEMINI USAGE & COST ==========")
            print(f"Model: {usage_dict['model']}\n")
            print(f"Input Tokens:    {usage_dict['prompt_tokens']:,}")
            print(f"Output Tokens:   {usage_dict['output_tokens']:,}")
            print(f"Thinking Tokens: {usage_dict['thinking_tokens']:,}")
            print(f"Cached Tokens:   {usage_dict['cached_tokens']:,}")
            print(f"Total Tokens:    {usage_dict['total_tokens']:,}\n")
            
            if usage_dict.get('pricing_available'):
                print(f"Input Cost:      ${usage_dict['input_cost_usd']}")
                print(f"Output Cost:     ${usage_dict['output_cost_usd']}")
                print(f"Total Cost:      ${usage_dict['total_cost_usd']}")
                print(f"Total Cost INR:  ₹{usage_dict['total_cost_inr']}\n")
            else:
                print("Pricing:         Unavailable\n")
            
            print(f"Duration:        {usage_dict['duration_ms']:,.0f} ms")
            print("=========================================\n")
            
            res_text = response.text.strip()
            if res_text.startswith("```json"):
                res_text = res_text[7:]
            if res_text.startswith("```"):
                res_text = res_text[3:]
            if res_text.endswith("```"):
                res_text = res_text[:-3]
            res_text = res_text.strip()
            
            res_json = json.loads(res_text)
            gemini_score = int(res_json.get("overall_score", 0))
        except Exception as e:
            end_time = time.perf_counter()
            duration_ms = round((end_time - start_time) * 1000, 2) if 'start_time' in locals() else 0.0
            print("\n====================================================")
            print("GEMINI EVALUATION FAILED")
            print("====================================================")
            print(f"Model: gemini-2.5-flash")
            print(f"Error Type: {type(e).__name__}")
            print(f"Error: {e}")
            print(f"Request Duration: {duration_ms} ms")
            print("====================================================\n")
            gemini_score = bge_relevance_score  # fallback if Gemini fails
            usage_dict = {
                "model": "gemini-2.5-flash",
                "prompt_tokens": 0, "output_tokens": 0, "thinking_tokens": 0, "cached_tokens": 0, "total_tokens": 0,
                "duration_ms": duration_ms, "estimated_cost_usd": None, "estimated_cost_inr": None,
                "status": "FAILED", "error": str(e)
            }
    else:
        gemini_score = bge_relevance_score

    # --- 3. Final Scoring and Logging ---
    final_score = gemini_score
    
    print("\n========== TEXT AI EVALUATION DEBUG ==========")
    print(f"Task Comparison Text:\n{comparison_text}")
    print(f"BGE Raw Cosine Similarity: {round(float(sim), 4)}")
    print(f"BGE Relevance Score: {bge_relevance_score}")
    print(f"Gemini Overall Score: {gemini_score}")
    print(f"Clarity Score: {clarity_score}")
    print(f"Final Score: {final_score}")
    print("==============================================\n")

    # Map the new format back to the API contract
    strengths = res_json.get("strengths", [])
    weaknesses = res_json.get("concerns", [])
    improvement_points = res_json.get("recommendations", [])
    
    # Derive detected issues conservatively from concerns
    detected_issues = [f"Issue: {w}" for w in weaknesses]

    if not strengths and not weaknesses:
        if bge_relevance_score >= 70:
            strengths.append("High semantic alignment with task objectives.")
        else:
            weaknesses.append("Response deviates from expected core themes.")
            improvement_points.append("Align the response more closely with the task objectives.")

        if clarity_score >= 80:
            strengths.append("Excellent readability and structured sentence lengths.")
        elif clarity_score < 50:
            detected_issues.append("Low readability or unstructured sentences.")
            improvement_points.append("Use shorter, well-structured sentences to improve clarity.")

        if not strengths:
            strengths.append("Response recorded successfully.")

    # Convert parameter_analysis from key_themes + action_orientation etc
    key_themes = res_json.get("key_themes", [])
    action_orient = res_json.get("action_orientation", "medium")
    engage = res_json.get("engagement", "medium")
    sentiment = res_json.get("sentiment", "Neutral")
    
    param_analysis_parts = []
    if key_themes:
        param_analysis_parts.append(f"Themes detected: {', '.join(key_themes)}.")
    param_analysis_parts.append(f"Action Orientation: {action_orient}.")
    param_analysis_parts.append(f"Engagement: {engage}.")
    param_analysis_parts.append(f"Sentiment: {sentiment}.")
    parameter_analysis = " ".join(param_analysis_parts)

    return {
        "overall_score": final_score,
        "metrics": {
            "gemini_quality_score": gemini_score,
            "bge_relevance_score": bge_relevance_score,
            "bge_raw_similarity": round(float(sim), 4),
            "clarity_score": clarity_score
        },
        "sentiment": sentiment,
        "parameter_analysis": parameter_analysis,
        "summary": res_json.get("summary", ""),
        "strengths": strengths,
        "weaknesses": weaknesses,
        "detected_issues": detected_issues,
        "improvement_points": improvement_points,
        "measurable_outcomes": res_json.get("measurable_outcomes", []),
        "actions_taken": res_json.get("actions_taken", []),
        "unique_methods": res_json.get("unique_methods", []),
        "challenges": res_json.get("challenges", []),
        "learnings": res_json.get("learnings", []),
        "missing_information": res_json.get("missing_information", []),
        "extraction_confidence": res_json.get("extraction_confidence", "high"),
        "model_output": {
            "model_name": "Hybrid-Gemini-BGE",
            "cosine_similarity": round(float(sim), 4),
            "gemini_output": res_json,
            "usage_metrics": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": total_tokens
            },
            "usage": usage_dict
        }
    }

def analyze_mcq(questions: list, answers: list) -> dict:
    """
    Perform silent rule-based MCQ option verification.
    """
    total = len(questions)
    if total == 0:
        return {
            "overall_score": 100,
            "metrics": {"correct_answers": 0, "total_questions": 0, "accuracy": 100},
            "strengths": ["Quiz submitted successfully."],
            "weaknesses": [],
            "detected_issues": [],
            "improvement_points": [],
            "question_analysis": []
        }

    correct_count = 0
    analysis = []
    
    # Map questions by ID for quick lookup
    q_map = {}
    for q in questions:
        q_id = q.get("id") or q.get("question_id")
        if q_id:
            q_map[str(q_id)] = q

    for ans in answers:
        q_id = str(ans.get("question_id") or ans.get("id") or "")
        q_obj = q_map.get(q_id)

        selected = str(ans.get("selected_option") or ans.get("selected_answer") or ans.get("answer") or ans.get("selected") or ""

).strip()
        if q_obj:
            correct = str(q_obj.get("correctAnswer") or q_obj.get("correct_answer") or q_obj.get("correct_answers") or "").strip()
            
            selected_items = {
                x.strip().lower()
                for x in selected.split(",")
                if x.strip()
            }

            correct_items = {
                x.strip().lower()
                for x in correct.split(",")
                if x.strip()
            }

            is_correct = (selected_items == correct_items) if correct_items else False
            if is_correct:
                correct_count += 1

            analysis.append({
                "question": q_obj.get("question", ""),
                "selected_answer": selected,
                "correct_answer": correct,
                "is_correct": is_correct,
                "feedback": "Correct option selected." if is_correct else f"Incorrect. The correct option was: {correct}"
            })
        else:
            # Invalid question ID provided in payload
            analysis.append({
                "question": ans.get("question", f"Unknown Question ID: {q_id}"),
                "selected_answer": selected,
                "correct_answer": "UNKNOWN",
                "is_correct": False,
                "feedback": "Invalid question. No matching question found in the database."
            })

    score = int((correct_count / total) * 100) if total > 0 else 0
    
    strengths = []
    weaknesses = []
    improvement_points = []
    
    if score >= 80:
        strengths.append(f"Demonstrated excellent understanding with {score}% accuracy.")
    elif score >= 50:
        strengths.append(f"Passed the quiz with {score}% accuracy.")
        weaknesses.append("Some concepts need revision.")
        improvement_points.append("Review the questions marked incorrect and try again.")
    else:
        weaknesses.append(f"Low accuracy of {score}%. Key concepts are not clear.")
        improvement_points.append("Review all course materials and retake the quiz.")

    return {
        "overall_score": score,
        "metrics": {
            "correct_answers": correct_count,
            "total_questions": total,
            "accuracy": score
        },
        "strengths": strengths,
        "weaknesses": weaknesses,
        "detected_issues": [f"Incorrectly answered {total - correct_count} questions."] if correct_count < total else [],
        "improvement_points": improvement_points,
        "question_analysis": analysis,
        "model_output": {"type": "rule_based_mcq"}
    }


import os
import json
import uuid
from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException, BackgroundTasks
from pydantic import BaseModel
from google import genai
from google.genai import types

from utils.supabase_client import supabase
from utils.auth import RequestAuth, get_request_auth_required
from task_manager import route as service

router = APIRouter()

# Initialize Gemini Client using GEMINI_API_KEY
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY") or "") if os.getenv("GEMINI_API_KEY") else None

def get_company_id(
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    x_company_id: Optional[str] = Header(None, alias="X-Company-ID"),
) -> str:
    company_id = service.resolve_company_id(auth_ctx.user_id, x_company_id)
    if not company_id:
        raise HTTPException(status_code=400, detail="Company ID is required")
    return company_id

class AnswerItem(BaseModel):
    question_id: str
    question: str
    selected_option: str
    correct_answer: str

class TextAnalysisRequest(BaseModel):
    assignment_id: str
    task_id: str
    submission_type: str  # "text" or "multiple_choice"
    text_response: Optional[str] = None
    answers: Optional[List[AnswerItem]] = None

@router.post("/submit")
async def submit_text_analysis(
    payload: TextAnalysisRequest,
    background_tasks: BackgroundTasks,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    company_id: str = Depends(get_company_id)
):
    user_id = auth_ctx.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="User not authenticated")

    submission_type = payload.submission_type.lower()
    
    resolved_task_id = payload.task_id
    is_bundle_submission = False
    if payload.task_id and "-" in payload.task_id:
        parts = payload.task_id.rsplit("-", 1)
        if parts[1].isdigit() or parts[1] in ["image", "text", "audio", "video", "multiple_choice"]:
            resolved_task_id = parts[0]
            is_bundle_submission = True
    if submission_type not in ("text", "multiple_choice"):
        raise HTTPException(status_code=400, detail="Invalid submission type. Must be 'text' or 'multiple_choice'.")

    # 1. Fetch existing submission to check if already completed for this format
    existing_row = None
    if payload.task_id and user_id:
        existing_res = (
            supabase
            .table("task_submissions")
            .select("submission_id, assignment_id, company_id, user_id, task_id, child_task_id, parent_task_id, submission_type, text_response, image_url, audio_url, video_url, answers, score, max_score, ai_validation_pass, ai_validation_verdict, ai_validation_reason, ai_validation_suggestion, ai_validation_confidence, ai_status, analysis_status, status, submitted_at")
            .eq("task_id", resolved_task_id)
            .eq("user_id", user_id)
            .execute()
        )
        rows = existing_res.data or []
        if is_bundle_submission:
            for row in rows:
                answers = row.get("answers") or []
                if any(isinstance(ans, dict) and ans.get("child_task_id") == payload.task_id for ans in answers):
                    existing_row = row
                    break
            if not existing_row and rows:
                existing_row = rows[0]
        else:
            existing_row = rows[0] if rows else None

    if existing_row:
        is_completed = False
        if is_bundle_submission:
            answers = existing_row.get("answers") or []
            if any(isinstance(ans, dict) and ans.get("child_task_id") == payload.task_id for ans in answers):
                is_completed = True
        else:
            if submission_type == "text" and existing_row.get("text_response"):
                is_completed = True
            elif submission_type == "multiple_choice" and existing_row.get("answers"):
                is_completed = True
            
        if is_completed:
            raise HTTPException(status_code=409, detail="Task already completed")

    submission_id = existing_row["submission_id"] if existing_row else str(uuid.uuid4())

    # 2. Prepare insert/update data with pending status
    insert_data = {
        "submission_id": submission_id,
        "company_id": company_id,
        "task_id": resolved_task_id,
        "user_id": user_id,
        "assignment_id": payload.assignment_id,
        "submission_type": payload.submission_type,
        "text_response": payload.text_response if submission_type == "text" else None,
        "answers": [a.model_dump() for a in payload.answers] + ([{"child_task_id": payload.task_id}] if is_bundle_submission else []) if submission_type == "multiple_choice" and payload.answers else ([{"child_task_id": payload.task_id}] if is_bundle_submission else []),
        "score": 0,
        "max_score": len(payload.answers) if submission_type == "multiple_choice" and payload.answers else 100,
        "ai_validation_pass": False,
        "ai_validation_verdict": "PENDING",
        "ai_validation_reason": "AI evaluation is running in background...",
        "ai_validation_suggestion": "",
        "ai_validation_confidence": "medium",
        "ai_status": "pending",
        "analysis_status": "pending",
        "status": "submitted",
        "submitted_at": datetime.utcnow().isoformat()
    }

    if not existing_row:
        try:
            result = (
                supabase
                .table("task_submissions")
                .insert(insert_data)
                .execute()
            )
        except Exception as e:
            err_msg = str(e).lower()
            if "duplicate key" in err_msg or "23505" in err_msg or "already exists" in err_msg:
                # Retrieve the row that was just inserted by the concurrent request
                existing_res = (
                    supabase
                    .table("task_submissions")
                    .select("submission_id, assignment_id, company_id, user_id, task_id, child_task_id, parent_task_id, submission_type, text_response, image_url, audio_url, video_url, answers, score, max_score, ai_validation_pass, ai_validation_verdict, ai_validation_reason, ai_validation_suggestion, ai_validation_confidence, ai_status, analysis_status, status, submitted_at")
                    .eq("task_id", resolved_task_id)
                    .eq("user_id", user_id)
                    .execute()
                )
                rows = existing_res.data or []
                if is_bundle_submission:
                    for row in rows:
                        answers = row.get("answers") or []
                        if any(isinstance(ans, dict) and ans.get("child_task_id") == payload.task_id for ans in answers):
                            existing_row = row
                            break
                    if not existing_row and rows:
                        existing_row = rows[0]
                else:
                    existing_row = rows[0] if rows else None
                if not existing_row:
                    raise HTTPException(status_code=500, detail=str(e))
            else:
                raise HTTPException(status_code=500, detail=str(e))

    if existing_row:
        update_data = {}
        for field in ["text_response", "answers", "score", "max_score", "ai_validation_pass",
                      "ai_validation_verdict", "ai_validation_reason", "ai_validation_suggestion",
                      "ai_validation_confidence", "ai_status", "analysis_status", "status",
                      "submission_type", "submitted_at"]:
            val = insert_data.get(field)
            if val is not None:
                # Merge answers to avoid overwriting existing ones for other subtasks
                if field == "answers" and is_bundle_submission and existing_row.get("answers"):
                    existing_answers = existing_row.get("answers") or []
                    # Keep old answers, but filter out the ones for this child_task_id if updating
                    merged_answers = [a for a in existing_answers if not (isinstance(a, dict) and a.get("child_task_id") == payload.task_id)]
                    merged_answers.extend(val)
                    update_data[field] = merged_answers
                else:
                    update_data[field] = val
        
        result = (
            supabase
            .table("task_submissions")
            .update(update_data)
            .eq("submission_id", existing_row["submission_id"])
            .execute()
        )
        submission_id = existing_row["submission_id"]

    # 3. Queue background task
    from task_manager.analyzer.pipeline import run_ai_pipeline_bg
    # run_ai_pipeline_bg.delay(
    background_tasks.add_task(
        run_ai_pipeline_bg,
        submission_id,
        company_id,
        payload.task_id,
        payload.submission_type,
        payload.text_response if submission_type == "text" else [a.model_dump() for a in payload.answers] if payload.answers else []
    )

    return {
        "status": "success",
        "message": "Task submitted successfully",
        "submission_id": submission_id
    }

