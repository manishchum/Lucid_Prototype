from video_analysis.services.audio_extractor import extract_audio

from audio_analysis.services.gemini_audio import analyze_audio_with_gemini


# 1. Extract audio from video
audio_path = extract_audio(
    "sample.mp4"
)


print(
    "Extracted:",
    audio_path
)


# 2. Read wav bytes
with open(audio_path, "rb") as f:

    audio_bytes = f.read()


# 3. Send to existing Gemini audio analyzer
result = analyze_audio_with_gemini(
    audio_bytes,
    "audio/wav"
)


print(result)