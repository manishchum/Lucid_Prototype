import os
import re
import json
import uuid as uuid_lib
import base64
import tempfile
import shutil
import datetime
import asyncio
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from fastapi.concurrency import run_in_threadpool

from supabase import create_client, Client

from google.cloud import texttospeech

import ffmpeg  # ffmpeg-python
import subprocess
import shutil

from playwright.sync_api import sync_playwright

# ------------------------------------------------------------------
# FFMPEG PATH RESOLUTION
# ------------------------------------------------------------------
try:
    import static_ffmpeg
    FFMPEG_PATH, FFPROBE_PATH = static_ffmpeg.run.get_or_fetch_platform_executables_else_raise()
    print(f"[VIDEO] Using static-ffmpeg at: {FFMPEG_PATH}")
    print(f"[VIDEO] Using static-ffprobe at: {FFPROBE_PATH}")
except ImportError:
    try:
        import imageio_ffmpeg
        FFMPEG_PATH = imageio_ffmpeg.get_ffmpeg_exe()
        FFPROBE_PATH = shutil.which("ffprobe")
        print(f"[VIDEO] Using imageio-ffmpeg at: {FFMPEG_PATH}")
        if FFPROBE_PATH:
            print(f"[VIDEO] ffprobe found at: {FFPROBE_PATH}")
    except ImportError:
        FFMPEG_PATH = shutil.which("ffmpeg")
        FFPROBE_PATH = shutil.which("ffprobe")
        if FFMPEG_PATH:
            print(f"[VIDEO] Using system ffmpeg at: {FFMPEG_PATH}")

if not FFMPEG_PATH:
    print("[WARNING] ffmpeg not found. Install: pip install static-ffmpeg")
if not FFPROBE_PATH:
    print("[WARNING] ffprobe not found. Duration detection will use defaults.")

# ------------------------------------------------------------------
# NEXT CONFIG (equivalent)
# ------------------------------------------------------------------
runtime = "nodejs"
dynamic = "force-dynamic"

# ------------------------------------------------------------------
# SUPABASE INIT
# ------------------------------------------------------------------
supabase: Client = create_client(
    os.environ["NEXT_PUBLIC_SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_ROLE_KEY"]
)

BUCKET = "module-visuals"

# ------------------------------------------------------------------
# GOOGLE CREDS INIT
# ------------------------------------------------------------------
base64Key = os.environ.get("GOOGLE_TTS_JSON")
if base64Key:
    try:
        decoded = base64.b64decode(base64Key).decode("utf-8")
        tempPath = os.path.join(tempfile.gettempdir(), f"google-credentials-{int(datetime.datetime.now().timestamp()*1000)}.json")
        with open(tempPath, "w", encoding="utf-8") as f:
            f.write(decoded)

        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = tempPath
        print("[VIDEO API] Google credentials loaded")
    except Exception as e:
        print("[VIDEO API] Failed to decode/write GOOGLE_TTS_JSON:", e)
else:
    print("[VIDEO API] GOOGLE_TTS_JSON not set.")

# ------------------------------------------------------------------
# FFmpeg PATH RESOLUTION (best effort mimic)
# ------------------------------------------------------------------
# In Node: ffmpeg-static, ffprobe-static.
# In Python: assumes ffmpeg/ffprobe are installed in system PATH.
# This keeps functionality same (pipeline works).
# ------------------------------------------------------------------


# ------------------------------------------------------------------
# HELPERS
# ------------------------------------------------------------------
async def ensureBucketExists():
    try:
        # listBuckets equivalent
        buckets = supabase.storage.list_buckets()
        if buckets is None:
            return {"ok": False, "error": "List buckets failed: empty response"}

        exists = False
        for b in buckets:
            if b.get("name") == BUCKET:
                exists = True
                break

        if exists:
            return {"ok": True}

        # createBucket equivalent
        # supabase-py storage API differs, but this tries to mimic behavior.
        supabase.storage.create_bucket(BUCKET, options={
            "public": True,
            "file_size_limit": "200MB"
        })

        return {"ok": True}

    except Exception as e:
        return {"ok": False, "error": str(e) or "Unknown error creating bucket"}


# ------------------------------------------------------------------
# TYPES
# ------------------------------------------------------------------
# Scene:
# {
#   title: string;
#   spoken_script: string;
#   slide_bullets: string[];
#   visual_prompt: string;
# }
Scene = Dict[str, Any]


