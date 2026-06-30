from __future__ import annotations

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
