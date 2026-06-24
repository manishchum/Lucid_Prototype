import os
import json
from utils.supabase_client import supabase
from analysis.text_analyzer import analyze_text, analyze_mcq
from analysis.image_analyzer import analyze_image
from analysis.audio_analyzer import analyze_audio
from analysis.video_analyzer import analyze_video

def run_ai_pipeline_bg(submission_id: str, company_id: str, task_id: str, submission_type: str, input_data: str | list):
    """
    Background worker executed via FastAPI BackgroundTasks.
    Runs the specific AI pipeline, updates task_submissions with the result,
    and cleans up saved file inputs.
    """
    print(f"[AI Background] Starting evaluation for submission_id: {submission_id}")
    
    # 1. Update analysis_status to 'processing'
    try:
        supabase.table("task_submissions").update({"analysis_status": "processing"}).eq("submission_id", submission_id).execute()
    except Exception as e:
        print(f"[AI Background] Error updating status to processing for {submission_id}:", e)

    # 2. Fetch Task Details (title, description, expected_answer, questions)
    task = {}
    try:
        task_res = (
            supabase.table("tasks")
            .select("title, description, expected_answer, questions")
            .eq("task_id", task_id)
            .eq("company_id", company_id)
            .maybe_single()
            .execute()
        )
        task = task_res.data or {}
    except Exception as e:
        print(f"[AI Background] Error fetching task {task_id}:", e)

    # 3. Execute the corresponding analysis pipeline
    result = {}
    try:
        stype = str(submission_type).lower()
        if stype == "text":
            result = analyze_text(
                task_title=task.get("title", ""),
                task_description=task.get("description", ""),
                expected_answer=task.get("expected_answer"),
                employee_response=input_data  # text_response
            )
        elif stype == "multiple_choice":
            result = analyze_mcq(
                questions=task.get("questions") or [],
                answers=input_data  # list of answer items
            )
        elif stype == "image":
            # input_data is saved image file path
            result = analyze_image(
                image_path=input_data,
                instruction=task.get("description", "")
            )
        elif stype == "audio":
            # input_data is saved audio file path
            result = analyze_audio(
                audio_path=input_data,
                task_title=task.get("title", ""),
                task_description=task.get("description", ""),
                expected_answer=task.get("expected_answer")
            )
        elif stype == "video":
            # input_data is saved video file path
            result = analyze_video(
                video_path=input_data,
                task_title=task.get("title", ""),
                task_description=task.get("description", ""),
                expected_answer=task.get("expected_answer")
            )
        else:
            raise ValueError(f"Unknown submission type: {submission_type}")

        # 4. Save results to Database
        overall_score = result.get("overall_score", 0)
        ai_validation_pass = overall_score >= 60
        ai_validation_verdict = "PASS" if ai_validation_pass else "REVIEW"
        
        # Pull dynamic reason
        reason = "Submission evaluated successfully."
        if result.get("strengths"):
            reason = result["strengths"][0]
        elif result.get("weaknesses"):
            reason = result["weaknesses"][0]

        update_data = {
            "ai_analysis": result,
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
            update_data["audio_analysis"] = result

        supabase.table("task_submissions").update(update_data).eq("submission_id", submission_id).execute()
        print(f"[AI Background] Evaluation completed successfully for submission_id: {submission_id}. Score: {overall_score}")
        
    except Exception as exc:
        print(f"[AI Background] Critical error running pipeline for {submission_id}:", exc)
        try:
            supabase.table("task_submissions").update({
                "analysis_status": "failed",
                "ai_status": "failed",
                "ai_validation_reason": f"Evaluation failed: {str(exc)}"
            }).eq("submission_id", submission_id).execute()
        except Exception as db_err:
            print("[AI Background] Failed to update DB on fail:", db_err)
            
    finally:
        # 5. Safe file deletion
        if submission_type in ("image", "audio", "video") and isinstance(input_data, str) and os.path.exists(input_data):
            try:
                os.unlink(input_data)
                print(f"[AI Background] Deleted temporary media file: {input_data}")
            except Exception as e:
                print(f"[AI Background] Error deleting temporary file {input_data}:", e)
