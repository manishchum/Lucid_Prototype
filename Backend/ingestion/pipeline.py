

from ingestion.parser import parse_pdf
from ingestion.supabase_store import (
    insert_chunks_to_supabase,
    insert_image_to_supabase
)
from ingestion.embedder import embed_chunks
import os


def ingest_pdf_for_rag(pdf_path: str, doc_id: str):

    text_blocks, images = parse_pdf(pdf_path)

    # 1 chunk per page
    chunks = [block["content"] for block in text_blocks]

    embeddings = embed_chunks(chunks)

    response = insert_chunks_to_supabase(
        module_id=doc_id,
        chunks=chunks,
        embeddings=embeddings,
        source_file=os.path.basename(pdf_path)
    )

    inserted_rows = response.data

    # Safe mapping: chunk_index == page order
    for row in inserted_rows:

        chunk_index = row["chunk_index"]
        chunk_id = row["chunk_id"]

        page_number = text_blocks[chunk_index]["page_number"]

        images_for_page = [
            img for img in images
            if img["page_number"] == page_number
        ]

        for img in images_for_page:

            # Convert bytes to PIL
            from PIL import Image
            import io

            pil_image = Image.open(io.BytesIO(img["bytes"]))

            insert_image_to_supabase(
                module_id=doc_id,
                chunk_id=chunk_id,
                image=pil_image,
                ocr_text=text_blocks[chunk_index]["content"]
            )

    return {
        "module_id": doc_id,
        "chunks_inserted": len(chunks),
        "images_linked": len(images),
        "status": "success"
    }