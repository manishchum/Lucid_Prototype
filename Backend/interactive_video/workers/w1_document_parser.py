"""
Worker 1: Document Parser
Extracts clean text, images, and structural metadata from the processed_module content.
"""
from __future__ import annotations
import json
import re
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _clean_text(text: str) -> str:
    """Remove excessive whitespace while preserving paragraph structure."""
    # Normalise line endings
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # Collapse runs of blank lines to max 2
    text = re.sub(r"\n{3,}", "\n\n", text)
    # Strip trailing spaces per line
    lines = [line.rstrip() for line in text.split("\n")]
    return "\n".join(lines).strip()


def _extract_headings(text: str) -> List[str]:
    """Return all markdown-style headings found in the text."""
    headings = []
    for line in text.split("\n"):
        stripped = line.strip()
        if stripped.startswith("#"):
            heading = re.sub(r"^#+\s*", "", stripped)
            if heading:
                headings.append(heading)
    return headings


def _split_into_paragraphs(text: str) -> List[str]:
    """Split text on blank lines; return non-empty paragraphs."""
    return [p.strip() for p in text.split("\n\n") if p.strip()]


def _detect_existing_assets(module: Dict[str, Any]) -> Dict[str, Optional[str]]:
    """Check if the module already has video / audio assets."""
    return {
        "video_url_en": module.get("video_url"),
        "video_url_hi": module.get("video_url_hinglish"),
        "audio_url": module.get("audio_url"),
        "has_flashcards": bool(module.get("flashcard_data")),
    }


def _estimate_reading_time(text: str) -> float:
    """Rough TTS duration estimate: average 140 wpm → seconds."""
    word_count = len(text.split())
    return round(word_count / 140 * 60, 1)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def run(module: Dict[str, Any]) -> Dict[str, Any]:
    """
    W1: Document Parser

    Args:
        module: Raw row from `processed_modules` Supabase table.

    Returns:
        Structured document dict passed to W2.
    """
    print("[W1] Document Parser starting...")

    raw_content = module.get("content") or ""

    # Handle JSON-encoded content field
    if isinstance(raw_content, str) and raw_content.strip().startswith("{"):
        try:
            parsed = json.loads(raw_content)
            # Flatten common shapes: {sections: [...]} or {content: "..."}
            if isinstance(parsed, dict):
                if "content" in parsed:
                    raw_content = parsed["content"]
                elif "sections" in parsed:
                    sections = parsed["sections"]
                    parts = []
                    for s in sections:
                        if isinstance(s, dict):
                            t = s.get("title", "")
                            c = s.get("content", s.get("text", ""))
                            parts.append(f"## {t}\n{c}" if t else c)
                        elif isinstance(s, str):
                            parts.append(s)
                    raw_content = "\n\n".join(parts)
        except Exception:
            pass  # Keep raw string

    # Handle list content
    if isinstance(raw_content, list):
        raw_content = "\n\n".join(
            item if isinstance(item, str) else json.dumps(item)
            for item in raw_content
        )

    clean = _clean_text(str(raw_content))
    headings = _extract_headings(clean)
    paragraphs = _split_into_paragraphs(clean)
    assets = _detect_existing_assets(module)
    estimated_seconds = _estimate_reading_time(clean)

    result = {
        "processed_module_id": module.get("processed_module_id"),
        "original_module_id": module.get("original_module_id"),
        "title": module.get("title", "Untitled Module"),
        "clean_text": clean,
        "headings": headings,
        "paragraphs": paragraphs,
        "paragraph_count": len(paragraphs),
        "word_count": len(clean.split()),
        "estimated_tts_seconds": estimated_seconds,
        "existing_assets": assets,
        "raw_module": module,
    }

    print(
        f"[W1] Done: {len(paragraphs)} paragraphs, "
        f"{len(headings)} headings, ~{estimated_seconds}s TTS"
    )
    return result
