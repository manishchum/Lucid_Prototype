import os
import json
import re
import time
import inspect
import asyncio
import concurrent.futures
import tempfile
import httpx
from typing import List, Dict, Any, Optional
from ai.ai_gateway import AI
from ai.types import AIRequest
from utils.auth_bridge import get_service_supabase_client


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
from enum import Enum
from typing import List, Dict, Any
from pydantic import BaseModel, Field

# from celery_worker import celery_app

class SubmissionType(str, Enum):
    TEXT = "text"
    AUDIO = "audio"
    VIDEO = "video"
    IMAGE = "image"
    MULTIPLE_CHOICE = "multiple_choice"

class TaskInsightsResponse(BaseModel):
    summary: str = Field(description="A brief executive summary of performance.")
    measurable_outcomes: List[str] = Field(default_factory=list)
    actions_taken: List[str] = Field(default_factory=list)
    unique_methods: List[str] = Field(default_factory=list)
    challenges: List[str] = Field(default_factory=list)
    learnings: List[str] = Field(default_factory=list)
    missing_information: List[str] = Field(default_factory=list)
    extraction_confidence: str = Field(default="high")

TYPE_CONFIGS = {
    SubmissionType.MULTIPLE_CHOICE: {
        "analysis_focus": """
            - Knowledge demonstrated
            - Correct and Incorrect concepts
            - Learning gaps and Knowledge strengths
            - Revision recommendations
        """,
        "schema_mapping": """
            - 'measurable_outcomes': List the correct concepts and knowledge strengths demonstrated.
            - 'challenges': List the incorrect concepts and identified learning gaps.
            - 'learnings': List the recommended revision topics and next steps.
            - 'missing_information': List specific knowledge areas that were completely absent or skipped.
            - 'actions_taken' & 'unique_methods': MUST be empty arrays [] as these do not apply to MCQs.
        """
    },
    SubmissionType.AUDIO: {
        "analysis_focus": """
            - Communication and Sales skills
            - Customer handling and Objections
            - Confidence and Business outcomes
        """,
        "schema_mapping": """
            - 'measurable_outcomes': Business outcomes achieved or objections successfully overcome.
            - 'actions_taken': Specific conversational tactics or communication strategies used.
            - 'unique_methods': Unique sales skills or rapport-building techniques.
            - 'challenges': Customer objections faced or communication stumbles.
        """
    },
    SubmissionType.IMAGE: {
        "analysis_focus": """
            - Visual proof and Compliance
            - Required objects and Task completion
            - Missing evidence
        """,
        "schema_mapping": """
            - 'measurable_outcomes': List compliant items and visual proof of task completion.
            - 'actions_taken': Actions clearly visible in the image.
            - 'missing_information': Required objects, safety gear, or compliance elements missing from the image.
            - 'unique_methods', 'learnings', 'challenges': Return empty arrays [] unless visually obvious.
        """
    },
    SubmissionType.VIDEO: {
        "analysis_focus": """
            - Communication and Visual behaviour
            - Task completion and Presentation
            - Customer interaction
        """,
        "schema_mapping": """
            - 'measurable_outcomes': Task completion markers and interaction outcomes.
            - 'actions_taken': Physical actions and presentation behaviours demonstrated.
            - 'unique_methods': Exceptional presentation or interaction techniques.
            - 'challenges': Visible struggles, awkward interactions, or missed steps.
        """
    },
    SubmissionType.TEXT: {
        "analysis_focus": """
            - Writing clarity and Professionalism
            - Detail orientation and Key arguments
            - Task completion
        """,
        "schema_mapping": """
            - 'measurable_outcomes': Key arguments made and task objectives met.
            - 'unique_methods': Unique problem-solving approaches described in the text.
            - 'challenges': Weak arguments or missing logical steps.
        """
    }
}

