"""
Worker 9: Course Publisher
Uploads all video assets to Supabase Storage, builds the final CourseManifest JSON,
saves it in the database, and links it to the processed module.
"""
from __future__ import annotations
import os
import uuid
import datetime
from typing import Any, Dict, List, Optional
from utils.supabase_client import supabase, supabase_admin
from utils.auth_bridge import get_service_supabase_client
from .w7_avatar_video_generator import _concat_videos_sync

BUCKET = "module-visuals"

async def ensure_bucket_exists():
    try:
        buckets = supabase_admin.storage.list_buckets()
        if buckets is None:
            return {"ok": False, "error": "List buckets failed: empty response"}
        exists = any(b.get("name") == BUCKET for b in buckets)
        if exists:
            return {"ok": True}
        supabase_admin.storage.create_bucket(BUCKET, options={"public": True, "file_size_limit": "200MB"})
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}

def _upload_file_sync(local_path: str, upload_path: str) -> str:
    """Uploads a file to Supabase Storage and returns its public URL."""
    with open(local_path, "rb") as f:
        file_data = f.read()
    
    supabase_admin.storage.from_(BUCKET).upload(
        path=upload_path,
        file=file_data,
        file_options={"content-type": "video/mp4", "upsert": "true"}
    )
    
    url = supabase_admin.storage.from_(BUCKET).get_public_url(upload_path)
    if isinstance(url, dict):
        url = url.get("publicURL") or url.get("publicUrl") or url.get("signedURL")
    return url

