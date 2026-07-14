import asyncio
import os
import sys

# Ensure Backend is in search path
sys.path.append(os.path.abspath(os.path.dirname(__file__)))

from utils.supabase_client import supabase
from interactive_video.pipeline import run_pipeline

async def main():
    print("Fetching an existing processed module to run test...")
    # Get the latest processed module
    res = supabase.table("processed_modules").select("processed_module_id, title, content").order("created_at", desc=True).limit(5).execute()
    if not res.data:
        print("No processed modules found. Please create a module first or ingest content.")
        return
        
    print("Found processed modules:")
    for idx, row in enumerate(res.data):
        print(f"[{idx}] ID: {row['processed_module_id']} | Title: {row['title']}")
        
    # We will pick the first module to test
    target_module = res.data[0]
    pm_id = target_module["processed_module_id"]
    title = target_module["title"]
    print(f"\nUsing module: {title} ({pm_id})")
    
    # Create a mock job entry
    print("Creating a test job...")
    job_res = supabase.table("interactive_video_jobs").insert({
        "processed_module_id": pm_id,
        "status": "pending",
        "current_worker": 1
    }).execute()
    
    if not job_res.data:
        print("Failed to create job entry.")
        return
        
    job_id = job_res.data[0]["id"]
    print(f"Created job: {job_id}")
    
    # Trigger the pipeline synchronously for testing
    print("Running pipeline...")
    await run_pipeline(job_id, pm_id)
    
    # Fetch final course record
    course_res = supabase.table("interactive_video_courses").select("*").eq("processed_module_id", pm_id).maybe_single().execute()
    if course_res.data:
        print("\nSUCCESS! Interactive Video Course Manifest created:")
        manifest = course_res.data["manifest"]
        print(f"Course ID: {manifest['course_id']}")
        print(f"Total segments: {manifest['total_segments']}")
        for seg in manifest['segments']:
            print(f"- Segment [{seg['type']}]: {seg['title']}")
            if seg['type'] == 'lecture':
                print(f"  EN Video: {seg.get('video_url_en')}")
                print(f"  HI Video: {seg.get('video_url_hi')}")
    else:
        print("\nPipeline finished but no course record found.")

if __name__ == "__main__":
    asyncio.run(main())
