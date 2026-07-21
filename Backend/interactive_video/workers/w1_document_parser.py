"""
Worker 1: Document Parser
Extracts clean text, images, and structural metadata from the processed_module content.
"""
from __future__ import annotations
import json
import re
from typing import Any, Dict, List, Optional

from utils.supabase_client import supabase, supabase_admin
from .image_relevance import resolve_image_url


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
    module_images = _fetch_module_uploaded_images(
        module.get("processed_module_id"),
        module.get("original_module_id"),
    )

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
        "module_images": module_images,
        "raw_module": module,
    }

    print(
        f"[W1] Done: {len(paragraphs)} paragraphs, "
        f"{len(headings)} headings, ~{estimated_seconds}s TTS, "
        f"{len(module_images)} uploaded images found"
    )
    return result


def _fetch_module_uploaded_images(processed_module_id: Optional[str], original_module_id: Optional[str]) -> List[str]:
    module_ids = [mid for mid in {processed_module_id, original_module_id} if mid]
    if not module_ids:
        return []

    candidate_columns = ["module_id", "processed_module_id", "original_module_id"]
    candidate_selects = [
        ["storage_path"],
        ["image_url"],
        ["public_url"],
        ["signed_url"],
        ["url"],
    ]
    response_data: List[Dict[str, Any]] = []

    for column in candidate_columns:
        for select_columns in candidate_selects:
            try:
                query = supabase.table("vectordb_images").select(",".join(select_columns))
                if len(module_ids) == 1:
                    query = query.eq(column, module_ids[0])
                else:
                    query = query.in_(column, module_ids)
                response = query.execute()
                if response and getattr(response, "data", None):
                    response_data.extend(response.data)
                    break
            except Exception as exc:
                print(
                    f"[W1] WARNING: Failed to query module images via {column} "
                    f"select={select_columns}: {exc}"
                )
                continue

    if not response_data:
        return []

    images: List[Dict[str, Any]] = []
    seen = set()
    for row in response_data:
        candidate_url = resolve_image_url(row)
        if not candidate_url:
            storage_path = row.get("storage_path")
            if storage_path:
                try:
                    candidate_url = supabase_admin.storage.from_("module-assets").get_public_url(storage_path)
                    if isinstance(candidate_url, dict):
                        candidate_url = (
                            candidate_url.get("publicURL")
                            or candidate_url.get("publicUrl")
                            or candidate_url.get("signedURL")
                        )
                except Exception as exc:
                    print(f"[W1] WARNING: Could not get public URL for storage_path {storage_path}: {exc}")

        if candidate_url and candidate_url not in seen:
            images.append({
                "url": candidate_url,
                "storage_path": row.get("storage_path"),
                "chunk_id": row.get("chunk_id"),
                "caption": row.get("caption", ""),
                "surrounding_text": row.get("surrounding_text", ""),
                "source_type": row.get("source_type"),
            })
            seen.add(candidate_url)

    return images
