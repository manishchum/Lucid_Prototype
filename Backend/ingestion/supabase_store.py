# ingestion/supabase_store.py
from supabase import create_client
from typing import List
import numpy as np
import os
import config

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


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
