from __future__ import annotations

from typing import Any


def _score(value: Any, fallback: int = 0) -> int:
    try:
        return int(max(0, min(100, round(float(value)))))
    except Exception:
        return fallback


def generate_audio_score(
    gemini_result: dict[str, Any],
    acoustic_result: dict[str, Any],
    speech_result: dict[str, Any],
) -> dict[str, Any]:
    communication = _score(gemini_result.get("communication_score"), 70)
    clarity = _score(speech_result.get("clarity_score"), communication)
    pronunciation = _score(speech_result.get("pronunciation_score"), clarity)
    pace = _score(acoustic_result.get("pace_score"), 70)

    filler_words = gemini_result.get("filler_words") or []
    filler_penalty = min(20, len(filler_words) * 2) if isinstance(filler_words, list) else 0
    confidence = _score(communication - filler_penalty, communication)
    fluency = _score((communication * 0.45) + (pace * 0.35) + (clarity * 0.2), communication)
    overall = _score(
        (clarity * 0.18)
        + (confidence * 0.18)
        + (fluency * 0.2)
        + (pronunciation * 0.18)
        + (pace * 0.16)
        + (communication * 0.1),
        communication,
    )

    return {
        "transcript": gemini_result.get("transcript") or "",
        "scores": {
            "clarity": clarity,
            "confidence": confidence,
            "fluency": fluency,
            "pronunciation": pronunciation,
            "pace": pace,
            "overall": overall,
        },
        "audio_features": {
            "duration": acoustic_result.get("duration", 0),
            "silence_ratio": acoustic_result.get("silence_ratio", 0),
            "speaking_speed": acoustic_result.get("speaking_pace")
            or acoustic_result.get("pace_score", 0),
            "average_volume": acoustic_result.get("average_volume", 0),
            "pause_count": acoustic_result.get("pause_count", 0),
        },
        "tone": gemini_result.get("tone") or "not available",
        "filler_words": filler_words if isinstance(filler_words, list) else [],
        "strengths": gemini_result.get("strengths") or [],
        "weaknesses": gemini_result.get("weaknesses") or [],
        "feedback": gemini_result.get("feedback") or "",
        "improvement_suggestions": gemini_result.get("improvement_suggestions") or [],
    }



from typing import Any


def analyze_audio_features(audio_path: str) -> dict[str, Any]:
    """
    Extract lightweight acoustic features. Optional imports keep task submission
    working even when local ML/audio packages are not installed.
    """
    try:
        import librosa
        import numpy as np
    except Exception as exc:
        return {
            "duration": 0,
            "average_volume": 0,
            "energy": 0,
            "silence_ratio": 0,
            "pause_count": 0,
            "pace_score": 0,
            "error": f"audio feature dependencies unavailable: {exc}",
        }

    try:
        y, sr = librosa.load(audio_path, sr=None, mono=True)
        duration = float(librosa.get_duration(y=y, sr=sr))
        if duration <= 0 or y.size == 0:
            return {
                "duration": 0,
                "average_volume": 0,
                "energy": 0,
                "silence_ratio": 1,
                "pause_count": 0,
                "pace_score": 0,
            }

        rms = librosa.feature.rms(y=y)[0]
        average_volume = float(np.mean(rms)) if rms.size else 0.0
        energy = float(np.mean(y ** 2))
        threshold = max(average_volume * 0.45, 0.005)
        silent_frames = rms < threshold
        silence_ratio = float(np.mean(silent_frames)) if silent_frames.size else 0.0

        pause_count = 0
        in_pause = False
        frame_duration = 512 / float(sr)
        min_pause_frames = max(1, int(0.35 / frame_duration))
        current_pause_frames = 0
        for is_silent in silent_frames:
            if is_silent:
                current_pause_frames += 1
                if not in_pause and current_pause_frames >= min_pause_frames:
                    pause_count += 1
                    in_pause = True
            else:
                current_pause_frames = 0
                in_pause = False

        pause_rate = pause_count / max(duration / 60.0, 1.0)
        pace_score = int(max(0, min(100, 100 - abs(pause_rate - 6) * 8 - silence_ratio * 35)))

        return {
            "duration": round(duration, 2),
            "average_volume": round(average_volume, 4),
            "energy": round(energy, 6),
            "silence_ratio": round(silence_ratio, 3),
            "pause_count": int(pause_count),
            "pace_score": pace_score,
        }
    except Exception as exc:
        return {
            "duration": 0,
            "average_volume": 0,
            "energy": 0,
            "silence_ratio": 0,
            "pause_count": 0,
            "pace_score": 0,
            "error": str(exc),
        }

import os
import json
from dotenv import load_dotenv
from google import genai
from google.genai import types
import time
from .gemini_usage import extract_gemini_usage

load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")


