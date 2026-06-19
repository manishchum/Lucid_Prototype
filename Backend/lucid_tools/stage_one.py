import json
import os
import google.generativeai as genai
from utils.supabase_client import supabase # Assuming you have a supabase client utility
from typing import List, Dict

genai.configure(
    api_key=os.getenv("GEMINI_API_KEY")
)

model = genai.GenerativeModel(
    "gemini-2.5-pro"
)

async def get_tools_for_category(category_id: str) -> List[Dict]:
    """Fetches all predefined tools for a given category from the database."""
    try:
        response = supabase.table("tools").select("id, name, description").eq("category_id", category_id).execute()
        if response.data:
            return response.data
        return []
    except Exception as e:
        print(f"[Lucid Tools - Stage 1] Error fetching tools: {e}")
        return []

async def call_gemini_for_retrieval_queries(
    document_content: str,
    tools: List[Dict]
) -> Dict:

    prompt = f"""
You are an expert AI system that plans retrieval strategies for enterprise document intelligence.

Analyze the document and the tools.

For each tool generate a semantic retrieval query.

A semantic retrieval query is NOT the tool name.

It should describe:

- what information should be retrieved
- what concepts should be searched
- what facts should be extracted
- what context would help generate the tool output

Return ONLY valid JSON.

DOCUMENT:
-------------------
{document_content}
-------------------

TOOLS:
-------------------
{json.dumps(tools, indent=2)}
-------------------

Expected format:

{{
    "tool_id_1": "semantic retrieval query",
    "tool_id_2": "semantic retrieval query"
}}
"""

    try:

        response = model.generate_content(
            prompt,
            generation_config={
                "response_mime_type": "application/json"
            }
        )

        llm_response_str = response.text.strip()

        retrieval_queries = json.loads(
            llm_response_str
        )

        return retrieval_queries

    except Exception as e:
        print(
            f"[Lucid Tools - Stage 1] Gemini Error: {e}"
        )
        return {}


async def create_tool_generation_jobs(source_document_id: str, document_content: str, category_id: str, user_id: str, company_id: str):
    """
    Orchestrates Stage 1: Fetches tools, calls Gemini to get retrieval queries,
    and saves the results as jobs in the 'lucid_tool_jobs' table.
    """
    print("====================================")
    print("STAGE 1 STARTED")
    print("====================================")
    print(f"[Lucid Tools - Stage 1] Starting job creation for document {source_document_id}")
    
    # 1. Get all tools for the selected category
    tools = await get_tools_for_category(category_id)
    if not tools:
        print(f"[Lucid Tools - Stage 1] No tools found for category {category_id}. Aborting.")
        return {"status": "failed", "reason": "No tools found for category"}

    # 2. Call Gemini to get the semantic retrieval queries
    retrieval_queries = await call_gemini_for_retrieval_queries(document_content, tools)
    if not retrieval_queries:
        print(f"[Lucid Tools - Stage 1] Failed to generate retrieval queries from LLM. Aborting.")
        return {"status": "failed", "reason": "LLM query generation failed"}

    # 3. Prepare the job data to be inserted into the database
    jobs_to_insert = []
    for tool in tools:
        tool_id = tool['id']
        if tool_id in retrieval_queries:
            jobs_to_insert.append({
                "source_document_id": source_document_id,
                "user_id": user_id,
                "company_id": company_id,
                "category_id": category_id,
                "tool_id": tool_id,
                "semantic_retrieval_query": retrieval_queries[tool_id],
                "status": "pending" # Ready for the Stage 2 worker
            })

    # 4. Insert all jobs into the lucid_tool_jobs table in a single batch
    if jobs_to_insert:
        try:
            response = supabase.table("lucid_tool_jobs").insert(jobs_to_insert).execute()
            if response.data:
                print(f"[Lucid Tools - Stage 1] Successfully created {len(response.data)} generation jobs.")
                return {"status": "success", "jobs_created": len(response.data)}
            else:
                # Handle potential insertion error from Supabase
                print(f"[Lucid Tools - Stage 1] Supabase insertion failed: {response.error}")
                return {"status": "failed", "reason": "Database insertion failed"}
        except Exception as e:
            print(f"[Lucid Tools - Stage 1] Database insertion exception: {e}")
            return {"status": "failed", "reason": str(e)}

    return {"status": "success", "jobs_created": 0}
