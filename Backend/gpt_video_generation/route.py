# import os
# import re
# import json
# import uuid as uuid_lib
# import base64
# import tempfile
# import shutil
# import datetime
# import asyncio
# from typing import Any, Dict, List, Optional

# import httpx
# from fastapi import APIRouter, Request
# from fastapi.responses import JSONResponse
# from fastapi.concurrency import run_in_threadpool

# from supabase import create_client, Client

# from google.cloud import texttospeech

# import ffmpeg  # ffmpeg-python
# import subprocess

# from playwright.sync_api import sync_playwright

# # ------------------------------------------------------------------
# # NEXT CONFIG (equivalent)
# # ------------------------------------------------------------------
# runtime = "nodejs"
# dynamic = "force-dynamic"

# # ------------------------------------------------------------------
# # SUPABASE INIT
# # ------------------------------------------------------------------
# supabase: Client = create_client(
#     os.environ["NEXT_PUBLIC_SUPABASE_URL"],
#     os.environ["SUPABASE_SERVICE_ROLE_KEY"]
# )

# BUCKET = "module-visuals"

# # ------------------------------------------------------------------
# # GOOGLE CREDS INIT
# # ------------------------------------------------------------------
# base64Key = os.environ.get("GOOGLE_TTS_JSON")
# if base64Key:
#     try:
#         decoded = base64.b64decode(base64Key).decode("utf-8")
#         tempPath = os.path.join(tempfile.gettempdir(), f"google-credentials-{int(datetime.datetime.now().timestamp()*1000)}.json")
#         with open(tempPath, "w", encoding="utf-8") as f:
#             f.write(decoded)

#         os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = tempPath
#         print("[VIDEO API] Google credentials loaded")
#     except Exception as e:
#         print("[VIDEO API] Failed to decode/write GOOGLE_TTS_JSON:", e)
# else:
#     print("[VIDEO API] GOOGLE_TTS_JSON not set.")

# # ------------------------------------------------------------------
# # FFmpeg PATH RESOLUTION (best effort mimic)
# # ------------------------------------------------------------------
# # In Node: ffmpeg-static, ffprobe-static.
# # In Python: assumes ffmpeg/ffprobe are installed in system PATH.
# # This keeps functionality same (pipeline works).
# # ------------------------------------------------------------------


# # ------------------------------------------------------------------
# # HELPERS
# # ------------------------------------------------------------------
# async def ensureBucketExists():
#     try:
#         # listBuckets equivalent
#         buckets = supabase.storage.list_buckets()
#         if buckets is None:
#             return {"ok": False, "error": "List buckets failed: empty response"}

#         exists = False
#         for b in buckets:
#             if b.get("name") == BUCKET:
#                 exists = True
#                 break

#         if exists:
#             return {"ok": True}

#         # createBucket equivalent
#         # supabase-py storage API differs, but this tries to mimic behavior.
#         supabase.storage.create_bucket(BUCKET, options={
#             "public": True,
#             "file_size_limit": "200MB"
#         })

#         return {"ok": True}

#     except Exception as e:
#         return {"ok": False, "error": str(e) or "Unknown error creating bucket"}


# # ------------------------------------------------------------------
# # TYPES
# # ------------------------------------------------------------------
# # Scene:
# # {
# #   title: string;
# #   spoken_script: string;
# #   slide_bullets: string[];
# #   visual_prompt: string;
# # }
# Scene = Dict[str, Any]


# # ------------------------------------------------------------------
# # 1. PLAN SCENES (OPENAI)
# # ------------------------------------------------------------------
# async def planScenes(content: str) -> List[Scene]:
#     async with httpx.AsyncClient(timeout=300) as client:
#         res = await client.post(
#             "https://api.openai.com/v1/chat/completions",
#             headers={
#                 "Authorization": f"Bearer {os.environ.get('OPENAI_API_KEY')}",
#                 "Content-Type": "application/json",
#             },
#             json={
#                 "model": "gpt-4o",
#                 "temperature": 0.7,
#                 "messages": [
#                     {
#                         "role": "system",
#                         "content": "You are a master AI instructor specializing in NotebookLM-style deep dives. You synthesize complex information into engaging narratives.",
#                     },
#                     {
#                         "role": "user",
#                         "content": f"""
# Create a deep-dive, conversational instructor-led video script based on the modules provided.