def generate_task_insights(
    task_title: str,
    task_description: str,
    expected_answer: str | None,
    analyzing_parameters: str | None,
    submission_type: str,
    submission_content: dict | str | list,
    evaluation_result: dict,
    company_id: str | None = None,
    user_id: str | None = None,
) -> dict:
    """
    Generate business/task outcomes (insights) dynamically using AI Gateway feature 'task_insights'.
    """
    content_str = ""
    stype = str(submission_type).lower()
    if stype == "text":
        content_str = f"Employee Text Response:\n{submission_content}"
    elif stype == "audio":
        content_str = f"Employee Spoken Transcript:\n{submission_content}"
    elif stype == "video":
        transcript = submission_content.get("transcript", "") if isinstance(submission_content, dict) else ""
        visual_summary = submission_content.get("visual_summary", "") if isinstance(submission_content, dict) else ""
        content_str = f"Employee Spoken Transcript:\n{transcript}\n\nVideo Visual Summary:\n{visual_summary}"
    elif stype == "image":
        if isinstance(submission_content, dict):
            detected_objects = submission_content.get("detected_objects", [])
            clip_similarity = submission_content.get("clip_similarity", 0.0)
            generated_description = submission_content.get("generated_description", "")
        else:
            detected_objects, clip_similarity, generated_description = [], 0.0, ""

        content_str = (
            f"Detected objects in image:\n{detected_objects}\n\n"
            f"CLIP semantic similarity score: {clip_similarity}\n\n"
            f"Generated Description:\n{generated_description}"
        )
    elif stype == "multiple_choice":
        content_str = "MCQ Quiz Question and Answer Results:\n"
        if isinstance(submission_content, list):
            for idx, qa in enumerate(submission_content):
                if isinstance(qa, dict):
                    content_str += (
                        f"{idx + 1}. Question: {qa.get('question')}\n"
                        f"   Employee Selected: {qa.get('selected_answer')}\n"
                        f"   Correct Answer: {qa.get('correct_answer')}\n"
                        f"   Is Correct: {qa.get('is_correct')}\n"
                    )

    evaluation_summary = f"""AI Evaluation Results:
Overall Score: {evaluation_result.get("overall_score", 0)}
Strengths: {json.dumps(evaluation_result.get("strengths", []), indent=2)}
Weaknesses: {json.dumps(evaluation_result.get("weaknesses", []), indent=2)}
Detected Issues: {json.dumps(evaluation_result.get("detected_issues", []), indent=2)}
Improvement Points: {json.dumps(evaluation_result.get("improvement_points", []), indent=2)}
Metrics: {json.dumps(evaluation_result.get("metrics", {}), indent=2)}"""

    try:
        sub_enum = SubmissionType(stype)
    except ValueError:
        sub_enum = SubmissionType.TEXT

    config = TYPE_CONFIGS.get(sub_enum, TYPE_CONFIGS[SubmissionType.TEXT])

    variables = {
        "task_title": task_title or "Untitled Task",
        "task_description": task_description or "No task description provided.",
        "expected_answer": expected_answer or "N/A",
        "analyzing_parameters": analyzing_parameters or "N/A",
        "submission_type": stype.upper(),
        "analysis_focus": config["analysis_focus"].strip(),
        "schema_mapping": config["schema_mapping"].strip(),
        "submission_content": content_str,
        "evaluation_summary": evaluation_summary.strip(),
    }

    try:
        request = AIRequest(
            feature="task_insights",
            company_id=company_id or "system",
            user_id=user_id or "system",
            route="/api/task-manager/analyzer/pipeline",
            variables=variables,
            prompt_type="default",
            response_format="json",
            generation_config={
                "temperature": 0.2,
                "response_mime_type": "application/json",
            },
        )
        ai_resp = _run_coroutine(AI.execute(request))
        raw_content = getattr(ai_resp, "content", None) or ""
        insights = _parse_json_response(raw_content)

        if not insights:
            raise RuntimeError("Empty or non-JSON insights output returned by AI Gateway")

        expected_keys = [
            "summary",
            "measurable_outcomes",
            "actions_taken",
            "unique_methods",
            "challenges",
            "learnings",
            "missing_information",
            "extraction_confidence",
        ]
        for key in expected_keys:
            if key not in insights:
                if key in [
                    "actions_taken",
                    "unique_methods",
                    "challenges",
                    "learnings",
                    "missing_information",
                    "measurable_outcomes",
                ]:
                    insights[key] = []
                elif key == "extraction_confidence":
                    insights[key] = "high"
                else:
                    insights[key] = ""

        return insights
    except Exception as e:
        print(f"[AI Insights] Failed to generate/parse insights via AI Gateway: {e}")
        return {
            "summary": "Task submission processed.",
            "measurable_outcomes": [],
            "actions_taken": [],
            "unique_methods": [],
            "challenges": [],
            "learnings": [],
            "missing_information": [f"AI insights generation or parsing failed: {e}"],
            "extraction_confidence": "low",
        }

