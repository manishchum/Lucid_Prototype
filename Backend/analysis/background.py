import os
import json
import re
from google import genai
from google.genai import types
from utils.supabase_client import supabase
from analysis.text_analyzer import analyze_text, analyze_mcq
from analysis.image_analyzer import analyze_image
from analysis.audio_analyzer import analyze_audio
from analysis.video_analyzer import analyze_video

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

def generate_task_insights(task_title: str, task_description: str, expected_answer: str | None, submission_type: str, submission_content: dict | str | list, evaluation_result: dict) -> dict:
    """
    Generate business/task outcomes (insights) dynamically using Gemini structured outputs.
    """
    api_key = os.getenv("GEMINI_API_KEY") or ""
    if not api_key:
        print("[AI Insights] GEMINI_API_KEY not found. Skipping insights.")
        return {
            "summary": "Task submission processed.",
            "measurable_outcomes": [],
            "actions_taken": [],
            "unique_methods": [],
            "challenges": [],
            "learnings": [],
            "missing_information": ["GEMINI_API_KEY not configured."],
            "extraction_confidence": "low"
        }

    client = genai.Client(api_key=api_key)

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

    import json
    evaluation_summary = f"""
        AI Evaluation Results:
        Overall Score: {evaluation_result.get("overall_score", 0)}
        Strengths: {json.dumps(evaluation_result.get("strengths", []), indent=2)}
        Weaknesses: {json.dumps(evaluation_result.get("weaknesses", []), indent=2)}
        Detected Issues: {json.dumps(evaluation_result.get("detected_issues", []), indent=2)}
        Improvement Points: {json.dumps(evaluation_result.get("improvement_points", []), indent=2)}
        Metrics: {json.dumps(evaluation_result.get("metrics", {}), indent=2)}
    """
    
    try:
        sub_enum = SubmissionType(stype)
    except ValueError:
        sub_enum = SubmissionType.TEXT
        
    config = TYPE_CONFIGS.get(sub_enum, TYPE_CONFIGS[SubmissionType.TEXT])

    prompt = f"""
    You are an AI task analyst and expert Enterprise AI Coaching Assistant.
    Your task is to extract BUSINESS outcomes and manager-ready coaching insights from the employee submission.
    Ignore AI quality metrics, CLIP scores, audio quality, and visual scores. Focus on employee performance.

    Task: {task_title}
    Description: {task_description}
    Expected Answer/Behavior: {expected_answer or "N/A"}
    Submission Type: {stype.upper()}

    ANALYSIS FOCUS:
    You must ONLY analyze the following criteria relevant to this submission type:
    {config['analysis_focus']}

    SCHEMA MAPPING INSTRUCTIONS:
    Map your findings into the JSON output according to these exact rules:
    {config['schema_mapping']}

    STRICT CONSTRAINTS:
    1. NEVER invent or hallucinate information.
    2. Metrics need exact evidence from the submission.
    3. If information for a field cannot be inferred, you MUST return an empty array [].
    4. Do NOT write "Missing", "Not applicable", or "None found" inside the array.
    5. For AUDIO submissions, the transcript is generated by ASR and may contain minor typos. Focus on the semantic meaning.

    SUBMISSION CONTENT:
    {content_str}

    {evaluation_summary}
    """

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=TaskInsightsResponse,
                temperature=0.2
            )
        )

        if hasattr(response, 'usage_metadata') and response.usage_metadata:
            meta = response.usage_metadata
            print("\n========== GEMINI TOKEN USAGE (analysis/background.py - generate_task_insights) ==========")
            print(f"  Input tokens:    {getattr(meta, 'prompt_token_count', 'N/A')}")
            print(f"  Output tokens:   {getattr(meta, 'candidates_token_count', 'N/A')}")
            print(f"  Thinking tokens: {getattr(meta, 'thoughts_token_count', 'N/A')}")
            print(f"  TOTAL tokens:    {getattr(meta, 'total_token_count', 'N/A')}")
            print("=========================================================================================\n")

        text = response.text.strip()
        insights = json.loads(text)
        
        expected_keys = ["summary", "measurable_outcomes", "actions_taken", "unique_methods", "challenges", "learnings", "missing_information", "extraction_confidence"]
        for key in expected_keys:
            if key not in insights:
                if key in ["actions_taken", "unique_methods", "challenges", "learnings", "missing_information", "measurable_outcomes"]:
                    insights[key] = []
                elif key == "extraction_confidence":
                    insights[key] = "high"
                else:
                    insights[key] = ""
                    
        return insights
    except Exception as e:
        print(f"[AI Insights] Failed to generate/parse insights: {e}")
        return {
            "summary": "Task submission processed.",
            "measurable_outcomes": [],
            "actions_taken": [],
            "unique_methods": [],
            "challenges": [],
            "learnings": [],
            "missing_information": ["AI insights generation or parsing failed."],
            "extraction_confidence": "low"
        }

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

    # 1. Update analysis_status to 'processing'
    try:
        supabase.table(table_name).update({"analysis_status": "processing"}).eq("submission_id", submission_id).execute()
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
            result = analyze_text(
                task_title=task.get("title", ""),
                task_description=task.get("description", ""),
                expected_answer=task.get("expected_answer"),
                employee_response=input_data  # text_response
            )
            extracted_content["raw_employee_response"] = input_data
            text_inputs_for_insights = input_data
            quality_analysis = result.get("metrics", {}).copy()
            quality_analysis["bge_similarity"] = result.get("model_output", {}).get("bge_relevance")
            quality_analysis["acoustic_features"] = result.get("model_output", {}).get("acoustic_features")
            quality_analysis["speech_quality"] = result.get("model_output", {}).get("speech_quality")

        elif stype == "multiple_choice":
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
    # input_data is saved image file path

            print("\n========== IMAGE PIPELINE START ==========")
            print("IMAGE PATH:", input_data)
            print("TASK DESCRIPTION:", task.get("description", ""))

            result = analyze_image(
            image_path=input_data,
            instruction=task.get("description", "")
            )

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
            # input_data is saved audio file path
            result = analyze_audio(
                audio_path=input_data,
                task_title=task.get("title", ""),
                task_description=task.get("description", ""),
                expected_answer=task.get("expected_answer")
            )
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
            # input_data is saved video file path
            result = analyze_video(
                video_path=input_data,
                task_title=task.get("title", ""),
                task_description=task.get("description", ""),
                expected_answer=task.get("expected_answer")
            )
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
        if stype == "audio" and not result.get("metrics", {}).get("transcript", "").strip():
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
            submission_type=stype,
            submission_content=text_inputs_for_insights,
            evaluation_result=result
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

        supabase.table(table_name).update(update_data).eq("submission_id", submission_id).execute()
        print(f"[AI Background] Evaluation completed successfully for submission_id: {submission_id}. Score: {overall_score}")
        
    except Exception as exc:
        print(f"[AI Background] Critical error running pipeline for {submission_id}:", exc)
        try:
            supabase.table(table_name).update({
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


           