# For each scene, provide:
# 1. title
# 2. spoken_script
# 3. slide_bullets (2-3 bullets)
# 4. visual_prompt (no text, no human faces)

# CRITICAL: Return JSON ONLY.
# [
#   {{
#     "title": "...",
#     "spoken_script": "...",
#     "slide_bullets": ["...", "..."],
#     "visual_prompt": "..."
#   }}
# ]

# CONTENT:
# {content}
#                         """,
#                     },
#                 ],
#             }
#         )

#     if res.status_code < 200 or res.status_code >= 300:
#         raise Exception("OpenAI scene planning failed")

#     json_data = res.json()
#     rawText = (json_data.get("choices") or [{}])[0].get("message", {}).get("content", "") or ""

#     jsonMatch = re.search(r"\[\s*\{[\s\S]*\}\s*\]", rawText)
#     if not jsonMatch:
#         raise Exception("No JSON array found from OpenAI response")

#     return json.loads(jsonMatch.group(0))


# # ------------------------------------------------------------------
# # 2. IMAGEN
# # ------------------------------------------------------------------
# async def generateImagenImage(prompt: str, outFile: str):
#     try:
#         key = os.environ.get("GEMINI_API_KEY")
#         print(f"[IMAGEN] Generating with prompt: {prompt}")

#         async with httpx.AsyncClient(timeout=300) as client:
#             res = await client.post(
#                 f"https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict?key={key}",
#                 headers={"Content-Type": "application/json"},
#                 json={
#                     "instances": [{"prompt": prompt}],
#                     "parameters": {"sampleCount": 1, "aspectRatio": "16:9"},
#                 }
#             )

#         if res.status_code < 200 or res.status_code >= 300:
#             err = res.text
#             print("[IMAGEN] failed:", res.status_code, err)
#             return

#         data = res.json()

#         base64_img = None
#         try:
#             base64_img = (
#                 (data.get("predictions") or [{}])[0].get("bytesBase64Encoded")
#                 or (data.get("images") or [{}])[0].get("base64")
#                 or (data.get("output") or [{}])[0].get("base64")
#             )
#             if not base64_img:
#                 pred0 = (data.get("predictions") or [None])[0]
#                 if isinstance(pred0, str):
#                     base64_img = pred0
#         except Exception:
#             base64_img = None

#         if not base64_img:
#             raise Exception("No valid image data found in Imagen response")

#         with open(outFile, "wb") as f:
#             f.write(base64.b64decode(base64_img))

#         print(f"[IMAGEN] Success: {outFile}")

#     except Exception as e:
#         print("[IMAGEN] generation error:", e)


# # ------------------------------------------------------------------
# # FALLBACK ASSETS
# # ------------------------------------------------------------------
# def renderFallbackAssets_sync(dir: str):
#     print("[Fallback] Generating fallback background and avatar...")
#     bgPath = os.path.join(dir, "fallback-bg.png")

#     with sync_playwright() as p:
#         browser = p.chromium.launch(
#             headless=True,
#             args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
#         )
#         try:
#             page = browser.new_page()

#             page.set_viewport_size({"width": 1280, "height": 720})
#             page.set_content(
#                 "<body style=\"margin:0; background: linear-gradient(135deg, #f8fafc, #e2e8f0); width:1280px; height:720px;\"></body>"
#             )
#             page.screenshot(path=bgPath)
#             print(f"[Fallback] Background saved: {bgPath}")

#             page.set_viewport_size({"width": 1, "height": 1})
#             page.set_content("<body style=\"margin:0; background: transparent;\"></body>")
#             fallbackAvatar = os.path.join(dir, "fallback-av.png")
#             page.screenshot(path=fallbackAvatar, omit_background=True)

#             return {"bgPath": bgPath, "fallbackAvatar": fallbackAvatar}
#         finally:
#             browser.close()


# async def renderFallbackAssets(dir: str):
#     return await run_in_threadpool(renderFallbackAssets_sync, dir)


# async def generateAvatarImage(dir: str) -> str:
#     avatarPath = os.path.join(dir, "avatar.png")
#     await generateImagenImage(
#         "A professional, high-definition 3D render of a friendly AI instructor avatar, chest-up shot, wearing modern casual professional attire, soft studio lighting, solid neutral background",
#         avatarPath
#     )
#     return avatarPath


