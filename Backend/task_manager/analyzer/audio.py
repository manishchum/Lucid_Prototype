from __future__ import annotations

import os
import json
import inspect
import asyncio
import concurrent.futures
from typing import Any

from ai.ai_gateway import AI
from ai.types import AIRequest
from .models import get_whisper_pipeline, get_bge_model
from .text import cosine_similarity, extract_keywords


def _run_coroutine(coro):
    """
    Safely executes an async coroutine from either a synchronous thread,
    within an active asyncio event loop, or in sandbox environments.
    """
    if not inspect.iscoroutine(coro):
        return coro

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(asyncio.run, coro).result()

    try:
        return asyncio.run(coro)
    except Exception:
        try:
            coro.send(None)
        except StopIteration as e:
            return e.value
        raise


def _parse_json_response(raw_text: Any) -> dict:
    """
    Standardize JSON extraction from AI responses (handles raw text, markdown blocks, and embedded objects).
    """
    if isinstance(raw_text, dict):
        return raw_text
    if not raw_text or not isinstance(raw_text, str):
        return {}

    text = raw_text.strip()
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()

    try:
        return json.loads(text)
    except Exception:
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(text[start:end + 1])
            except Exception:
                pass
    return {}


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
            "pace_score": 50,
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
                "pace_score": 50,
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
            "pace_score": 50,
            "error": str(exc),
        }