def _ensure_local_media_file(input_path_or_url: str, submission_id: str, default_ext: str = "") -> tuple:
    """
    If input_path_or_url is an HTTP/HTTPS URL, download it to a local temp file.
    Returns (local_path: str, is_temp: bool).
    If already a local path, returns (input_path_or_url, False).
    """
    if not input_path_or_url:
        return input_path_or_url, False
    if not (input_path_or_url.startswith("http://") or input_path_or_url.startswith("https://")):
        return input_path_or_url, False

    media_dir = os.path.join(tempfile.gettempdir(), "lucid_eval_media")
    os.makedirs(media_dir, exist_ok=True)

    # Guess extension from URL or use default
    url_path = input_path_or_url.split("?")[0]
    _, url_ext = os.path.splitext(url_path)
    ext = url_ext if url_ext else default_ext
    local_path = os.path.join(media_dir, f"{submission_id}{ext}")

    try:
        with httpx.Client(timeout=60.0, follow_redirects=True) as client:
            response = client.get(input_path_or_url)
            response.raise_for_status()
            with open(local_path, "wb") as f:
                f.write(response.content)
        print(f"[pipeline] Downloaded remote media to: {local_path}")
        return local_path, True
    except Exception as e:
        print(f"[pipeline] Failed to download remote media {input_path_or_url}: {e}")
        return input_path_or_url, False


