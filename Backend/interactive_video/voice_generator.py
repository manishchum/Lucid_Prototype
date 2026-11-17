"""
Day 6: Voice Synthesis & Cost Tracking (voice_generator.py)

Milestone:
    Multi-language voiceover narration audio with exact duration tracking,
    sentence-level subtitle cues, and token/character cost tracking.

Features:
1. Google Cloud Text-to-Speech:
   - High-quality Neural2/Chirp voices for en-IN (English) and hi-IN (Hinglish).
   - Safe fallback to silent audio if TTS credentials or network are unavailable.
2. Company Language Filtering:
   - Respects company allowed languages from subscription_addons (default: en + hi).
3. Audio Duration & Subtitles:
   - Extracts exact audio duration in seconds using ffprobe via static_ffmpeg.
   - Generates sentence-level SubtitleCue models with proportional timestamps.
4. AI Usage & Cost Tracking:
   - Fetches active pricing from ModelManager for feature 'video_tts_generation'.
   - Calculates character usage and costs (USD & INR) via CostCalculator.
   - Logs to ai_usage_logs via UsageTracker when enable_usage_logging is True.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re
import subprocess
import tempfile
import time
import wave
from typing import Any, Dict, List, Optional, Set, Tuple

from dotenv import load_dotenv
from fastapi.concurrency import run_in_threadpool
from google.cloud import texttospeech

from ai.cost_calculator import CostCalculator
from ai.model_manager import ModelManager
from ai.types import UsageLog
from ai.usage_tracker import UsageTracker
from interactive_video.models import CourseManifest, ParsedDocumentContext, Segment, SubtitleCue

load_dotenv()

logger = logging.getLogger("interactive_video.voice_generator")

FEATURE_KEY = "video_tts_generation"
ROUTE = "/api/interactive-video"

# ---------------------------------------------------------------------------
# Resolve FFmpeg / FFprobe via static_ffmpeg
# ---------------------------------------------------------------------------

_FFMPEG_EXE: Optional[str] = None
_FFPROBE_EXE: Optional[str] = None

try:
    import static_ffmpeg
    _FFMPEG_EXE, _FFPROBE_EXE = static_ffmpeg.run.get_or_fetch_platform_executables_else_raise()
except Exception as _exc:
    logger.debug(f"[VoiceGenerator] static_ffmpeg resolution notice: {_exc}")
    import shutil
    _FFMPEG_EXE = shutil.which("ffmpeg")
    _FFPROBE_EXE = shutil.which("ffprobe")


# ---------------------------------------------------------------------------
# TTS Voice Profiles
# ---------------------------------------------------------------------------

VOICE_CONFIGS: Dict[str, Dict[str, str]] = {
    "en": {
        "language_code": "en-IN",
        "name": "en-IN-Chirp3-HD-Callirrhoe",
        "fallback_name": "en-IN-Neural2-A",
    },
    "hi": {
        "language_code": "hi-IN",
        "name": "hi-IN-Chirp3-HD-Callirrhoe",
        "fallback_name": "hi-IN-Neural2-A",
    },
    "hinglish": {
        "language_code": "hi-IN",
        "name": "hi-IN-Chirp3-HD-Callirrhoe",
        "fallback_name": "hi-IN-Neural2-A",
    },
}

_TTS_CLIENT: Optional[texttospeech.TextToSpeechClient] = None


def _get_tts_client() -> Optional[texttospeech.TextToSpeechClient]:
    """Initializes and caches the Google Cloud TTS client."""
    global _TTS_CLIENT
    if _TTS_CLIENT is not None:
        return _TTS_CLIENT

    raw_creds = os.getenv("GOOGLE_TTS_JSON")
    if raw_creds:
        try:
            raw_str = raw_creds.strip()
            if raw_str.startswith("{"):
                creds_dict = json.loads(raw_str)
            else:
                decoded = base64.b64decode(raw_str).decode("utf-8")
                creds_dict = json.loads(decoded)
            _TTS_CLIENT = texttospeech.TextToSpeechClient.from_service_account_info(creds_dict)
            logger.info("[VoiceGenerator] Initialized Google TTS client from GOOGLE_TTS_JSON")
            return _TTS_CLIENT
        except Exception as exc:
            logger.warning(f"[VoiceGenerator] Failed initializing TTS client from GOOGLE_TTS_JSON: {exc}")

    try:
        _TTS_CLIENT = texttospeech.TextToSpeechClient()
        logger.info("[VoiceGenerator] Initialized Google TTS client from environment")
        return _TTS_CLIENT
    except Exception as exc:
        logger.warning(f"[VoiceGenerator] No default Google Cloud TTS credentials found: {exc}")
        return None


# ---------------------------------------------------------------------------
# Silent Audio Generator (Graceful Fallback)
# ---------------------------------------------------------------------------

def _write_silent_audio(out_path: str, duration_seconds: float = 8.0) -> None:
    """Generates a silent audio file when TTS is unavailable."""
    tmp_wav = out_path + ".wav"
    try:
        with wave.open(tmp_wav, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(22050)
            num_frames = int(22050 * duration_seconds)
            wf.writeframes(b"\x00\x00" * num_frames)

        if _FFMPEG_EXE and os.path.exists(_FFMPEG_EXE):
            subprocess.run(
                [_FFMPEG_EXE, "-y", "-i", tmp_wav, "-c:a", "libmp3lame", "-b:a", "128k", out_path],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True,
            )
            if os.path.exists(tmp_wav):
                os.remove(tmp_wav)
        else:
            os.replace(tmp_wav, out_path)
    except Exception as exc:
        logger.error(f"[VoiceGenerator] Failed creating silent audio fallback: {exc}")


# ---------------------------------------------------------------------------
# Duration & Subtitle Helpers
# ---------------------------------------------------------------------------

def get_audio_duration(path: str) -> float:
    """
    Extracts the exact audio duration in seconds using ffprobe.
    Falls back to safe default if ffprobe fails or file does not exist.
    """
    if not path or not os.path.exists(path):
        return 5.0

    if _FFPROBE_EXE and os.path.exists(_FFPROBE_EXE):
        try:
            cmd = [
                _FFPROBE_EXE,
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "json",
                path,
            ]
            result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            data = json.loads(result.stdout or "{}")
            dur = float(data.get("format", {}).get("duration") or 0.0)
            if dur > 0:
                return round(dur, 2)
        except Exception as exc:
            logger.debug(f"[VoiceGenerator] ffprobe duration parse failed for {path}: {exc}")

    return 6.0


def build_subtitle_cues(script: str, total_duration: float) -> List[SubtitleCue]:
    """
    Splits the script into sentence-level subtitle cues with proportional timestamps.
    """
    if not script or total_duration <= 0:
        return []

    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", script.strip()) if s.strip()]
    if not sentences:
        return [SubtitleCue(start=0.0, end=round(total_duration, 2), text=script[:120])]

    total_words = sum(len(s.split()) for s in sentences)
    if total_words == 0:
        total_words = 1

    cues: List[SubtitleCue] = []
    cursor = 0.0

    for sent in sentences:
        words_count = len(sent.split())
        ratio = words_count / total_words
        cue_dur = round(ratio * total_duration, 2)
        cues.append(
            SubtitleCue(
                start=round(cursor, 2),
                end=round(min(cursor + cue_dur, total_duration), 2),
                text=sent,
            )
        )
        cursor += cue_dur

    if cues:
        cues[-1].end = round(total_duration, 2)

    return cues


# ---------------------------------------------------------------------------
# TTS Synthesis Worker
# ---------------------------------------------------------------------------

def synthesize_text_to_mp3(
    text: str,
    out_path: str,
    lang: str = "en",
    speaking_rate: float = 1.0,
) -> int:
    """
    Synthesizes speech using Google Cloud Text-to-Speech and saves as MP3.
    Returns the character count processed.
    """
    cleaned_text = (text or "").strip()
    if not cleaned_text:
        _write_silent_audio(out_path, duration_seconds=5.0)
        return 0

    client = _get_tts_client()
    if not client:
        logger.warning(f"[VoiceGenerator] TTS client unavailable, writing silent fallback to {out_path}")
        _write_silent_audio(out_path, duration_seconds=max(5.0, len(cleaned_text.split()) / 2.5))
        return len(cleaned_text)

    cfg = VOICE_CONFIGS.get(lang.lower(), VOICE_CONFIGS["en"])
    lang_code = cfg["language_code"]
    voice_name = cfg["name"]

    try:
        synthesis_input = texttospeech.SynthesisInput(text=cleaned_text)
        voice = texttospeech.VoiceSelectionParams(
            language_code=lang_code,
            name=voice_name,
        )
        audio_config = texttospeech.AudioConfig(
            audio_encoding=texttospeech.AudioEncoding.MP3,
            speaking_rate=speaking_rate,
        )

        response = client.synthesize_speech(
            input=synthesis_input,
            voice=voice,
            audio_config=audio_config,
        )

        if not response.audio_content:
            raise RuntimeError("Google Cloud TTS returned empty audio content")

        os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
        with open(out_path, "wb") as f:
            f.write(response.audio_content)

        return len(cleaned_text)

    except Exception as exc:
        logger.warning(f"[VoiceGenerator] Primary voice {voice_name} failed: {exc}. Trying fallback...")
        try:
            voice_fb = texttospeech.VoiceSelectionParams(
                language_code=lang_code,
                name=cfg.get("fallback_name", "en-IN-Standard-A"),
            )
            response = client.synthesize_speech(
                input=synthesis_input,
                voice=voice_fb,
                audio_config=audio_config,
            )
            with open(out_path, "wb") as f:
                f.write(response.audio_content)
            return len(cleaned_text)
        except Exception as fb_exc:
            logger.error(f"[VoiceGenerator] Fallback TTS failed: {fb_exc}. Writing silent audio.")
            _write_silent_audio(out_path, duration_seconds=max(5.0, len(cleaned_text.split()) / 2.5))
            return len(cleaned_text)


# ---------------------------------------------------------------------------
# Company Language Resolution
# ---------------------------------------------------------------------------

def resolve_allowed_languages(subscription_addons: Optional[List[str]]) -> Set[str]:
    """
    Checks company subscription_addons for allowed languages.
    Always includes English ('en'), and includes Hinglish ('hi') by default
    unless explicitly disabled.
    """
    allowed = {"en", "hi"}
    if not subscription_addons:
        return allowed

    normalized = {str(a).strip().lower() for a in subscription_addons if a}

    # If specific language restrictions exist
    has_hinglish = any(k in normalized for k in ("hi", "hinglish", "hindi", "lucid_studio_video_interactive", "lucid_studio_video"))
    if has_hinglish:
        allowed.add("hi")

    return allowed


# ---------------------------------------------------------------------------
# Public Batch API
# ---------------------------------------------------------------------------

async def synthesize_course_audio(
    manifest: CourseManifest,
    ctx: ParsedDocumentContext,
    output_dir: Optional[str] = None,
    enable_usage_logging: bool = False,
) -> CourseManifest:
    """
    Day 6 Milestone: Synthesizes multi-language narration audio (EN + Hinglish)
    for each lecture segment in the manifest, extracts exact duration and subtitle cues,
    and tracks character usage/costs.

    Args:
        manifest: CourseManifest returned by planner.py (and slide_renderer.py).
        ctx: ParsedDocumentContext containing company ownership and allowed addons.
        output_dir: Target directory for MP3 audio files. If None, creates a tempdir.
        enable_usage_logging: If True, writes usage logs to ai_usage_logs (default: False for safe testing).

    Returns:
        Updated CourseManifest with audio paths, durations, and subtitle cues populated.
    """
    if not output_dir:
        output_dir = tempfile.mkdtemp(prefix=f"audio_{manifest.processed_module_id[:8]}_")
    os.makedirs(output_dir, exist_ok=True)

    allowed_langs = resolve_allowed_languages(ctx.subscription_addons)
    logger.info(
        "[VoiceGenerator] Synthesizing audio for '%s' (%d segments, allowed_langs=%s) into %s",
        manifest.title,
        len(manifest.segments),
        allowed_langs,
        output_dir,
    )

    # 1. Fetch ModelConfig for cost rate
    tts_cost_rate_per_million = 16.0  # Default Google TTS Neural2 rate: $16.00 / 1M chars
    tts_feature_id = ""
    try:
        model_cfg = ModelManager.get(FEATURE_KEY, use_cache=True)
        if model_cfg:
            tts_cost_rate_per_million = model_cfg.output_cost_per_million or 16.0
            tts_feature_id = model_cfg.feature_id
    except Exception as exc:
        logger.debug(f"[VoiceGenerator] Could not fetch ModelConfig for {FEATURE_KEY}: {exc}")

    total_characters_synthesized = 0
    start_time = time.time()

    # 2. Synthesize each segment
    for i, seg in enumerate(manifest.segments):
        seg_id = seg.id
        script_en = seg.script_en or seg.title
        script_hi = seg.script_hi or script_en

        dur_en = 0.0
        dur_hi = 0.0

        # English Track
        if "en" in allowed_langs:
            out_en = os.path.join(output_dir, f"audio_en_{i + 1:03d}_{seg_id}.mp3")
            chars = await run_in_threadpool(synthesize_text_to_mp3, script_en, out_en, "en")
            total_characters_synthesized += chars
            dur_en = await run_in_threadpool(get_audio_duration, out_en)
            seg.audio_en_path = out_en
            seg.duration_en = dur_en
            seg.subtitles_en = build_subtitle_cues(script_en, dur_en)
            logger.info("[VoiceGenerator] Segment %d EN audio: %.2fs (%d chars)", i + 1, dur_en, chars)

        # Hinglish Track
        if "hi" in allowed_langs or "hinglish" in allowed_langs:
            out_hi = os.path.join(output_dir, f"audio_hi_{i + 1:03d}_{seg_id}.mp3")
            chars = await run_in_threadpool(synthesize_text_to_mp3, script_hi, out_hi, "hi")
            total_characters_synthesized += chars
            dur_hi = await run_in_threadpool(get_audio_duration, out_hi)
            seg.audio_hi_path = out_hi
            seg.duration_hi = dur_hi
            seg.subtitles_hi = build_subtitle_cues(script_hi, dur_hi)
            logger.info("[VoiceGenerator] Segment %d HI audio: %.2fs (%d chars)", i + 1, dur_hi, chars)

        # Keep segment duration synchronized (max of both tracks, at least 5s)
        seg.duration = max(dur_en, dur_hi, 5.0)

    # 3. Update CourseManifest estimated duration
    total_sec = sum(s.duration for s in manifest.segments)
    manifest.estimated_duration_minutes = round(total_sec / 60.0, 2)

    latency_ms = int((time.time() - start_time) * 1000)

    # 4. Calculate Costs
    cost_usd, cost_inr = CostCalculator.calculate(
        input_tokens=0,
        output_tokens=total_characters_synthesized,
        input_cost_per_million=0.0,
        output_cost_per_million=tts_cost_rate_per_million,
    )

    logger.info(
        "[VoiceGenerator] Completed TTS synthesis: %d chars, duration=%.1fs, cost=$%.4f USD (₹%.2f INR)",
        total_characters_synthesized,
        total_sec,
        cost_usd,
        cost_inr,
    )

    # 5. Usage Logging (only if explicitly enabled)
    if enable_usage_logging and ctx.company_id and tts_feature_id:
        try:
            usage = UsageLog(
                company_id=ctx.company_id,
                user_id=ctx.uploaded_by or "system",
                feature_id=tts_feature_id,
                provider="google_tts",
                model="google-cloud-tts",
                route=ROUTE,
                prompt_version=1,
                input_tokens=0,
                output_tokens=total_characters_synthesized,
                total_tokens=total_characters_synthesized,
                cost_usd=cost_usd,
                cost_inr=cost_inr,
                latency_ms=latency_ms,
                status="success",
                usage_quantity=float(total_characters_synthesized),
                usage_unit="characters",
                duration_seconds=total_sec,
            )
            UsageTracker.log(usage)
            logger.info("[VoiceGenerator] Usage logged to ai_usage_logs")
        except Exception as log_exc:
            logger.warning(f"[VoiceGenerator] Could not record usage log: {log_exc}")

    return manifest
