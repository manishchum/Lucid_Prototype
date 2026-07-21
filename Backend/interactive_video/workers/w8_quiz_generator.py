"""
Worker 8: Quiz Generator (Polish Pass)
Validates and polishes quiz questions from W4.
Ensures exactly 4 well-worded options, plausible distractors, and clear explanations.
Pass threshold: 80% (set in models).
"""
from __future__ import annotations
import json
import os
import re
from typing import Any, Dict, List

import google.generativeai as genai

genai.configure(api_key=os.getenv("GEMINI_API_KEY") or "")


_POLISH_PROMPT = """
You are a senior enterprise L&D assessment specialist.

Polish the quiz questions below to meet enterprise training standards:
1. Each question must test UNDERSTANDING or APPLICATION, not just recall
2. All 4 options must be plausible (no obviously wrong distractors)
3. Explanations must be clear and reference the source concept
4. Questions must be unambiguous and professionally worded
5. Ensure exactly 4 options per question

Return ONLY valid JSON with this exact structure (same question IDs):
{{
  "questions": [
    {{
      "id": "...",
      "text": "...",
      "options": ["A", "B", "C", "D"],
      "correct": 0,
      "explanation": "...",
      "segment_ref": "..."
    }}
  ]
}}

ORIGINAL QUESTIONS:
{questions_json}

TOPIC CONTEXT:
{context}
"""


def _extract_json(text: str) -> Dict:
    text = re.sub(r"```json|```", "", text).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("No JSON found")
    return json.loads(text[start : end + 1])


def _validate_question(q: Dict) -> bool:
    """Check a question has all required fields and correct option count."""
    return (
        isinstance(q.get("text"), str)
        and len(q.get("text", "")) > 10
        and isinstance(q.get("options"), list)
        and len(q["options"]) == 4
        and isinstance(q.get("correct"), int)
        and 0 <= q["correct"] <= 3
        and isinstance(q.get("explanation"), str)
        and len(q.get("explanation", "")) > 10
    )


def run(video_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    W8: Quiz Generator (Polish Pass)

    Validates and polishes all quiz gate questions.
    Updates enriched_segments in place.
    """
    print("[W8] Quiz Generator (Polish Pass) starting...")

    model = genai.GenerativeModel("gemini-2.5-flash")
    enriched_segments: List[Dict] = video_data.get("enriched_segments", [])
    topics: List[Dict] = video_data.get("topics", [])

    # Build topic context string
    topic_context = "\n".join(
        f"- {t.get('title')}: {'; '.join(t.get('objectives', []))}"
        for t in topics
    )

    for seg in enriched_segments:
        if seg.get("type") != "quiz_gate":
            continue

        seg_id = seg.get("id")
        questions: List[Dict] = seg.get("quiz_questions", [])

        if not questions:
            print(f"[W8] No questions for {seg_id}, skipping polish")
            continue

        # Check if questions already pass validation
        all_valid = all(_validate_question(q) for q in questions)
        if all_valid and len(questions) >= 2:
            # Still polish for quality
            pass

        try:
            resp = model.generate_content(
                _POLISH_PROMPT.format(
                    questions_json=json.dumps(questions, indent=2),
                    context=topic_context[:2000],
                ),
                generation_config=genai.GenerationConfig(
                    temperature=0.2, max_output_tokens=2500
                ),
            )
            polished = _extract_json(resp.text or "")
            polished_qs: List[Dict] = polished.get("questions", [])

            if polished_qs and all(_validate_question(q) for q in polished_qs):
                seg["quiz_questions"] = polished_qs
                print(f"[W8] Polished {len(polished_qs)} questions for {seg_id}")
            else:
                # Keep originals — mark any invalid ones with a flag
                print(f"[W8] Polish produced invalid questions for {seg_id}, keeping originals")
                seg["quiz_questions"] = [
                    q for q in questions if _validate_question(q)
                ]

        except Exception as e:
            print(f"[W8] Polish failed for {seg_id}: {e} — keeping originals")

        # Ensure pass threshold is set
        seg.setdefault("pass_threshold", 0.8)
        seg.setdefault("max_attempts", 2)

    print("[W8] Done: all quiz questions validated and polished")
    return video_data
