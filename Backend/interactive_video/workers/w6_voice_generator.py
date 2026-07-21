"""
Worker 6: Voice Generator
Generates Google TTS audio for each lecture segment (EN + Hinglish).
Also produces subtitle cue timestamps by chunking the script.
"""
from __future__ import annotations
import base64
import json
import os
import subprocess
import shutil
import wave
from typing import Any, Dict, List, Optional, Tuple

from google.cloud import texttospeech

# Resolve ffprobe path (same pattern as gpt_video_generation)
try:
    import static_ffmpeg
    _FFMPEG, _FFPROBE = static_ffmpeg.run.get_or_fetch_platform_executables_else_raise()
except ImportError:
    try:
        import imageio_ffmpeg
        _FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
        _FFPROBE = shutil.which("ffprobe")
    except ImportError:
        _FFMPEG = shutil.which("ffmpeg")
        _FFPROBE = shutil.which("ffprobe")

# TTS voice config
EN_TTS_COST_PER_CHAR = 0.00003
HI_TTS_COST_PER_CHAR = 0.000016

_VOICES = {
    "en": {
        "language_code": "en-IN",
        "name": "en-IN-Chirp3-HD-Callirrhoe",
    },
    "hi": {
        "language_code": "hi-IN",
        "name": "hi-IN-Neural2-B",
    },
}

_TTS_CLIENT: Optional[texttospeech.TextToSpeechClient] = None


def _get_tts_client() -> texttospeech.TextToSpeechClient:
    global _TTS_CLIENT
    if _TTS_CLIENT is None:
        credentials_payload = os.getenv("GOOGLE_TTS_JSON")
        if credentials_payload:
            try:
                try:
                    decoded = base64.b64decode(credentials_payload).decode("utf-8")
                    creds = json.loads(decoded)
                except Exception:
                    creds = json.loads(credentials_payload)
                _TTS_CLIENT = texttospeech.TextToSpeechClient.from_service_account_info(creds)
                return _TTS_CLIENT
            except Exception as exc:
                print(f"[W6] WARNING: Failed to initialize TTS client from GOOGLE_TTS_JSON: {exc}")
        _TTS_CLIENT = texttospeech.TextToSpeechClient()
    return _TTS_CLIENT


