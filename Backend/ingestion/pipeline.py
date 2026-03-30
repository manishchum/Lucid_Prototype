from ingestion.parser import parse_pdf
from ingestion.supabase_store import (
    insert_chunks_to_supabase,
    insert_image_to_supabase
)
from ingestion.embedder import embed_chunks
from ingestion.chunker import chunk_text
from ingestion.config import CHUNK_SIZE, CHUNK_OVERLAP
import os


def ingest_pdf_for_rag(pdf_path: str, doc_id: str):
    text_blocks, images = parse_pdf(pdf_path)

    # Split each page into smaller chunks that stay under embedder token limit
    page_chunks = []
    for block in text_blocks:
        sub_chunks = chunk_text(
            block["content"],
            size=CHUNK_SIZE,
            overlap=CHUNK_OVERLAP
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
        module_id=doc_id,
        chunks=chunks,
        embeddings=embeddings,
        source_file=os.path.basename(pdf_path)
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
                module_id=doc_id,
                chunk_id=chunk_id,
                image=pil_image,
                ocr_text=chunk_text_content
            )

    return {
        "module_id": doc_id,
        "chunks_inserted": len(chunks),
        "images_linked": len(images),
        "status": "success"
    }