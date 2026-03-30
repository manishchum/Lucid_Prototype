
from sentence_transformers import SentenceTransformer
import numpy as np

# Lazy load model on first use
_model = None

def get_model():
    global _model
    if _model is None:
        _model = SentenceTransformer(
            "BAAI/bge-large-en-v1.5",
            device="cpu",
            cache_folder="./models"  # Cache locally to avoid redownloads
        )
    return _model
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

class EmbedRequest(BaseModel):
    text: str

@router.post("/embed-query")
def embed_query_api(req: EmbedRequest):
    embedding = get_model().encode(
        f"Represent this document for retrieval: {req.text}",
        normalize_embeddings=True
    )
    return {"embedding": embedding.tolist()}


DOCUMENT_PREFIX = "Represent this document for retrieval: "
QUERY_PREFIX = "Represent this sentence for searching relevant passages: "

def embed_chunks(chunks: list[str]) -> np.ndarray:
    """
    Generates embeddings for a list of text chunks
    Returns: numpy array of shape (N, 1024)
    """
    # IMPORTANT: BGE models expect this prefix for best performance
    prefixed = [DOCUMENT_PREFIX + c for c in chunks]
    embeddings = _model.encode(
        prefixed,
        batch_size=4,
        show_progress_bar=True,
        normalize_embeddings=True,  # VERY IMPORTANT for cosine similarity
    )

    return embeddings