def _write_silent_mp3(out_path: str, duration_seconds: float = 10.0) -> None:
    # Generate a silent WAV then convert to MP3 if ffmpeg is available.
    tmp_wav = out_path + ".wav"
    with wave.open(tmp_wav, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(22050)
        num_frames = int(22050 * duration_seconds)
        wf.writeframes(b"\x00\x00" * num_frames)

    if _FFMPEG:
        subprocess.run(
            [_FFMPEG, "-y", "-i", tmp_wav, out_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        os.remove(tmp_wav)
    else:
        # Fallback to WAV if MP3 conversion is unavailable.
        os.replace(tmp_wav, out_path)


def _synthesize(script: str, out_path: str, lang: str = "en") -> None:
    try:
        client = _get_tts_client()
        cfg = _VOICES.get(lang, _VOICES["en"])

        response = client.synthesize_speech(
            input=texttospeech.SynthesisInput(text=script),
            voice=texttospeech.VoiceSelectionParams(
                language_code=cfg["language_code"],
                name=cfg["name"],
            ),
            audio_config=texttospeech.AudioConfig(
                audio_encoding=texttospeech.AudioEncoding.MP3,
                speaking_rate=1.0,
            ),
        )
        if not response.audio_content:
            raise RuntimeError("TTS returned empty audio")
        with open(out_path, "wb") as f:
            f.write(response.audio_content)
    except Exception as exc:
        print(f"[W6] WARNING: TTS synth failed ({lang}) — falling back to silent audio: {exc}")
        _write_silent_mp3(out_path, duration_seconds=10.0)


def _get_audio_duration(path: str) -> float:
    if not _FFPROBE or not os.path.exists(path):
        return 5.0
    try:
        result = subprocess.run(
            [_FFPROBE, "-v", "error", "-show_entries", "format=duration",
             "-of", "json", path],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        data = json.loads(result.stdout or "{}")
        return float(data.get("format", {}).get("duration") or 5.0)
    except Exception:
        return 5.0


def _build_subtitle_cues(script: str, total_duration: float) -> List[Dict]:
    """
    Split script into sentence-level subtitle cues distributed over the audio duration.
    Simple proportional approach: cue duration = sentence_words / total_words * total_duration
    """
    import re
    sentences = re.split(r"(?<=[.!?])\s+", script.strip())
    sentences = [s.strip() for s in sentences if s.strip()]
    if not sentences:
        return [{"start": 0.0, "end": total_duration, "text": script[:120]}]

    total_words = sum(len(s.split()) for s in sentences)
    if total_words == 0:
        total_words = 1

    cues = []
    cursor = 0.0
    for sent in sentences:
        word_ratio = len(sent.split()) / total_words
        duration = round(word_ratio * total_duration, 2)
        cues.append({
            "start": round(cursor, 2),
            "end": round(cursor + duration, 2),
            "text": sent,
        })
        cursor += duration

    return cues


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def run(slide_data: Dict[str, Any], tmp_dir: str) -> Dict[str, Any]:
    """
    W6: Voice Generator

    Synthesises EN + Hinglish TTS audio for each lecture segment.
    Adds `audio_en_path`, `audio_hi_path`, `duration_en`, `duration_hi`,
    `subtitles_en`, `subtitles_hi` to each lecture segment.
    """
    print("[W6] Voice Generator starting...")

    from fastapi.concurrency import run_in_threadpool

    enriched_segments: List[Dict] = slide_data.get("enriched_segments", [])

    for seg in enriched_segments:
        if seg.get("type") != "lecture":
            continue

        seg_id = seg.get("id", "unknown")
        script_en = seg.get("script_en", "")
        script_hi = seg.get("script_hi", script_en)

        if not script_en:
            print(f"[W6] Skipping {seg_id} — no script")
            continue

        en_chars = len(script_en)
        hi_chars = len(script_hi)
        seg["tts_en_chars"] = en_chars
        seg["tts_hi_chars"] = hi_chars
        seg["tts_en_cost_usd"] = round(en_chars * EN_TTS_COST_PER_CHAR, 6)
        seg["tts_hi_cost_usd"] = round(hi_chars * HI_TTS_COST_PER_CHAR, 6)
        seg["tts_total_cost_usd"] = round(seg["tts_en_cost_usd"] + seg["tts_hi_cost_usd"], 6)

        audio_en = os.path.join(tmp_dir, f"audio_en_{seg_id}.mp3")
        audio_hi = os.path.join(tmp_dir, f"audio_hi_{seg_id}.mp3")

        try:
            await run_in_threadpool(_synthesize, script_en, audio_en, "en")
            dur_en = await run_in_threadpool(_get_audio_duration, audio_en)
            seg["audio_en_path"] = audio_en
            seg["duration_en"] = dur_en
            seg["subtitles_en"] = _build_subtitle_cues(script_en, dur_en)
            print(f"[W6] EN audio: {seg_id} → {dur_en:.1f}s")
        except Exception as e:
            print(f"[W6] EN TTS failed for {seg_id}: {e}")
            seg["duration_en"] = 10.0
            seg["subtitles_en"] = [{"start": 0.0, "end": 10.0, "text": script_en[:100]}]

        try:
            await run_in_threadpool(_synthesize, script_hi, audio_hi, "hi")
            dur_hi = await run_in_threadpool(_get_audio_duration, audio_hi)
            seg["audio_hi_path"] = audio_hi
            seg["duration_hi"] = dur_hi
            seg["subtitles_hi"] = _build_subtitle_cues(script_hi, dur_hi)
            print(f"[W6] HI audio: {seg_id} → {dur_hi:.1f}s")
        except Exception as e:
            print(f"[W6] HI TTS failed for {seg_id}: {e}")
            seg["duration_hi"] = seg.get("duration_en", 10.0)
            seg["subtitles_hi"] = [{"start": 0.0, "end": seg["duration_hi"], "text": script_hi[:100]}]

        # Use max duration so both tracks stay in sync
        seg["duration"] = max(seg.get("duration_en", 10.0), seg.get("duration_hi", 10.0))

    print("[W6] Done: TTS audio generated for all lecture segments")
    return slide_data
