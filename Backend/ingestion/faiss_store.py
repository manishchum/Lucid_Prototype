import os
import faiss
import pickle
from ingestion.config import VECTOR_DB_ROOT, EMBEDDING_DIM

def get_doc_dir(doc_id: str):
    path = os.path.join(VECTOR_DB_ROOT, doc_id)
    print("database folder created at:", path)
    os.makedirs(path, exist_ok=True)
    return path

def create_index():
    return faiss.IndexFlatIP(EMBEDDING_DIM)

def save_index(doc_id: str, index, chunks):
    base = get_doc_dir(doc_id)
    faiss.write_index(index, f"{base}/index.faiss")

    with open(f"{base}/chunks.pkl", "wb") as f:
        pickle.dump(chunks, f)
