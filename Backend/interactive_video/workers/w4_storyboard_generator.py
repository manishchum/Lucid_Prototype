"""
Worker 4: Storyboard Generator
For each lecture/simulation segment, generates the full narration script (EN + Hinglish),
slide bullets, visual prompts, and avatar cues.
For each quiz gate segment, generates 3 MCQ questions with distractors.
"""
from __future__ import annotations
import json
import os
import re
from typing import Any, Dict, List, Optional

import google.generativeai as genai

genai.configure(api_key=os.getenv("GEMINI_API_KEY") or "")


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

_LECTURE_PROMPT = """
You are an expert enterprise e-learning scriptwriter.

Write a complete storyboard for ONE video segment on the topic below.

Return ONLY valid JSON:
{{
  "title": "...",
  "script_en": "Full natural spoken English narration (1-3 minutes). Conversational, engaging, avoids jargon unless explained.",
  "script_hi": "Same script in conversational Hinglish (Hindi-English mix, written in Latin script). Friendly tone.",
  "slide_bullets": ["Bullet 1", "Bullet 2", "Bullet 3"],
  "visual_prompt": "Describe a background image (no text, no human faces). E.g. modern office dashboard, abstract data flow",
  "avatar_cue": "explaining",
  "key_takeaway": "One sentence summary of the most important concept"
}}

TOPIC: {topic_title}
OBJECTIVES: {objectives}
CONTENT:
{content}
"""

_QUIZ_PROMPT = """
You are an expert enterprise training assessment designer.

Create 3 multiple-choice questions that test understanding of the lecture segment(s) below.

Rules:
- Each question must have exactly 4 options (A, B, C, D)
- Only one correct answer per question
- Distractors must be plausible (common misconceptions)
- Provide a clear explanation for the correct answer
- Questions should test application, not just recall

Return ONLY valid JSON:
{{
  "questions": [
    {{
      "id": "q1",
      "text": "...",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct": 0,
      "explanation": "...",
      "segment_ref": "{segment_ref}"
    }}
  ]
}}

LECTURE CONTENT BEING TESTED:
{lecture_content}
"""

