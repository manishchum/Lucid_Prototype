import sys

file_path = "/Users/monalikagoel/Desktop/lucid_new/Lucid_Prototype/Backend/analysis/background.py"
with open(file_path, "r") as f:
    lines = f.readlines()

start_idx = -1
for i, line in enumerate(lines):
    if line.startswith("def generate_task_insights"):
        start_idx = i
        break

end_idx = -1
for i in range(start_idx + 1, len(lines)):
    if lines[i].startswith("def run_ai_pipeline_bg"):
        end_idx = i - 1
        break

new_code = """from enum import Enum
from typing import List, Dict, Any
from pydantic import BaseModel, Field

class SubmissionType(str, Enum):
    TEXT = "text"
    AUDIO = "audio"
    VIDEO = "video"
    IMAGE = "image"
    MULTIPLE_CHOICE = "multiple_choice"

class TaskInsightsResponse(BaseModel):
    summary: str = Field(description="A brief executive summary of performance.")
    measurable_outcomes: List[str] = Field(default_factory=list)
    actions_taken: List[str] = Field(default_factory=list)
    unique_methods: List[str] = Field(default_factory=list)
    challenges: List[str] = Field(default_factory=list)
    learnings: List[str] = Field(default_factory=list)
    missing_information: List[str] = Field(default_factory=list)
    extraction_confidence: str = Field(default="high")

TYPE_CONFIGS = {
    SubmissionType.MULTIPLE_CHOICE: {
        "analysis_focus": \"\"\"
            - Knowledge demonstrated
            - Correct and Incorrect concepts
            - Learning gaps and Knowledge strengths
            - Revision recommendations
        \"\"\",
        "schema_mapping": \"\"\"
            - 'measurable_outcomes': List the correct concepts and knowledge strengths demonstrated.
            - 'challenges': List the incorrect concepts and identified learning gaps.
            - 'learnings': List the recommended revision topics and next steps.
            - 'missing_information': List specific knowledge areas that were completely absent or skipped.
            - 'actions_taken' & 'unique_methods': MUST be empty arrays [] as these do not apply to MCQs.
        \"\"\"
    },
    SubmissionType.AUDIO: {
        "analysis_focus": \"\"\"
            - Communication and Sales skills
            - Customer handling and Objections
            - Confidence and Business outcomes
        \"\"\",
        "schema_mapping": \"\"\"
            - 'measurable_outcomes': Business outcomes achieved or objections successfully overcome.
            - 'actions_taken': Specific conversational tactics or communication strategies used.
            - 'unique_methods': Unique sales skills or rapport-building techniques.
            - 'challenges': Customer objections faced or communication stumbles.
        \"\"\"
    },
    SubmissionType.IMAGE: {
        "analysis_focus": \"\"\"
            - Visual proof and Compliance
            - Required objects and Task completion
            - Missing evidence
        \"\"\",
        "schema_mapping": \"\"\"
            - 'measurable_outcomes': List compliant items and visual proof of task completion.
            - 'actions_taken': Actions clearly visible in the image.
            - 'missing_information': Required objects, safety gear, or compliance elements missing from the image.
            - 'unique_methods', 'learnings', 'challenges': Return empty arrays [] unless visually obvious.
        \"\"\"
    },
    SubmissionType.VIDEO: {
        "analysis_focus": \"\"\"
            - Communication and Visual behaviour
            - Task completion and Presentation
            - Customer interaction
        \"\"\",
        "schema_mapping": \"\"\"
            - 'measurable_outcomes': Task completion markers and interaction outcomes.
            - 'actions_taken': Physical actions and presentation behaviours demonstrated.
            - 'unique_methods': Exceptional presentation or interaction techniques.
            - 'challenges': Visible struggles, awkward interactions, or missed steps.
        \"\"\"
    },
    SubmissionType.TEXT: {
        "analysis_focus": \"\"\"
            - Writing clarity and Professionalism
            - Detail orientation and Key arguments
            - Task completion
        \"\"\",
        "schema_mapping": \"\"\"
            - 'measurable_outcomes': Key arguments made and task objectives met.
            - 'unique_methods': Unique problem-solving approaches described in the text.
            - 'challenges': Weak arguments or missing logical steps.
        \"\"\"
    }
}

def generate_task_insights(task_title: str, task_description: str, expected_answer: str | None, submission_type: str, submission_content: dict | str | list, evaluation_result: dict) -> dict:
    \"\"\"
    Generate business/task outcomes (insights) dynamically using Gemini structured outputs.
    \"\"\"
    api_key = os.getenv("GEMINI_API_KEY") or ""
    if not api_key:
        print("[AI Insights] GEMINI_API_KEY not found. Skipping insights.")
        return {
            "summary": "Task submission processed.",
            "measurable_outcomes": [],
            "actions_taken": [],
            "unique_methods": [],
            "challenges": [],
            "learnings": [],
            "missing_information": ["GEMINI_API_KEY not configured."],
            "extraction_confidence": "low"
        }

    client = genai.Client(api_key=api_key)

    content_str = ""
    stype = str(submission_type).lower()
    if stype == "text":
        content_str = f"Employee Text Response:\\n{submission_content}"
    elif stype == "audio":
        content_str = f"Employee Spoken Transcript:\\n{submission_content}"
    elif stype == "video":
        transcript = submission_content.get("transcript", "") if isinstance(submission_content, dict) else ""
        visual_summary = submission_content.get("visual_summary", "") if isinstance(submission_content, dict) else ""
        content_str = f"Employee Spoken Transcript:\\n{transcript}\\n\\nVideo Visual Summary:\\n{visual_summary}"
    elif stype == "image":
        if isinstance(submission_content, dict):
            detected_objects = submission_content.get("detected_objects", [])
            clip_similarity = submission_content.get("clip_similarity", 0.0)
            generated_description = submission_content.get("generated_description", "")
        else:
            detected_objects, clip_similarity, generated_description = [], 0.0, ""

        content_str = (
            f"Detected objects in image:\\n{detected_objects}\\n\\n"
            f"CLIP semantic similarity score: {clip_similarity}\\n\\n"
            f"Generated Description:\\n{generated_description}"
        )
    elif stype == "multiple_choice":
        content_str = "MCQ Quiz Question and Answer Results:\\n"
        if isinstance(submission_content, list):
            for idx, qa in enumerate(submission_content):
                if isinstance(qa, dict):
                    content_str += (
                        f"{idx + 1}. Question: {qa.get('question')}\\n"
                        f"   Employee Selected: {qa.get('selected_answer')}\\n"
                        f"   Correct Answer: {qa.get('correct_answer')}\\n"
                        f"   Is Correct: {qa.get('is_correct')}\\n"
                    )

    import json
    evaluation_summary = f\"\"\"
        AI Evaluation Results:
        Overall Score: {evaluation_result.get("overall_score", 0)}
        Strengths: {json.dumps(evaluation_result.get("strengths", []), indent=2)}
        Weaknesses: {json.dumps(evaluation_result.get("weaknesses", []), indent=2)}
        Detected Issues: {json.dumps(evaluation_result.get("detected_issues", []), indent=2)}
        Improvement Points: {json.dumps(evaluation_result.get("improvement_points", []), indent=2)}
        Metrics: {json.dumps(evaluation_result.get("metrics", {}), indent=2)}
    \"\"\"
    
    try:
        sub_enum = SubmissionType(stype)
    except ValueError:
        sub_enum = SubmissionType.TEXT
        
    config = TYPE_CONFIGS.get(sub_enum, TYPE_CONFIGS[SubmissionType.TEXT])

    prompt = f\"\"\"
    You are an AI task analyst and expert Enterprise AI Coaching Assistant.
    Your task is to extract BUSINESS outcomes and manager-ready coaching insights from the employee submission.
    Ignore AI quality metrics, CLIP scores, audio quality, and visual scores. Focus on employee performance.

    Task: {task_title}
    Description: {task_description}
    Expected Answer/Behavior: {expected_answer or "N/A"}
    Submission Type: {stype.upper()}

    ANALYSIS FOCUS:
    You must ONLY analyze the following criteria relevant to this submission type:
    {config['analysis_focus']}

    SCHEMA MAPPING INSTRUCTIONS:
    Map your findings into the JSON output according to these exact rules:
    {config['schema_mapping']}

    STRICT CONSTRAINTS:
    1. NEVER invent or hallucinate information.
    2. Metrics need exact evidence from the submission.
    3. If information for a field cannot be inferred, you MUST return an empty array [].
    4. Do NOT write "Missing", "Not applicable", or "None found" inside the array.

    SUBMISSION CONTENT:
    {content_str}

    {evaluation_summary}
    \"\"\"

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=TaskInsightsResponse,
                temperature=0.2
            )
        )

        if hasattr(response, 'usage_metadata') and response.usage_metadata:
            meta = response.usage_metadata
            print("\\n========== GEMINI TOKEN USAGE (analysis/background.py - generate_task_insights) ==========")
            print(f"  Input tokens:    {getattr(meta, 'prompt_token_count', 'N/A')}")
            print(f"  Output tokens:   {getattr(meta, 'candidates_token_count', 'N/A')}")
            print(f"  Thinking tokens: {getattr(meta, 'thoughts_token_count', 'N/A')}")
            print(f"  TOTAL tokens:    {getattr(meta, 'total_token_count', 'N/A')}")
            print("=========================================================================================\\n")

        text = response.text.strip()
        insights = json.loads(text)
        
        expected_keys = ["summary", "measurable_outcomes", "actions_taken", "unique_methods", "challenges", "learnings", "missing_information", "extraction_confidence"]
        for key in expected_keys:
            if key not in insights:
                if key in ["actions_taken", "unique_methods", "challenges", "learnings", "missing_information", "measurable_outcomes"]:
                    insights[key] = []
                elif key == "extraction_confidence":
                    insights[key] = "high"
                else:
                    insights[key] = ""
                    
        return insights
    except Exception as e:
        print(f"[AI Insights] Failed to generate/parse insights: {e}")
        return {
            "summary": "Task submission processed.",
            "measurable_outcomes": [],
            "actions_taken": [],
            "unique_methods": [],
            "challenges": [],
            "learnings": [],
            "missing_information": ["AI insights generation or parsing failed."],
            "extraction_confidence": "low"
        }

"""

with open(file_path, "w") as f:
    f.writelines(lines[:start_idx])
    f.write(new_code)
    f.writelines(lines[end_idx+1:])

print("Successfully updated file.")
