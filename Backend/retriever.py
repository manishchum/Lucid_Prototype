import os
import pickle
import faiss
import numpy as np
from sentence_transformers import SentenceTransformer

# Load embedding model ONCE
_model = None

def get_embedding_model():
    global _model
    if _model is None:
        _model = SentenceTransformer("BAAI/bge-large-en-v1.5")
    return _model


def retrieve_chunks(
    query: str,
    doc_id: str,
    top_k: int = 5,
):
    """
    Returns top_k text chunks relevant to the query
    """
    base_path = f"storage/vector_db/{doc_id}"

    index_path = os.path.join(base_path, "index.faiss")
    chunks_path = os.path.join(base_path, "chunks.pkl")

    if not os.path.exists(index_path) or not os.path.exists(chunks_path):
        raise FileNotFoundError(f"Vector DB not found for doc_id={doc_id}")

    # Load FAISS index
    index = faiss.read_index(index_path)

    # Load chunks
    with open(chunks_path, "rb") as f:
        chunks = pickle.load(f)

    # Embed query
    model = get_embedding_model()
    query_embedding = model.encode(
        [query],
        normalize_embeddings=True
    ).astype("float32")

    # Search
    scores, indices = index.search(query_embedding, top_k)

    results = []
    for score, idx in zip(scores[0], indices[0]):
        if idx == -1:
            continue
        results.append({
            "score": float(score),
            "text": chunks[idx]
        })

    return results