async def run(video_data: Dict[str, Any], tmp_dir: str) -> Dict[str, Any]:
    """
    W9: Course Publisher
    """
    print("[W9] Course Publisher starting...")
    await ensure_bucket_exists()

    processed_module_id = video_data["processed_module_id"]
    course_id = str(uuid.uuid4())
    enriched_segments: List[Dict] = video_data.get("enriched_segments", [])
    
    final_segments = []
    
    # 1. Upload segment videos and construct final segments outline
    for i, seg in enumerate(enriched_segments):
        seg_id = seg.get("id")
        seg_type = seg.get("type", "lecture")
        
        final_seg = {
            "id": seg_id,
            "title": seg.get("title", ""),
            "type": seg_type,
            "order": seg.get("order", i + 1),
            "duration": seg.get("duration", 0.0),
            "avatar_cue": seg.get("avatar_cue", "idle")
        }
        
        if seg_type == "lecture":
            video_en_path = seg.get("video_en_path")
            video_hi_path = seg.get("video_hi_path")
            
            url_en = None
            url_hi = None
            
            if video_en_path and os.path.exists(video_en_path):
                upload_path_en = f"{processed_module_id}/interactive/{course_id}_{seg_id}_en.mp4"
                print(f"[W9] Uploading EN video for segment {seg_id}...")
                url_en = _upload_file_sync(video_en_path, upload_path_en)
                
            if video_hi_path and os.path.exists(video_hi_path):
                upload_path_hi = f"{processed_module_id}/interactive/{course_id}_{seg_id}_hi.mp4"
                print(f"[W9] Uploading Hinglish video for segment {seg_id}...")
                url_hi = _upload_file_sync(video_hi_path, upload_path_hi)
                
            final_seg.update({
                "video_url_en": url_en,
                "video_url_hi": url_hi,
                "subtitles_en": seg.get("subtitles_en", []),
                "subtitles_hi": seg.get("subtitles_hi", []),
                "slide_bullets": seg.get("slide_bullets", []),
                "visual_prompt": seg.get("visual_prompt", "")
            })
            
        elif seg_type == "quiz_gate":
            final_seg.update({
                "quiz": {
                    "questions": seg.get("quiz_questions", []),
                    "pass_threshold": seg.get("pass_threshold", 0.8),
                    "max_attempts": seg.get("max_attempts", 2),
                    "on_fail": "replay_segment",
                    "replay_segment_id": seg.get("replay_segment_id")
                }
            })
            
        elif seg_type == "simulation":
            # Simulation steps
            sim_steps = []
            for idx, step in enumerate(seg.get("simulation_steps", [])):
                # If we have pre-rendered step screenshots, upload them
                screenshot_url = ""
                sim_slide_pngs = seg.get("sim_slide_pngs", [])
                if sim_slide_pngs and idx < len(sim_slide_pngs):
                    local_png = sim_slide_pngs[idx]
                    upload_png_path = f"{processed_module_id}/interactive/{course_id}_{seg_id}_step_{idx}.png"
                    # Simple helper to upload PNG
                    with open(local_png, "rb") as png_f:
                        png_data = png_f.read()
                    supabase_admin.storage.from_(BUCKET).upload(
                        path=upload_png_path,
                        file=png_data,
                        file_options={"content-type": "image/png", "upsert": "true"}
                    )
                    screenshot_url = supabase_admin.storage.from_(BUCKET).get_public_url(upload_png_path)
                    if isinstance(screenshot_url, dict):
                        screenshot_url = screenshot_url.get("publicURL") or screenshot_url.get("publicUrl")
                
                # Mock a hotspot in the middle/button area of the simulation frame if not specified
                hotspot = step.get("hotspot") or {"x": 1084, "y": 320, "w": 160, "h": 48} # Coordinates corresponding to "Click Here" hotspot in W5
                sim_steps.append({
                    "screenshot_url": screenshot_url,
                    "instruction": step.get("instruction", ""),
                    "hotspot": hotspot,
                    "highlight_text": step.get("highlight_text", "")
                })
            
            final_seg.update({
                "simulation": {
                    "title": seg.get("simulation_title", "Try It Yourself"),
                    "steps": sim_steps
                }
            })
            
        final_segments.append(final_seg)

    # 2. Build final manifest
    total_duration = sum(seg.get("duration", 0.0) for seg in final_segments)
    quiz_gates_count = sum(1 for seg in final_segments if seg["type"] == "quiz_gate")
    
    manifest = {
        "course_id": course_id,
        "processed_module_id": processed_module_id,
        "title": video_data.get("course_title", "Interactive Course"),
        "description": video_data.get("clean_text", "")[:300] + "...",
        "segments": final_segments,
        "total_segments": len(final_segments),
        "quiz_gates": quiz_gates_count,
        "estimated_duration_minutes": round(total_duration / 60, 1),
        "created_at": datetime.datetime.utcnow().isoformat()
    }

    # 3. Concatenate and publish a flat backup video of lectures if requested/needed
    # We can also generate a single unified backup video using W7's concat if necessary
    # For now, let's keep it segment-based for interactivity, but update video_url to the first segment
    first_lecture = next((s for s in final_segments if s["type"] == "lecture"), None)
    backup_video_url_en = first_lecture["video_url_en"] if first_lecture else ""
    backup_video_url_hi = first_lecture["video_url_hi"] if first_lecture else ""

    # 4. Save manifest in interactive_video_courses table
    # Upsert course manifest
    course_resp = supabase.table("interactive_video_courses").upsert({
        "processed_module_id": processed_module_id,
        "manifest": manifest,
        "updated_at": datetime.datetime.utcnow().isoformat()
    }, on_conflict="processed_module_id").execute()

    course_data = course_resp.data[0] if course_resp.data else {}
    interactive_video_id = course_data.get("id")

    # 5. Link in processed_modules table
    update_data = {
        "interactive_video_id": interactive_video_id,
        "video_generated_at": datetime.datetime.utcnow().isoformat()
    }
    if backup_video_url_en:
        update_data["video_url"] = backup_video_url_en
    if backup_video_url_hi:
        update_data["video_url_hinglish"] = backup_video_url_hi

    supabase.table("processed_modules").update(update_data).eq("processed_module_id", processed_module_id).execute()

    print(f"[W9] Course manifest published successfully. Course ID: {course_id}, Interactive Video DB ID: {interactive_video_id}")
    
    return {
        "course_id": course_id,
        "interactive_video_id": interactive_video_id,
        "manifest": manifest
    }
