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
Pick the most relevant text directly from the module title and content to create slide bullets and slide text.

Return ONLY valid JSON:
{{
  "title": "...",
  "script_en": "Full natural spoken English narration (1-3 minutes). Conversational, engaging, avoids jargon unless explained.",
  "script_hi": "Same script in conversational Hinglish (Hindi-English mix, written in Latin script). Friendly tone.",
  "slide_bullets": ["Bullet 1", "Bullet 2", "Bullet 3"],
  "slide_text": "A short text excerpt from the module title or content for the slide visual.",
  "visual_prompt": "Describe a background image (no text, no human faces). E.g. modern office dashboard, abstract data flow",
  "avatar_cue": "explaining",
  "key_takeaway": "One sentence summary of the most important concept"
}}

TOPIC: {topic_title}
MODULE TITLE: {module_title}
MODULE CONTENT:
{module_content}

SEGMENT CONTENT:
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
    cleaned = (text or "").strip()
    if not cleaned:
        raise ValueError("No JSON in empty Gemini response")

    # Remove markdown code fences if present
    if cleaned.startswith("```"):
        fence_end = cleaned.find("```", 3)
        if fence_end != -1:
            cleaned = cleaned[cleaned.find("\n", 3) + 1 : fence_end].strip()

    # Find the first JSON object and keep the first balanced object only.
    first_open = cleaned.find("{")
    if first_open == -1:
        raise ValueError(f"No JSON in: {cleaned[:300]}")

    brace_count = 0
    end_index = -1
    for i in range(first_open, len(cleaned)):
        if cleaned[i] == "{":
            brace_count += 1
        elif cleaned[i] == "}":
            brace_count -= 1
            if brace_count == 0:
                end_index = i
                break

    if end_index == -1:
        raise ValueError(f"No complete JSON object found in: {cleaned[:300]}")

    json_text = cleaned[first_open : end_index + 1]
    try:
        return json.loads(json_text)
    except json.JSONDecodeError as exc:
        print(f"[W4] WARNING: Failed to decode Gemini JSON: {exc}")
        print(f"[W4] WARNING: Gemini raw response preview: {cleaned[:1000]}")
        raise


def _get_topic_for_segment(seg: Dict, topics: List[Dict]) -> Optional[Dict]:
    topic_id = seg.get("topic_id")
    if topic_id:
        for t in topics:
            if t.get("id") == topic_id:
                return t
    return topics[0] if topics else None


def _derive_slide_bullets(content: str, max_bullets: int = 4) -> List[str]:
    if not content or not content.strip():
        return []
    cleaned = re.sub(r"\s+", " ", content.replace("\n", " ")).strip()
    sentences = re.split(r"(?<=[.!?])\s+", cleaned)
    bullets: List[str] = []
    for sentence in sentences:
        text = sentence.strip()
        if not text:
            continue
        if len(text) > 120:
            text = text[:117].rstrip() + "..."
        bullets.append(text)
        if len(bullets) >= max_bullets:
            break
    return bullets


def _build_lecture_storyboard(seg: Dict, topics: List[Dict], model, module_title: str = "", module_content: str = "") -> Dict:
    topic = _get_topic_for_segment(seg, topics)
    content = topic.get("content_text", "") if topic else ""
    objectives = "; ".join(topic.get("objectives", [])) if topic else ""

    resp = model.generate_content(
        _LECTURE_PROMPT.format(
            topic_title=seg["title"],
            module_title=module_title,
            module_content=module_content[:3000],
            content=content[:3000],
            objectives=objectives,
        ),
        generation_config=genai.GenerationConfig(temperature=0.4, max_output_tokens=3000),
    )
    data = _extract_json(resp.text or "")
    slide_bullets = data.get("slide_bullets", []) or []
    if len(slide_bullets) < 3:
        fallback = _derive_slide_bullets(content, max_bullets=4)
        for bullet in fallback:
            if bullet not in slide_bullets:
                slide_bullets.append(bullet)
            if len(slide_bullets) >= 4:
                break

    slide_text = data.get("slide_text")
    if not slide_text:
        slide_text = content.strip().replace("\n", " ")[:240]

    script_en = data.get("script_en", "") or (
        f"Welcome to {seg.get('title', 'this topic')}. In this segment, we explore the key ideas from the module title and content, with clear examples and practical guidance."
    )
    script_hi = data.get("script_hi", "") or (
        f"{seg.get('title', 'Yeh topic')} par baat karte hain. Is section mein hum module ke mukhya points ko Hindi-English style mein samjhenge."
    )

    return {
        "script_en": script_en,
        "script_hi": script_hi,
        "slide_bullets": slide_bullets,
        "slide_text": slide_text,
        "visual_prompt": data.get("visual_prompt", "abstract professional background"),
        "avatar_cue": data.get("avatar_cue", "explaining"),
        "key_takeaway": data.get("key_takeaway", ""),
        "source_text": content,
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

    model = genai.GenerativeModel("gemini-2.5-flash")
    segments_outline: List[Dict] = design_data.get("segments_outline", [])
    topics: List[Dict] = design_data.get("topics", [])

    enriched_segments = []

    module_title = design_data.get("title", "")
    module_content = design_data.get("clean_text", "")
    module_images = design_data.get("module_images", [])

    for i, seg in enumerate(segments_outline):
        seg_type = seg.get("type", "lecture")
        print(f"[W4] Storyboarding segment {i+1}/{len(segments_outline)}: [{seg_type}] {seg.get('title')}")

        enriched = dict(seg)

        try:
            enriched["module_images"] = module_images
            if seg_type == "lecture":
                board = _build_lecture_storyboard(seg, topics, model, module_title=module_title, module_content=module_content)
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