def analyze_audio_with_gemini(
    audio_bytes: bytes,
    mime_type: str,
    prompt: str | None = None
):
    if not api_key:
        return {
            "transcript": "",
            "tone": "not available",
            "communication_score": 0,
            "filler_words": [],
            "strengths": [],
            "weaknesses": ["Gemini API key is not configured."],
            "feedback": "Audio was submitted, but AI audio analysis is not configured.",
            "improvement_suggestions": [],
        }

    client = genai.Client(api_key=api_key)
    analysis_prompt = prompt or (
        "You are an enterprise task communication evaluator. "
        "Transcribe the speech and analyze tone, professionalism, communication quality, "
        "sentence structure, language confidence, filler words, strengths, weaknesses, "
        "feedback, and improvement suggestions. Return STRICT JSON ONLY with keys: "
        "transcript, tone, communication_score, filler_words, strengths, weaknesses, "
        "feedback, improvement_suggestions. Scores must be 0-100."
    )

    start_time = time.time()
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=[
            types.Part.from_bytes(
                data=audio_bytes,
                mime_type=mime_type
            ),
            types.Part(text=analysis_prompt)
        ],
        config=types.GenerateContentConfig(
            temperature=0.2
        )
    )
    end_time = time.time()

    usage = extract_gemini_usage(response, "gemini-2.5-flash", start_time, end_time)
    print(f"\n========== GEMINI USAGE: audio.py (analyze_audio_with_gemini) ==========")
    print(f"Model: {usage['model']} | Duration: {usage['duration_ms']}ms")
    print(f"Tokens: Input {usage['prompt_tokens']} | Output {usage['output_tokens']} | Total {usage['total_tokens']}")
    if usage['pricing_available']:
        print(f"Cost: ${usage['total_cost_usd']} | INR ₹{usage['total_cost_inr']}")
    print("========================================================================\n")

    text = response.text

    try:
        parsed = json.loads(
            text.replace("```json", "")
                .replace("```", "")
                .strip()
        )
        return {
            "transcript": parsed.get("transcript", ""),
            "tone": parsed.get("tone", ""),
            "communication_score": int(parsed.get("communication_score", 0) or 0),
            "filler_words": parsed.get("filler_words") or [],
            "strengths": parsed.get("strengths") or [],
            "weaknesses": parsed.get("weaknesses") or [],
            "feedback": parsed.get("feedback", ""),
            "improvement_suggestions": parsed.get("improvement_suggestions") or [],
        }
    except Exception:
        return {
            "transcript": "",
            "tone": "",
            "communication_score": 0,
            "filler_words": [],
            "strengths": [],
            "weaknesses": ["Gemini response could not be parsed as JSON."],
            "feedback": text,
            "improvement_suggestions": [],
        }



from typing import Any


def analyze_speech_quality(audio_path: str) -> dict[str, Any]:
    """
    Estimate speech quality with Wav2Vec2 when available. The model is loaded
    lazily so normal task submission startup is not blocked by ML imports.
    """
    try:
        import torch
        import torchaudio
        from transformers import Wav2Vec2Model, Wav2Vec2Processor
    except Exception as exc:
        return {
            "clarity_score": 0,
            "pronunciation_score": 0,
            "error": f"speech quality dependencies unavailable: {exc}",
        }

    try:
        waveform, sample_rate = torchaudio.load(audio_path)
        if waveform.numel() == 0:
            return {"clarity_score": 0, "pronunciation_score": 0}

        if waveform.shape[0] > 1:
            waveform = waveform.mean(dim=0, keepdim=True)
        if sample_rate != 16000:
            waveform = torchaudio.transforms.Resample(sample_rate, 16000)(waveform)

        processor = Wav2Vec2Processor.from_pretrained("facebook/wav2vec2-base-960h")
        model = Wav2Vec2Model.from_pretrained("facebook/wav2vec2-base-960h")
        inputs = processor(
            waveform.squeeze().numpy(),
            sampling_rate=16000,
            return_tensors="pt",
            padding=True,
        )

        with torch.no_grad():
            outputs = model(**inputs)

        hidden = outputs.last_hidden_state
        variance = float(hidden.var().item())
        mean_abs = float(hidden.abs().mean().item())

        clarity_score = int(max(40, min(100, 70 + variance * 12)))
        pronunciation_score = int(max(40, min(100, 72 + mean_abs * 18)))

        return {
            "clarity_score": clarity_score,
            "pronunciation_score": pronunciation_score,
        }
    except Exception as exc:
        return {
            "clarity_score": 0,
            "pronunciation_score": 0,
            "error": str(exc),
        }

import os
from google import genai
from google.genai import types
from .models import whisper_pipeline, bge_model
from .text import cosine_similarity, extract_keywords



def transcribe_audio_whisper(audio_path: str) -> str:
    """
    Transcribe audio file using cached Whisper pipeline.
    """
    if not whisper_pipeline:
        print("[Audio Analyzer] Whisper pipeline not initialized")
        return ""
    
    try:
        res = whisper_pipeline(
              audio_path,
              generate_kwargs={
        "task": "transcribe",
        "language": "en",
    },
    return_timestamps=True,
)

        print("\n========== WHISPER OUTPUT ==========")
        print(res)
        print("====================================\n")
        return res.get("text", "").strip()
    except Exception as e:
        print("[Audio Analyzer] Whisper transcription failed:", e)
        return ""

