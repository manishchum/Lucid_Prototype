"""
Orchestrates the 9-worker pipeline for creating interactive video courses.
Runs sequentially or asynchronously, updating status in Supabase.
"""
from __future__ import annotations
import os
import shutil
import tempfile
import traceback
import datetime
from typing import Any, Dict, Optional
from utils.supabase_client import supabase

from .workers import (
    w1_document_parser,
    w2_topic_extractor,
    w3_instructional_designer,
    w4_storyboard_generator,
    w5_slide_generator,
    w6_voice_generator,
    w7_avatar_video_generator,
    w8_quiz_generator,
    w9_course_publisher,
)

WORKER_NAMES = {
    1: "Document Parsing",
    2: "Topic Extraction",
    3: "Instructional Design",
    4: "Storyboard Generation",
    5: "Slide Rendering",
    6: "Voice Synthesis",
    7: "Avatar Composition",
    8: "Quiz Validation",
    9: "Course Publishing"
}

def update_job_status(job_id: str, status: str, current_worker: int, error: Optional[str] = None):
    try:
        supabase.table("interactive_video_jobs").update({
            "status": status,
            "current_worker": current_worker,
            "error": error,
            "updated_at": datetime.datetime.utcnow().isoformat()
        }).eq("id", job_id).execute()
    except Exception as e:
        print(f"[Pipeline] Failed to update status for job {job_id}: {e}")

async def run_pipeline(job_id: str, processed_module_id: str):
    """Runs W1-W9 pipeline in a managed temporary directory, updating progress."""
    print(f"[Pipeline] Starting interactive video pipeline for job {job_id}...")
    
    # 1. Fetch the raw module data
    module_resp = supabase.table("processed_modules").select("*").eq("processed_module_id", processed_module_id).execute()
    if not module_resp.data:
        err = f"Processed module {processed_module_id} not found"
        update_job_status(job_id, "failed", 1, err)
        return
        
    module_data = module_resp.data[0]
    tmp_dir = tempfile.mkdtemp(prefix=f"interactive_vid_{job_id}_")
    
    try:
        # W1: Document Parser
        update_job_status(job_id, "w1_parsing", 1)
        w1_out = w1_document_parser.run(module_data)
        
        # W2: Topic Extractor
        update_job_status(job_id, "w2_topics", 2)
        w2_out = w2_topic_extractor.run(w1_out)
        
        # W3: Instructional Designer
        update_job_status(job_id, "w3_designing", 3)
        w3_out = w3_instructional_designer.run(w2_out)
        
        # W4: Storyboard Generator
        update_job_status(job_id, "w4_storyboarding", 4)
        w4_out = w4_storyboard_generator.run(w3_out)
        
        # W5: Slide Generator
        update_job_status(job_id, "w5_slides", 5)
        w5_out = await w5_slide_generator.run(w4_out, tmp_dir)
        
        # W6: Voice Generator
        update_job_status(job_id, "w6_voice", 6)
        w6_out = await w6_voice_generator.run(w5_out, tmp_dir)
        
        # W7: Avatar Video Generator
        update_job_status(job_id, "w7_avatar", 7)
        w7_out = await w7_avatar_video_generator.run(w6_out, tmp_dir)
        
        # W8: Quiz Generator
        update_job_status(job_id, "w8_quiz", 8)
        w8_out = w8_quiz_generator.run(w7_out)
        
        # W9: Course Publisher
        update_job_status(job_id, "w9_publishing", 9)
        w9_out = await w9_course_publisher.run(w8_out, tmp_dir)
        
        # Mark as completed
        update_job_status(job_id, "completed", 9)
        # Update job metadata with course details
        supabase.table("interactive_video_jobs").update({
            "job_metadata": {
                "course_id": w9_out["course_id"],
                "interactive_video_id": w9_out["interactive_video_id"],
                "total_segments": w9_out["manifest"]["total_segments"]
            }
        }).eq("id", job_id).execute()
        
        print(f"[Pipeline] Job {job_id} completed successfully!")
        
    except Exception as e:
        tb = traceback.format_exc()
        print(f"[Pipeline] Job {job_id} failed with exception:\n{tb}")
        update_job_status(job_id, "failed", 0, str(e))
        
    finally:
        # Clean up tmp directory
        try:
            shutil.rmtree(tmp_dir, ignore_errors=True)
            print(f"[Pipeline] Cleaned up temporary directory {tmp_dir}")
        except Exception as cleanup_err:
            print(f"[Pipeline] Failed to clean up tmp_dir {tmp_dir}: {cleanup_err}")
