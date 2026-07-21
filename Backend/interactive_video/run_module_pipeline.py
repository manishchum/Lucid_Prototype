from __future__ import annotations
import argparse
import asyncio
import os
import sys
from pathlib import Path
from typing import Any, Dict

ROOT = Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT))

from utils.supabase_client import supabase
from interactive_video.pipeline import run_pipeline


def fetch_processed_module(module_id: str) -> Dict[str, Any]:
    res = supabase.table("processed_modules").select("processed_module_id,title").eq("processed_module_id", module_id).maybe_single().execute()
    if not res.data:
        raise RuntimeError(f"Processed module {module_id} not found")
    return res.data


def create_job(module_id: str) -> str:
    resp = supabase.table("interactive_video_jobs").insert({
        "processed_module_id": module_id,
        "status": "pending",
        "current_worker": 1,
    }).execute()
    if not resp.data:
        raise RuntimeError("Failed to create interactive video job")
    return resp.data[0]["id"]


def get_course_manifest(module_id: str) -> Dict[str, Any] | None:
    resp = supabase.table("interactive_video_courses").select("*").eq("processed_module_id", module_id).maybe_single().execute()
    if resp is None:
        print("[run_module_pipeline] Supabase returned None for course manifest query")
        return None
    return resp.data if getattr(resp, 'data', None) else None


def get_processed_module_record(module_id: str) -> Dict[str, Any] | None:
    resp = supabase.table("processed_modules").select("processed_module_id,title,video_url,video_url_hinglish,interactive_video_id").eq("processed_module_id", module_id).maybe_single().execute()
    return resp.data if resp.data else None


async def main(module_id: str) -> None:
    print(f"Preparing interactive video pipeline for module: {module_id}")
    module = fetch_processed_module(module_id)
    print(f"Found module: {module.get('title')} ({module_id})")

    job_id = create_job(module_id)
    print(f"Created job: {job_id}")

    success = await run_pipeline(job_id, module_id)

    if not success:
        print("Pipeline failed. No new manifest will be shown.")
        return

    manifest = get_course_manifest(module_id)
    processed_module = get_processed_module_record(module_id)

    if not manifest:
        print("Pipeline completed, but no course manifest found. Check interactive_video_courses table.")
        return

    print("Pipeline completed successfully.")
    print(f"Course ID: {manifest['manifest']['course_id']}")
    print(f"Total segments: {manifest['manifest']['total_segments']}")
    if manifest['manifest'].get('segments'):
        for seg in manifest['manifest']['segments']:
            if seg['type'] == 'lecture':
                print(f"- Lecture: {seg['title']} → {seg.get('video_url_en')}")
            elif seg['type'] == 'simulation':
                print(f"- Simulation: {seg['title']}")
            elif seg['type'] == 'quiz_gate':
                print(f"- Quiz gate: {seg['title']}")

    print("Final manifest stored in interactive_video_courses.")
    if processed_module:
        print("Processed module record:")
        print(f"- processed_module_id: {processed_module.get('processed_module_id')}")
        print(f"- interactive_video_id: {processed_module.get('interactive_video_id')}")
        print(f"- video_url: {processed_module.get('video_url')}")
        print(f"- video_url_hinglish: {processed_module.get('video_url_hinglish')}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run the interactive video pipeline for a specific processed_module_id")
    parser.add_argument("module_id", help="Processed module ID")
    args = parser.parse_args()
    asyncio.run(main(args.module_id))
