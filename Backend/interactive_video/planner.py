from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Any, Dict, List, Optional

from ai.ai_gateway import AI
from ai.types import AIRequest
from interactive_video.models import (
    CourseManifest,
    Segment,
    ParsedDocumentContext,
)

logger = logging.getLogger("interactive_video.planner")

# ---------------------------------------------------------------------------
# Feature constants
# ---------------------------------------------------------------------------

FEATURE_KEY = "interactive_video_planner"
ROUTE = "/api/interactive-video"

# Maximum characters of module content sent to the model.
# Keeps the request inside a safe token budget (~6 k tokens of input).
MAX_CONTENT_CHARS = 14_000

# ---------------------------------------------------------------------------
# Fallback prompt
# ---------------------------------------------------------------------------
# Used ONLY when the ai_prompts table has no row for this feature yet.
# Once you insert the production prompt into the DB this constant is ignored.

_FALLBACK_PROMPT = """
You are an expert enterprise video course producer.

Given the training module below, generate a complete, high-quality
video course plan in a SINGLE JSON response. Focus on polished video delivery:
clear narration, impactful slide bullets, key takeaways, and visual background prompts.

Module title  : {module_title}
Est. duration : {estimated_duration_minutes} minutes
Headings      : {headings_summary}
Images found  : {image_captions}

MODULE CONTENT:
{module_content}

Return ONLY valid JSON with no markdown fences.

{{
  "course_title": "...",
  "description": "One sentence course description.",
  "estimated_duration_minutes": 4,
  "segments": [
    {{
      "id": "seg_001",
      "type": "lecture",
      "order": 1,
      "title": "Segment title",
      "slide_bullets": ["Bullet 1", "Bullet 2", "Bullet 3", "Bullet 4"],
      "key_takeaway": "One sentence takeaway.",
      "visual_prompt": "Describe relevant visual background, motion graphic, or diagram. No text in image.",
      "script_en": "Full spoken English narration (45-60 seconds, ~105-140 words). Thorough, conversational, engaging, with real-world enterprise context.",
      "script_hi": "Same script in conversational Hinglish (Hindi-English mix, Latin script, ~105-140 words). Friendly, professional tone."
    }}
  ]
}}

RULES:
- Total video duration MUST be between 3.0 and 5.0 minutes (180 to 300 seconds).
- Produce 4 to 6 sequential video segments based on natural topic boundaries.
- Every segment is a pure video segment with slide content and spoken voiceover narration.
- Each segment's narration MUST be between 45 and 60 seconds (~105-140 words in script_en and script_hi).
- DO NOT generate any quizzes, quiz gates, or interactive questions.
- DO NOT include any "avatar_cue" field anywhere.
- slide_bullets: 3-5 concise bullet points per segment.
- All ids must be unique strings (e.g. seg_001, seg_002).
- Return ONLY the JSON object. No preamble, no markdown, no trailing text.
""".strip()


# ---------------------------------------------------------------------------
# JSON repair & extraction helpers
# ---------------------------------------------------------------------------

def _strip_fences(text: str) -> str:
    """Remove markdown code fences (```json ... ```)."""
    text = text.strip()
    fence_re = re.compile(r"^```[a-z]*\n?(.*?)```\s*$", re.DOTALL)
    m = fence_re.match(text)
    if m:
        return m.group(1).strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    return text.strip()


def _balance_extract(text: str) -> str:
    """
    Walk the string character-by-character and return the first
    complete, balanced JSON object (brace-balanced).
    Handles nested objects and arrays robustly.
    """
    start = text.find("{")
    if start == -1:
        raise ValueError("No JSON object found in model output")

    depth = 0
    in_string = False
    escape_next = False

    for i in range(start, len(text)):
        ch = text[i]

        if escape_next:
            escape_next = False
            continue

        if ch == "\\" and in_string:
            escape_next = True
            continue

        if ch == '"':
            in_string = not in_string
            continue

        if in_string:
            continue

        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]

    raise ValueError("Unbalanced JSON braces in model output")