def analyze_audio_with_gemini(
    audio_bytes: bytes,
    mime_type: str,
    prompt: str | None = None,
    company_id: str | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    """
    Evaluate speech audio communication using the centralized AI Gateway
    with feature 'task_evaluation_audio' and prompt_type 'communication'.
    Extracts transcript, tone, communication score, filler words, strengths,
    weaknesses, feedback, and improvement suggestions.
    """
    try:
        request = AIRequest(
            feature="task_evaluation_audio",
            company_id=company_id or "system",
            user_id=user_id or "system",
            route="/api/task-manager/analyzer/audio",
            variables={},
            prompt_type="communication",
            system_prompt=prompt,
            files=[{"mime_type": mime_type, "data": audio_bytes}],
            response_format="json",
            generation_config={"temperature": 0.2},
        )
        ai_resp = _run_coroutine(AI.execute(request))
        raw_content = getattr(ai_resp, "content", None) or ""
        parsed = _parse_json_response(raw_content)

        if parsed:
            filler_words = parsed.get("filler_words")
            if not isinstance(filler_words, list):
                filler_words = []

            strengths = parsed.get("strengths")
            if not isinstance(strengths, list):
                strengths = []

            weaknesses = parsed.get("weaknesses")
            if not isinstance(weaknesses, list):
                weaknesses = []

            improvement_suggestions = parsed.get("improvement_suggestions")
            if not isinstance(improvement_suggestions, list):
                improvement_suggestions = []

            return {
                "transcript": str(parsed.get("transcript") or ""),
                "tone": str(parsed.get("tone") or "not available"),
                "communication_score": _score(parsed.get("communication_score"), 0),
                "filler_words": filler_words,
                "strengths": strengths,
                "weaknesses": weaknesses,
                "feedback": str(parsed.get("feedback") or ""),
                "improvement_suggestions": improvement_suggestions,
            }
        else:
            return {
                "transcript": "",
                "tone": "not available",
                "communication_score": 0,
                "filler_words": [],
                "strengths": [],
                "weaknesses": ["AI audio response could not be parsed as JSON."],
                "feedback": str(raw_content) if raw_content else "Audio analysis could not be completed.",
                "improvement_suggestions": [],
            }
    except Exception as e:
        print(f"[Audio Analyzer] analyze_audio_with_gemini failed: {e}")
        return {
            "transcript": "",
            "tone": "not available",
            "communication_score": 0,
            "filler_words": [],
            "strengths": [],
            "weaknesses": [f"AI audio evaluation error: {e}"],
            "feedback": "Audio analysis could not be completed.",
            "improvement_suggestions": [],
        }


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


def transcribe_audio_whisper(audio_path: str) -> str:
    """
    Transcribe audio file using cached Whisper pipeline.
    """
    whisper_pipeline = get_whisper_pipeline()
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


def evaluate_audio_task_compliance(
    transcript: str,
    task_title: str,
    task_description: str,
    analyzing_parameters: str | None = None,
    expected_answer: str | None = None,
    company_id: str | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    """
    Uses the centralized AI Gateway with feature 'task_evaluation_audio' and prompt_type 'compliance'
    to evaluate whether the transcript satisfies the actual task requirements.
    """
    try:
        variables = {
            "task_title": task_title or "Untitled Task",
            "task_description": task_description or "No task description provided.",
            "analyzing_parameters": analyzing_parameters or "No additional parameters provided.",
            "expected_answer": expected_answer or "No expected answer provided.",
            "transcript": transcript or "No transcript available.",
        }

        request = AIRequest(
            feature="task_evaluation_audio",
            company_id=company_id or "system",
            user_id=user_id or "system",
            route="/api/task-manager/analyzer/audio",
            variables=variables,
            prompt_type="compliance",
            response_format="json",
            generation_config={
                "temperature": 0.2,
                "thinking_config": {"thinking_budget": 0},
            },
        )
        ai_resp = _run_coroutine(AI.execute(request))
        raw_content = getattr(ai_resp, "content", None) or ""
        parsed = _parse_json_response(raw_content)

        if parsed:
            score = _score(parsed.get("score"), 50)
            passed = bool(parsed.get("passed", False))
            criteria = parsed.get("criteria", [])
            if not isinstance(criteria, list):
                criteria = []
            feedback = str(parsed.get("feedback") or "Task compliance evaluated.")
            return {
                "score": score,
                "passed": passed,
                "criteria": criteria,
                "feedback": feedback,
            }
    except Exception as e:
        print(f"[Audio Analyzer] Task compliance evaluation failed: {e}")

    return {
        "score": 50,
        "passed": False,
        "feedback": "Task compliance evaluation unavailable.",
        "criteria": [],
    }


evaluate_task_compliance_with_gemini = evaluate_audio_task_compliance


def analyze_audio(
    audio_path: str,
    task_title: str,
    task_description: str,
    expected_answer: str | None,
    analyzing_parameters: str | None = None,
    company_id: str | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
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
                "improvement_points": ["Audio file missing."],
            },
            "strengths": [],
            "weaknesses": ["Media file missing."],
            "detected_issues": ["Audio file not found on disk."],
            "improvement_points": ["Re-upload audio file."],
            "model_output": {},
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
                ],
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
            "model_output": {},
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
        bge_model = get_bge_model()
        if bge_model:
            try:
                emb_comp = bge_model.encode(comparison_text)
                emb_trans = bge_model.encode(transcript)
                sim = cosine_similarity(emb_comp, emb_trans)
                relevance_score = int(max(0, min(100, (sim - 0.4) / 0.6 * 100)))
            except Exception as e:
                print("[Audio Analyzer] BGE embedding failed:", e)
                relevance_score = 50
                sim = 0.5
        else:
            relevance_score = 50
            sim = 0.5

    # 5. Task compliance using AI Gateway
    task_compliance = evaluate_audio_task_compliance(
        transcript=transcript,
        task_title=task_title,
        task_description=task_description,
        analyzing_parameters=analyzing_parameters,
        expected_answer=expected_answer,
        company_id=company_id,
        user_id=user_id,
    )

    criteria = task_compliance.get("criteria", [])

    if criteria:
        satisfied_count = sum(
            1
            for criterion in criteria
            if criterion.get("satisfied") is True
        )
        task_compliance_score = int(
            (satisfied_count / len(criteria)) * 100
        )
    else:
        task_compliance_score = int(
            max(0, min(100, task_compliance.get("score", 50)))
        )

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
    score = int(
        0.20 * clarity
        + 0.15 * fluency
        + 0.15 * confidence
        + 0.15 * relevance_score
        + 0.35 * task_compliance_score
    )
    print("\n========== AUDIO ANALYZER DEBUG ==========")
    print("Clarity:", clarity)
    print("Fluency:", fluency)
    print("Confidence:", confidence)
    print("Relevance:", relevance_score)
    print("Task compliance:", task_compliance_score)
    print("Task compliance details:", task_compliance)
    print("BGE similarity:", sim)
    print("Final score:", score)
    print("Analyzing parameters:", analyzing_parameters)
    print("Expected answer:", expected_answer)
    print("==========================================\n")

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
            "improvement_points": improvement_points,
        },
        "strengths": strengths,
        "weaknesses": weaknesses,
        "detected_issues": issues,
        "improvement_points": improvement_points,
        "model_output": {
            "whisper_transcript": transcript,
            "bge_relevance": round(float(sim), 4),
            "acoustic_features": acoustic_result,
            "speech_quality": speech_result,
        },
    }
