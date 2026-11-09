import os
import re
import json
import time
import uuid
import inspect
import asyncio
import concurrent.futures
from typing import Any, List, Optional
from datetime import datetime
import numpy as np

from fastapi import APIRouter, Depends, Header, HTTPException, BackgroundTasks
from pydantic import BaseModel

from ai.ai_gateway import AI
from ai.types import AIRequest
from utils.supabase_client import supabase
from utils.auth import RequestAuth, get_request_auth_required
from task_manager import route as service
from .models import get_bge_model

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


def _run_coroutine(coro):
    """
    Safely executes an async coroutine from either a synchronous thread,
    within an active asyncio event loop, or in sandbox environments.
    """
    if not inspect.iscoroutine(coro):
        return coro

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(asyncio.run, coro).result()

    try:
        return asyncio.run(coro)
    except Exception:
        try:
            coro.send(None)
        except StopIteration as e:
            return e.value
        raise


def _parse_json_response(raw_text: Any) -> dict:
    """
    Standardize JSON extraction from AI responses (handles raw text, markdown blocks, and embedded objects).
    """
    if isinstance(raw_text, dict):
        return raw_text
    if not raw_text or not isinstance(raw_text, str):
        return {}

    text = raw_text.strip()
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()

    try:
        return json.loads(text)
    except Exception:
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(text[start:end + 1])
            except Exception:
                pass
    return {}


def analyze_text(
    task_title: str,
    task_description: str,
    expected_answer: str | None,
    analyzing_parameters: str | None,
    employee_response: str,
    company_id: str = "system",
    user_id: str = "system"
) -> dict:
    """
    Perform text submission evaluation using Model Agnostic AI Gateway as the primary qualitative evaluator,
    supported by BGE for semantic relevance and clarity metrics.
    """
    if not employee_response or not employee_response.strip():
        return {
            "overall_score": 0,
            "metrics": {
                "ai_quality_score": 0,
                "gemini_quality_score": 0,
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
        bge_model = get_bge_model()
        if bge_model is not None:
            emb_comp = bge_model.encode(comparison_text)
            emb_resp = bge_model.encode(employee_response)
            sim = cosine_similarity(emb_comp, emb_resp)
            bge_relevance_score = int(max(0, sim) * 100)
        else:
            bge_relevance_score = 50
            sim = 0.5
    except Exception as e:
        print(f"[Text Analyzer] BGE embedding failed: {e}")
        bge_relevance_score = 50
        sim = 0.5
        
    # --- 2. Model Agnostic Layer Evaluation (Primary) ---
    res_json = {}
    ai_score = 0
    ai_response = None

    variables = {
        "task_context": task_context,
        "analyzing_parameters": (analyzing_parameters or "No specific evaluation criteria provided.").strip(),
        "expected_answer": (expected_answer or "No reference answer provided.").strip(),
        "employee_response": employee_response.strip(),
    }

    try:
        request = AIRequest(
            feature="task_evaluation_text",
            company_id=company_id or "system",
            user_id=user_id or "system",
            route="/api/task-manager/analyzer/text",
            variables=variables,
            prompt_type="default",
            response_format="json",
            generation_config={
                "temperature": 0.2,
                "thinking_config": {"thinking_budget": 1024},
            },
        )
        ai_response = _run_coroutine(AI.execute(request))

        if not ai_response or not ai_response.success:
            raise RuntimeError(f"AI Gateway returned failure: {getattr(ai_response, 'error', 'No response')}")

        res_json = _parse_json_response(ai_response.content)
        ai_score = int(res_json.get("overall_score", 0))

    except Exception as e:
        print(f"[Text Analyzer] AI Gateway evaluation failed ({type(e).__name__}: {e}). Falling back to BGE similarity score.")
        ai_score = bge_relevance_score
        res_json = {}

    final_score = ai_score

    # Map the evaluated format to the API contract
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

    input_tokens = ai_response.input_tokens if ai_response else 0
    output_tokens = ai_response.output_tokens if ai_response else 0
    total_tokens = ai_response.total_tokens if ai_response else 0

    return {
        "overall_score": final_score,
        "metrics": {
            "ai_quality_score": ai_score,
            "gemini_quality_score": ai_score,
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
            "model_name": f"{ai_response.provider}-{ai_response.model}" if ai_response else "Hybrid-AI-BGE",
            "cosine_similarity": round(float(sim), 4),
            "ai_output": res_json,
            "gemini_output": res_json,
            "usage_metrics": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": total_tokens
            },
            "usage": {
                "model": ai_response.model if ai_response else "fallback",
                "provider": ai_response.provider if ai_response else "none",
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": total_tokens,
                "latency_ms": ai_response.latency_ms if ai_response else 0,
                "status": "SUCCESS" if ai_response and ai_response.success else "FALLBACK"
            }
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

        selected = str(ans.get("selected_option") or ans.get("selected_answer") or ans.get("answer") or ans.get("selected") or "").strip()
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


router = APIRouter()


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
                if field == "answers" and is_bundle_submission and existing_row.get("answers"):
                    existing_answers = existing_row.get("answers") or []
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
