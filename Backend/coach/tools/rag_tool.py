# Backend/coach/tools/rag_tool.py
"""
Semantic Vector RAG Tool for Performance Coach.
Embeds user queries using BAAI/bge-large-en-v1.5 and executes cosine similarity searches
against coach_document_chunks via Supabase pgvector RPC with strict citations.
"""

from typing import List, Dict, Any, Optional
from utils.supabase_client import supabase_admin
from ingestion.embedder import get_model, QUERY_PREFIX
from security.pii_firewall import mask_rag_chunks_for_role, allowed_tiers_for_role_level
from security.rebac import is_missing_schema_error


def _extract_sec(security_ctx: Any) -> Dict[str, Any]:
    if not security_ctx:
        return {
            "has_context": False,
            "is_active": True,
            "is_admin": False,
            "role_level": 1,
            "user_id": "",
            "email": None,
            "principals": [],
            "allowed_tiers": ["public", "internal"],
            "managed_employee_ids": [],
        }
    if isinstance(security_ctx, dict):
        rl = int(security_ctx.get("role_level", 1))
        return {
            "has_context": True,
            "is_active": bool(security_ctx.get("is_active", True)),
            "is_admin": bool(security_ctx.get("is_admin", rl >= 3)),
            "role_level": rl,
            "user_id": str(security_ctx.get("user_id") or ""),
            "email": security_ctx.get("email"),
            "principals": list(security_ctx.get("principals") or []),
            "allowed_tiers": list(security_ctx.get("allowed_tiers") or allowed_tiers_for_role_level(rl)),
            "managed_employee_ids": list(security_ctx.get("managed_employee_ids") or []),
        }
    rl = int(getattr(security_ctx, "role_level", 1))
    return {
        "has_context": True,
        "is_active": bool(getattr(security_ctx, "is_active", True)),
        "is_admin": bool(getattr(security_ctx, "is_admin", rl >= 3)),
        "role_level": rl,
        "user_id": str(getattr(security_ctx, "user_id", "")),
        "email": getattr(security_ctx, "email", None),
        "principals": list(getattr(security_ctx, "principals", [])),
        "allowed_tiers": list(getattr(security_ctx, "allowed_tiers", allowed_tiers_for_role_level(rl))),
        "managed_employee_ids": list(getattr(security_ctx, "managed_employee_ids", [])),
    }


