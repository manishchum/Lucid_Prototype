"""
Worker 3: Instructional Designer
Produces the full course outline — ordered segments (lectures, quiz gates, simulations)
with durations and placement rationale.
"""
from __future__ import annotations
import json
import os
import re
import uuid
from typing import Any, Dict, List

import google.generativeai as genai

genai.configure(api_key=os.getenv("GEMINI_API_KEY") or "")


_PROMPT = """
You are a world-class instructional designer specializing in enterprise e-learning (SAP, ERP, SOP training).

Given the topic analysis below, produce a FINAL COURSE OUTLINE as an ordered list of segments.

Each segment must have a type:
- "lecture"      → avatar-led video with slide bullets
- "quiz_gate"    → knowledge check quiz (placed after 2-3 lectures)
- "simulation"   → click-through software simulation (only if topic has needs_simulation=true)

Quiz gates must reference the lecture segments they test.
Every quiz gate must have 3 questions.

Return ONLY valid JSON:
{{
  "course_title": "...",
  "segments": [
    {{
      "id": "seg_001",
      "order": 1,
      "type": "lecture",
      "title": "...",
      "topic_id": "t1",
      "estimated_duration_seconds": 90,
      "avatar_cue": "explaining"
    }},
    {{
      "id": "seg_002",
      "order": 2,
      "type": "simulation",
      "title": "Try It: ...",
      "topic_id": "t1",
      "estimated_duration_seconds": 60,
      "simulation_hint": "Show user clicking through VA01 transaction"
    }},
    {{
      "id": "seg_003",
      "order": 3,
      "type": "quiz_gate",
      "title": "Knowledge Check",
      "tests_segments": ["seg_001"],
      "estimated_duration_seconds": 120,
      "pass_threshold": 0.8
    }}
  ]
}}

TOPIC ANALYSIS:
{topic_summary}
"""


def _extract_json(text: str) -> Dict:
    text = re.sub(r"```json|```", "", text).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("No JSON object found in Gemini response")
    return json.loads(text[start : end + 1])


def _build_topic_summary(topics_data: Dict) -> str:
    lines = [f"Course Title: {topics_data.get('course_title', 'Training Course')}"]
    for t in topics_data.get("topics", []):
        needs_sim = t.get("needs_simulation", False)
        sim_hint = t.get("simulation_hint", "")
        obj_str = "; ".join(t.get("objectives", []))
        lines.append(
            f"\nTopic [{t['id']}]: {t['title']}\n"
            f"  Objectives: {obj_str}\n"
            f"  Needs Simulation: {needs_sim}\n"
            f"  Simulation Hint: {sim_hint}"
        )
    lines.append(
        f"\nQuiz gates should appear after topics: "
        f"{topics_data.get('quiz_after_topics', [])}"
    )
    return "\n".join(lines)


def run(topics_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    W3: Instructional Designer

    Args:
        topics_data: Output from W2 topic extractor.

    Returns:
        Enriched dict with ordered segments outline passed to W4.
    """
    print("[W3] Instructional Designer starting...")

    topic_summary = _build_topic_summary(topics_data)

    model = genai.GenerativeModel("gemini-1.5-flash")
    response = model.generate_content(
        _PROMPT.format(topic_summary=topic_summary),
        generation_config=genai.GenerationConfig(
            temperature=0.1,
            max_output_tokens=4096,
        ),
    )

    raw = response.text or ""
    outline = _extract_json(raw)

    segments_outline: List[Dict] = outline.get("segments", [])

    # Ensure unique IDs and sequential order
    for i, seg in enumerate(segments_outline):
        if not seg.get("id"):
            seg["id"] = f"seg_{uuid.uuid4().hex[:6]}"
        seg["order"] = i + 1

    quiz_count = sum(1 for s in segments_outline if s["type"] == "quiz_gate")
    lecture_count = sum(1 for s in segments_outline if s["type"] == "lecture")
    sim_count = sum(1 for s in segments_outline if s["type"] == "simulation")

    result = {
        **topics_data,
        "course_title": outline.get("course_title", topics_data.get("course_title")),
        "segments_outline": segments_outline,
    }

    print(
        f"[W3] Done: {lecture_count} lectures, "
        f"{quiz_count} quiz gates, {sim_count} simulations — "
        f"{len(segments_outline)} segments total"
    )
    return result
