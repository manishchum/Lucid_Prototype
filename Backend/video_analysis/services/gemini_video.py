import os
import json

from dotenv import load_dotenv

from google import genai
from google.genai import types


load_dotenv()


client = genai.Client(
    api_key=os.getenv(
        "GEMINI_API_KEY"
    )
)



def analyze_video_frames(
        frames,
        task_description
):


    prompt = f"""
You are an employee performance evaluator.

Analyze these video frames for the employee task.

Task:
{task_description}


IMPORTANT RULES:
- A person may appear in a small part of the frame.
- A person may appear along with slides, screen, product, or objects.
- If ANY human face/body/person is visible in ANY frame, person_visible MUST be true.
- Do NOT mark person_visible false just because slides or animations are present.
- Evaluate the visible employee only.


Return ONLY valid JSON:

{{
 "task_completed": true/false,

 "person_visible": true/false,

 "visual_score": 0-100,

 "eye_contact_score":0-100,

 "body_language_score":0-100,

 "professionalism_score":0-100,

 "engagement_score":0-100,


 "strengths":[
 ],

 "weaknesses":[
 ],

 "feedback":""
}}


Scoring:
- visual_score means how well the employee performed the task visually.
- eye_contact_score means looking towards camera/audience.
- body_language_score means posture, gestures, confidence.
- professionalism_score means appearance and presentation.
- engagement_score means energy and involvement.

If employee is visible:
Never return all visual scores as 0.
"""


    content = [
        prompt
    ]


    for frame in frames:

        content.append(

            types.Part.from_bytes(
                data=frame,
                mime_type="image/jpeg"
            )

        )



    response = client.models.generate_content(

        model="gemini-2.5-flash",

        contents=content

    )



    clean = (
        response.text
        .replace("```json","")
        .replace("```","")
        .strip()
    )


    return json.loads(clean)