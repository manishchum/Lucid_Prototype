from audio_analysis.services.gemini_audio import analyze_audio_with_gemini


with open("sample.mp3", "rb") as f:
    audio = f.read()


prompt = prompt = """
You are an expert speech and communication evaluator.

Analyze the uploaded AUDIO.

Return ONLY JSON.

Rules:
- Scores must be integers from 0 to 100
- Do not answer the speaker
- Evaluate only communication quality

Schema:

{
 "transcript":"",
 "clarity_score":0,
 "confidence_score":0,
 "fluency_score":0,
 "pronunciation_score":0,
 "pace_score":0,

 "tone":"",
 "speaking_speed":"",
 "filler_words":[],

 "strengths":[],
 "weaknesses":[],

 "feedback":"",
 "improvement_suggestions":[]
}
"""


result = analyze_audio_with_gemini(
    audio,
    "audio/mpeg",
    prompt
)


print(result)