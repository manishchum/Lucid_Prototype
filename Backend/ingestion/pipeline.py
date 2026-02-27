from ingestion.config import CHUNK_SIZE, CHUNK_OVERLAP
from ingestion.parser import parse_pdf_rich
from ingestion.chunker import chunk_text
from ingestion.embedder import embed_chunks
from ingestion.faiss_store import create_index, save_index
from ingestion.supabase_store import insert_chunks_to_supabase
import os
def ingest_pdf_for_rag(pdf_path: str, doc_id: str):

    # 1. Parse document richly
    text = parse_pdf_rich(pdf_path)

    # 2. Chunk
    chunks = chunk_text(text, CHUNK_SIZE, CHUNK_OVERLAP)

    # 3. Embed
    embeddings = embed_chunks(chunks)


    # 4. Store in Supabase
    print (f"Storing {len(chunks)} chunks in Supabase for doc_id: {doc_id}")
    insert_chunks_to_supabase(
        module_id=doc_id,
        chunks=chunks,
        embeddings=embeddings,
        source_file=os.path.basename(pdf_path)

    )   
    print(f"Supabase ingestion complete, total chunks: {len(chunks)}")

    return {
        "doc_id": doc_id,
        "chunks": len(chunks),
        "embedding_model": "bge-large-en-v1.5",
        "status": "stored_in_supabase"
    }
