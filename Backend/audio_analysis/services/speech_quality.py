from __future__ import annotations

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