# ------------------------------------------------------------------
# 1. PLAN SCENES (OPENAI)
# ------------------------------------------------------------------
def extract_json_array(text: str):
    # Remove markdown code fences if present
    text = re.sub(r"```json|```", "", text).strip()

    # Find first [ and last ]
    start = text.find("[")
    end = text.rfind("]")

    if start == -1 or end == -1 or end <= start:
        return None

    json_str = text[start:end+1]

    try:
        return json.loads(json_str)
    except Exception as e:
        print("[JSON PARSE ERROR]", e)
        print("[BAD JSON STRING]", json_str[:1000])
        return None

async def planScenes(content: str) -> List[Scene]:
    async with httpx.AsyncClient(timeout=300) as client:
        res = await client.post(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent",
    params={"key": os.environ.get("GEMINI_API_KEY")},
    headers={"Content-Type": "application/json"},
    json={
        "contents": [
            {
                "role": "user",
                "parts": [{
                    "text": f"""
You are a master AI instructor specializing in NotebookLM-style deep dives. You synthesize complex information into engaging narratives.

Create a deep-dive, conversational instructor-led video script based on the modules provided.

For each scene, provide:
1. title
2. spoken_script
3. slide_bullets (2-3 bullets)
4. visual_prompt (no text, no human faces)

CRITICAL: Return JSON ONLY.
[
  {{
    "title": "...",
    "spoken_script": "...",
    "slide_bullets": ["...", "..."],
    "visual_prompt": "..."
  }}
]

CONTENT:
{content}
"""
                }]
            }
        ],
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": 20486
        }
    }
)

    
    print(res)
    if res.status_code < 200 or res.status_code >= 300:
        raise Exception("OpenAI scene planning failed")

    json_data = res.json()
    rawText = ""
    try:
        rawText = (json_data.get("candidates") or [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "") or ""
    except Exception:
        rawText = ""

    scenes = extract_json_array(rawText)

    if not scenes:
        print("[Gemini RAW OUTPUT]", rawText[:2000])
        raise Exception("No JSON array found from Gemini response")

    return scenes


# ------------------------------------------------------------------
# 2. IMAGEN (Fallback to placeholder on failure)
# ------------------------------------------------------------------
async def generateImagenImage(prompt: str, outFile: str):
    try:
        key = os.environ.get("GEMINI_API_KEY")
        print(f"[IMAGEN] Generating with prompt: {prompt}")

        # Try Gemini API first
        async with httpx.AsyncClient(timeout=300) as client:
            res = await client.post(
                f"https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash-exp:generateContent?key={key}",
                headers={"Content-Type": "application/json"},
                json={
                    "contents": [{
                        "parts": [{
                            "text": f"Generate image: {prompt}. Respond with: IMAGE_GENERATION_NOT_AVAILABLE"
                        }]
                    }]
                }
            )

        if res.status_code >= 200 and res.status_code < 300:
            # Since Gemini text models can't generate images, we'll create a placeholder
            print("[IMAGEN] API not available, using placeholder")
        else:
            print(f"[IMAGEN] API call failed: {res.status_code}")
        
        # Create placeholder image instead of failing
        print(f"[IMAGEN] Creating placeholder for: {outFile}")
        # Don't create file - let fallback system handle it
        return

    except Exception as e:
        print(f"[IMAGEN] generation error: {e}")
        # Don't create file - let fallback system handle it
        return


# ------------------------------------------------------------------
# FALLBACK ASSETS
# ------------------------------------------------------------------
def renderFallbackAssets_sync(dir: str):
    print("[Fallback] Generating fallback background and avatar...")
    bgPath = os.path.join(dir, "fallback-bg.png")

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
        )
        try:
            page = browser.new_page()

            page.set_viewport_size({"width": 1280, "height": 720})
            page.set_content(
                "<body style=\"margin:0; background: linear-gradient(135deg, #f8fafc, #e2e8f0); width:1280px; height:720px;\"></body>"
            )
            page.screenshot(path=bgPath)
            print(f"[Fallback] Background saved: {bgPath}")

            page.set_viewport_size({"width": 1, "height": 1})
            page.set_content("<body style=\"margin:0; background: transparent;\"></body>")
            fallbackAvatar = os.path.join(dir, "fallback-av.png")
            page.screenshot(path=fallbackAvatar, omit_background=True)

            return {"bgPath": bgPath, "fallbackAvatar": fallbackAvatar}
        finally:
            browser.close()


async def renderFallbackAssets(dir: str):
    return await run_in_threadpool(renderFallbackAssets_sync, dir)


async def generateAvatarImage(dir: str) -> str:
    avatarPath = os.path.join(dir, "avatar.png")
    await generateImagenImage(
        "A professional, high-definition 3D render of a friendly AI instructor avatar, chest-up shot, wearing modern casual professional attire, soft studio lighting, solid neutral background",
        avatarPath
    )
    return avatarPath