# # ------------------------------------------------------------------
# # GOOGLE TTS
# # ------------------------------------------------------------------
# async def generateTTSAudio(script: str, outFile: str) -> float:
#     ttsClient = texttospeech.TextToSpeechClient()

#     response = ttsClient.synthesize_speech(
#         input=texttospeech.SynthesisInput(text=script),
#         voice=texttospeech.VoiceSelectionParams(
#             language_code="en-US",
#             name="en-US-Neural2-J"
#         ),
#         audio_config=texttospeech.AudioConfig(
#             audio_encoding=texttospeech.AudioEncoding.MP3,
#             speaking_rate=1.0
#         )
#     )

#     if not response.audio_content:
#         raise Exception("TTS failed")

#     with open(outFile, "wb") as f:
#         f.write(response.audio_content)

#     # ffprobe duration (exact equivalent)
#     try:
#         result = subprocess.run(
#             ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", outFile],
#             stdout=subprocess.PIPE,
#             stderr=subprocess.PIPE,
#             text=True
#         )
#         d = json.loads(result.stdout or "{}")
#         return float(d.get("format", {}).get("duration") or 5)
#     except Exception:
#         return 5.0


# # ------------------------------------------------------------------
# # SLIDE RENDER
# # ------------------------------------------------------------------
# def renderSlide_sync(scene: Scene, index: int, dir: str) -> str:
#     with sync_playwright() as p:
#         browser = p.chromium.launch(
#             headless=True,
#             args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
#         )
#         try:
#             page = browser.new_page()
#             page.set_viewport_size({"width": 1280, "height": 720})

#             html = f"""
#     <html>
#       <head>
#         <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Outfit:wght@600;800&display=swap" rel="stylesheet">
#         <style>
#           body {{ margin: 0; padding: 0; font-family: 'Inter', sans-serif; background: transparent; width: 1280px; height: 720px; display: flex; align-items: center; overflow: hidden; }}
#           .content {{ padding: 80px 120px; max-width: 800px; }}
#           .glass-card {{ background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 32px; padding: 60px; color: white; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); }}
#           h1 {{ font-family: 'Outfit', sans-serif; font-size: 48px; font-weight: 800; margin: 0 0 24px 0; background: linear-gradient(to right, #38bdf8, #818cf8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }}
#           ul {{ list-style: none; padding: 0; margin: 0; }}
#           li {{ font-size: 24px; line-height: 1.4; margin-bottom: 16px; display: flex; align-items: flex-start; }}
#           li::before {{ content: "→"; color: #38bdf8; font-weight: bold; width: 30px; flex-shrink: 0; }}
#         </style>
#       </head>
#       <body>
#         <div class="content">
#           <div class="glass-card">
#             <h1>{scene.get("title","")}</h1>
#             <ul> {"".join([f"<li>{b}</li>" for b in (scene.get("slide_bullets") or [])])} </ul>
#           </div>
#         </div>
#       </body>
#     </html>
#             """

#             page.set_content(html)
#             img = os.path.join(dir, f"slide-{index}.png")
#             page.screenshot(path=img, omit_background=True)
#             return img
#         finally:
#             browser.close()


# async def renderSlide(scene: Scene, index: int, dir: str) -> str:
#     return await run_in_threadpool(renderSlide_sync, scene, index, dir)


# # ------------------------------------------------------------------
# # COMPOSE SCENE
# # ------------------------------------------------------------------
# async def composeScene(
#     background: str,
#     overlay: str,
#     avatar: str,
#     audio: str,
#     out: str,
#     fallbacks: Dict[str, str]
# ):
#     print("[Compose] Scene args:", {"bg": background, "av": avatar})

#     bgExists = False
#     try:
#         if background:
#             if os.path.getsize(background) > 500:
#                 bgExists = True
#     except Exception:
        
#         pass

#     avatarExists = False
    
#     print("[Compose] Checking avatar existence...")
#     try:
#         if avatar:
#             print(f"[Compose] Avatar path: {avatar}, ")
#             # if os.path.getsize(avatar) > 500:
#             avatarExists = True
#     except Exception:
#         print("[Compose] Avatar check failed.")
#         pass

