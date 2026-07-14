import os
import json
import base64
import time
import tempfile
import uuid
import re
from typing import Any, Dict, List, Optional, Literal

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
# from supabase import create_client, Client
from utils.supabase_client import supabase_admin, supabase

import google.generativeai as genai


router = APIRouter()

# -------------------------------
# ENV + INIT (same behavior)
# -------------------------------

# supabaseUrl = os.getenv("NEXT_PUBLIC_SUPABASE_URL") or ""
# serviceKey = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

# print("[TTS API] supabaseUrl:", supabaseUrl)
# print("[TTS API] serviceKey", (serviceKey or ""))

SUPABASE_URL = (
    os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    or os.getenv("SUPABASE_URL")
    or ""
).rstrip("/")

base64Key = os.getenv("GOOGLE_TTS_JSON")
credentialsPath: Optional[str] = None

if base64Key:
    try:
        decoded = base64.b64decode(base64Key).decode("utf-8")
        tempPath = os.path.join(
            tempfile.gettempdir(),
            f"google-credentials-{int(time.time() * 1000)}.json"
        )
        with open(tempPath, "w", encoding="utf-8") as f:
            f.write(decoded)
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = tempPath
        credentialsPath = tempPath
        print("[TTS API] Decoded Google credentials from GOOGLE_TTS_JSON and set GOOGLE_APPLICATION_CREDENTIALS")
    except Exception as e:
        print("[TTS API] Failed to decode/write Google credentials:", e)
else:
    print("[TTS API] GOOGLE_TTS_JSON not set.")

# if not supabaseUrl:
#     print("[TTS API] NEXT_PUBLIC_SUPABASE_URL is not set")
# if not serviceKey:
#     print("[TTS API] SUPABASE_SERVICE_ROLE_KEY is not set. Storage/DB writes may fail due to RLS.")

# admin: Client = create_client(
#     supabaseUrl,
#     serviceKey or (os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY") or "")
# )

BUCKET = "module_audio"

# Gemini init (same behavior)
if not os.getenv("GEMINI_API_KEY"):
    print("[TTS API] WARNING: GEMINI_API_KEY not set")
genai.configure(api_key=os.getenv("GEMINI_API_KEY") or "")


