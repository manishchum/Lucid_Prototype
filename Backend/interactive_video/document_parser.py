"""
Document Ingestion & Ownership Context Resolution for Interactive Video Pipeline.

Tasks:
1. Ingest module content from `processed_modules` (clean text, headings, word count).
2. Resolve tenant ownership: `company_id` and `uploaded_by` from `training_modules`.
3. Fetch `company_logo` and `name` from `companies` table.
4. Retrieve relevant diagram / visual images from `vectordb_images`.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, Optional, Tuple

from utils.auth_bridge import get_service_supabase_client
from interactive_video.models import ModuleImage, ParsedDocumentContext

logger = logging.getLogger("interactive_video.document_parser")


# ---------------------------------------------------------------------------
# Text Extraction & Normalization
# ---------------------------------------------------------------------------

def clean_text(text: str) -> str:
    """Normalize line endings, trim trailing whitespace, and collapse multi-newlines."""
    if not text:
        return ""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"\n{3,}", "\n\n", text)
    lines = [line.rstrip() for line in text.split("\n")]
    return "\n".join(lines).strip()


def extract_headings(text: str) -> List[str]:
    """Extract markdown-style headings (# Heading)."""
    headings: List[str] = []
    for line in text.split("\n"):
        stripped = line.strip()
        if stripped.startswith("#"):
            heading = re.sub(r"^#+\s*", "", stripped)
            if heading and heading not in headings:
                headings.append(heading)
    return headings


def parse_raw_module_content(raw_content: Any) -> str:
    """
    Unwraps raw module content which can either be:
    - Clean markdown / plain text string
    - JSON string or dict structured as {sections: [...]} or {content: "..."}
    """
    if not raw_content:
        return ""

    if isinstance(raw_content, dict):
        if "content" in raw_content and isinstance(raw_content["content"], str):
            return clean_text(raw_content["content"])
        if "sections" in raw_content and isinstance(raw_content["sections"], list):
            parts: List[str] = []
            for s in raw_content["sections"]:
                if isinstance(s, dict):
                    t = s.get("title", "").strip()
                    c = s.get("content", s.get("text", "")).strip()
                    parts.append(f"## {t}\n{c}" if t else c)
                elif isinstance(s, str):
                    parts.append(s.strip())
            return clean_text("\n\n".join(parts))
        return clean_text(json.dumps(raw_content))

    if isinstance(raw_content, str):
        content_str = raw_content.strip()
        if content_str.startswith("{") and content_str.endswith("}"):
            try:
                parsed = json.loads(content_str)
                return parse_raw_module_content(parsed)
            except Exception:
                pass
        return clean_text(content_str)

    return clean_text(str(raw_content))


def estimate_duration_minutes(text: str, wpm: int = 140) -> float:
    """Estimates spoken narration / reading time in minutes."""
    words = len(text.split())
    if words == 0:
        return 0.0
    return round((words / wpm), 2)


# ---------------------------------------------------------------------------
# Supabase Ingestion & Context Resolution
# ---------------------------------------------------------------------------

async def resolve_module_records(
    module_identifier: str,
    supabase_client: Any,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """
    Resolves the processed_modules row and corresponding training_modules row.
    Accepts either processed_module_id or original_module_id.
    """
    pm_row: Optional[Dict[str, Any]] = None
    tm_row: Optional[Dict[str, Any]] = None

    # 1. Try querying processed_modules by processed_module_id
    resp = (
        supabase_client.table("processed_modules")
        .select("*")
        .eq("processed_module_id", module_identifier)
        .maybe_single()
        .execute()
    )
    if resp.data:
        pm_row = resp.data

    # 2. If not found by processed_module_id, try by original_module_id
    if not pm_row:
        resp = (
            supabase_client.table("processed_modules")
            .select("*")
            .eq("original_module_id", module_identifier)
            .order("created_at", desc=True)
            .limit(1)
            .maybe_single()
            .execute()
        )
        if resp.data:
            pm_row = resp.data

    original_module_id = pm_row.get("original_module_id") if pm_row else module_identifier

    # 3. Query training_modules to get ownership context (company_id, uploaded_by)
    if original_module_id:
        tm_resp = (
            supabase_client.table("training_modules")
            .select("module_id, company_id, uploaded_by, title, description")
            .eq("module_id", original_module_id)
            .maybe_single()
            .execute()
        )
        if tm_resp.data:
            tm_row = tm_resp.data

    if not pm_row and not tm_row:
        raise ValueError(f"Module not found with identifier '{module_identifier}' in processed_modules or training_modules.")

    # Synthesize fallback processed_module row if only training_module exists
    if not pm_row and tm_row:
        pm_row = {
            "processed_module_id": f"synthetic_{module_identifier}",
            "original_module_id": tm_row.get("module_id"),
            "title": tm_row.get("title", "Untitled Module"),
            "content": tm_row.get("description", ""),
        }

    return pm_row or {}, tm_row or {}


async def resolve_company_branding(
    company_id: Optional[str],
    supabase_client: Any,
) -> Tuple[str, Optional[str]]:
    """
    Fetches company name and company_logo from the companies table.
    Returns (company_name, company_logo_url).
    """
    if not company_id:
        return "Enterprise Training", None, []

    try:
        resp = (
            supabase_client.table("companies")
            .select("name, company_logo, subscription_addons")
            .eq("company_id", company_id)
            .maybe_single()
            .execute()
        )
        if resp.data:
            company_name = resp.data.get("name") or "Enterprise Training"
            company_logo = resp.data.get("company_logo")
            addons = resp.data.get("subscription_addons") or []
            return company_name, company_logo, addons
    except Exception as exc:
        logger.warning(f"[DocumentParser] Failed to fetch company branding for {company_id}: {exc}")

    return "Enterprise Training", None, []


async def resolve_module_images(
    processed_module_id: Optional[str],
    original_module_id: Optional[str],
    supabase_client: Any,
) -> List[ModuleImage]:
    """
    Retrieves images associated with the module from vectordb_images.
    Resolves public URLs from Supabase Storage if necessary.
    """
    module_ids = [mid for mid in {original_module_id, processed_module_id} if mid]
    if not module_ids:
        return []

    images: List[ModuleImage] = []
    seen_urls = set()

    try:
        query = (
            supabase_client.table("vectordb_images")
            .select("storage_path, image_url, caption, surrounding_text, chunk_id")
        )
        if len(module_ids) == 1:
            query = query.eq("module_id", module_ids[0])
        else:
            query = query.in_("module_id", module_ids)

        resp = query.execute()
        rows = resp.data or []

        for row in rows:
            candidate_url = row.get("image_url") or ""
            storage_path = row.get("storage_path")

            if not candidate_url and storage_path:
                try:
                    pub = supabase_client.storage.from_("module-assets").get_public_url(storage_path)
                    if isinstance(pub, str):
                        candidate_url = pub
                    elif isinstance(pub, dict):
                        candidate_url = pub.get("publicURL") or pub.get("publicUrl") or pub.get("signedURL") or ""
                except Exception as exc:
                    logger.debug(f"[DocumentParser] Could not resolve public URL for {storage_path}: {exc}")

            if candidate_url and candidate_url not in seen_urls:
                images.append(
                    ModuleImage(
                        url=candidate_url,
                        storage_path=storage_path,
                        caption=row.get("caption") or "",
                        surrounding_text=row.get("surrounding_text") or "",
                        chunk_id=str(row.get("chunk_id")) if row.get("chunk_id") else None,
                        source_type=row.get("source_type"),
                    )
                )
                seen_urls.add(candidate_url)

    except Exception as exc:
        logger.warning(f"[DocumentParser] Failed to retrieve module images from vectordb_images: {exc}")

    return images


# ---------------------------------------------------------------------------
# Primary Entrypoint
# ---------------------------------------------------------------------------

async def parse_document_context(
    module_identifier: str,
    explicit_company_id: Optional[str] = None,
    explicit_user_id: Optional[str] = None,
    supabase_client: Optional[Any] = None,
) -> ParsedDocumentContext:
    """
    Day 3 Milestone: Document Ingestion & Ownership Context Resolution.

    Args:
        module_identifier: processed_module_id or original_module_id.
        explicit_company_id: Optional company_id override if already in session.
        explicit_user_id: Optional user_id override if already in session.
        supabase_client: Optional Supabase service client.

    Returns:
        Fully populated ParsedDocumentContext ready for planner.py.
    """
    db = supabase_client or get_service_supabase_client()

    # 1. Ingest processed_modules and training_modules records
    pm_row, tm_row = await resolve_module_records(module_identifier, db)

    processed_module_id = str(pm_row.get("processed_module_id") or module_identifier)
    original_module_id = pm_row.get("original_module_id") or tm_row.get("module_id")

    # 2. Extract clean text, title, headings, and metrics
    module_title = pm_row.get("title") or tm_row.get("title") or "Untitled Module"
    clean_content = parse_raw_module_content(pm_row.get("content"))
    if not clean_content and tm_row.get("description"):
        clean_content = parse_raw_module_content(tm_row.get("description"))

    headings = extract_headings(clean_content)
    word_count = len(clean_content.split())
    duration_min = estimate_duration_minutes(clean_content)

    # 3. Resolve tenant ownership context
    company_id = explicit_company_id or tm_row.get("company_id")
    uploaded_by = explicit_user_id or tm_row.get("uploaded_by")

    # 4. Fetch company branding watermark & metadata
    company_name, company_logo, subscription_addons = await resolve_company_branding(company_id, db)

    # 5. Retrieve associated visual images from vectordb_images
    images = await resolve_module_images(processed_module_id, original_module_id, db)

    logger.info(
        f"[DocumentParser] Successfully parsed module '{module_title}' "
        f"(pm_id={processed_module_id}, company_id={company_id}, "
        f"images={len(images)}, words={word_count})"
    )

    return ParsedDocumentContext(
        processed_module_id=processed_module_id,
        original_module_id=original_module_id,
        module_title=module_title,
        clean_content=clean_content,
        headings=headings,
        word_count=word_count,
        estimated_duration_minutes=duration_min,
        company_id=str(company_id) if company_id else "",
        company_name=company_name,
        company_logo=company_logo,
        uploaded_by=str(uploaded_by) if uploaded_by else None,
        images=images,
        subscription_addons=subscription_addons,
    )
