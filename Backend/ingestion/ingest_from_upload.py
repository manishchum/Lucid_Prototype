import os
from ingestion.pipeline import ingest_pdf_for_rag

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(BASE_DIR)

DOCUMENTS_DIR = os.path.join(BACKEND_DIR, "storage", "documents")


def ingest_by_module_id(module_id: str):
    pdf_path = os.path.join(DOCUMENTS_DIR, f"{module_id}.pdf")
    print("[RAG] Looking for PDF:", pdf_path)

    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    ingest_pdf_for_rag(
        pdf_path=pdf_path,
        doc_id=module_id
    )
