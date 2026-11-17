# Backend/scripts/test_coach_intelligence.py
"""
Interactive / End-to-End Test Script for the Performance Coach Intelligence Layer.
Tests live querying against Supabase:
  1. Inspects existing uploaded coach documents, spreadsheet rows, and vector chunks.
  2. Tests Schema Introspection for the active company.
  3. Tests Text-to-SQL execution against real coach_spreadsheet_rows.
  4. Tests Vector RAG retrieval against real coach_document_chunks.
  5. Tests End-to-End Coach Intelligence Agent via execute_coach_agent.
"""

import os
import sys
import json
import logging

os.environ["OTEL_SDK_DISABLED"] = "true"
os.environ["GUARDRAILS_DISABLE_TRACING"] = "true"
logging.getLogger("opentelemetry").setLevel(logging.CRITICAL)
logging.getLogger("opentelemetry.exporter.otlp").setLevel(logging.CRITICAL)

# Ensure Backend/ is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from utils.supabase_client import supabase_admin
from coach.schema_inspector import (
    get_company_spreadsheet_schema,
    get_company_document_catalog,
    format_schema_for_sql_prompt
)
from coach.tools.sql_tool import generate_coach_sql, execute_coach_sql
from coach.tools.rag_tool import search_coach_knowledge, extract_citations_from_chunks
from coach.graph import execute_coach_agent