_SIMULATION_PROMPT = """
You are an enterprise software training expert.

Based on the topic below, create a step-by-step software simulation (click-through walkthrough).

Return ONLY valid JSON:
{{
  "title": "Try It: {topic_title}",
  "steps": [
    {{
      "step_number": 1,
      "instruction": "What the user should click or do",
      "screen_description": "Describe the screen state (for placeholder image generation)",
      "highlight_text": "Optional: text to highlight on screen"
    }}
  ]
}}

TOPIC: {topic_title}
SIMULATION HINT: {sim_hint}
CONTENT:
{content}
"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_json(text: str) -> Dict:
    text = re.sub(r"```json|```", "", text).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError(f"No JSON in: {text[:300]}")
    return json.loads(text[start : end + 1])


def _get_topic_for_segment(seg: Dict, topics: List[Dict]) -> Optional[Dict]:
    topic_id = seg.get("topic_id")
    if topic_id:
        for t in topics:
            if t.get("id") == topic_id:
                return t
    return topics[0] if topics else None


def _build_lecture_storyboard(seg: Dict, topics: List[Dict], model) -> Dict:
    topic = _get_topic_for_segment(seg, topics)
    content = topic.get("content_text", "") if topic else ""
    objectives = "; ".join(topic.get("objectives", [])) if topic else ""

    resp = model.generate_content(
        _LECTURE_PROMPT.format(
            topic_title=seg["title"],
            objectives=objectives,
            content=content[:4000],
        ),
        generation_config=genai.GenerationConfig(temperature=0.4, max_output_tokens=3000),
    )
    data = _extract_json(resp.text or "")
    return {
        "script_en": data.get("script_en", ""),
        "script_hi": data.get("script_hi", ""),
        "slide_bullets": data.get("slide_bullets", []),
        "visual_prompt": data.get("visual_prompt", "abstract professional background"),
        "avatar_cue": data.get("avatar_cue", "explaining"),
        "key_takeaway": data.get("key_takeaway", ""),
    }


def _build_quiz_storyboard(seg: Dict, outline_segments: List[Dict], topics: List[Dict], model) -> Dict:
    tested_ids = seg.get("tests_segments", [])
    lecture_contents = []
    for sid in tested_ids:
        for s in outline_segments:
            if s.get("id") == sid and s.get("type") == "lecture":
                topic = _get_topic_for_segment(s, topics)
                if topic:
                    lecture_contents.append(
                        f"--- {s['title']} ---\n{topic.get('content_text', '')[:1500]}"
                    )
    combined = "\n\n".join(lecture_contents) or "General course content"
    seg_ref = tested_ids[0] if tested_ids else seg.get("id", "")

    resp = model.generate_content(
        _QUIZ_PROMPT.format(
            segment_ref=seg_ref,
            lecture_content=combined[:4000],
        ),
        generation_config=genai.GenerationConfig(temperature=0.3, max_output_tokens=2000),
    )
    data = _extract_json(resp.text or "")
    replay_id = tested_ids[0] if tested_ids else None
    return {
        "quiz_questions": data.get("questions", []),
        "replay_segment_id": replay_id,
        "pass_threshold": seg.get("pass_threshold", 0.8),
    }


def _build_simulation_storyboard(seg: Dict, topics: List[Dict], model) -> Dict:
    topic = _get_topic_for_segment(seg, topics)
    content = topic.get("content_text", "") if topic else ""
    sim_hint = seg.get("simulation_hint", "General software walkthrough")

    resp = model.generate_content(
        _SIMULATION_PROMPT.format(
            topic_title=seg["title"],
            sim_hint=sim_hint,
            content=content[:3000],
        ),
        generation_config=genai.GenerationConfig(temperature=0.2, max_output_tokens=2000),
    )
    data = _extract_json(resp.text or "")
    return {
        "simulation_title": data.get("title", f"Try It: {seg['title']}"),
        "simulation_steps": data.get("steps", []),
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def run(design_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    W4: Storyboard Generator

    Args:
        design_data: Output from W3 instructional designer.

    Returns:
        Enriched dict with per-segment storyboard data passed to W5.
    """
    print("[W4] Storyboard Generator starting...")

    model = genai.GenerativeModel("gemini-1.5-flash")
    segments_outline: List[Dict] = design_data.get("segments_outline", [])
    topics: List[Dict] = design_data.get("topics", [])

    enriched_segments = []

    for i, seg in enumerate(segments_outline):
        seg_type = seg.get("type", "lecture")
        print(f"[W4] Storyboarding segment {i+1}/{len(segments_outline)}: [{seg_type}] {seg.get('title')}")

        enriched = dict(seg)

        try:
            if seg_type == "lecture":
                board = _build_lecture_storyboard(seg, topics, model)
                enriched.update(board)
            elif seg_type == "quiz_gate":
                board = _build_quiz_storyboard(seg, segments_outline, topics, model)
                enriched.update(board)
            elif seg_type == "simulation":
                board = _build_simulation_storyboard(seg, topics, model)
                enriched.update(board)
        except Exception as e:
            print(f"[W4] WARNING: Storyboard failed for segment {seg.get('id')}: {e}")
            if seg_type == "lecture":
                enriched.update({
                    "script_en": f"Welcome to {seg.get('title', 'this section')}. Let's explore the key concepts.",
                    "script_hi": f"{seg.get('title', 'Is section')} mein aapka swagat hai. Aao milke key concepts samjhein.",
                    "slide_bullets": ["Key concept 1", "Key concept 2", "Key concept 3"],
                    "visual_prompt": "Modern professional office workspace with digital displays",
                    "avatar_cue": "explaining",
                })

        enriched_segments.append(enriched)

    result = {**design_data, "enriched_segments": enriched_segments}
    print(f"[W4] Done: {len(enriched_segments)} segments storyboarded")
    return result
