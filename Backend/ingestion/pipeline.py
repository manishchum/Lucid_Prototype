from ingestion.parser import parse_pdf
from ingestion.supabase_store import (
    insert_chunks_to_supabase,
    insert_image_to_supabase,
    fetch_document_details
)
from ingestion.embedder import embed_chunks
from ingestion.chunker import chunk_text
from ingestion.company_config import get_company_rag_config
import os


def ingest_pdf_for_rag(pdf_path: str, doc_id: str, source_type="training"):
    # Fetch module details to get company_id
    module_details = fetch_document_details(doc_id, source_type)
    company_id = module_details.get("company_id")
    
    # Get company-specific RAG configuration
    rag_config = get_company_rag_config(company_id)
    chunk_size = rag_config.get('rag_chunk_size', 250)
    chunk_overlap = rag_config.get('rag_chunk_overlap', 40)
    
    print(f"[RAG CONFIG] Using chunk_size={chunk_size}, chunk_overlap={chunk_overlap} for company {company_id}")
    
    text_blocks, images = parse_pdf(pdf_path)

    # Split each page into smaller chunks that stay under embedder token limit
    page_chunks = []
    for block in text_blocks:
        sub_chunks = chunk_text(
            block["content"],
            size=chunk_size,
            overlap=chunk_overlap
        )

        for sc in sub_chunks:
            if sc.strip():
                page_chunks.append({
                    "content": sc,
                    "page_number": block["page_number"]
                })

    chunks = [c["content"] for c in page_chunks]

    embeddings = embed_chunks(chunks)

    response = insert_chunks_to_supabase(
        doc_id=doc_id,
        chunks=chunks,
        embeddings=embeddings,
        source_file=os.path.basename(pdf_path),
        source_type=source_type
    )

    inserted_rows = response.data

    for row in inserted_rows:
        chunk_index = row["chunk_index"]
        chunk_id = row["chunk_id"]

        # IMPORTANT: map against page_chunks, not text_blocks
        page_number = page_chunks[chunk_index]["page_number"]
        chunk_text_content = page_chunks[chunk_index]["content"]

        images_for_page = [
            img for img in images
            if img["page_number"] == page_number
        ]

        for img in images_for_page:
            from PIL import Image
            import io

            pil_image = Image.open(io.BytesIO(img["bytes"]))

            insert_image_to_supabase(
                doc_id=doc_id,
                chunk_id=chunk_id,
                image=pil_image,
                ocr_text=chunk_text_content,
                source_type=source_type
            )

    return {
        "module_id": doc_id,
        "chunks_inserted": len(chunks),
        "images_linked": len(images),
        "status": "success"
    }