def _try_repair_json(raw: str) -> Dict:
    """
    Attempt progressive repairs on malformed JSON:
    1. Remove trailing commas before ] or }
    2. Replace single-quoted strings
    3. Strip control characters
    """
    repaired = re.sub(r",\s*([}\]])", r"\1", raw)
    repaired = re.sub(r"(?<!\w)'([^']*)'(?=\s*:)", r'"\1"', repaired)
    repaired = re.sub(r":\s*'([^']*)'", r': "\1"', repaired)
    repaired = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", repaired)
    return json.loads(repaired)


def _parse_model_output(raw: str) -> Dict:
    """
    Robust JSON extraction pipeline:
      1. Strip markdown fences
      2. Balance-extract the first complete object
      3. json.loads
      4. If that fails, try _try_repair_json
      5. Raise with useful debug context on total failure
    """
    cleaned = _strip_fences(raw or "")
    if not cleaned:
        raise ValueError("Model returned an empty response")

    try:
        candidate = _balance_extract(cleaned)
    except ValueError:
        candidate = cleaned

    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        pass

    try:
        return _try_repair_json(candidate)
    except Exception:
        pass

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as exc:
        preview = cleaned[:500]
        raise ValueError(
            f"Could not parse model output as JSON. "
            f"JSONDecodeError: {exc}. "
            f"Preview: {preview!r}"
        )


# ---------------------------------------------------------------------------
# Schema assembly helpers
# ---------------------------------------------------------------------------

def _safe_str(val: Any, default: str = "") -> str:
    return str(val).strip() if val else default


def _safe_list(val: Any, default: Optional[List] = None) -> List:
    if isinstance(val, list):
        return val
    return default or []

def _assemble_segments(raw_segments: List[Dict]) -> List[Segment]:
    """
    Convert raw segment dicts from the model into video Segment Pydantic models.
    Filters out any quiz gates or non-lecture elements.
    Every segment is a pure video segment with slides, bullets, and narration scripts.
    """
    segments: List[Segment] = []

    for raw in raw_segments:
        if not isinstance(raw, dict):
            continue

        seg_type = _safe_str(raw.get("type"), "lecture").lower()
        # Discard any quiz gate segments
        if seg_type == "quiz_gate":
            continue

        seg_id = _safe_str(
            raw.get("id") or raw.get("segment_id"),
            f"seg_{uuid.uuid4().hex[:8]}"
        )
        title = _safe_str(raw.get("title"), f"Segment {len(segments) + 1}")

        # Strip avatar_cue if present
        raw.pop("avatar_cue", None)

        seg = Segment(
            id=seg_id,
            title=title,
            type="lecture",
            order=len(segments),
            script_en=_safe_str(raw.get("script_en")) or None,
            script_hi=_safe_str(raw.get("script_hi")) or None,
            slide_bullets=_safe_list(raw.get("slide_bullets"), []),
            key_takeaway=_safe_str(raw.get("key_takeaway")) or None,
            visual_prompt=_safe_str(raw.get("visual_prompt")) or None,
            quiz=None,
        )
        segments.append(seg)

    return segments


# ---------------------------------------------------------------------------
# Fallback course manifest
# ---------------------------------------------------------------------------

