# Backend/coach/tools/rag_tool.py
"""
Semantic Vector RAG Tool for Performance Coach.
Embeds user queries using BAAI/bge-large-en-v1.5 and executes cosine similarity searches
against coach_document_chunks via Supabase pgvector RPC with strict citations.
"""

import json
import uuid
import numpy as np
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


def _is_valid_uuid(val: Any) -> bool:
    if not val:
        return False
    try:
        uuid.UUID(str(val))
        return True
    except (ValueError, AttributeError, TypeError):
        return False


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
        allowed_emp_ids = None
        if target_employee_id:
            cleaned_id = str(target_employee_id).strip()
            if _is_valid_uuid(cleaned_id):
                allowed_emp_ids = [cleaned_id]
            else:
                # If target_employee_id is a Firebase UID string, attempt lookup for postgres UUID in users table
                try:
                    u_res = supabase_admin.table("users").select("user_id").eq("user_id", cleaned_id).limit(1).execute()
                    u_data = getattr(u_res, "data", None) or []
                    if u_data and u_data[0].get("user_id") and _is_valid_uuid(u_data[0]["user_id"]):
                        allowed_emp_ids = [str(u_data[0]["user_id"])]
                except Exception as u_err:
                    print(f"[COACH RAG TOOL] User lookup error for UUID resolution: {u_err}")

        is_admin_flag = sec["is_admin"] if sec["has_context"] else True
        principals_list = sec["principals"] if sec["has_context"] else []
        sensitivity_tiers = sec["allowed_tiers"] if sec["has_context"] else ["public", "internal", "confidential", "restricted"]

        rpc_params: Dict[str, Any] = {
            "query_embedding": query_vector,
            "p_company_id": company_id,
            "p_is_admin": is_admin_flag,
            "p_user_principals": principals_list,
            "p_allowed_sensitivity_tiers": sensitivity_tiers,
            "p_allowed_employee_ids": allowed_emp_ids,
            "match_count": match_count,
            "match_threshold": match_threshold,
        }

        print(f"[COACH RAG TOOL] Executing RPC match_coach_document_chunks (company: {company_id}, allowed_emps: {allowed_emp_ids}, is_admin: {is_admin_flag}, threshold: {match_threshold})")
        chunks = []
        try:
            res = supabase_admin.rpc("match_coach_document_chunks", rpc_params).execute()
            chunks = getattr(res, "data", None) or []
            rpc_error = getattr(res, "error", None)
            if rpc_error:
                print(f"[COACH RAG TOOL] RPC returned error: {rpc_error}")
            else:
                print(f"[COACH RAG TOOL] RPC returned {len(chunks)} chunks")
        except Exception as rpc_err:
            print(f"[COACH RAG TOOL] RPC execution exception: {rpc_err}")
            if is_missing_schema_error(rpc_err):
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
                try:
                    res = supabase_admin.rpc("match_coach_document_chunks", legacy_params).execute()
                    chunks = getattr(res, "data", None) or []
                except Exception as leg_err:
                    print(f"[COACH RAG TOOL] Legacy RPC call error: {leg_err}")

        # Direct Table Fallback: If RPC returned 0 chunks (or failed), execute direct table scoring
        # STRICT REBAC FILTERING: Never leak another employee's private documents or unauthorized sensitivity tiers!
        if not chunks:
            print(f"[COACH RAG TOOL] RPC returned 0 chunks. Executing table-level vector scoring fallback...")
            try:
                # Fetch recent chunk candidates for the company
                tbl_res = None
                try:
                    tbl_res = (
                        supabase_admin.table("coach_document_chunks")
                        .select("id, document_id, company_id, target_employee_id, chunk_index, chunk_type, content, citation, embedding, sensitivity_tier, acl_principals, deny_principals, created_at")
                        .eq("company_id", company_id)
                        .order("created_at", desc=True)
                        .limit(300)
                        .execute()
                    )
                except Exception as col_err:
                    if is_missing_schema_error(col_err):
                        tbl_res = (
                            supabase_admin.table("coach_document_chunks")
                            .select("id, document_id, company_id, target_employee_id, chunk_index, chunk_type, content, citation, embedding")
                            .eq("company_id", company_id)
                            .limit(300)
                            .execute()
                        )
                    else:
                        raise

                raw_rows = getattr(tbl_res, "data", None) or []
                print(f"[COACH RAG TOOL] Fallback retrieved {len(raw_rows)} total chunk candidates for company {company_id}")

                if raw_rows:
                    q_vec = np.array(query_vector, dtype=np.float32)
                    q_norm = np.linalg.norm(q_vec)
                    if q_norm > 0:
                        q_vec = q_vec / q_norm

                    scoped_clean_id = allowed_emp_ids[0].lower() if allowed_emp_ids else None

                    # ReBAC Authorization Scope:
                    # - Admins can query all employee records.
                    # - Managers can query their own records + direct reports (managed_employee_ids).
                    # - Regular employees can ONLY query their own records and company-wide docs (target_employee_id IS NULL).
                    if sec["has_context"] and not is_admin_flag:
                        caller_uid = str(sec.get("user_id") or "").strip().lower()
                        managed_uids = {str(m).strip().lower() for m in (sec.get("managed_employee_ids") or []) if m}
                        authorized_emp_ids = ({caller_uid} | managed_uids) - {""}
                    else:
                        authorized_emp_ids = None  # Admin or unrestricted

                    scored_candidates = []

                    for row in raw_rows:
                        row_emp_id = row.get("target_employee_id")

                        # ReBAC CHECK 1: Employee Isolation
                        # If chunk is targeted to a specific employee (not company-wide):
                        if row_emp_id is not None:
                            row_emp_str = str(row_emp_id).strip().lower()
                            # Non-admin callers CANNOT access private documents belonging to another employee!
                            if authorized_emp_ids is not None and row_emp_str not in authorized_emp_ids:
                                continue
                            # If the query was scoped to a specific employee, enforce matching target
                            if scoped_clean_id and row_emp_str != scoped_clean_id:
                                continue

                        # ReBAC CHECK 2: Sensitivity Tier Filtering
                        row_tier = row.get("sensitivity_tier") or "internal"
                        if sensitivity_tiers and row_tier not in sensitivity_tiers:
                            continue

                        # ReBAC CHECK 3: Explicit Deny Principals
                        row_deny = row.get("deny_principals") or []
                        if principals_list and any(p in principals_list for p in row_deny):
                            continue

                        raw_emb = row.get("embedding")
                        if not raw_emb:
                            continue

                        if isinstance(raw_emb, str):
                            try:
                                raw_emb = json.loads(raw_emb)
                            except Exception:
                                continue

                        c_vec = np.array(raw_emb, dtype=np.float32)
                        c_norm = np.linalg.norm(c_vec)
                        if c_norm > 0:
                            c_vec = c_vec / c_norm

                        sim = float(np.dot(q_vec, c_vec))
                        if sim >= match_threshold:
                            row_copy = dict(row)
                            row_copy.pop("embedding", None)
                            row_copy["similarity"] = round(sim, 4)

                            # Parse citation if it's a JSON string
                            cit = row_copy.get("citation")
                            if isinstance(cit, str):
                                try:
                                    row_copy["citation"] = json.loads(cit)
                                except Exception:
                                    pass

                            scored_candidates.append(row_copy)

                    scored_candidates.sort(key=lambda x: x.get("similarity", 0.0), reverse=True)
                    chunks = scored_candidates[:match_count]
                    print(f"[COACH RAG TOOL] Fallback successfully scored {len(chunks)} authorized chunks (top match similarity: {chunks[0]['similarity'] if chunks else 'N/A'})")

            except Exception as fb_err:
                print(f"[COACH RAG TOOL] Fallback retrieval encountered error: {fb_err}")

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
    Includes verified source text excerpts and proof coordinates.
    """
    citations = []
    seen = set()

    for c in chunks:
        cit = c.get("citation") or {}
        if isinstance(cit, str):
            try:
                cit = json.loads(cit)
            except Exception:
                cit = {}

        file_name = cit.get("file_name") or c.get("file_name") or "Document"
        page = cit.get("page_number")
        slide = cit.get("slide_number")
        sheet = cit.get("sheet_name")
        row = cit.get("row_number")
        section = cit.get("section_title")
        period = cit.get("eval_period")
        chunk_idx = c.get("chunk_index", 0)
        excerpt_text = (c.get("content") or "").strip()

        key = (file_name, chunk_idx, page, slide, sheet, row, section)
        if key in seen:
            continue
        seen.add(key)

        coord_parts = []
        if page:
            coord_parts.append(f"Page {page}")
        if slide:
            coord_parts.append(f"Slide {slide}")
        if sheet:
            coord_parts.append(f"Sheet {sheet}")
        if row:
            coord_parts.append(f"Row {row}")
        if section:
            coord_parts.append(str(section))
        if period:
            coord_parts.append(f"Period: {period}")

        location_str = " • ".join(coord_parts) if coord_parts else ""
        sim = float(c.get("similarity") or 0.0)

        citations.append({
            "document_id": str(c.get("document_id") or ""),
            "filename": file_name,
            "file_name": file_name,
            "title": file_name,
            "name": file_name,
            "file_type": cit.get("file_type", "doc"),
            "chunk_index": chunk_idx,
            "score": round(sim, 3),
            "similarity": round(sim, 3),
            "location": location_str,
            "page_number": page,
            "slide_number": slide,
            "sheet_name": sheet,
            "row_number": row,
            "section_title": section,
            "eval_period": period,
            "excerpt": excerpt_text,
            "content": excerpt_text,
            "text": excerpt_text
        })

    return citations
