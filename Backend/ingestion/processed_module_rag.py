import re
from typing import List, Dict, Any
from utils.supabase_client import supabase_admin
from ingestion.embedder import embed_chunks
from ai.ai_gateway import AI
from ai.types import AIRequest


VERNACULAR_GLOSSARY = {
    r"\b(grinding noise|grinding sound|screeching|grinding)\b": "abnormal vibration friction bearing housing mechanical noise",
    r"\b(drum)\b": "roller drum assembly bearing housing shaft",
    r"\b(squealing|squeal|belt slip)\b": "drive belt tension pulley slippage",
    r"\b(overheating|hot casing|smoking|high temp)\b": "thermal expansion bearing failure overheating friction",
    r"\b(wobble|shaking|vibrating|vibration)\b": "shaft misalignment rotor imbalance bearing play",
    r"\b(leaking|leak|dripping)\b": "gland packing seal degradation hydraulic fluid leakage",
    r"\b(tripped|power loss|no power|breaker)\b": "overcurrent trip circuit breaker thermal overload safety interlock",
    r"\b(clogged|blocked|stuck)\b": "flow restriction nozzle blockage valve obstruction",
}


def _expand_vernacular_query(user_message: str) -> str:
    """
    Expands technician shopfloor vernacular into formal industrial manual terms
    before vector retrieval to ensure high-recall semantic matching.
    """
    if not user_message:
        return ""

    user_lower = user_message.lower()
    expanded_terms = []

    for pattern, expansion in VERNACULAR_GLOSSARY.items():
        if re.search(pattern, user_lower):
            expanded_terms.append(expansion)

    if expanded_terms:
        expanded_str = " ".join(set(" ".join(expanded_terms).split()))
        return f"{user_message} (Industrial manual terms: {expanded_str})"

    return user_message


