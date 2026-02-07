# This file will be sued later to generate RAG content for training modules.


import os
from typing import List, Dict

import numpy as np
from supabase import create_client, Client
from sentence_transformers import SentenceTransformer
from google import genai
import config
# ---------- Supabase ----------
SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = (
    os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
)

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Supabase credentials missing")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ---------- Gemini ----------
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY missing")

gemini_client = genai.Client(api_key=GEMINI_API_KEY)

# ---------- Embedding Model ----------
embedder = SentenceTransformer(
    config.EMBEDDING_MODEL_NAME,  
    device=config.DEVICE  
)

def clean_items(items: List[str]) -> List[str]:
    cleaned = []
    for i in items:
        if not i or not isinstance(i, str):
            continue
        t = i.strip()
        if not t:
            continue
        if t in {"*", "--"}:
            continue
        if t.lower().startswith("*module splitting"):
            continue
        cleaned.append(t)
    return cleaned


def build_object_text(obj: Dict) -> str:
    title = obj.get("title", "").strip()
    topics = clean_items(obj.get("topics", []))
    objectives = clean_items(obj.get("objectives", []))

    text = f"Module Title: {title}\n\n"

    if topics:
        text += "Topics Covered:\n"
        for t in topics:
            text += f"- {t}\n"

    if objectives:
        text += "\nLearning Objectives:\n"
        for o in objectives:
            text += f"- {o}\n"

    return text.strip()

def embed_query(text: str) -> np.ndarray:
    emb = embedder.encode(
        [text],
        normalize_embeddings=True,
        convert_to_numpy=True
    )
    return emb.astype("float32")[0]

def retrieve_top_k(query_embedding: np.ndarray, k: int = config.TOP_K):
    resp = supabase.rpc(
        "match_module_embeddings",
        {
            "query_embedding": query_embedding.tolist(),
            "match_count": k
        }
    ).execute()

    return resp.data or []

def build_rag_prompt(object_text: str, retrieved: List[Dict]) -> str:
    context = "\n\n".join(
        f"Context {i+1}:\n{r['source_text']}"
        for i, r in enumerate(retrieved)
    )

    return f"""
You are an expert instructional content writer.

STRICT RULES:
- Use ONLY the information provided below
- Do NOT add external knowledge
- Do NOT hallucinate
- If information is missing, say so clearly

OBJECT TO EXPAND:
----------------
{object_text}

RELEVANT CONTEXT:
----------------
{context}

TASK:
Generate detailed, structured learning content aligned strictly to the object.
"""
def generate_content(prompt: str) -> str:
    response = gemini_client.models.generate_content(
        model="gemini-3-flash-preview",
        contents=[prompt]
    )
    return getattr(response, "text", "").strip()

def save_rag_content(
    module_id: str,
    title: str,
    rag_content: str
):
    supabase.table("processed_modules").update(
        {"RAG_content": rag_content}
    ).eq(
        "original_module_id", module_id
    ).eq(
        "title", title
    ).execute()

def run_rag_content_generation(module_id: str, top_k: int = 3):
    # Fetch ai_modules
    resp = (
        supabase
        .table("training_modules")
        .select("ai_modules")
        .eq("module_id", module_id)
        .single()
        .execute()
    )

    ai_modules = resp.data.get("ai_modules", [])
    if not ai_modules:
        raise RuntimeError("No ai_modules found")

    for obj in ai_modules:
        title = obj["title"]

        print(f"[RAG] Generating content for: {title}")

        object_text = build_object_text(obj)
        query_embedding = embed_query(object_text)

        retrieved = retrieve_top_k(query_embedding, k=top_k)

        if not retrieved:
            print(f"[RAG] No context found for {title}, skipping")
            continue

        prompt = build_rag_prompt(object_text, retrieved)
        rag_content = generate_content(prompt)

        save_rag_content(
            module_id=module_id,
            title=title,
            rag_content=rag_content
        )

        print(f"[RAG] Saved RAG content for: {title}")

if __name__ == "__main__":
    MODULE_ID = "your-module-id-here"
    run_rag_content_generation(MODULE_ID)