def analyze_audio(audio_path: str, task_title: str, task_description: str, expected_answer: str | None) -> dict:
    """
    Silent audio submission analyzer.
    """
    if not os.path.exists(audio_path):
        return {
            "overall_score": 0,
            "metrics": {
                "transcript": "",
                "clarity": 0,
                "fluency": 0,
                "confidence": 0,
                "relevance_score": 0,
                "improvement_points": ["Audio file missing."]
            },
            "strengths": [],
            "weaknesses": ["Media file missing."],
            "detected_issues": ["Audio file not found on disk."],
            "improvement_points": ["Re-upload audio file."],
            "model_output": {}
        }

    # 1. Whisper Transcription
    transcript = transcribe_audio_whisper(audio_path)
    if not transcript.strip():
        return {
            "overall_score": 0,
            "metrics": {
                "transcript": "",
                "clarity": 0,
                "fluency": 0,
                "confidence": 0,
                "relevance_score": 0,
                "improvement_points": [
                    "Speech could not be transcribed."
                ]
            },
            "strengths": [],
            "weaknesses": [
                "Speech could not be recognized."
            ],
            "detected_issues": [
                "No speech detected or audio quality too poor."
            ],
            "improvement_points": [
                "Please speak clearly into the microphone."
            ],
            "model_output": {}
        }

    # 2. Acoustic features via Librosa
    acoustic_result = analyze_audio_features(audio_path)
    
    # 3. Speech quality via Wav2Vec2 (if available)
    speech_result = analyze_speech_quality(audio_path)

    # 4. Transcript Relevance using BGE
    sim = 0.0
    relevance_score = 0
    if transcript:
        comparison_text = expected_answer.strip() if (expected_answer and expected_answer.strip()) else f"{task_title}\n{task_description}".strip()
        try:
            emb_comp = bge_model.encode(comparison_text)
            emb_trans = bge_model.encode(transcript)
            sim = cosine_similarity(emb_comp, emb_trans)
            relevance_score = int(max(0, min(100, (sim - 0.4) / 0.6 * 100)))
        except Exception as e:
            print("[Audio Analyzer] BGE embedding failed:", e)
            relevance_score = 50
            sim = 0.5
            
    # Calculate clarity, fluency, confidence
    # Clarity score from Wav2Vec2 or fallback to silence ratio
    raw_clarity = speech_result.get("clarity_score", 0)
    if raw_clarity > 0:
        clarity = raw_clarity
    else:
        silence_ratio = acoustic_result.get("silence_ratio", 0.0)
        clarity = int(max(30, min(100, 100 - silence_ratio * 120)))
        
    # Fluency is based on pace score
    fluency = acoustic_result.get("pace_score", 50)
    
    # Confidence is average of pronunciation score and pace score
    raw_pron = speech_result.get("pronunciation_score", 0)
    if raw_pron > 0:
        confidence = int(raw_pron * 0.7 + relevance_score * 0.3)
    else:
        confidence = int(fluency * 0.6 + relevance_score * 0.4)

    # Overall score synthesis
    score = int(0.25 * clarity + 0.25 * fluency + 0.25 * confidence + 0.25 * relevance_score)
    score = max(0, min(100, score))

    # Evaluate issues and recommendations
    issues = []
    improvement_points = []
    strengths = []
    weaknesses = []

    # Pace checks
    pause_count = acoustic_result.get("pause_count", 0)
    duration = acoustic_result.get("duration", 0)
    if duration > 0:
        pause_rate = pause_count / max(duration / 60.0, 1.0)
        if pause_rate > 15:
            issues.append("Frequent long pauses detected during speech.")
            improvement_points.append("Try to maintain a more continuous flow and minimize long pauses.")
            weaknesses.append("High pause frequency.")
        elif pause_rate < 3:
            improvement_points.append("Incorporate brief pauses between ideas to pace your speaking.")

    if clarity < 65:
        issues.append("Low audio clarity or excessive background noise.")
        improvement_points.append("Speak directly into the microphone in a quiet room.")
        weaknesses.append("Poor voice clarity.")
    else:
        strengths.append("Clear vocal pronunciation and low background noise.")

    if relevance_score >= 70:
        strengths.append("Speech content strongly aligns with task parameters.")
    elif relevance_score < 45:
        weaknesses.append("Spoken topics are unrelated or missing key instructions.")
        improvement_points.append("Cover all required talking points and expected concepts.")

    if fluency >= 75:
        strengths.append("Consistent and steady speaking pace.")
    else:
        weaknesses.append("Irregular speaking pace.")

    if not strengths:
        strengths.append("Audio speech recorded and processed successfully.")

    return {
        "overall_score": score,
        "metrics": {
            "transcript": transcript,
            "clarity": clarity,
            "fluency": fluency,
            "confidence": confidence,
            "relevance_score": relevance_score,
            "improvement_points": improvement_points
        },
        "strengths": strengths,
        "weaknesses": weaknesses,
        "detected_issues": issues,
        "improvement_points": improvement_points,
        "model_output": {
            "whisper_transcript": transcript,
            "bge_relevance": round(float(sim), 4),
            "acoustic_features": acoustic_result,
            "speech_quality": speech_result
        }
    }

