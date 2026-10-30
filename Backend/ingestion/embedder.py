from sentence_transformers import SentenceTransformer
import numpy as np
import os
import shutil
import threading

# Thread locks for safe concurrent model loading & inference in distributed workers
_model_lock = threading.Lock()
_encode_lock = threading.Lock()
_model = None

def get_model():
    """Thread-safe singleton model loader."""
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                _model = SentenceTransformer(
                    "BAAI/bge-large-en-v1.5",
                    device="cpu",
                    cache_folder=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")
                )
    return _model

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

class EmbedRequest(BaseModel):
    text: str

@router.post("/embed-query")
def embed_query_api(req: EmbedRequest):
    model = get_model()
    with _encode_lock:
        embedding = model.encode(
            f"Represent this document for retrieval: {req.text}",
            normalize_embeddings=True
        )
    return {"embedding": embedding.tolist()}


DOCUMENT_PREFIX = "Represent this document for retrieval: "
QUERY_PREFIX = "Represent this sentence for searching relevant passages: "

def embed_chunks(chunks: list[str]) -> np.ndarray:
    """
    Generates embeddings for a list of text chunks.
    Thread-safe inference using mutex to prevent BLAS / CPU contention across worker threads.
    Returns: numpy array of shape (N, 1024)
    """
    model = get_model()
    # IMPORTANT: BGE models expect this prefix for best performance
    prefixed = [DOCUMENT_PREFIX + c for c in chunks]
    with _encode_lock:
        embeddings = model.encode(
            prefixed,
            batch_size=32,
            show_progress_bar=False,
            normalize_embeddings=True,  # VERY IMPORTANT for cosine similarity
        )

    return embeddings


def cleanup_model_cache():
    """
    Unload the model from memory and delete the cache directory.
    Call this after ingestion is completed to clean up disk space.
    """
    global _model
    
    with _model_lock:
        # Unload model from memory
        if _model is not None:
            del _model
            _model = None
            print("[CLEANUP] Model unloaded from memory")
        
        # Delete model cache directory
        cache_folder = "./models"
        if os.path.exists(cache_folder):
            try:
                shutil.rmtree(cache_folder)
                print(f"[CLEANUP] Model cache deleted: {cache_folder}")
            except Exception as e:
                print(f"[CLEANUP] Error deleting model cache: {e}")
