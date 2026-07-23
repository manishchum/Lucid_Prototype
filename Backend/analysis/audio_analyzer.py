import os
from google import genai
from google.genai import types
from analysis.models import whisper_pipeline, bge_model
from analysis.text_analyzer import cosine_similarity, extract_keywords
from audio_analysis.services.acoustic_analysis import analyze_audio_features
from audio_analysis.services.speech_quality import analyze_speech_quality

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