# -------------------------------
# Helper: callGemini (compatible)
# -------------------------------
async def callGemini(prompt: str, opts: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Equivalent to TS callGemini(prompt, { temperature, maxOutputTokens }).
    Preserves response shape:
    { ok: boolean, text?: string, data?: { text: string } }
    """
    try:
        opts = opts or {}
        temperature = opts.get("temperature", 0.35)
        maxOutputTokens = opts.get("maxOutputTokens", 1200)

        model = genai.GenerativeModel("gemini-2.5-flash-lite")
        result = model.generate_content(
            prompt,
            generation_config={
                "temperature": temperature,
                "max_output_tokens": maxOutputTokens,
            }
        )
        text = getattr(result, "text", "") if result else ""
        return {"ok": True, "data": {"text": text}}
    except Exception as e:
        return {"ok": False, "text": str(e)}


# -------------------------------
# Google JWT generation (same)
# -------------------------------
def generateJWT(credentials: Dict[str, Any]) -> str:
    import jwt  # pyjwt

    now = int(time.time())
    payload = {
        "iss": credentials.get("client_email"),
        "sub": credentials.get("client_email"),
        "scope": "https://www.googleapis.com/auth/cloud-platform",
        "aud": "https://oauth2.googleapis.com/token",
        "exp": now + 3600,
        "iat": now,
    }

    private_key = (credentials.get("private_key") or "").replace("\\n", "\n").strip()

    token = jwt.encode(
        payload,
        private_key,
        algorithm="RS256",
        headers={"typ": "JWT"},
    )

    if isinstance(token, bytes):
        token = token.decode("utf-8")
    return token


# -------------------------------
# Storage bucket ensure
# -------------------------------
async def ensureBucketExists():
    """
    In TS: listBuckets + createBucket if missing.
    In Python: we just check bucket reachability using list().
    """
    try:
        # If bucket does not exist / no permission -> it errors
        res = supabase_admin.storage.from_(BUCKET).list("")

        # supabase-py versions vary:
        if isinstance(res, dict):
            if res.get("error"):
                err = res["error"]
                msg = err.get("message") if isinstance(err, dict) else str(err)
                return {"ok": False, "error": msg or f"Bucket '{BUCKET}' not found"}
            return {"ok": True}

        err = getattr(res, "error", None)
        if err:
            msg = err.get("message") if isinstance(err, dict) else str(err)
            return {"ok": False, "error": msg or f"Bucket '{BUCKET}' not found"}

        return {"ok": True}

    except Exception as e:
        return {"ok": False, "error": str(e)}


# -------------------------------
# Text sanitization (same)
# -------------------------------
def cleanTextForTTS(text: str):
    text = (
        re.sub(r"[#*`>-]", "", text)          # Remove markdown symbols
        .replace("\n", " ")                  # Replace newlines with space
        .replace("\r", " ")
    )
    text = re.sub(r"\s+", " ", text)         # Collapse multiple spaces
    text = re.sub(r"<[^>]+>", "", text)      # Remove HTML tags
    return text.strip()


# -------------------------------
# Podcast prompt builder (same)
# -------------------------------
def buildGeminiPodcastPrompt(moduleTitle: str, moduleContent: str, language: Literal["en", "hinglish"] = "en") -> str:
    languageInstruction = (
        """CRITICAL LANGUAGE REQUIREMENT - MUST BE FOLLOWED STRICTLY:
- Write 85% of ALL content in HINDI (Devanagari script or romanized Hindi)
- Use English ONLY for: technical terms, modern concepts, brand names
- Maximum 15-20% English words allowed
- Each sentence should be PRIMARILY Hindi with minimal English
- Example CORRECT format: "Aaj hum baat karenge financial ratios ke baare mein jo company ki health check karne mein help karte hain"
- Example WRONG format (DO NOT USE): "Today we are going to talk about financial ratios which help in checking company health"
- Pooja aur Rahul dono ko Hindi mein hi baat karni hai"""
        if language == "hinglish"
        else (
            "Generate the entire podcast script in English only. "
            "Do NOT use Hindi words, Hinglish phrases, or Devanagari script."
        )
    )

    dialogueCount = "48" if language == "hinglish" else "30"

    speakers = (
        "- Pooja (host) - Hindi mein baat karti hai, enthusiastic, warm, naturally curious\n"
        "- Rahul (expert) - Hindi mein samjhate hain, friendly teacher, real-world examples dete hain"
        if language == "hinglish"
        else
        "- Sarah (host) - enthusiastic, warm, naturally curious, uses conversational fillers and expressions\n"
        "- Mark (expert) - friendly teacher, uses real-world examples, explains like talking to a friend"
    )

    # ✅ Fixed: Define format strings outside f-string
    hinglish_format = "Pooja: [text in Hindi with minimal English]\\nRahul: [text in Hindi with minimal English]"
    english_format = "Sarah: [text]\\nMark: [text]"
    
    format_instruction = hinglish_format if language == "hinglish" else english_format

    hinglish_filler = '"toh", "matlab", "dekho", "acha", "sahi hai", "bilkul"'
    english_filler = '"you know", "I mean", "actually", "right", "so"'
    filler_words = hinglish_filler if language == "hinglish" else english_filler

    hinglish_reactions = '"Arey interesting!", "Bilkul sahi!", "Aur batao iske baare mein"'
    english_reactions = '"Oh interesting!", "That makes sense", "Tell me more about that"'
    reactions = hinglish_reactions if language == "hinglish" else english_reactions

    hinglish_transitions = '"Isse yaad aaya...", "Iske baare mein baat karte hain...", "Ek aur cheez..."'
    english_transitions = '"That reminds me...", "Speaking of...", "And another thing..."'
    transitions = hinglish_transitions if language == "hinglish" else english_transitions

    language_reminder = (
        "REMINDER: WRITE IN HINDI! Use romanized Hindi or Devanagari. English sirf technical terms ke liye."
        if language == "hinglish"
        else "REMINDER: WRITE ONLY IN ENGLISH. No Hindi or Hinglish words."
    )

    greeting_instruction = (
        "Line 1 ONLY - One speaker says a single brief greeting line (max 1 sentence). "
        "NO 'Namaste aur swagat'. Start like: 'Aaj hum discuss karenge [topic]' or similar."
        if language == "hinglish"
        else (
            "Line 1 ONLY - One speaker says a single brief greeting line (max 1 sentence). "
            "NO Hindi/Hinglish greeting. Start like: 'Today we're discussing [topic]' or similar."
        )
    )

    structure_line_1 = (
        "Single brief greeting (e.g., 'Aaj hum discuss karenge [topic]')"
        if language == "hinglish"
        else "Single brief greeting (e.g., 'Today we're discussing [topic]')"
    )

    return f"""Create a natural, engaging podcast conversation between two people:
{speakers}

Module Title: {moduleTitle}

Content to cover:
{moduleContent}

CRITICAL REQUIREMENTS - FOLLOW EXACTLY:
1. DIALOGUE COUNT: Generate EXACTLY {dialogueCount} dialogue exchanges total (count each speaker turn)
2. MINIMAL GREETING: {greeting_instruction}
3. DIVE INTO CONTENT: From Line 2 onwards, immediately start discussing the actual topic
4. PROPER ENDING: Last 3 lines MUST wrap up with summary and sign-off. DO NOT end mid-sentence.
5. COMPLETE ALL {dialogueCount} LINES - Do not stop early

IMPORTANT - Make it sound like a real conversation:
1. {languageInstruction}
2. Use natural speech patterns - include filler words like {filler_words}
3. The host should react naturally - {reactions}
4. Keep responses conversational and flowing - 2 to 4 sentences per turn
5. The expert should explain concepts like teaching a friend, not lecturing
6. Include smooth transitions - {transitions}
7. Show genuine enthusiasm and interest in the topic
8. Avoid formal or robotic language - be warm and relatable
9. Skip activities, homework sections, and discussion prompts
10. Focus on practical insights and real-world applications

{language_reminder}

STRUCTURE:
- Line 1: {structure_line_1}
- Lines 2 to {dialogueCount}-3: Deep dive into main content
- Last 3 lines: Wrap-up with key takeaways and sign-off

Format each line as:
{format_instruction}

Generate EXACTLY {dialogueCount} dialogue exchanges total."""


# -------------------------------
# Dialogue parsing (same)
# -------------------------------
def parseGeminiDialogue(text: str, language: Literal["en", "hinglish"] = "en") -> List[Dict[str, Any]]:
    dialogue: List[Dict[str, Any]] = []
    lines = text.split("\n")

    for line in lines:
        trimmed = line.strip()
        if not trimmed:
            continue

        if language == "hinglish":
            poojaMatch = re.match(r"^Pooja:\s*(.+)$", trimmed, re.IGNORECASE)
            rahulMatch = re.match(r"^Rahul:\s*(.+)$", trimmed, re.IGNORECASE)

            if poojaMatch:
                dialogue.append({"speaker": "pooja", "text": cleanTextForTTS(poojaMatch.group(1))})
            elif rahulMatch:
                dialogue.append({"speaker": "rahul", "text": cleanTextForTTS(rahulMatch.group(1))})
        else:
            sarahMatch = re.match(r"^Sarah:\s*(.+)$", trimmed, re.IGNORECASE)
            markMatch = re.match(r"^Mark:\s*(.+)$", trimmed, re.IGNORECASE)

            if sarahMatch:
                dialogue.append({"speaker": "sarah", "text": cleanTextForTTS(sarahMatch.group(1))})
            elif markMatch:
                dialogue.append({"speaker": "mark", "text": cleanTextForTTS(markMatch.group(1))})

    # Return all dialogue segments (no arbitrary limit)
    return dialogue


# -------------------------------
# WAV encoding (same)
# -------------------------------
def createWavBuffer(pcmBytes: bytes, sampleRate: int = 24000, numChannels: int = 1, bytesPerSample: int = 2) -> bytes:
    import struct

    blockAlign = numChannels * bytesPerSample
    byteRate = sampleRate * blockAlign

    header = bytearray(44)
    header[0:4] = b"RIFF"
    struct.pack_into("<I", header, 4, 36 + len(pcmBytes))
    header[8:12] = b"WAVE"
    header[12:16] = b"fmt "
    struct.pack_into("<I", header, 16, 16)
    struct.pack_into("<H", header, 20, 1)
    struct.pack_into("<H", header, 22, numChannels)
    struct.pack_into("<I", header, 24, sampleRate)
    struct.pack_into("<I", header, 28, byteRate)
    struct.pack_into("<H", header, 32, blockAlign)
    struct.pack_into("<H", header, 34, bytesPerSample * 8)
    header[36:40] = b"data"
    struct.pack_into("<I", header, 40, len(pcmBytes))

    return bytes(header) + pcmBytes


# -------------------------------
# Main synthesis pipeline (same)
# -------------------------------
async def synthesizeAndStore(processedModuleId: str, language: Literal["en", "hinglish"] = "en"):
    # Fetch module content from processed_modules
    moduleRes = (
        supabase
        .table("processed_modules")
        .select("processed_module_id, title, content")
        .eq("processed_module_id", processedModuleId)
        .maybe_single()
        .execute()
    )

    module = getattr(moduleRes, "data", None)
    moduleError = getattr(moduleRes, "error", None)

    if moduleError or not module:
        err_msg = None
        if moduleError:
            err_msg = moduleError.get("message") if isinstance(moduleError, dict) else str(moduleError)
        return {"error": err_msg or "Module not found", "status": 404}

    fullContent = module.get("content") or ""
    if not fullContent:
        return {"error": "Empty content", "status": 400}

    # Gemini
    print(f"[TTS] Calling Gemini to generate podcast script (language: {language})...")
    prompt = buildGeminiPodcastPrompt(module.get("title") or "", fullContent, language)

    geminiResponse = ""
    try:
        # Increased token limits to ensure full dialogue generation with proper endings
        maxTokens = 2000 if language == "hinglish" else 2500
        temp = 0.3 if language == "hinglish" else 0.35

        geminiResult = await callGemini(prompt, {"temperature": temp, "maxOutputTokens": maxTokens})

        if not geminiResult.get("ok"):
            print("[TTS] Gemini API failed:", geminiResult.get("text"))
            return {"error": f"Gemini API failed: {geminiResult.get('text')}", "status": 500}

        geminiResponse = ((geminiResult.get("data") or {}).get("text")) or ""
        if not geminiResponse:
            return {"error": "No text generated from Gemini", "status": 500}

    except Exception as err:
        print("[TTS] Gemini API error:", err)
        return {"error": f"Gemini API failed: {str(err)}", "status": 500}

    print(f"[TTS] Gemini response length: {len(geminiResponse)} chars")
    print(f"[TTS] Gemini response preview (first 500 chars): {geminiResponse[:500]}")
    print(f"[TTS] Gemini response preview (last 500 chars): {geminiResponse[-500:]}")
    
    dialogue = parseGeminiDialogue(geminiResponse, language)
    if len(dialogue) == 0:
        return {"error": "No dialogue generated from Gemini response", "status": 500}

    # Expected dialogue count based on language
    expectedDialogueCount = 48 if language == "hinglish" else 30
    
    print(f"[TTS] Generated {len(dialogue)} dialogue segments from Gemini (target was {expectedDialogueCount})")
    if len(dialogue) < 30:
        print(f"[TTS] ⚠️ WARNING: Only {len(dialogue)} dialogues generated, expected around {expectedDialogueCount}")

    pcmBuffers: List[bytes] = []
    SAMPLE_RATE = 24000
    BYTES_PER_SAMPLE = 2
    PAUSE_DURATION = 0.2

    podcastTimeline: List[Dict[str, Any]] = []
    cumulativeTime = 0.0

    # Google access token
    accessToken: Optional[str] = None
    try:
        credPath = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
        if not credPath:
            return {"error": "GOOGLE_APPLICATION_CREDENTIALS not set", "status": 500}

        with open(credPath, "r", encoding="utf-8") as f:
            credentials = json.loads(f.read())

        tokenReq = {
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": generateJWT(credentials),
        }

        async with httpx.AsyncClient(timeout=60) as client:
            tokenResp = await client.post(
                "https://oauth2.googleapis.com/token",
                headers={"Content-Type": "application/json"},
                json=tokenReq,
            )

        if tokenResp.status_code < 200 or tokenResp.status_code >= 300:
            errText = tokenResp.text
            print("[TTS API] Failed to get access token:", errText)
            return {"error": f"Failed to get Google access token: {errText}", "status": 500}

        tokenData = tokenResp.json()
        accessToken = tokenData.get("access_token")
        if not accessToken:
            return {"error": "No access token in response", "status": 500}

    except Exception as err:
        print("[TTS API] Error getting access token:", err)
        return {"error": f"Failed to initialize TTS: {str(err)}", "status": 500}

    # Generate audio segments
    for i in range(len(dialogue)):
        segment = dialogue[i]

        if language == "hinglish":
            voice = (
                {"languageCode": "hi-IN", "name": "hi-IN-Chirp3-HD-Autonoe", "ssmlGender": "FEMALE"}
                if segment["speaker"] == "pooja"
                else {"languageCode": "hi-IN", "name": "hi-IN-Chirp3-HD-Enceladus", "ssmlGender": "MALE"}
            )
        else:
            voice = (
                {"languageCode": "en-IN", "name": "en-IN-Chirp3-HD-Callirrhoe", "ssmlGender": "FEMALE"}
                if segment["speaker"] == "sarah"
                else {"languageCode": "en-IN", "name": "en-IN-Chirp3-HD-Enceladus", "ssmlGender": "MALE"}
            )

        requestBody = {
            "input": {"text": segment["text"]},
            "voice": voice,
            "audioConfig": {
                "audioEncoding": "LINEAR16",
                "sampleRateHertz": 24000,
                "speakingRate": 1.0,
                "pitch": 0.0,
            },
        }

        try:
            print(f"[TTS] Synthesizing segment {i + 1}/{len(dialogue)} ({segment['speaker']}, {language})...")

            async with httpx.AsyncClient(timeout=60) as client:
                response = await client.post(
                    "https://texttospeech.googleapis.com/v1/text:synthesize",
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {accessToken}",
                    },
                    json=requestBody,
                )

            if response.status_code < 200 or response.status_code >= 300:
                errorText = response.text
                print("[TTS API] Google TTS REST API error:", response.status_code, errorText)
                return {
                    "error": f"Google TTS API failed: {response.reason_phrase}. {errorText}",
                    "status": response.status_code,
                }

            data = response.json()
            audioContent = data.get("audioContent")

            if not audioContent:
                return {"error": "TTS returned no audio for a segment", "status": 500}

            buf = base64.b64decode(audioContent)

            durationSec = len(buf) / (SAMPLE_RATE * BYTES_PER_SAMPLE)
            startSec = cumulativeTime
            endSec = cumulativeTime + durationSec

            podcastTimeline.append({
                "speaker": segment["speaker"],
                "text": segment["text"],
                "startSec": startSec,
                "endSec": endSec
            })

            pcmBuffers.append(buf)
            cumulativeTime = endSec

            if i < len(dialogue) - 1:
                pauseSamples = int(PAUSE_DURATION * SAMPLE_RATE)
                pauseBuffer = b"\x00" * (pauseSamples * BYTES_PER_SAMPLE)
                pcmBuffers.append(pauseBuffer)
                cumulativeTime += PAUSE_DURATION

        except Exception as ttsErr:
            errMsg = str(ttsErr)
            print("[TTS API] Google Cloud TTS error:", errMsg)
            return {"error": f"Google Cloud TTS failed: {errMsg}", "status": 500}

    # Build WAV
    print("[TTS] All segments synthesized, creating final audio file...")
    pcm = b"".join(pcmBuffers)
    wavBuffer = createWavBuffer(pcm, 24000, 1, 2)

    # Ensure bucket
    print("[TTS][DEBUG] ensuring bucket...")
    ensured = await ensureBucketExists()
    print("[TTS][DEBUG] ensured:", ensured)

    if not ensured.get("ok"):
        return {
            "error": f"Bucket not found and could not be created: {ensured.get('error')}. Ensure SUPABASE_SERVICE_ROLE_KEY is set or create the bucket manually.",
            "status": 500,
        }

    fileName = f"module-audio/{processedModuleId}/{uuid.uuid4()}.wav"

    # Upload
    print("[TTS][DEBUG] uploading to storage... bucket=", BUCKET, "file=", fileName)
    uploadRes = supabase_admin.storage.from_(BUCKET).upload(
        fileName,
        wavBuffer,
        file_options={"content-type": "audio/wav", "upsert": "true"}
    )

    uploadError = None
    if uploadRes is None:
        uploadError = {"message": "Storage upload returned None"}
    else:
        uploadError = getattr(uploadRes, "error", None)
        if (not uploadError) and isinstance(uploadRes, dict):
            uploadError = uploadRes.get("error")

    if uploadError:
        msg = uploadError.get("message") if isinstance(uploadError, dict) else str(uploadError)
        return {"error": f"Audio upload failed: {msg}", "status": 500}

    # ✅ Public URL (fixed)
    print("[TTS][DEBUG] get public url... bucket=", BUCKET, "file=", fileName)
    publicUrlData = supabase_admin.storage.from_(BUCKET).get_public_url(fileName)

    audioUrl = None

    # Case 1: supabase-py returns string
    if isinstance(publicUrlData, str):
        audioUrl = publicUrlData

    # Case 2: dict response
    elif isinstance(publicUrlData, dict):
        audioUrl = (
            (publicUrlData.get("data") or {}).get("publicUrl")
            or (publicUrlData.get("data") or {}).get("public_url")
            or publicUrlData.get("publicUrl")
            or publicUrlData.get("publicURL")
            or publicUrlData.get("public_url")
        )

    # Case 3: object response
    else:
        dataObj = getattr(publicUrlData, "data", None)
        if isinstance(dataObj, dict):
            audioUrl = dataObj.get("publicUrl") or dataObj.get("public_url")
        audioUrl = audioUrl or getattr(publicUrlData, "publicUrl", None)

    # fallback (always correct for public bucket)
    if not audioUrl:
        if SUPABASE_URL:
            audioUrl = f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{fileName}"

    if not audioUrl:
        return {"error": "Failed to get public URL from Supabase storage", "status": 500}

    # DB update
    print("[TTS][DEBUG] updating DB... processed_module_id=", processedModuleId, "language=", language)

    if language == "hinglish":
        updateData = {
            "audio_url_hinglish": audioUrl,
            "podcast_transcript_hinglish": "\n".join([f"{d['speaker']}: {d['text']}" for d in dialogue]),
            "podcast_timeline_hinglish": json.dumps(podcastTimeline),
            "audio_generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
    else:
        updateData = {
            "audio_url": audioUrl,
            "podcast_transcript": "\n".join([f"{d['speaker']}: {d['text']}" for d in dialogue]),
            "podcast_timeline": json.dumps(podcastTimeline),
            "audio_generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }

    updRes = (
        supabase
        .table("processed_modules")
        .update(updateData)
        .eq("processed_module_id", processedModuleId)
        .execute()
    )

    updateErr = getattr(updRes, "error", None)
    if updateErr:
        msg = updateErr.get("message") if isinstance(updateErr, dict) else str(updateErr)
        return {"error": f"DB update failed: {msg}", "status": 500}

    podcastTranscript = "\n".join([f"{d['speaker']}: {d['text']}" for d in dialogue])
    print("[TTS] ✅ Done:", audioUrl)

    return {"audioUrl": audioUrl, "podcastTimeline": podcastTimeline, "podcastTranscript": podcastTranscript}


# -------------------------------
# GET handler (same behavior)
# -------------------------------
@router.get("/tts")
async def GET(request: Request):
    try:
        searchParams = request.query_params
        processed = searchParams.get("processed_module_id")
        legacy = searchParams.get("module_id")
        language = (searchParams.get("language") or "en")
        language = "hinglish" if language == "hinglish" else "en"

        moduleId = processed or legacy
        targetId = moduleId

        print("[TTS API][GET] Incoming request: processed_module_id=", processed, "language=", language)

        if not targetId:
            res = (
                supabase
                .table("processed_modules")
                .select("processed_module_id")
                .is_("audio_url", "null")
                .limit(1)
                .maybe_single()
                .execute()
            )

            data = getattr(res, "data", None)
            error = getattr(res, "error", None)

            if error:
                code = error.get("code") if isinstance(error, dict) else None
                if code != "PGRST116":
                    msg = error.get("message") if isinstance(error, dict) else str(error)
                    return JSONResponse(content={"error": msg}, status_code=500)

            targetId = (data or {}).get("processed_module_id") if isinstance(data, dict) else None

            if not targetId:
                anyOneRes = (
                    supabase
                    .table("processed_modules")
                    .select("processed_module_id")
                    .limit(1)
                    .maybe_single()
                    .execute()
                )
                anyOne = getattr(anyOneRes, "data", None)
                targetId = (anyOne or {}).get("processed_module_id") if isinstance(anyOne, dict) else None

        if not targetId:
            return JSONResponse(content={"error": "No processed_modules found to synthesize"}, status_code=404)

        result = await synthesizeAndStore(targetId, language)

        if isinstance(result, dict) and "error" in result:
            print("[TTS API][GET] Synthesis failed:", result.get("error"))
            return JSONResponse(content={"error": result.get("error")}, status_code=result.get("status", 500))

        if not isinstance(result, dict):
            return JSONResponse(content={"error": "Synthesis returned invalid result"}, status_code=500)

        return JSONResponse(content={
            "audioUrl": result.get("audioUrl"),
            "podcastTimeline": result.get("podcastTimeline"),
            "podcastTranscript": result.get("podcastTranscript"),
            "processed_module_id": targetId
        })

    except Exception as err:
        errMsg = str(err)
        print("[TTS API][GET] Error:", errMsg, err)
        return JSONResponse(content={"error": f"TTS request failed: {errMsg}"}, status_code=500)


@router.post("/tts")
async def POST(request: Request):
    try:
        body = await request.json()
        module_id = body.get("processed_module_id") or body.get("module_id")
        language = body.get("language") or "en"
        language = "hinglish" if language == "hinglish" else "en"

        if not module_id:
            return JSONResponse(content={"error": "Missing processed_module_id"}, status_code=400)

        result = await synthesizeAndStore(module_id, language)

        if isinstance(result, dict) and "error" in result:
            print("[TTS API][POST] Synthesis failed:", result.get("error"))
            return JSONResponse(content={"error": result.get("error")}, status_code=result.get("status", 500))

        if not isinstance(result, dict):
            return JSONResponse(content={"error": "Synthesis returned invalid result"}, status_code=500)

        return JSONResponse(content={
            "audioUrl": result.get("audioUrl"),
            "podcastTimeline": result.get("podcastTimeline"),
            "podcastTranscript": result.get("podcastTranscript"),
            "processed_module_id": module_id
        })

    except Exception as err:
        errMsg = str(err)
        print("[TTS API][POST] Error:", errMsg, err)
        return JSONResponse(content={"error": f"TTS request failed: {errMsg}"}, status_code=500)
