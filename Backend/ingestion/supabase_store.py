# ingestion/supabase_store.py
import io
from supabase import create_client
from typing import List
import numpy as np
import os
import config
from PIL import Image as PILImage
import uuid

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY") or os.getenv("SUPABASE_ANON_KEY")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
BUCKET = "module-assets"

def fetch_document_details(doc_id: str, source_type="training"):
    
    if source_type == "training":
        res = (
            supabase
            .table("training_modules")
            .select("module_id, title, company_id")
            .eq("module_id", doc_id)
            .single()
            .execute()
        )

        if not res.data:
            raise ValueError(f"Module not found: {doc_id}")

        return {
            "company_id": res.data["company_id"],
            "title": res.data["title"]
        }

    elif source_type == "sales_tool":

        res = (
            supabase
            .table("sales_tool_documents")
            .select("document_id, file_name, company_id")
            .eq("document_id", doc_id)
            .single()
            .execute()
        )

        if not res.data:
            raise ValueError(f"Document not found: {doc_id}")

        return {
            "company_id": res.data["company_id"],
            "title": res.data["file_name"]
        }


def insert_chunks_to_supabase(
    doc_id: str,
    chunks: List[str],
    embeddings: np.ndarray,
    source_file: str,
    source_type="training"
):
    print("Inserting chunks into Supabase for doc_id:", doc_id)
    document = fetch_document_details(doc_id, source_type)
    print("Fetched document details:", doc_id)

    rows = []

    for idx, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
        row = {
            "company_id": document["company_id"],
            "module_title": document["title"],
            "chunk_index": idx,
            "content": chunk,
            "embedding": embedding.tolist(),
            "metadata": {
                "source": source_file,
                "chunk_size": 500,
                "overlap": 80,
                "embedding_model": "bge-large-en-v1.5"
            }
        }
        if source_type == "training":
            row["module_id"] = doc_id
        else:
            row["source_document_id"] = doc_id
        
        rows.append(row)
        print(f"Prepared chunk {idx} for insertion")
        

    print(f"[SUPABASE] Attempting to insert {len(rows)} rows into vectordb_chunks...")
    try:
        response = supabase.table("vectordb_chunks").insert(rows).execute()
        print(f"[SUPABASE] ✅ Successfully inserted {len(rows)} chunks")
        if hasattr(response, 'data') and response.data:
            print(f"[SUPABASE] Response data count: {len(response.data)}")
        return response
    except Exception as e:
        print(f"[SUPABASE ERROR] Failed to insert chunks: {type(e).__name__}")
        print(f"[SUPABASE ERROR] Error message: {str(e)}")
        import traceback
        print(f"[SUPABASE ERROR] Traceback:\n{traceback.format_exc()}")
        raise


def insert_image_to_supabase(doc_id, chunk_id, image, ocr_text, source_type="training"):

    if image is None:
        print("Skipping None image")
        return
    image_bytes = io.BytesIO()
    image.save(image_bytes, format='PNG')
    image_bytes.seek(0)

    file_path = f"{doc_id}/images/{chunk_id}_{uuid.uuid4()}.png"
    try:
        supabase.storage.from_(BUCKET).upload(
            file_path,
            image_bytes.getvalue(),
            {"content-type": "image/png"}
        )
        print(f"[SUPABASE] ✅ Uploaded image for chunk_id {chunk_id} to storage at {file_path}")

        # Store the relative path, not a public URL
        # supabase.table("vectordb_images").insert({
        #     "module_id": module_id,
        #     "chunk_id": chunk_id,
        #     "storage_path": file_path,  # Store the path directly
        #     "caption": "",  # Placeholder for caption
        #     "surrounding_text": ocr_text
        # }).execute()
        payload = {
            "chunk_id": chunk_id,
            "storage_path": file_path,
            "caption": "",
            "surrounding_text": ocr_text
        }

        if source_type == "training":
            payload["module_id"] = doc_id
        else:
            payload["source_document_id"] = doc_id

        supabase.table("vectordb_images").insert(payload).execute()

        print(f"[SUPABASE] ✅ Linked image path {file_path} to chunk {chunk_id}")

    except Exception as e:
        print(f"❌ Failed to upload/insert image for chunk {chunk_id}: {e}")




