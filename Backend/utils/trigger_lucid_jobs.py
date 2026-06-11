from utils.supabase_client import supabase


def trigger_lucid_jobs(document_id: str):

    jobs = (
        supabase
        .table("lucid_tool_jobs")
        .select("id")
        .eq("source_document_id", document_id)
        .execute()
    )

    if not jobs.data:
        print(f"[Lucid] No jobs found for document {document_id}")
        return

    for job in jobs.data:

        existing = (
            supabase
            .table("lucid_tool_content_jobs")
            .select("id")
            .eq("lucid_tool_job_id", job["id"])
            .execute()
        )

        if existing.data:
            continue

        supabase.table(
            "lucid_tool_content_jobs"
        ).insert({
            "lucid_tool_job_id": job["id"],
            "status": "pending"
        }).execute()

        print(
            f"[Lucid] Content job created for tool job {job['id']}"
        )