#     bgInput = background if bgExists else fallbacks["bgPath"]
#     avInput = avatar if avatarExists else fallbacks["fallbackAvatar"]
    
    
    
#     print(f"[Compose] Using bg: {bgInput}, avatar: {avInput}")

#     # Build exact ffmpeg filter graph
#     filter_complex = [
#         "[0:v]scale=1280:720[bgv]",
#         "[1:v]scale=1280:720[overv]",
#         "[bgv][overv]overlay=0:0[combined]",
#         "[2:v]scale=350:350[av_scaled]" if avatarExists else "[2:v]scale=1:1[av_scaled]",
#         "[av_scaled]pad=iw+10:ih+10:5:5:color='#38bdf8'[av]" if avatarExists else "[av_scaled]copy[av]",
#         "[combined][av]overlay=W-w-40:H-h-40[outv]",
#     ]

#     cmd = [
#         "ffmpeg",
#         "-y",
#         "-loop", "1",
#         "-i", bgInput,
#         "-i", overlay,
#         "-loop", "1",
#         "-i", avInput,
#         "-i", audio,
#         "-filter_complex", ";".join(filter_complex),
#         "-map", "[outv]",
#         "-map", "3:a",
#         "-c:v", "libx264",
#         "-pix_fmt", "yuv420p",
#         "-shortest",
#         out
#     ]


#     print("[Compose] Running ffmpeg command...")
#     print('430')
#     proc = await asyncio.create_subprocess_exec(
#         *cmd,
#         stdout=asyncio.subprocess.PIPE,
#         stderr=asyncio.subprocess.PIPE
#     )
#     _, stderr = await proc.communicate()


#     print('439')
#     print(f"[Compose] ffmpeg return code: {proc.returncode}")
#     if proc.returncode != 0:
#         raise Exception(stderr.decode("utf-8", errors="ignore")[:2000])


#     print('442')
#     print(f"[Compose] Scene composed successfully: {out}")

# # ------------------------------------------------------------------
# # MAIN VIDEO PIPELINE
# # ------------------------------------------------------------------
# async def generateVideo(processedModuleId: str) -> str:
#     print("Processed_Module_id:-", processedModuleId)

#     module = None

#     # 1) maybeSingle equivalent
#     try:
#         res = supabase.table("processed_modules") \
#             .select("content, title, processed_module_id, created_at, original_module_id") \
#             .eq("processed_module_id", processedModuleId) \
#             .execute()

#         if res and res.data:
#             module = res.data[0] if isinstance(res.data, list) else res.data
#     except Exception:
#         module = None

#     # If module missing, fallback .single()
#     if not module:
#         try:
#             res = supabase.table("processed_modules") \
#                 .select("content, title, processed_module_id, created_at, original_module_id") \
#                 .eq("processed_module_id", processedModuleId) \
#                 .execute()
#             if res and res.data:
#                 module = res.data[0] if isinstance(res.data, list) else res.data
#         except Exception:
#             module = None

#     # fallback by original_module_id
#     if not module:
#         res = supabase.table("processed_modules") \
#             .select("content, title, processed_module_id, created_at, original_module_id") \
#             .eq("original_module_id", processedModuleId) \
#             .execute()

#         if res and res.data:
#             module = res.data[0] if isinstance(res.data, list) else res.data

#     if not module:
#         raise Exception("Module not found")

#     actualId = module["processed_module_id"]

#     # Context
#     userModules = None
#     try:
#         res_ctx = supabase.table("processed_modules") \
#             .select("title, content") \
#             .eq("processed_module_id", actualId) \
#             .order("created_at", desc=True) \
#             .limit(3) \
#             .execute()
#         userModules = res_ctx.data
#     except Exception:
#         userModules = None

#     context = "\n\n".join([f"### {m['title']}\n{m['content']}" for m in (userModules or [])]) or module["content"]

#     scenes = await planScenes(context)

#     tmpDir = os.path.join(tempfile.gettempdir(), f"lucid-gen-{str(uuid_lib.uuid4())}")
#     os.makedirs(tmpDir, exist_ok=True)

#     print("[VIDEO] Preparing fallback assets...")
#     fallbacks = await renderFallbackAssets(tmpDir)