def _clean_html_text(html_content: str) -> str:
    """Strips HTML tags and normalizes whitespace while preserving table layouts, diagrams, and callout blocks."""
    if not html_content:
        return ""

    cleaned = html_content
    # Preserve HTML tables by formatting rows and cells cleanly
    cleaned = re.sub(r"</tr>", "\n", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"</t[dh]>", " | ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"<t[dh][^>]*>", "", cleaned, flags=re.IGNORECASE)

    # Preserve callout warning boxes
    cleaned = re.sub(r'<div[^>]*class="[^"]*warning[^"]*"[^>]*>', "\n> [!WARNING] ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'<div[^>]*class="[^"]*callout[^"]*"[^>]*>', "\n> [!NOTE] ", cleaned, flags=re.IGNORECASE)

    # Preserve image diagram links
    cleaned = re.sub(r'<img[^>]*src="([^"]+)"[^>]*alt="([^"]*)"[^>]*>', r" ![Diagram: \2](\1) ", cleaned, flags=re.IGNORECASE)

    cleaned = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", cleaned, flags=re.DOTALL | re.IGNORECASE)
    cleaned = re.sub(r"<(br|p|h[1-6]|li)[^>]*>", "\n", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    cleaned = re.sub(r"\n\s*\n", "\n\n", cleaned)
    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    return cleaned.strip()


def _chunk_html_structure_aware(raw_content: str, title: str, chunk_size: int = 800) -> List[Dict[str, Any]]:
    """
    Splits content into section-aware chunks that keep tables, diagrams, and callout blocks intact with section metadata.
    """
    if not raw_content:
        return []

    # Split by headers (H1, H2, H3, or Section markers)
    sections = re.split(r"(?=<h[1-4][^>]*>|(?:\n|^)#{1-4}\s)", raw_content, flags=re.IGNORECASE)
    structured_chunks = []

    for idx, sec in enumerate(sections, 1):
        cleaned_sec = _clean_html_text(sec)
        if not cleaned_sec:
            continue

        header_match = re.search(r"^(?:<h[1-4][^>]*>(.*?)</h[1-4]>|#{1-4}\s*(.*?)(?:\n|$))", sec, flags=re.IGNORECASE | re.DOTALL)
        section_title = f"Section {idx}"
        if header_match:
            raw_h = header_match.group(1) or header_match.group(2) or ""
            section_title = re.sub(r"<[^>]+>", "", raw_h).strip() or f"Section {idx}"

        # Sub-chunk if section is unusually long, keeping table rows together
        sub_chunks = []
        if len(cleaned_sec) <= chunk_size:
            sub_chunks.append(cleaned_sec)
        else:
            paras = cleaned_sec.split("\n\n")
            curr = ""
            for p in paras:
                if len(curr) + len(p) > chunk_size and curr:
                    sub_chunks.append(curr.strip())
                    curr = p
                else:
                    curr = curr + "\n\n" + p if curr else p
            if curr:
                sub_chunks.append(curr.strip())

        for s_idx, sc in enumerate(sub_chunks, 1):
            structured_chunks.append({
                "content": sc,
                "section_title": section_title,
                "section_num": idx,
                "sub_index": s_idx
            })

    return structured_chunks


def _chunk_text_simple(text: str, chunk_size: int = 700, overlap: int = 150) -> List[str]:
    """Splits plain text into overlapping chunks."""
    if not text:
        return []
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        start += (chunk_size - overlap)
    return chunks


async def ingest_processed_module_vectors(processed_module_id: str) -> Dict[str, Any]:
    """
    Generates Q&A pairs, section chunks, and embeddings for a processed module
    and stores them in Supabase vectordb_processed_chunks table.
    """
    print(f"[PROCESSED_RAG] Starting vector ingestion for processed_module_id: {processed_module_id}")

    # 1. Fetch processed_module record
    pm_res = (
        supabase_admin
        .table("processed_modules")
        .select("processed_module_id, original_module_id, title, content")
        .eq("processed_module_id", processed_module_id)
        .single()
        .execute()
    )

    pm_data = getattr(pm_res, "data", None)
    if not pm_data:
        raise ValueError(f"Processed module not found: {processed_module_id}")

    original_module_id = pm_data.get("original_module_id")
    title = pm_data.get("title", "")
    raw_content = pm_data.get("content", "") or ""

    if not raw_content.strip():
        print(f"[PROCESSED_RAG] Module content is empty for {processed_module_id}, skipping vector ingestion.")
        return {"processed_module_id": processed_module_id, "inserted_count": 0, "status": "skipped_empty_content"}

    # 2. Fetch company_id from training_modules
    company_id = None
    if original_module_id:
        tm_res = (
            supabase_admin
            .table("training_modules")
            .select("company_id")
            .eq("module_id", original_module_id)
            .single()
            .execute()
        )
        tm_data = getattr(tm_res, "data", None)
        if tm_data:
            company_id = tm_data.get("company_id")

    # 3. Clean content
    plain_text = _clean_html_text(raw_content)

    # 4. Create section chunks
    text_chunks = _chunk_text_simple(plain_text, chunk_size=700, overlap=150)

    qa_chunks: List[Dict[str, Any]] = []
    
    # Summary chunk
    summary_text = f"Summary of {title}: {plain_text[:1200]}"
    qa_chunks.append({
        "chunk_type": "summary",
        "embed_text": summary_text,
        "content": summary_text,
        "metadata": {"title": title, "answer": summary_text}
    })

    # Section chunks
    for idx, tc in enumerate(text_chunks):
        qa_chunks.append({
            "chunk_type": "section",
            "embed_text": f"{title}. {tc}",
            "content": f"Module: {title}\nSection Passage:\n{tc}",
            "metadata": {"title": title, "chunk_index": idx}
        })

    # AI Gateway Q&A generation using database prompt templates
    try:
        ai_res = await AI.execute(
            AIRequest(
                feature="module_chat",
                company_id=str(company_id) if company_id else "",
                user_id="",
                route="/ingest-processed-module",
                prompt_type="qa_generation",
                variables={
                    "moduleTitle": title,
                    "moduleContent": plain_text[:4000],
                    "userMessage": "Generate 8-15 common, high-value questions that a student or employee might ask, along with concise, direct answers based strictly on the content in 'Q: [Question]\\nA: [Answer]' format."
                },
                response_format="text"
            )
        )
        llm_text = str(ai_res.content or "")
        qa_pairs = re.findall(r"Q:\s*(.*?)\s*\nA:\s*(.*?)(?=\nQ:|\Z)", llm_text, flags=re.DOTALL)
        for q, a in qa_pairs:
            q_clean = q.strip()
            a_clean = a.strip()
            if q_clean and a_clean:
                qa_chunks.append({
                    "chunk_type": "qa",
                    "embed_text": q_clean,  # Embed the question text directly for precise matching!
                    "content": f"Question: {q_clean}\nAnswer: {a_clean}",
                    "metadata": {
                        "title": title,
                        "question": q_clean,
                        "answer": a_clean
                    }
                })
    except Exception as llm_err:
        print(f"[PROCESSED_RAG] Q&A generation warning: {llm_err}")

    if not qa_chunks:
        print(f"[PROCESSED_RAG] No chunks created for {processed_module_id}.")
        return {"processed_module_id": processed_module_id, "inserted_count": 0, "status": "no_chunks"}

    # 5. Compute embeddings on embed_text
    embed_texts = [item["embed_text"] for item in qa_chunks]
    embeddings = embed_chunks(embed_texts)

    # 6. Prepare database rows
    db_rows = []
    for idx, (item, emb) in enumerate(zip(qa_chunks, embeddings)):
        meta = item["metadata"]
        meta["model"] = "bge-large-en-v1.5"
        db_rows.append({
            "processed_module_id": processed_module_id,
            "original_module_id": original_module_id or "",
            "company_id": company_id,
            "chunk_type": item["chunk_type"],
            "content": item["content"],
            "embedding": emb.tolist(),
            "metadata": meta
        })

    # 7. Delete existing records for processed_module_id to ensure clean update
    try:
        supabase_admin.table("vectordb_processed_chunks").delete().eq("processed_module_id", processed_module_id).execute()
    except Exception as del_err:
        print(f"[PROCESSED_RAG] Notice during cleanup of old chunks: {del_err}")

    # 8. Insert new vector rows
    insert_res = supabase_admin.table("vectordb_processed_chunks").insert(db_rows).execute()
    inserted_count = len(getattr(insert_res, "data", []) or db_rows)

    print(f"[PROCESSED_RAG] Successfully inserted {inserted_count} vector chunks for processed_module_id: {processed_module_id}")
    return {
        "processed_module_id": processed_module_id,
        "inserted_count": inserted_count,
        "status": "success"
    }
