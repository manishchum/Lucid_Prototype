# import os
# from ingestion.pipeline import ingest_pdf_for_rag

# BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# BACKEND_DIR = os.path.dirname(BASE_DIR)

# DOCUMENTS_DIR = os.path.join(BACKEND_DIR, "storage", "documents")


# def ingest_by_module_id(module_id: str):
#     pdf_path = os.path.join(DOCUMENTS_DIR, f"{module_id}.pdf")
#     print("[RAG] Looking for PDF:", pdf_path)

#     if not os.path.exists(pdf_path):
#         raise FileNotFoundError(f"PDF not found: {pdf_path}")
    
#     print("[RAG] Found PDF, starting ingestion for module_id:", module_id)

#     ingest_pdf_for_rag(
#         pdf_path=pdf_path,
#         doc_id=module_id
#     )


import os
import tempfile
import httpx
from utils.supabase_client import supabase
from ingestion.pipeline import ingest_pdf_for_rag


def ingest_by_module_id(module_id: str):
    """
    Fetch PDF from Supabase using training_modules.content_url
    and ingest it for RAG.

    Works for:
    - Single uploads (original file)
    - Multi uploads (merged file stored in same bucket)
    """

    print(f"[RAG] Fetching content_url for module_id: {module_id}")

    # 1️⃣ Get content_url from DB
    res = (
        supabase
        .table("training_modules")
        .select("content_url")
        .eq("module_id", module_id)
        .single()
        .execute()
    )

    data = getattr(res, "data", None)

    if not data:
        raise FileNotFoundError(f"No training module found for module_id: {module_id}")

    pdf_url = data.get("content_url")

    if not pdf_url:
        raise FileNotFoundError(f"content_url is empty for module_id: {module_id}")

    print(f"[RAG] Downloading PDF from Supabase: {pdf_url}")

    # 2️⃣ Download PDF from Supabase
    with httpx.Client(timeout=60.0) as client:
        response = client.get(pdf_url)
        response.raise_for_status()
        pdf_bytes = response.content

    # 3️⃣ Save temporarily
    temp_dir = tempfile.gettempdir()
    temp_pdf_path = os.path.join(temp_dir, f"{module_id}_rag.pdf")

    with open(temp_pdf_path, "wb") as f:
        f.write(pdf_bytes)

    print(f"[RAG] Temporary PDF saved at: {temp_pdf_path}")

    try:
        # 4️⃣ Run ingestion
        ingest_pdf_for_rag(
            pdf_path=temp_pdf_path,
            doc_id=module_id
        )

        print(f"[RAG] Ingestion completed for module_id: {module_id}")

    finally:
        # 5️⃣ Cleanup
        if os.path.exists(temp_pdf_path):
            os.remove(temp_pdf_path)
            print(f"[RAG] Temp file removed: {temp_pdf_path}")


