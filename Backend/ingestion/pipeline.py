from ingestion.config import CHUNK_SIZE, CHUNK_OVERLAP
from ingestion.parser import parse_pdf_rich
from ingestion.chunker import chunk_text
from ingestion.embedder import embed_chunks
from ingestion.faiss_store import create_index, save_index
import os
def ingest_pdf_for_rag(pdf_path: str, doc_id: str):

    vector_dir = f"storage/vector_db/{doc_id}"

    if os.path.exists(os.path.join(vector_dir, "index.faiss")):
        print("Vector DB already exists, skipping ingestion")
        return
    # 1. Parse document richly
    text = parse_pdf_rich(pdf_path)

    # 2. Chunk
    chunks = chunk_text(text, CHUNK_SIZE, CHUNK_OVERLAP)

    # 3. Embed
    embeddings = embed_chunks(chunks)

    # 4. Build FAISS
    index = create_index()
    index.add(embeddings)

    # 5. Store
    save_index(doc_id, index, chunks)

    return {
        "doc_id": doc_id,
        "chunks": len(chunks),
        "embedding_model": "bge-large-en-v1.5",
        "status": "vector_db_created"
    }