def _build_fallback_manifest(ctx: ParsedDocumentContext) -> CourseManifest:
    """
    Returns a minimal valid CourseManifest when the AI Gateway call fails.
    Splits the module content into ~3 equal lecture segments.
    """
    logger.warning("[Planner] Building fallback CourseManifest from content chunks.")

    paragraphs = [p.strip() for p in ctx.clean_content.split("\n\n") if p.strip()]
    chunk_size = max(1, len(paragraphs) // 4)
    headings = ctx.headings or [ctx.module_title]

    segments: List[Segment] = []
    num_segs = max(4, min(6, len(headings)))
    for i in range(num_segs):
        start = i * chunk_size
        seg_title = headings[i] if i < len(headings) else f"Topic {i + 1}"
        segments.append(
            Segment(
                id=f"seg_{uuid.uuid4().hex[:8]}",
                title=seg_title,
                type="lecture",
                order=i,
                script_en=(
                    f"Welcome to this comprehensive overview of {seg_title}. "
                    "In this section, we examine key foundational principles, operational methodologies, "
                    "and practical workflows necessary for driving measurable business results. "
                    "By understanding the relationship between primary and secondary drivers, teams can improve "
                    "forecasting accuracy, minimize stockouts, and streamline distribution across all regional territories. "
                    "Pay close attention to how these concepts align with enterprise performance targets and execution."
                ),
                script_hi=(
                    f"{seg_title} ke is important session mein aapka swagat hai. "
                    "Is section mein hum core operational methodologies aur workflow principles ko detail mein samjhenge. "
                    "Jab aap primary aur secondary demand drivers ko accurately align karte hain, tab business distribution "
                    "aur inventory management kaafi efficient ho jaati hai. Stockouts ko reduce karne aur timely deliveries "
                    "ensure karne ke liye in standard guidelines ko follow karna behad zaroori hai."
                ),
                slide_bullets=[
                    f"Core principles and framework for {seg_title}",
                    "Operational alignment between primary and secondary drivers",
                    "Minimizing stockouts and optimizing inventory distribution",
                    "Enterprise best practices for measurable business impact",
                ],
                key_takeaway=f"Mastering {seg_title} ensures consistent execution and operational excellence.",
                visual_prompt=(
                    f"Educational illustration for the topic '{seg_title}'. "
                    "No text, no logos, clean professional style."
                ),
            )
        )

    return CourseManifest(
        processed_module_id=ctx.processed_module_id,
        title=ctx.module_title,
        description=f"An interactive course on {ctx.module_title}.",
        segments=segments,
        total_segments=len(segments),
        quiz_gates=0,
        estimated_duration_minutes=4,
    )


# ---------------------------------------------------------------------------
# Input preparation helpers
# ---------------------------------------------------------------------------

def _build_image_captions_summary(ctx: ParsedDocumentContext) -> str:
    if not ctx.images:
        return "None"
    lines = []
    for img in ctx.images[:10]:
        caption = img.caption or img.surrounding_text or ""
        if caption:
            lines.append(f"- {caption[:120]}")
    return "\n".join(lines) if lines else "None"


def _build_headings_summary(ctx: ParsedDocumentContext) -> str:
    if not ctx.headings:
        return "No explicit headings"
    return " | ".join(ctx.headings[:10])


def _truncate_content(content: str, max_chars: int = MAX_CONTENT_CHARS) -> str:
    if len(content) <= max_chars:
        return content
    return content[:max_chars] + "\n\n[...content truncated for token budget...]"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def generate_course_manifest(
    ctx: ParsedDocumentContext,
) -> CourseManifest:
    """
    Day 4 Milestone — Consolidated Course Planner.

    Makes a single AI Gateway call with feature='interactive_video_planner'
    and assembles the full CourseManifest (segments + scripts + bullets + quizzes).

    Args:
        ctx:  Fully populated ParsedDocumentContext from document_parser.py.

    Returns:
        CourseManifest ready for slide_renderer.py (Day 5).
    """
    logger.info(
        "[Planner] Generating course manifest for '%s' "
        "(pm_id=%s, company_id=%s)",
        ctx.module_title,
        ctx.processed_module_id,
        ctx.company_id,
    )

    content_clean = _truncate_content(ctx.clean_content)
    duration_directive = (
        "================================================================================\n"
        "[MANDATORY REQUIREMENT - COURSE DURATION: 3 TO 5 MINUTES TOTAL]\n"
        "- The total final video course duration MUST be strictly between 3.0 minutes (180 seconds)\n"
        "  and 5.0 minutes (300 seconds).\n"
        "- Structure the curriculum into 4 to 6 sequential lecture segments (ideally 4 or 5 segments).\n"
        "- Each segment's narration ('script_en' and 'script_hi') MUST be detailed, educational, and\n"
        "  take between 45 to 60 seconds to speak at conversational pace (~105 to 140 words per segment).\n"
        "- OVERRIDE any rule specifying 25-35 seconds: scripts under 100 words are strictly unacceptable.\n"
        "  Provide thorough, in-depth corporate instruction, business rationale, concrete operational\n"
        "  examples, and step-by-step guidance so each segment delivers a solid 45-60 seconds of voiceover.\n"
        "- For each segment, provide 3 to 5 clear, high-impact slide bullets and an actionable key takeaway.\n"
        "- Ensure no quizzes, quiz gates, or avatar cues are generated. All segments are pure video lectures.\n"
        "- Return 'quiz': null, and 'simulation': null. Focus completely on the rich lecture segments.\n"
        "================================================================================\n\n"
    )
    content_augmented = duration_directive + content_clean

    variables = {
        "module_title": ctx.module_title,
        "content": content_augmented,
        "module_content": content_augmented,
        "estimated_duration_minutes": "4",
        "headings_summary": _build_headings_summary(ctx),
        "image_captions": _build_image_captions_summary(ctx),
    }

    # --- AI Gateway call ---
    raw_text: str = ""
    try:
        request = AIRequest(
            feature=FEATURE_KEY,
            company_id=ctx.company_id or "system",
            user_id=ctx.uploaded_by or "system",
            route=ROUTE,
            variables=variables,
            prompt_type="default",
            response_format="json",
            generation_config={
                "temperature": 0.35,
                "max_output_tokens": 8192,
                "thinking_config": {"thinking_budget": 0},
            },
        )
        response = await AI.execute(request)

        if not response.success:
            raise RuntimeError(
                f"AI Gateway returned failure for feature '{FEATURE_KEY}': "
                f"{response.error}"
            )

        raw_text = response.content or ""

    except Exception as exc:
        logger.error(
            "[Planner] AI Gateway call failed for '%s': %s: %s",
            ctx.module_title,
            type(exc).__name__,
            exc,
        )
        return _build_fallback_manifest(ctx)

    # --- Parse model output ---
    try:
        data = _parse_model_output(raw_text)
    except ValueError as exc:
        logger.error(
            "[Planner] JSON parse failed for '%s': %s. Raw preview: %r",
            ctx.module_title,
            exc,
            raw_text[:400],
        )
        return _build_fallback_manifest(ctx)

    # --- Assemble CourseManifest ---
    raw_segments = _safe_list(data.get("segments"), [])
    if not raw_segments:
        logger.warning(
            "[Planner] Model returned 0 segments for '%s'. "
            "Falling back to content-split manifest.",
            ctx.module_title,
        )
        return _build_fallback_manifest(ctx)

    segments = _assemble_segments(raw_segments)
    if not segments:
        logger.warning("[Planner] _assemble_segments produced 0 valid segments. Falling back.")
        return _build_fallback_manifest(ctx)

    try:
        est_duration = float(
            data.get("estimated_duration_minutes", ctx.estimated_duration_minutes)
        )
    except (TypeError, ValueError):
        est_duration = ctx.estimated_duration_minutes

    manifest = CourseManifest(
        processed_module_id=ctx.processed_module_id,
        title=_safe_str(data.get("course_title"), ctx.module_title),
        description=_safe_str(
            data.get("description") or data.get("course_description"),
            f"A video course on {ctx.module_title}.",
        ),
        segments=segments,
        total_segments=len(segments),
        quiz_gates=0,
        estimated_duration_minutes=est_duration,
    )

    logger.info(
        "[Planner] Manifest built: '%s' — %d video segments, ~%.1f min",
        manifest.title,
        len(segments),
        est_duration,
    )
    return manifest
