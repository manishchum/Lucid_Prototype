
from sentence_transformers import SentenceTransformer
import numpy as np

# Load once at import time (VERY IMPORTANT)
_model = SentenceTransformer(
    "BAAI/bge-large-en-v1.5",
    device= "cpu"
)

# def _has_cuda():
#     try:
#         import torch
#         return torch.cuda.is_available()
#     except Exception:
#         return False


def embed_chunks(chunks: list[str]) -> np.ndarray:
    """
    Generates embeddings for a list of text chunks
    Returns: numpy array of shape (N, 1024)
    """

    # IMPORTANT: BGE models expect this prefix for best performance
    prefixed_chunks = [f"Represent this document for retrieval: {c}" for c in chunks]

    embeddings = _model.encode(
        prefixed_chunks,
        batch_size=4,
        show_progress_bar=True,
        normalize_embeddings=True,  # VERY IMPORTANT for cosine similarity
    )

    return embeddings