def _convert_to_wav(audio_path: str, submission_id: str) -> tuple:
    """
    Convert any audio file to 16kHz mono WAV using ffmpeg (via static_ffmpeg).
    Whisper's soundfile backend only reads PCM-based formats (WAV/FLAC).
    Returns (wav_path: str, is_temp: bool).
    If ffmpeg is unavailable or conversion fails, returns (audio_path, False).
    """
    _, ext = os.path.splitext(audio_path)
    if ext.lower() in (".wav",):
        # Already WAV — no conversion needed
        return audio_path, False

    wav_dir = os.path.join(tempfile.gettempdir(), "lucid_eval_media")
    os.makedirs(wav_dir, exist_ok=True)
    wav_path = os.path.join(wav_dir, f"{submission_id}_converted.wav")

    try:
        import subprocess
        result = subprocess.run(
            [
                "ffmpeg", "-y", "-i", audio_path,
                "-ar", "16000", "-ac", "1",
                "-acodec", "pcm_s16le",
                wav_path
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=120,
        )
        if result.returncode == 0 and os.path.exists(wav_path):
            print(f"[pipeline] Converted audio to WAV: {wav_path}")
            return wav_path, True
        else:
            err = result.stderr.decode(errors="replace").strip()[-300:]
            print(f"[pipeline] ffmpeg audio conversion failed (rc={result.returncode}): {err}")
            return audio_path, False
    except Exception as e:
        print(f"[pipeline] Audio conversion to WAV failed: {e}")
        return audio_path, False

# @celery_app.task(name="analysis.background.run_ai_pipeline_bg")
def run_ai_pipeline_bg(submission_id: str, company_id: str, task_id: str, submission_type: str, input_data: str | list, is_bundle_submission: bool = False):
    """
    Background worker executed via FastAPI BackgroundTasks.
    Runs the specific AI pipeline, updates task_submissions with the result,
    and cleans up saved file inputs.
    """
    print(f"[AI Background] Starting evaluation for submission_id: {submission_id}")
    print("\n========== NEW AI JOB ==========")
    print("Submission ID :", submission_id)
    print("Submission Type :", submission_type)
    print("Input Data :", input_data)
    print("================================\n")
    
    table_name = "child_task_submissions" if is_bundle_submission else "task_submissions"
    db = get_service_supabase_client()

    sub_user_id = None
    try:
        sub_res = db.table(table_name).select("user_id").eq("submission_id", submission_id).maybe_single().execute()
        sub_user_id = sub_res.data.get("user_id") if sub_res and sub_res.data else None
    except Exception as e:
        print(f"[AI Background] Error fetching user_id for submission {submission_id}: {e}")

    # 1. Update analysis_status to 'processing'
    try:
        db.table(table_name).update({"analysis_status": "processing"}).eq("submission_id", submission_id).execute()
    except Exception as e:
        print(f"[AI Background] Error updating status to processing for {submission_id}:", e)

    # 2. Fetch Task Details (title, description, expected_answer, questions)
    task = {}
    try:
        from utils.task_resolver import resolve_task_details
        task = resolve_task_details(task_id, company_id)
    except Exception as e:
        print(f"[AI Background] Error fetching task {task_id}:", e)

    # 3. Execute the corresponding analysis pipeline
    result = {}
    extracted_content = {
        "transcript": "",
        "detected_objects": [],
        "visual_summary": "",
        "raw_employee_response": ""
    }
    quality_analysis = {}
    text_inputs_for_insights = ""

    try:
        stype = str(submission_type).lower()
        if stype == "text":
            from task_manager.analyzer.text import analyze_text
            result = analyze_text(
                task_title=task.get("title", ""),
                task_description=task.get("description", ""),
                expected_answer=task.get("expected_answer"),
                analyzing_parameters=task.get("analyzing_parameters"),
                employee_response=input_data,  # text_response
                company_id=company_id,
                user_id=sub_user_id
            )
            extracted_content["raw_employee_response"] = input_data
            text_inputs_for_insights = input_data
            quality_analysis = result.get("metrics", {}).copy()
            quality_analysis["bge_similarity"] = result.get("model_output", {}).get("bge_relevance")
            quality_analysis["acoustic_features"] = result.get("model_output", {}).get("acoustic_features")
            quality_analysis["speech_quality"] = result.get("model_output", {}).get("speech_quality")

        elif stype == "multiple_choice":
            from task_manager.analyzer.text import analyze_mcq
            result = analyze_mcq(
                questions=task.get("questions") or [],
                answers=input_data  # list of answer items
            )
            extracted_content["raw_employee_response"] = json.dumps(input_data)
            text_inputs_for_insights = result.get("question_analysis", [])
            quality_analysis = {
                "correct_answers": result.get("metrics", {}).get("correct_answers", 0),
                "wrong_answers": result.get("metrics", {}).get("total_questions", 0) - result.get("metrics", {}).get("correct_answers", 0),
                "score": result.get("overall_score", 0)
            }

        elif stype == "image":
            # input_data is saved image file path or remote URL
            local_image_path, is_temp_image = _ensure_local_media_file(input_data, submission_id, ".jpg")

            print("\n========== IMAGE PIPELINE START ==========")
            print("IMAGE PATH:", local_image_path)
            print("TASK DESCRIPTION:", task.get("description", ""))

            from task_manager.analyzer.vision import analyze_image
            result = analyze_image(
                image_path=local_image_path,
                instruction=task.get("description", ""),
                analyzing_parameters=task.get("analyzing_parameters"),
                company_id=company_id,
                user_id=sub_user_id
            )

            if is_temp_image and os.path.exists(local_image_path):
                try:
                    os.unlink(local_image_path)
                except Exception:
                    pass

            print("\n========== RAW IMAGE ANALYZER OUTPUT ==========")
            print(json.dumps(result, indent=2, default=str))
            print("==========================================\n")


    # -------------------------
    # Extract AI model results
    # -------------------------

            detected_objects = result.get(
            "metrics",
            {}
            ).get(
            "detected_objects",
            []
            )

            clip_similarity = result.get(
            "metrics",
            {}
            ).get(
            "clip_similarity",
            0.0
            )

            model_output = result.get("model_output", {})
            object_validation = model_output.get("object_validation", {})
            pose_data = model_output.get("pose", {})
            ocr_data = model_output.get("ocr", {})
            gemini_verdict = model_output.get("gemini_verdict", {})


    # -------------------------
    # Save extracted content
    # (frontend/report usage)
    # -------------------------

            extracted_content["detected_objects"] = list(
            detected_objects
            )

            extracted_content["visual_summary"] = (
            f"Detected objects: "
            f"{', '.join(detected_objects) if detected_objects else 'none'}"
            )

            # Include Gemini verdict in extracted content
            if gemini_verdict:
                extracted_content["generated_description"] = gemini_verdict.get("feedback", "")


    # -------------------------
    # SMALL INPUT TO GEMINI
    # (for task insights)
    # -------------------------

            text_inputs_for_insights = {
            "detected_objects": list(detected_objects),
            "clip_similarity": clip_similarity,
            "generated_description": gemini_verdict.get("feedback", "") if gemini_verdict else ""
            }


    # -------------------------
    # Save technical AI scores
    # -------------------------

            quality_analysis = {
            "YOLO_objects": list(detected_objects),
            "CLIP_similarity": clip_similarity,
            "pose": pose_data,
            "ocr": ocr_data,
            "object_validation": object_validation,
            "gemini_verdict": gemini_verdict,
            "visual_match_score": result.get(
            "overall_score",
            0
            )
            }

        elif stype == "audio":
            # input_data is saved audio file path or remote URL
            local_audio_path, is_temp_audio = _ensure_local_media_file(input_data, submission_id, ".webm")
            # Convert to WAV — Whisper's soundfile backend can't read .m4a/.webm/.ogg
            wav_audio_path, is_temp_wav = _convert_to_wav(local_audio_path, submission_id)
            from task_manager.analyzer.audio import analyze_audio
            result = analyze_audio(
                audio_path=wav_audio_path,
                task_title=task.get("title", ""),
                task_description=task.get("description", ""),
                expected_answer=task.get("expected_answer"),
                analyzing_parameters=task.get("analyzing_parameters"),
                company_id=company_id,
                user_id=sub_user_id
            )

            # Clean up temp files
            if is_temp_wav and os.path.exists(wav_audio_path):
                try:
                    os.unlink(wav_audio_path)
                except Exception:
                    pass
            if is_temp_audio and os.path.exists(local_audio_path):
                try:
                    os.unlink(local_audio_path)
                except Exception:
                    pass
            transcript = result.get("metrics", {}).get("transcript", "")
            extracted_content["transcript"] = transcript
            if transcript.strip():
                text_inputs_for_insights = transcript
            else:
                text_inputs_for_insights = "No transcript could be extracted from the audio."
            quality_analysis = {
                "transcript": transcript,
                "relevance_score": result.get("metrics", {}).get("relevance_score", 0),
                "confidence": result.get("metrics", {}).get("confidence", 0),
                "clarity": result.get("metrics", {}).get("clarity", 0),
                "fluency": result.get("metrics", {}).get("fluency", 0),
                "bge_similarity": result.get("model_output", {}).get("bge_relevance"),
                "acoustic_features": result.get("model_output", {}).get("acoustic_features"),
                "speech_quality": result.get("model_output", {}).get("speech_quality"),
                "model_output": result.get("model_output", {})
            }

        elif stype == "video":
            # input_data is saved video file path or remote URL
            local_video_path, is_temp_video = _ensure_local_media_file(input_data, submission_id, ".mp4")
            from task_manager.analyzer.vision import analyze_video
            result = analyze_video(
                video_path=local_video_path,
                task_title=task.get("title", ""),
                task_description=task.get("description", ""),
                expected_answer=task.get("expected_answer"),
                company_id=company_id,
                user_id=sub_user_id
            )

            if is_temp_video and os.path.exists(local_video_path):
                try:
                    os.unlink(local_video_path)
                except Exception:
                    pass
            transcript = result.get("metrics", {}).get("transcript", "")
            detected_objects = result.get("metrics", {}).get("detected_objects", [])
            visual_score = result.get("metrics", {}).get("visual_score", 0)
            person_frames = result.get("model_output", {}).get("person_frames", "")
            visual_summary = (
                f"Video frames visual score: {visual_score}/100. "
                f"Person presence verified in {person_frames} frames. "
                f"Detected objects/visual elements in video: {', '.join(detected_objects) if detected_objects else 'none'}."
            )
            extracted_content["transcript"] = transcript
            extracted_content["detected_objects"] = list(detected_objects)
            extracted_content["visual_summary"] = visual_summary
            text_inputs_for_insights = {
                "transcript": transcript,
                "visual_summary": visual_summary
            }
            quality_analysis = {
                "visual_analysis": {
                    "visual_score": visual_score,
                    "person_frames": person_frames
                },
                "audio_analysis": {
                    "communication_score": result.get("metrics", {}).get("communication_score", 0)
                },
                "detected_actions": list(detected_objects)
            }
        else:
            raise ValueError(f"Unknown submission type: {submission_type}")

        # 4. Generate task insights
        if stype == "text":
            task_insights = {
                "summary": result.get("summary", ""),
                "measurable_outcomes": result.get("measurable_outcomes", []),
                "actions_taken": result.get("actions_taken", []),
                "unique_methods": result.get("unique_methods", []),
                "challenges": result.get("challenges", []),
                "learnings": result.get("learnings", []),
                "missing_information": result.get("missing_information", []),
                "extraction_confidence": result.get("extraction_confidence", "high")
            }
        elif stype == "audio" and not result.get("metrics", {}).get("transcript", "").strip():
              task_insights = {
            "summary": "No transcript could be extracted from the audio.",
            "measurable_outcomes": [],
            "actions_taken": [],
            "unique_methods": [],
            "challenges": [],
            "learnings": [],
            "missing_information": [
            "Speech could not be transcribed."
            ],
            "extraction_confidence": "low"
        }
        else:
            task_insights = generate_task_insights(
            task_title=task.get("title", ""),
            task_description=task.get("description", ""),
            expected_answer=task.get("expected_answer"),
            analyzing_parameters=task.get("analyzing_parameters"),
            submission_type=stype,
            submission_content=text_inputs_for_insights,
            evaluation_result=result,
            company_id=company_id,
            user_id=sub_user_id
        )

        # 5. Restructure ai_analysis dict to save both insights and quality analysis, keeping legacy attributes at root
        overall_score = result.get("overall_score", 0)
        ai_validation_pass = overall_score >= 60
        ai_validation_verdict = "PASS" if ai_validation_pass else "REVIEW"
        
        reason = "Submission evaluated successfully."
        if result.get("strengths"):
            reason = result["strengths"][0]
        elif result.get("weaknesses"):
            reason = result["weaknesses"][0]

        ai_analysis_restructured = {
            "extracted_content": extracted_content,
            "task_insights": task_insights,
            "quality_analysis": quality_analysis,
            
            # Root-level copies for backward compatibility
            "overall_score": overall_score,
            "metrics": result.get("metrics", {}),
            "strengths": result.get("strengths", []),
            "weaknesses": result.get("weaknesses", []),
            "detected_issues": result.get("detected_issues", []),
            "improvement_points": result.get("improvement_points", []),
            "model_output": result.get("model_output", {})
        }

        update_data = {
            "ai_analysis": ai_analysis_restructured,
            "analysis_status": "completed",
            "score": overall_score,
            "max_score": 100,
            "ai_validation_pass": ai_validation_pass,
            "ai_validation_verdict": ai_validation_verdict,
            "ai_validation_reason": reason,
            "ai_validation_suggestion": json.dumps(result.get("improvement_points", [])),
            "ai_validation_confidence": "high" if overall_score >= 80 else "medium" if overall_score >= 50 else "low",
            "ai_status": "completed"
        }
        
        # For compatibility with legacy audio_analysis column
        if stype in ("text", "multiple_choice"):
            update_data["audio_analysis"] = ai_analysis_restructured

        db.table(table_name).update(update_data).eq("submission_id", submission_id).execute()
        print(f"[AI Background] Evaluation completed successfully for submission_id: {submission_id}. Score: {overall_score}")

        # Invalidate dashboard summary and task caches for the submitted user
        try:
            sub_res = db.table(table_name).select("user_id").eq("submission_id", submission_id).maybe_single().execute()
            sub_user_id = sub_res.data.get("user_id") if sub_res and sub_res.data else None
            if sub_user_id:
                from utils.redis_client import delete_cache_pattern
                delete_cache_pattern(f"dashboard_summary:{sub_user_id}*")
                delete_cache_pattern(f"user_tasks:*{sub_user_id}*")
                from routes.employee_dashboard import invalidate_dashboard_l1_cache
                invalidate_dashboard_l1_cache(str(sub_user_id))

                # Trigger automated notification workflow: TASK_EVALUATED
                try:
                    from utils.notifications.workflow_engine import WorkflowEngine
                    import asyncio
                    eval_payload = {
                        "submission_id": submission_id,
                        "task_id": target_task_id,
                        "task.task_title": task.get("title", "Workplace Task"),
                        "task_title": task.get("title", "Workplace Task"),
                        "task.task_status": "evaluated",
                        "task.ai_validation_pass": ai_validation_pass,
                        "assessment.passed": ai_validation_pass,
                        "assessment.score": overall_score,
                        "score": overall_score,
                        "task.feedback_summary": reason,
                        "assessment.feedback_summary": reason,
                    }
                    try:
                        cur_loop = asyncio.get_running_loop()
                    except RuntimeError:
                        cur_loop = None

                    if cur_loop and cur_loop.is_running():
                        cur_loop.create_task(
                            WorkflowEngine.trigger_lifecycle(
                                trigger_lifecycle="TASK_EVALUATED",
                                user_id=sub_user_id,
                                payload=eval_payload,
                                company_id=company_id,
                            )
                        )
                    else:
                        asyncio.run(
                            WorkflowEngine.trigger_lifecycle(
                                trigger_lifecycle="TASK_EVALUATED",
                                user_id=sub_user_id,
                                payload=eval_payload,
                                company_id=company_id,
                            )
                        )
                except Exception as eval_wf_err:
                    print(f"[AI Background] WorkflowEngine TASK_EVALUATED trigger warning: {eval_wf_err}")
        except Exception as cache_err:
            print(f"[AI Background] Cache invalidation warning: {cache_err}")
        
    except Exception as exc:
        print(f"[AI Background] Critical error running pipeline for {submission_id}:", exc)
        try:
            db.table(table_name).update({
                "analysis_status": "failed",
                "ai_status": "failed",
                "ai_validation_reason": f"Evaluation failed: {str(exc)}"
            }).eq("submission_id", submission_id).execute()
        except Exception as db_err:
            print("[AI Background] Failed to update DB on fail:", db_err)
            
    finally:
        # 6. Safe file deletion
        if submission_type in ("image", "audio", "video") and isinstance(input_data, str) and os.path.exists(input_data):
            try:
                os.unlink(input_data)
                print(f"[AI Background] Deleted temporary media file: {input_data}")
            except Exception as e:
                print(f"[AI Background] Error deleting temporary file {input_data}:", e)


           