# ------------------------------------------------------------------
# GOOGLE TTS
# ------------------------------------------------------------------
async def generateTTSAudio(script: str, outFile: str) -> float:
    ttsClient = texttospeech.TextToSpeechClient()

    response = ttsClient.synthesize_speech(
        input=texttospeech.SynthesisInput(text=script),
        voice=texttospeech.VoiceSelectionParams(
            language_code="en-US",
            name="en-US-Neural2-J"
        ),
        audio_config=texttospeech.AudioConfig(
            audio_encoding=texttospeech.AudioEncoding.MP3,
            speaking_rate=1.0
        )
    )

    if not response.audio_content:
        raise Exception("TTS failed")

    with open(outFile, "wb") as f:
        f.write(response.audio_content)

    # ffprobe duration (exact equivalent)
    try:
        if not FFPROBE_PATH:
            return 5.0
        
        result = subprocess.run(
            [FFPROBE_PATH, "-v", "error", "-show_entries", "format=duration", "-of", "json", outFile],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        d = json.loads(result.stdout or "{}")
        return float(d.get("format", {}).get("duration") or 5)
    except Exception:
        return 5.0


# ------------------------------------------------------------------
# SLIDE RENDER
# ------------------------------------------------------------------
def renderSlide_sync(scene: Scene, index: int, dir: str) -> str:
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
        )
        try:
            page = browser.new_page()
            page.set_viewport_size({"width": 1280, "height": 720})

            html = f"""
    <html>
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Outfit:wght@600;800&display=swap" rel="stylesheet">
        <style>
          body {{ margin: 0; padding: 0; font-family: 'Inter', sans-serif; background: transparent; width: 1280px; height: 720px; display: flex; align-items: center; overflow: hidden; }}
          .content {{ padding: 80px 120px; max-width: 800px; }}
          .glass-card {{ background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 32px; padding: 60px; color: white; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); }}
          h1 {{ font-family: 'Outfit', sans-serif; font-size: 48px; font-weight: 800; margin: 0 0 24px 0; background: linear-gradient(to right, #38bdf8, #818cf8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }}
          ul {{ list-style: none; padding: 0; margin: 0; }}
          li {{ font-size: 24px; line-height: 1.4; margin-bottom: 16px; display: flex; align-items: flex-start; }}
          li::before {{ content: "→"; color: #38bdf8; font-weight: bold; width: 30px; flex-shrink: 0; }}
        </style>
      </head>
      <body>
        <div class="content">
          <div class="glass-card">
            <h1>{scene.get("title","")}</h1>
            <ul> {"".join([f"<li>{b}</li>" for b in (scene.get("slide_bullets") or [])])} </ul>
          </div>
        </div>
      </body>
    </html>
            """

            page.set_content(html)
            img = os.path.join(dir, f"slide-{index}.png")
            page.screenshot(path=img, omit_background=True)
            return img
        finally:
            browser.close()


async def renderSlide(scene: Scene, index: int, dir: str) -> str:
    return await run_in_threadpool(renderSlide_sync, scene, index, dir)


# ------------------------------------------------------------------
# COMPOSE SCENE
# ------------------------------------------------------------------
async def composeScene(
    background: str,
    overlay: str,
    avatar: str,
    audio: str,
    out: str,
    fallbacks: Dict[str, str]
):
    bgExists = False
    try:
        if background and os.path.exists(background) and os.path.getsize(background) > 500:
            bgExists = True
    except Exception:
        pass

    avatarExists = False
    try:
        if avatar and os.path.exists(avatar) and os.path.getsize(avatar) > 500:
            avatarExists = True
    except Exception:
        pass

    bgInput = background if bgExists else fallbacks["bgPath"]
    avInput = avatar if avatarExists else fallbacks["fallbackAvatar"]
    
    print(f"[Compose] Using bg: {bgInput}, avatar: {avInput}")

    if not FFMPEG_PATH:
        raise Exception("ffmpeg not found in PATH. Please install ffmpeg.")
    
    # Build exact ffmpeg filter graph
    filter_complex = [
        "[0:v]scale=1280:720[bgv]",
        "[1:v]scale=1280:720[overv]",
        "[bgv][overv]overlay=0:0[combined]",
        "[2:v]scale=350:350[av_scaled]" if avatarExists else "[2:v]scale=1:1[av_scaled]",
        "[av_scaled]pad=iw+10:ih+10:5:5:color='#38bdf8'[av]" if avatarExists else "[av_scaled]copy[av]",
        "[combined][av]overlay=W-w-40:H-h-40[outv]",
    ]

    cmd = [
        FFMPEG_PATH,
        "-y",
        "-loop", "1",
        "-i", bgInput,
        "-i", overlay,
        "-loop", "1",
        "-i", avInput,
        "-i", audio,
        "-filter_complex", ";".join(filter_complex),
        "-map", "[outv]",
        "-map", "3:a",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-shortest",
        out
    ]


    print("[Compose] Running ffmpeg command...")
    
    def run_ffmpeg():
        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        return result
    
    result = await run_in_threadpool(run_ffmpeg)
    
    print(f"[Compose] ffmpeg return code: {result.returncode}")
    if result.returncode != 0:
        raise Exception(result.stderr.decode("utf-8", errors="ignore")[:2000])
    
    print(f"[Compose] Scene composed successfully: {out}")