#     print("[VIDEO] Generating AI instructor avatar...")
#     avatar = await generateAvatarImage(tmpDir)

#     sceneVideos: List[str] = []
#     timeline = 0

#     for i in range(len(scenes)):
#         scene = scenes[i]
#         bg = os.path.join(tmpDir, f"bg-{i}.png")
#         audio = os.path.join(tmpDir, f"audio-{i}.mp3")
#         slide = await renderSlide(scene, i, tmpDir)

#         print(f"[VIDEO] Generating visual and audio for scene {i + 1}/{len(scenes)}")
#         await generateImagenImage(scene["visual_prompt"], bg)
#         duration = await generateTTSAudio(scene["spoken_script"], audio)

#         out = os.path.join(tmpDir, f"scene-{i}.mp4")
#         await composeScene(bg, slide, avatar, audio, out, fallbacks)

#         sceneVideos.append(out)
#         timeline += duration

#     listFile = os.path.join(tmpDir, "scenes.txt")
#     with open(listFile, "w", encoding="utf-8") as f:
#         f.write("\n".join([f"file '{v.replace('\\\\', '/')}'" for v in sceneVideos]))

#     finalVideo = os.path.join(tmpDir, "final.mp4")

#     # ffmpeg concat
#     cmd_concat = [
#         "ffmpeg", "-y",
#         "-f", "concat",
#         "-safe", "0",
#         "-i", listFile,
#         "-c", "copy",
#         finalVideo
#     ]
#     proc2 = await asyncio.create_subprocess_exec(
#         *cmd_concat,
#         stdout=asyncio.subprocess.PIPE,
#         stderr=asyncio.subprocess.PIPE
#     )
#     _, stderr2 = await proc2.communicate()
#     if proc2.returncode != 0:
#         raise Exception(stderr2.decode("utf-8", errors="ignore")[:2000])

#     with open(finalVideo, "rb") as f:
#         buffer = f.read()

#     # Upload to Supabase
#     await ensureBucketExists()
#     uploadPath = f"{actualId}/{str(uuid_lib.uuid4())}_notebooklm_video.mp4"

#     upload_res = supabase.storage.from_(BUCKET).upload(
#         path=uploadPath,
#         file=buffer,
#         file_options={"content-type": "video/mp4", "upsert": "true"}
#     )

#     # supabase-py returns object; mimic TS behaviour
#     if isinstance(upload_res, dict) and upload_res.get("error"):
#         raise Exception(f"Upload failed: {upload_res['error']}")

#     publicData = supabase.storage.from_(BUCKET).get_public_url(uploadPath)
#     videoUrl = None
#     if isinstance(publicData, dict):
#         videoUrl = publicData.get("publicURL") or publicData.get("publicUrl") or publicData.get("public_url")

#     if not videoUrl:
#         # strict: match TS failure
#         raise Exception("Failed to get public video URL")

#     # Save URL in DB
#     print("[VIDEO] Saving video URL to database:", videoUrl)

#     supabase.table("processed_modules").update({
#         "video_url": videoUrl,
#         "video_generated_at": datetime.datetime.utcnow().isoformat()
#     }).eq("processed_module_id", actualId).execute()

#     # cleanup
#     try:
#         shutil.rmtree(tmpDir, ignore_errors=True)
#     except Exception:
#         pass

#     return videoUrl


# # ------------------------------------------------------------------
# # POST HANDLER (ONLY ENDPOINT YOU NEED)
# # ------------------------------------------------------------------
# router = APIRouter()

# @router.post("/gpt-video")
# async def POST(req: Request):
#     print("[GPT-VIDEO] POST request received")
#     try:
#         body = await req.json()

#         # ✅ supports BOTH keys
#         moduleId = body.get("processed_module_id") or body.get("module_id")
#         if not moduleId:
#             return JSONResponse({"error": "Missing module ID"}, status_code=400)

#         print("[GPT-VIDEO] Starting generation for:", moduleId)

#         videoUrl = await generateVideo(moduleId)

#         return JSONResponse({"videoUrl": videoUrl})
#     except Exception as e:
#         print("[GPT-VIDEO] Video generation failed:", e)
#         return JSONResponse({"error": str(e) or "Generation failed"}, status_code=500)
