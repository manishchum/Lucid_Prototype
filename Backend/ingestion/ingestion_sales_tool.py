import os
import tempfile
from unittest import result
import httpx

from utils.supabase_client import supabase
from ingestion.pipeline import ingest_pdf_for_rag

from utils.trigger_lucid_jobs import trigger_lucid_jobs
def ingest_by_document_id(document_id: str):

    res = (
        supabase
        .table("sales_tool_documents")
        .select("context_url")
        .eq("document_id", document_id)
        .single()
        .execute()
    )

    data = res.data

    if not data:
        raise Exception("Document not found")

    pdf_url = data["context_url"]

    with httpx.Client(timeout=60.0) as client:
        response = client.get(pdf_url)
        response.raise_for_status()
        pdf_bytes = response.content

    temp_pdf_path = os.path.join(
        tempfile.gettempdir(),
        f"{document_id}.pdf"
    )

    with open(temp_pdf_path, "wb") as f:
        f.write(pdf_bytes)

    try:
        result = ingest_pdf_for_rag(
            pdf_path=temp_pdf_path,
            doc_id=document_id,
            source_type="sales_tool"
        )
        trigger_lucid_jobs(document_id)

        return result

    finally:
        if os.path.exists(temp_pdf_path):
            os.remove(temp_pdf_path)