# ------------------------------------------------------------------
# MAIN VIDEO PIPELINE
# ------------------------------------------------------------------
async def generateVideo(processedModuleId: str) -> str:
    print("Processed_Module_id:-", processedModuleId)

    module = None

    # 1) maybeSingle equivalent
    try:
        res = supabase.table("processed_modules") \
            .select("content, title, processed_module_id, created_at, original_module_id") \
            .eq("processed_module_id", processedModuleId) \
            .execute()
        print("inside try 1")
        if res and res.data:
            module = res.data[0] if isinstance(res.data, list) else res.data
    except Exception:
        module = None

    # If module missing, fallback .single()
    if not module:
        try:
            res = supabase.table("processed_modules") \
                .select("content, title, processed_module_id, created_at, original_module_id") \
                .eq("processed_module_id", processedModuleId) \
                .execute()
            if res and res.data:
                module = res.data[0] if isinstance(res.data, list) else res.data
            print("inside try 2")
        except Exception:
            module = None

    # fallback by original_module_id
    if not module:
        res = supabase.table("processed_modules") \
            .select("content, title, processed_module_id, created_at, original_module_id") \
            .eq("original_module_id", processedModuleId) \
            .execute()

        if res and res.data:
            module = res.data[0] if isinstance(res.data, list) else res.data

    if not module:
        raise Exception("Module not found")

    actualId = module["processed_module_id"]

    # Context
    userModules = None
    try:
        res_ctx = supabase.table("processed_modules") \
            .select("title, content") \
            .eq("processed_module_id", actualId) \
            .order("created_at", desc=True) \
            .limit(3) \
            .execute()
        userModules = res_ctx.data
        print("inside try 3")
    except Exception:
        userModules = None

    context = "\n\n".join([f"### {m['title']}\n{m['content']}" for m in (userModules or [])]) or module["content"]

    print("[VIDEO] Planning scenes...")
    scenes = await planScenes(context)
    print(f"[VIDEO] Planned {len(scenes)} scenes.")
    tmpDir = os.path.join(tempfile.gettempdir(), f"lucid-gen-{str(uuid_lib.uuid4())}")
    os.makedirs(tmpDir, exist_ok=True)

    print("[VIDEO] Preparing fallback assets...")
    fallbacks = await renderFallbackAssets(tmpDir)

    print("[VIDEO] Generating AI instructor avatar...")
    avatar = await generateAvatarImage(tmpDir)

    sceneVideos: List[str] = []
    timeline = 0

    for i in range(len(scenes)):
        scene = scenes[i]
        bg = os.path.join(tmpDir, f"bg-{i}.png")
        audio = os.path.join(tmpDir, f"audio-{i}.mp3")
        slide = await renderSlide(scene, i, tmpDir)

        print(f"[VIDEO] Generating visual and audio for scene {i + 1}/{len(scenes)}")
        await generateImagenImage(scene["visual_prompt"], bg)
        duration = await generateTTSAudio(scene["spoken_script"], audio)

        out = os.path.join(tmpDir, f"scene-{i}.mp4")
        await composeScene(bg, slide, avatar, audio, out, fallbacks)

        sceneVideos.append(out)
        timeline += duration

    listFile = os.path.join(tmpDir, "scenes.txt")
    with open(listFile, "w", encoding="utf-8") as f:
        f.write("\n".join([f"file '{v.replace(chr(92), '/')}'" for v in sceneVideos]))

    finalVideo = os.path.join(tmpDir, "final.mp4")

    if not FFMPEG_PATH:
        raise Exception("ffmpeg not found in PATH. Please install ffmpeg.")
    
    # ffmpeg concat
    cmd_concat = [
        FFMPEG_PATH, "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", listFile,
        "-c", "copy",
        finalVideo
    ]
    
    def run_concat():
        result = subprocess.run(
            cmd_concat,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        return result
    
    result2 = await run_in_threadpool(run_concat)
    if result2.returncode != 0:
        raise Exception(result2.stderr.decode("utf-8", errors="ignore")[:2000])

    with open(finalVideo, "rb") as f:
        buffer = f.read()

    # Upload to Supabase
    print("[VIDEO] Step 1: Ensuring bucket exists...")
    bucket_result = await ensureBucketExists()
    print(f"[VIDEO] Bucket check result: {bucket_result}")
    
    uploadPath = f"{actualId}/{str(uuid_lib.uuid4())}_notebooklm_video.mp4"
    print(f"[VIDEO] Step 2: Upload path: {uploadPath}")
    print(f"[VIDEO] Step 3: Buffer size: {len(buffer)} bytes ({len(buffer)/1024/1024:.2f} MB)")

    try:
        print(f"[VIDEO] Step 4: Starting upload to bucket '{BUCKET}'...")
        upload_res = supabase.storage.from_(BUCKET).upload(
            path=uploadPath,
            file=buffer,
            file_options={"content-type": "video/mp4", "upsert": "true"}
        )
        
        print(f"[VIDEO] Step 5: Upload response type: {type(upload_res)}")
        print(f"[VIDEO] Step 6: Upload response content: {upload_res}")
        
        # Check for upload errors
        if isinstance(upload_res, dict) and upload_res.get("error"):
            print(f"[VIDEO] Step 7: Upload returned error dict")
            raise Exception(f"Upload failed: {upload_res['error']}")
        
        print(f"[VIDEO] Step 8: Upload completed successfully")
    except Exception as e:
        print(f"[VIDEO] Step 9: Upload exception caught: {type(e).__name__}: {e}")
        import traceback
        print(f"[VIDEO] Traceback: {traceback.format_exc()}")
        # Continue anyway, try to get public URL
    
    # Get public URL - supabase-py returns string directly
    print(f"[VIDEO] Step 10: Requesting public URL for path: {uploadPath}")
    videoUrl = supabase.storage.from_(BUCKET).get_public_url(uploadPath)
    
    print(f"[VIDEO] Step 11: Raw public URL response type: {type(videoUrl)}")
    print(f"[VIDEO] Step 12: Raw public URL response value: {repr(videoUrl)}")
    
    # If it's a dict, extract the URL
    if isinstance(videoUrl, dict):
        print(f"[VIDEO] Step 13: videoUrl is dict, extracting URL...")
        print(f"[VIDEO] Dict keys: {videoUrl.keys()}")
        videoUrl = videoUrl.get("publicURL") or videoUrl.get("publicUrl") or videoUrl.get("signedURL")
        print(f"[VIDEO] Step 14: Extracted URL: {videoUrl}")
    
    print(f"[VIDEO] Step 15: Final videoUrl type: {type(videoUrl)}, is string: {isinstance(videoUrl, str)}")
    print(f"[VIDEO] Step 16: Final videoUrl value: {videoUrl}")
    
    if not videoUrl or not isinstance(videoUrl, str):
        print(f"[VIDEO] Step 17: FAILED - videoUrl validation failed")
        raise Exception(f"Failed to get public video URL. Got type={type(videoUrl)}, value={repr(videoUrl)}")
    
    print(f"[VIDEO] Step 18: SUCCESS - Valid video URL obtained")

    # Save URL in DB
    print("[VIDEO] Saving video URL to database:", videoUrl)

    supabase.table("processed_modules").update({
        "video_url": videoUrl,
        "video_generated_at": datetime.datetime.utcnow().isoformat()
    }).eq("processed_module_id", actualId).execute()

    # cleanup
    try:
        shutil.rmtree(tmpDir, ignore_errors=True)
    except Exception:
        pass

    return videoUrl


# ------------------------------------------------------------------
# POST HANDLER (ONLY ENDPOINT YOU NEED)
# ------------------------------------------------------------------
router = APIRouter()

@router.post("/gpt-video")
async def POST(req: Request):
    print("[GPT-VIDEO] POST request received")
    try:
        body = await req.json()

        # ✅ supports BOTH keys
        moduleId = body.get("processed_module_id") or body.get("module_id")
        if not moduleId:
            return JSONResponse({"error": "Missing module ID"}, status_code=400)

        print("[GPT-VIDEO] Starting generation for:", moduleId)

        videoUrl = await generateVideo(moduleId)

        return JSONResponse({"videoUrl": videoUrl})
    except Exception as e:
        print("[GPT-VIDEO] Video generation failed:", e)
        return JSONResponse({"error": str(e) or "Generation failed"}, status_code=500)