def main():
    print("=" * 80)
    print(" PERFORMANCE COACH INTELLIGENCE LAYER: BACKEND TEST BENCH")
    print("=" * 80)

    # 1. Discover active companies with coach documents
    print("\n[STEP 1] Scanning database for uploaded coach documents...")
    docs_res = (
        supabase_admin.table("coach_uploaded_documents")
        .select("id, company_id, file_name, file_type, document_period, status, created_at")
        .order("created_at", desc=True)
        .limit(20)
        .execute()
    )
    docs = getattr(docs_res, "data", None) or []

    if not docs:
        print("[!] No uploaded coach documents found in coach_uploaded_documents table.")
        print("    Please upload a spreadsheet (.xlsx/.csv) or document in the Coach Console first,")
        print("    or run an ingestion pipeline test.")
        return

    print(f"Found {len(docs)} uploaded document(s):")
    companies_found = set()
    for d in docs:
        c_id = d["company_id"]
        companies_found.add(c_id)
        status_icon = "OK" if d["status"] == "completed" else d["status"].upper()
        period_str = f" ({d['document_period']})" if d.get("document_period") else ""
        print(f"  - [{status_icon}] {d['file_name']} [{d['file_type'].upper()}]{period_str} | Company: {c_id}")

    # Use the most recent company with documents
    target_company_id = list(companies_found)[0]
    print(f"\nTargeting Company ID for testing: {target_company_id}")

    # Check row counts in coach_spreadsheet_rows and coach_document_chunks
    rows_count_res = (
        supabase_admin.table("coach_spreadsheet_rows")
        .select("id", count="exact")
        .eq("company_id", target_company_id)
        .execute()
    )
    total_spreadsheet_rows = getattr(rows_count_res, "count", 0) or len(getattr(rows_count_res, "data", None) or [])

    chunks_count_res = (
        supabase_admin.table("coach_document_chunks")
        .select("id", count="exact")
        .eq("company_id", target_company_id)
        .execute()
    )
    total_chunks = getattr(chunks_count_res, "count", 0) or len(getattr(chunks_count_res, "data", None) or [])

    print(f"  -> Total Structured Spreadsheet Rows: {total_spreadsheet_rows}")
    print(f"  -> Total Vector Document Chunks:      {total_chunks}")

    # 2. Test Schema Introspection
    print("\n" + "=" * 80)
    print("[STEP 2] Testing Dynamic Schema & Catalog Introspection")
    print("=" * 80)
    schema = get_company_spreadsheet_schema(target_company_id)
    print(f"Has Spreadsheet Data: {schema.get('has_spreadsheet_data')}")
    print(f"Sheet Tabs Found:     {schema.get('all_sheet_names')}")
    print(f"Columns Detected:     {schema.get('all_columns')[:15]}...")

    prompt_preview = format_schema_for_sql_prompt(schema, target_company_id)
    print("\n--- Formatted SQL Schema Prompt Preview (first 500 chars) ---")
    print(prompt_preview[:500] + "...\n")

    catalog = get_company_document_catalog(target_company_id)
    print(f"Document Catalog Count: {len(catalog)}")
    for cat_doc in catalog[:3]:
        print(f"  - {cat_doc['file_name']} ({cat_doc['category']}) Period: {cat_doc.get('document_period')}")

    # 3. Test Text-to-SQL Query
    if schema.get("has_spreadsheet_data") and total_spreadsheet_rows > 0:
        print("\n" + "=" * 80)
        print("[STEP 3] Testing Text-to-SQL Generation & Safe Execution")
        print("=" * 80)
        
        sample_sheet = schema["all_sheet_names"][0]
        test_sql_question = f"Show me the summary of records in sheet '{sample_sheet}'"
        print(f"User Prompt: '{test_sql_question}'")
        
        gen_res = generate_coach_sql(
            user_query=test_sql_question,
            company_id=target_company_id,
            schema_prompt=prompt_preview
        )
        sql_query = gen_res.get("sql_query")
        print(f"Generated SQL:\n  {sql_query}")
        print(f"Explanation:  {gen_res.get('explanation')}")

        if sql_query:
            print("\nExecuting query against execute_coach_sql_query RPC...")
            exec_res = execute_coach_sql(target_company_id, sql_query)
            print(f"Success: {exec_res['success']}")
            print(f"Row Count: {exec_res['row_count']}")
            if exec_res["rows"]:
                print("Sample Result Row(s):")
                print(json.dumps(exec_res["rows"][:2], indent=2))
            if exec_res.get("error"):
                print(f"Execution Error: {exec_res['error']}")
    else:
        print("\n[STEP 3] Skipping standalone SQL test (no completed spreadsheet rows for this company).")

    # 4. Test Vector RAG Retrieval
    if total_chunks > 0:
        print("\n" + "=" * 80)
        print("[STEP 4] Testing Vector RAG Semantic Retrieval")
        print("=" * 80)
        test_rag_query = "performance review feedback and goals"
        print(f"RAG Query: '{test_rag_query}'")
        chunks = search_coach_knowledge(
            query=test_rag_query,
            company_id=target_company_id,
            match_count=3,
            match_threshold=0.25
        )
        print(f"Retrieved {len(chunks)} chunks.")
        for idx, c in enumerate(chunks, 1):
            cit = c.get("citation") or {}
            sim = round(c.get("similarity", 0) * 100, 1)
            print(f"  Chunk {idx} (Similarity: {sim}%): {cit.get('file_name')} - Page {cit.get('page_number')} / Row {cit.get('row_number')}")
            snippet = c.get("content", "").replace("\n", " ")[:120]
            print(f"    Snippet: \"{snippet}...\"")
        
        citations = extract_citations_from_chunks(chunks)
        print(f"Extracted Citation Chips: {len(citations)}")
    else:
        print("\n[STEP 4] Skipping standalone RAG test (no vector chunks stored for this company).")

    # 5. Test End-to-End Coach Intelligence Agent (execute_coach_agent)
    print("\n" + "=" * 80)
    print("[STEP 5] Testing End-to-End Coach Agent (execute_coach_agent)")
    print("=" * 80)

    test_queries = [
    
        "Can you give me a summary of the Exotel Believer Plan?"
    ]

    for q in test_queries:
        print(f"\n--- USER QUESTION: '{q}' ---")
        agent_res = execute_coach_agent(
            user_query=q,
            company_id=target_company_id
        )
        print(f"Intent Classified: {agent_res.get('intent')}")
        if agent_res.get("sql_query"):
            print(f"Executed SQL:     {agent_res.get('sql_query')}")
            sql_rows = agent_res.get("sql_result") or []
            print(f"SQL Rows Fetched: {len(sql_rows)}")
            if sql_rows:
                print("Sample Retrieved Data:")
                print(json.dumps(sql_rows[:2], indent=2))
        if agent_res.get("citations"):
            print(f"Citations Linked: {len(agent_res.get('citations'))} chip(s)")
        print("\nCOACH RESPONSE:")
        print(agent_res.get("response", "").strip())
        print("-" * 60)

    # 6. Interactive Mode for Arbitrary Live Questions
    print("\n" + "=" * 80)
    print(" INTERACTIVE COACH QUERY MODE")
    print(" Type any question to test the Coach Intelligence layer live.")
    print(" (Type 'exit', 'quit', or 'q' to finish)")
    print("=" * 80)

    while True:
        try:
            user_input = input("\nEnter your question > ").strip()
            if not user_input:
                continue
            if user_input.lower() in ["exit", "quit", "q"]:
                print("Exiting interactive test mode.")
                break

            print("\n[Processing Query...]")
            agent_res = execute_coach_agent(
                user_query=user_input,
                company_id=target_company_id
            )
            print(f"Intent Classified: {agent_res.get('intent')}")
            if agent_res.get("sql_query"):
                print(f"Executed SQL:     {agent_res.get('sql_query')}")
                rows = agent_res.get("sql_result") or []
                print(f"SQL Rows Fetched: {len(rows)}")
                if rows:
                    print("Sample Retrieved Data:")
                    print(json.dumps(rows[:2], indent=2))
            if agent_res.get("citations"):
                print(f"Citations Linked: {len(agent_res.get('citations'))} chip(s)")
            print("\nCOACH RESPONSE:")
            print(agent_res.get("response", "").strip())
            print("-" * 60)
        except (KeyboardInterrupt, EOFError):
            print("\nExiting interactive test mode.")
            break

    print("\n[SUCCESS] Intelligence Layer Backend Test Bench Completed!")


if __name__ == "__main__":
    main()