def search_coach_knowledge(
    query: str,
    company_id: str,
    target_employee_id: Optional[str] = None,
    match_count: int = 6,
    match_threshold: float = 0.20,
    security_ctx: Any = None,
) -> List[Dict[str, Any]]:
    """
    Searches unstructured coach knowledge (PDFs, DOCX, PPTX slides, evaluations)
    using dense vector similarity, Pre-Retrieval Zanzibar ACL Filtering, and Layer 2 PII masking.
    """
    if not query or not query.strip():
        return []

    sec = _extract_sec(security_ctx)
    if sec["has_context"] and not sec["is_active"]:
        return []

    if sec["has_context"] and target_employee_id and not sec["is_admin"]:
        allowed_emp = {sec["user_id"]} | set(sec["managed_employee_ids"])
        if str(target_employee_id) not in allowed_emp:
            return []

    try:
        # 1. Generate normalized query embedding with BGE query prefix
        model = get_model()
        prefixed_query = QUERY_PREFIX + query.strip()
        embedding = model.encode(prefixed_query, normalize_embeddings=True)
        query_vector = embedding.tolist()

        # 2. Build parameters for match_coach_document_chunks RPC with Pre-Retrieval ACL Filtering
        rpc_params: Dict[str, Any] = {
            "query_embedding": query_vector,
            "p_company_id": company_id,
            "match_count": match_count,
            "match_threshold": match_threshold,
            "p_user_principals": sec["principals"],
            "p_is_admin": sec["is_admin"],
            "p_allowed_sensitivity_tiers": sec["allowed_tiers"],
        }

        if target_employee_id:
            rpc_params["p_allowed_employee_ids"] = [target_employee_id]

        try:
            res = supabase_admin.rpc("match_coach_document_chunks", rpc_params).execute()
            chunks = getattr(res, "data", None) or []
        except Exception as rpc_err:
            if not is_missing_schema_error(rpc_err):
                raise
            legacy_params: Dict[str, Any] = {
                "query_embedding": query_vector,
                "p_company_id": company_id,
                "match_count": match_count,
                "match_threshold": match_threshold,
            }
            if target_employee_id:
                legacy_params["p_allowed_employee_ids"] = [target_employee_id]
            elif sec["has_context"] and not sec["is_admin"]:
                legacy_params["p_allowed_employee_ids"] = [sec["user_id"], *sec["managed_employee_ids"]]
            res = supabase_admin.rpc("match_coach_document_chunks", legacy_params).execute()
            chunks = getattr(res, "data", None) or []
            if sec["has_context"] and not sec["is_admin"]:
                allowed_emp = {sec["user_id"]} | set(sec["managed_employee_ids"])
                chunks = [
                    c for c in chunks
                    if not c.get("target_employee_id") or str(c.get("target_employee_id")) in allowed_emp
                ]

        # 3. Apply Layer 2 PII Firewall before returning excerpts to LLM
        if sec["has_context"]:
            chunks = mask_rag_chunks_for_role(
                chunks,
                caller_user_id=sec["user_id"],
                caller_email=sec.get("email"),
                role_level=sec["role_level"],
            )

        return chunks

    except Exception as e:
        print(f"[COACH RAG TOOL] Vector retrieval failed: {e}")
        return []


def format_chunks_for_context(chunks: List[Dict[str, Any]]) -> str:
    """
    Formats retrieved vector chunks into an evidence block with exact citations.
    """
    if not chunks:
        return "No relevant qualitative documents or feedback chunks found."

    sections = []
    for idx, c in enumerate(chunks, 1):
        cit = c.get("citation") or {}
        doc_name = cit.get("file_name") or "Unknown Document"
        coord_parts = []
        if cit.get("page_number"):
            coord_parts.append(f"Page {cit['page_number']}")
        if cit.get("slide_number"):
            coord_parts.append(f"Slide {cit['slide_number']}")
        if cit.get("sheet_name"):
            coord_parts.append(f"Sheet {cit['sheet_name']}")
        if cit.get("row_number"):
            coord_parts.append(f"Row {cit['row_number']}")
        if cit.get("section_title"):
            coord_parts.append(cit["section_title"])
        if cit.get("eval_period"):
            coord_parts.append(f"Period: {cit['eval_period']}")

        coord_str = " | ".join(coord_parts) if coord_parts else "General Section"
        similarity = round(c.get("similarity", 0.0) * 100, 1)

        header = f"--- [EXCERPT {idx}] Source: {doc_name} ({coord_str}) [Relevance: {similarity}%] ---"
        content = c.get("content", "").strip()
        sections.append(f"{header}\n{content}")

    return "\n\n".join(sections)


def extract_citations_from_chunks(chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Extracts deduplicated, structured citation chips for frontend UI display.
    """
    citations = []
    seen = set()

    for c in chunks:
        cit = c.get("citation") or {}
        file_name = cit.get("file_name") or "Document"
        page = cit.get("page_number")
        slide = cit.get("slide_number")
        sheet = cit.get("sheet_name")
        row = cit.get("row_number")
        section = cit.get("section_title")
        period = cit.get("eval_period")

        key = (file_name, page, slide, sheet, row, section)
        if key in seen:
            continue
        seen.add(key)

        citations.append({
            "file_name": file_name,
            "file_type": cit.get("file_type", "doc"),
            "page_number": page,
            "slide_number": slide,
            "sheet_name": sheet,
            "row_number": row,
            "section_title": section,
            "eval_period": period,
            "similarity": c.get("similarity")
        })

    return citations
