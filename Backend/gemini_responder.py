import os
import pickle
from typing import List, Dict

import faiss
import numpy as np
from sentence_transformers import SentenceTransformer
from google import genai


# =========================
# CONFIG (EDIT THESE)
# =========================
EMBEDDING_MODEL = "BAAI/bge-large-en-v1.5"
DEVICE = "cpu"  # change to "cuda" if available
TOP_K = 5

GEMINI_MODEL = "gemini-3-flash-preview"  # you can change later


# =========================
# CLIENTS
# =========================
print("[INFO] Loading embedding model...")
embedder = SentenceTransformer(EMBEDDING_MODEL, device=DEVICE)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY is not set in environment variables")

gemini_client = genai.Client(api_key=GEMINI_API_KEY)


# =========================
# LOAD FAISS DB
# =========================
def load_faiss_db(db_folder: str):
    index_path = os.path.join(db_folder, "index.faiss")
    chunks_path = os.path.join(db_folder, "chunks.pkl")

    if not os.path.exists(index_path):
        raise FileNotFoundError(f"index.faiss not found in: {db_folder}")
    if not os.path.exists(chunks_path):
        raise FileNotFoundError(f"chunks.pkl not found in: {db_folder}")

    print(f"[INFO] Loading FAISS index: {index_path}")
    index = faiss.read_index(index_path)

    print(f"[INFO] Loading chunks: {chunks_path}")
    with open(chunks_path, "rb") as f:
        chunks = pickle.load(f)

    # chunks must be list[str]
    if not isinstance(chunks, list) or (len(chunks) > 0 and not isinstance(chunks[0], str)):
        raise ValueError("chunks.pkl must be a list of strings")

    return index, chunks


# =========================
# EMBED QUERY
# =========================
def embed_query(text: str) -> np.ndarray:
    emb = embedder.encode(
        [text],
        normalize_embeddings=True,
        convert_to_numpy=True
    )
    return emb.astype("float32")  # shape: (1, dim)


# =========================
# QUERY FAISS
# =========================
def query_faiss(index, chunks: List[str], query: str, top_k: int = 5) -> List[Dict]:
    q = embed_query(query)
    scores, indices = index.search(q, top_k)

    results = []
    for rank, idx in enumerate(indices[0]):
        if idx == -1:
            continue
        results.append({
            "rank": rank + 1,
            "score": float(scores[0][rank]),
            "text": chunks[idx]
        })
    return results


# =========================
# BUILD RAG PROMPT
# =========================
def build_rag_prompt(user_query: str, retrieved: List[Dict]) -> str:
    # Keep context bounded but useful
    context_blocks = []
    for r in retrieved:
        context_blocks.append(
            f"[Context {r['rank']}] (score={r['score']:.4f})\n{r['text']}"
        )
    context = "\n\n".join(context_blocks)

    return f"""
You are an expert instructional content writer.

STRICT RULES (must follow):
1) Use ONLY the information in the PROVIDED CONTEXT to answer.
2) Do NOT add outside knowledge.
3) If the context is insufficient, say: "Not enough information in the provided context."
4) Keep the answer structured and learner-friendly.

USER QUERY:
{user_query}

PROVIDED CONTEXT:
{context}

TASK:
Write a clear, detailed answer to the user query using the context only.
""".strip()


# =========================
# GEMINI CALL
# =========================
def ask_gemini(prompt: str) -> str:
    response = gemini_client.models.generate_content(
        model=GEMINI_MODEL,
        contents=[prompt]
    )
    return (getattr(response, "text", "") or "").strip()


# =========================
# MAIN RUN
# =========================
def run_rag(db_folder: str, user_query: str, top_k: int = 5):
    index, chunks = load_faiss_db(db_folder)

    print("\n==============================")
    print("USER QUERY:")
    print(user_query)
    print("==============================\n")

    retrieved = query_faiss(index, chunks, user_query, top_k=top_k)

    print("🔍 TOP-K RETRIEVED CHUNKS\n")
    for r in retrieved:
        print(f"--- Rank {r['rank']} | score={r['score']:.4f} ---")
        print(r["text"][:700])
        print("\n----------------------------\n")

    prompt = build_rag_prompt(user_query, retrieved)

    print("\n🧠 Sending grounded prompt to Gemini...\n")
    answer = ask_gemini(prompt)

    print("\n==============================")
    print("✅ GEMINI RESPONSE:")
    print(answer)
    print("==============================\n")


if __name__ == "__main__":
    # ✅ Change this path to your FAISS folder containing index.faiss + chunks.pkl
    VECTOR_DB_FOLDER = "path/to/your/vector_db_folder"
    # Example:
    # VECTOR_DB_FOLDER = "storage/vector_db/<module_id>"

    # ✅ Put your query here (can be title+topics+objectives OR normal question)
    QUERY = (
        "Explain Dabur's rural penetration strategy including Yoddha channel, "
        "ASTRA training, and low unit pac
    )
    run_rag(VECTOR_DB_FOLDER, QUERY, top_k=TOP_K)