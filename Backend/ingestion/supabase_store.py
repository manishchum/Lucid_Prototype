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

def fetch_module_details(module_id: str):
    res = (
        supabase
        .table("training_modules")
        .select("module_id, title, company_id")
        .eq("module_id", module_id)
        .single()
        .execute()
    )

    if not res.data:
        raise ValueError(f"Module not found: {module_id}")

    return res.data


def insert_chunks_to_supabase(
    module_id: str,
    chunks: List[str],
    embeddings: np.ndarray,
    source_file: str,
):
    print("Inserting chunks into Supabase for module_id:", module_id)
    module = fetch_module_details(module_id)
    print("Fetched module details:", module_id)

    rows = []

    for idx, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
        rows.append({
            "company_id": module["company_id"],
            "module_id": module_id,
            "module_title": module["title"],
            "chunk_index": idx,
            "content": chunk,
            "embedding": embedding.tolist(),  # VERY IMPORTANT
            "metadata": {
                "source": source_file,
                "chunk_size": 500,
                "overlap": 80,
                "embedding_model": "bge-large-en-v1.5"
            }
        })
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


def insert_image_to_supabase(module_id, chunk_id, image, ocr_text):

    if image is None:
        print("Skipping None image")
        return
    image_bytes = io.BytesIO()
    image.save(image_bytes, format='PNG')
    image_bytes.seek(0)

    file_path = f"{module_id}/images/{chunk_id}_{uuid.uuid4()}.png"
    try:
        supabase.storage.from_(BUCKET).upload(
            file_path,
            image_bytes.getvalue(),
            {"content-type": "image/png"}
        )
        print(f"[SUPABASE] ✅ Uploaded image for chunk_id {chunk_id} to storage at {file_path}")
    

        public_url = supabase.storage.from_(BUCKET).get_public_url(file_path)
        print(f"[SUPABASE] Public URL for image: {public_url}")

        supabase.table("vectordb_images").insert({
            "module_id":module_id,
            "chunk_id": chunk_id,
            "image_url": public_url,
            "storage_path": file_path,
            "caption": ocr_text,
            "surrounding_text": ocr_text,
            "embedding": None,
            "metadata": {}
        }).execute()
        print(f"[SUPABASE] ✅ Inserted image metadata for chunk_id {chunk_id} into vectordb_images")
    except Exception as e:
        print(f"[SUPABASE ERROR] Failed to upload image for chunk_id {chunk_id}: {type(e).__name__}")




