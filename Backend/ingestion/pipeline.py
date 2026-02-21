# from ingestion.config import CHUNK_SIZE, CHUNK_OVERLAP
# from ingestion.parser import parse_pdf
# from ingestion.chunker import chunk_text
# from ingestion.embedder import embed_chunks
# from ingestion.faiss_store import create_index, save_index
# from ingestion.supabase_store import insert_chunks_to_supabase
# import os
# from ingestion.supabase_store import insert_image_to_supabase

# def ingest_pdf_for_rag(pdf_path: str, doc_id: str):

#     # 1. Parse document richly
#     text_blocks, extracted_images = parse_pdf(pdf_path)

#     # convert structured blcoks into chunk groups
#     chunk_groups = []
#     current_text = ""
#     current_page = None
    
#     # Group text by page
#     page_text_map = {}

#     for block in blocks:
#         page = block["page"]

#         if page not in page_text_map:
#             page_text_map[page] = ""

#         page_text_map[page] += "\n" + block["content"]

#     chunk_groups = []

#     for page, text in page_text_map.items():

#         words = text.split()

#         for i in range(0, len(words), 500):
#             chunk_text = " ".join(words[i:i+500])

#             chunk_groups.append({
#                 "text": chunk_text,
#                 "page": page
#             })
#     # for block in blocks:

#     #     if block["type"] == "text":
#     #         current_text += "\n" + block["content"]
            
#     #         if block["page"] is not None:
#     #             current_page = block["page"]

#     #         if len(current_text.split()) >= 500:
#     #             chunk_groups.append({
#     #                 "text": current_text,
#     #                 "page": current_page,
#     #             })
#                 # current_text = ""




#     if current_text.strip():
#         chunk_groups.append({
#             "text": current_text,
#             "page": current_page,
#         })

#     chunks = [g["text"] for g in chunk_groups]
#     embeddings = embed_chunks(chunks)

#     print(f"Generated {len(chunks)} chunks with embeddings for doc_id: {doc_id}")
#     response = insert_chunks_to_supabase(
#         module_id=doc_id,
#         chunks=chunks,
#         embeddings=embeddings,
#         source_file=os.path.basename(pdf_path)
#     )
#     print("response received from insert_chunks_to_supabase:", response)
#     # This will return chunk ids and other metadata which we can use to link images to the correct chunks in the future when we implement image RAG
#     inserted_rows = response.data 

#     for row in inserted_rows:
#         chunk_page = chunk_groups[row["chunk_index"]]["page"]
#         chunk_id = row["chunk_id"]

#         images_for_page = [
#             img for img in extracted_images
#             if img["page"] == chunk_page
#         ]

#         print(f"Processing images for chunk_id: {chunk_id}, found {len(images_for_page)} images")

#         for img in images_for_page:
#             insert_image_to_supabase(
#                 module_id=doc_id,
#                 chunk_id=chunk_id,
#                 image=img["image"],
#                 ocr_text=None
#             )


#     return {
#         "doc_id": doc_id,
#         "chunks": len(chunks),
#         "embedding_model": "bge-large-en-v1.5",
#         "status": "stored_with_images"
#     }

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