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

# from supabase import create_client, Client
from utils.supabase_client import supabase

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
# supabase: Client = create_client(
#     os.environ["NEXT_PUBLIC_SUPABASE_URL"],
#     os.environ["SUPABASE_SERVICE_ROLE_KEY"]
# )

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
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent",
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
2. spoken_script (in English)
3. hinglish_script (in conversational Hinglish - a mix of Hindi and English written in Latin script)
4. slide_bullets (2-3 bullets)
5. visual_prompt (no text, no human faces)

CRITICAL: Return JSON ONLY.
[
  {{
    "title": "...",
    "spoken_script": "...",
    "hinglish_script": "...",
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
                f"https://generativelanguage.googleapis.com/v1/models/gemini-3-pro-preview:generateContent?key={key}",
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
async def generateTTSAudio(script: str, outFile: str, language_code: str = "en-IN", voice_name: str = "en-IN-Chirp3-HD-Callirrhoe") -> float:
    ttsClient = texttospeech.TextToSpeechClient()

    response = ttsClient.synthesize_speech(
        input=texttospeech.SynthesisInput(text=script),
        voice=texttospeech.VoiceSelectionParams(
            language_code=language_code,
            name=voice_name
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
    fallbacks: Dict[str, str],
    duration: float
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
        "[3:a]apad[a1]"
    ]

    cmd = [
        FFMPEG_PATH,
        "-y",
        "-loop", "1",
        "-i", bgInput,
        "-loop", "1",
        "-i", overlay,
        "-loop", "1",
        "-i", avInput,
        "-i", audio,
        "-filter_complex", ";".join(filter_complex),
        "-map", "[outv]",
        "-map", "[a1]",
        "-c:v", "libx264",
        "-c:a", "aac",
        "-pix_fmt", "yuv420p",
        "-t", str(duration),
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
async def generateVideo(processedModuleId: str) -> dict:
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

    sceneVideos_en: List[str] = []
    sceneVideos_hi: List[str] = []
    timeline = 0

    for i in range(len(scenes)):
        scene = scenes[i]
        bg = os.path.join(tmpDir, f"bg-{i}.png")
        audio_en = os.path.join(tmpDir, f"audio-en-{i}.mp3")
        audio_hi = os.path.join(tmpDir, f"audio-hi-{i}.mp3")
        slide = await renderSlide(scene, i, tmpDir)

        print(f"[VIDEO] Generating visual and audio for scene {i + 1}/{len(scenes)}")
        await generateImagenImage(scene["visual_prompt"], bg)
        
        # English audio
        print(f"[VIDEO] Scene {i + 1} - English Script: {scene.get('spoken_script', '')}")
        duration_en = await generateTTSAudio(scene["spoken_script"], audio_en, "en-IN", "en-IN-Chirp3-HD-Callirrhoe")

        # Hinglish audio
        hinglish_script = scene.get("hinglish_script", scene["spoken_script"])
        print(f"[VIDEO] Scene {i + 1} - Hinglish Script: {hinglish_script}")
        duration_hi = await generateTTSAudio(hinglish_script, audio_hi, "hi-IN", "hi-IN-Neural2-B")

        max_duration = max(duration_en, duration_hi)
        
        out_en = os.path.join(tmpDir, f"scene-en-{i}.mp4")
        out_hi = os.path.join(tmpDir, f"scene-hi-{i}.mp4")
        
        await composeScene(bg, slide, avatar, audio_en, out_en, fallbacks, max_duration)
        await composeScene(bg, slide, avatar, audio_hi, out_hi, fallbacks, max_duration)
        
        sceneVideos_en.append(out_en)
        sceneVideos_hi.append(out_hi)
        timeline += max_duration

    listFile_en = os.path.join(tmpDir, "scenes_en.txt")
    with open(listFile_en, "w", encoding="utf-8") as f:
        f.write("\n".join([f"file '{v.replace(chr(92), '/')}'" for v in sceneVideos_en]))

    listFile_hi = os.path.join(tmpDir, "scenes_hi.txt")
    with open(listFile_hi, "w", encoding="utf-8") as f:
        f.write("\n".join([f"file '{v.replace(chr(92), '/')}'" for v in sceneVideos_hi]))

    finalVideo_en = os.path.join(tmpDir, "final_en.mp4")
    finalVideo_hi = os.path.join(tmpDir, "final_hi.mp4")

    if not FFMPEG_PATH:
        raise Exception("ffmpeg not found in PATH. Please install ffmpeg.")
    
    # ffmpeg concat EN
    cmd_concat_en = [
        FFMPEG_PATH, "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", listFile_en,
        "-c", "copy",
        finalVideo_en
    ]
    # ffmpeg concat HI
    cmd_concat_hi = [
        FFMPEG_PATH, "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", listFile_hi,
        "-c", "copy",
        finalVideo_hi
    ]
    
    def run_concat(cmd):
        return subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
    
    result_en = await run_in_threadpool(run_concat, cmd_concat_en)
    if result_en.returncode != 0:
        raise Exception(result_en.stderr.decode("utf-8", errors="ignore")[:2000])

    result_hi = await run_in_threadpool(run_concat, cmd_concat_hi)
    if result_hi.returncode != 0:
        raise Exception(result_hi.stderr.decode("utf-8", errors="ignore")[:2000])

    # Upload English Video
    with open(finalVideo_en, "rb") as f:
        buffer_en = f.read()

    # Upload to Supabase
    print("[VIDEO] Step 1: Ensuring bucket exists...")
    bucket_result = await ensureBucketExists()
    print(f"[VIDEO] Bucket check result: {bucket_result}")
    
    uploadPath_en = f"{actualId}/{str(uuid_lib.uuid4())}_notebooklm_video_en.mp4"
    uploadPath_hi = f"{actualId}/{str(uuid_lib.uuid4())}_notebooklm_video_hi.mp4"

    try:
        supabase.storage.from_(BUCKET).upload(
            path=uploadPath_en,
            file=buffer_en,
            file_options={"content-type": "video/mp4", "upsert": "true"}
        )
        
        with open(finalVideo_hi, "rb") as f:
            buffer_hi = f.read()

        supabase.storage.from_(BUCKET).upload(
            path=uploadPath_hi,
            file=buffer_hi,
            file_options={"content-type": "video/mp4", "upsert": "true"}
        )
    except Exception as e:
        print(f"[VIDEO] Upload exception caught: {type(e).__name__}: {e}")
    
    videoUrl_en = supabase.storage.from_(BUCKET).get_public_url(uploadPath_en)
    videoUrl_hi = supabase.storage.from_(BUCKET).get_public_url(uploadPath_hi)
    
    if isinstance(videoUrl_en, dict):
        videoUrl_en = videoUrl_en.get("publicURL") or videoUrl_en.get("publicUrl") or videoUrl_en.get("signedURL")
    if isinstance(videoUrl_hi, dict):
        videoUrl_hi = videoUrl_hi.get("publicURL") or videoUrl_hi.get("publicUrl") or videoUrl_hi.get("signedURL")
    
    if not videoUrl_en or not isinstance(videoUrl_en, str):
        raise Exception(f"Failed to get EN video URL.")

    # Save URL in DB
    print("[VIDEO] Saving video URLs to database:")
    print("EN:", videoUrl_en)
    print("HI:", videoUrl_hi)

    supabase.table("processed_modules").update({
        "video_url": videoUrl_en,
        "video_url_hinglish": videoUrl_hi,
        "video_generated_at": datetime.datetime.utcnow().isoformat()
    }).eq("processed_module_id", actualId).execute()

    # cleanup
    try:
        shutil.rmtree(tmpDir, ignore_errors=True)
    except Exception:
        pass

    return {
        "videoUrl": videoUrl_en,
        "videoUrlHinglish": videoUrl_hi
    }


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

        urls = await generateVideo(moduleId)

        return JSONResponse({
            "videoUrl": urls["videoUrl"],
            "videoUrlHinglish": urls["videoUrlHinglish"]
        })
    except Exception as e:
        print("[GPT-VIDEO] Video generation failed:", e)
        return JSONResponse({"error": str(e) or "Generation failed"}, status_code=500)
