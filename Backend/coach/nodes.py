# Backend/coach/nodes.py
"""
LangGraph Nodes for the Performance Coach Intelligence Layer.
Implements:
  1. introspect_node: Dynamic schema & document inventory retrieval
  2. router_node: Intent classification (SQL, RAG, HYBRID, CATALOG, GENERAL)
  3. sql_generator_node: PostgreSQL JSONB query generation
  4. sql_executor_node: Safe execution via execute_coach_sql_query RPC
  5. sql_fixer_node: Self-healing retry loop upon database error
  6. rag_node: Vector search against coach_document_chunks with citation extraction
  7. synthesizer_node: Multi-source grounded answer generation
"""

import json
from typing import Dict, Any, List, Optional
from langchain_core.messages import HumanMessage, AIMessage

from config import OPENAI_API_KEY, GEMINI_API_KEY
from coach.state import CoachState
from coach.schema_inspector import (
    get_company_spreadsheet_schema,
    get_company_document_catalog,
    format_schema_for_sql_prompt
)
from coach.tools.sql_tool import generate_coach_sql, execute_coach_sql
from coach.tools.rag_tool import (
    search_coach_knowledge,
    format_chunks_for_context,
    extract_citations_from_chunks
)


# ============================================================================
# 1. INTROSPECTION NODE
# ============================================================================
def introspect_node(state: CoachState) -> Dict[str, Any]:
    """Fetches available spreadsheet schemas and document catalog for the company."""
    company_id = state.get("company_id", "")
    user_query = state.get("user_query")

    if not user_query and state.get("messages"):
        last_msg = state["messages"][-1]
        user_query = last_msg.content if isinstance(last_msg, HumanMessage) else str(last_msg)

    schema_dict = get_company_spreadsheet_schema(company_id)
    schema_prompt = format_schema_for_sql_prompt(schema_dict, company_id)
    doc_catalog = get_company_document_catalog(company_id)

    return {
        "user_query": user_query or "",
        "schema_dict": schema_dict,
        "schema_prompt": schema_prompt,
        "document_catalog": doc_catalog,
        "sql_retry_count": state.get("sql_retry_count", 0),
        "citations": state.get("citations", []),
        "rag_chunks": state.get("rag_chunks", [])
    }


# ============================================================================
# 2. ROUTER NODE
# ============================================================================
ROUTER_SYSTEM_PROMPT = """You are a smart query classifier for an enterprise Performance Coach.
Analyze the user's question, the available spreadsheet schema, and the uploaded document catalog.
Classify the user's intent into EXACTLY ONE of the following categories:

- "SQL": The question strictly requires numerical calculations, metric aggregations (SUM, AVG, MIN, MAX), counts, rankings (top/bottom performers), quota attainment percentages, or tabular spreadsheet data.
- "RAG": The question asks about ANY uploaded document, file, plan, policy, guide, presentation, company knowledge (e.g. Exotel Believer Plan, SOPs, training manuals, product docs, company plans), or qualitative employee performance reviews, 1-on-1 feedback, manager notes, and goals.
  IMPORTANT: If the user asks for a summary, explanation, definition ("what is...", "tell me about...", "summarize...", "give me summary of..."), or factual details regarding ANY topic, entity, plan, or document, ALWAYS classify as "RAG".
- "HYBRID": The question requires BOTH numerical spreadsheet metrics AND qualitative review feedback/document context (e.g., "Why did Rahul miss his sales quota? What did his manager say?").
- "CATALOG": The question asks what documents, spreadsheets, or files are uploaded or available in the knowledge base.
- "GENERAL": ONLY for conversational greetings or pleasantries (e.g., "Hello", "Hi", "Good morning", "How are you", "Thank you", "Who are you?"). Do NOT classify factual, informational, or document-related questions as GENERAL.

When in doubt between RAG and GENERAL, ALWAYS choose "RAG" so the document knowledge base can be searched.

Return ONLY a JSON object:
{
  "intent": "SQL" | "RAG" | "HYBRID" | "CATALOG" | "GENERAL",
  "reasoning": "1 sentence explanation."
}"""


def router_node(state: CoachState) -> Dict[str, Any]:
    """Determines whether to route query to SQL, RAG, Hybrid, or General."""
    import re

    user_query = state.get("user_query", "").strip()
    schema_dict = state.get("schema_dict", {})
    has_sheets = schema_dict.get("has_spreadsheet_data", False)
    all_sheets = schema_dict.get("all_sheet_names", [])
    all_cols = schema_dict.get("all_columns", [])
    doc_catalog = state.get("document_catalog", [])

    q_lower = user_query.lower()

    # Heuristic fast-path 0: Conversational Greetings & Thanks (e.g. "eyy hii", "hello", "thanks")
    clean_greeting = re.sub(r"[^a-zA-Z\s]", "", q_lower).strip()
    greeting_tokens = set(clean_greeting.split())
    greetings = {"hi", "hii", "hiii", "hello", "ey", "eyy", "hey", "heyy", "heyya", "hola", "namaste", "howdy", "sup", "yo"}
    thanks = {"thanks", "thank", "thx", "appreciate", "grateful"}

    if clean_greeting in greetings or (greeting_tokens and greeting_tokens.issubset(greetings | {"there", "coach", "lucid", "assistant", "good", "morning", "afternoon", "evening", "buddy", "bro", "sir"})):
        return {"intent": "GENERAL", "routing_reason": "Conversational greeting."}

    if any(t in greeting_tokens for t in thanks) and len(greeting_tokens) <= 4:
        return {"intent": "GENERAL", "routing_reason": "Conversational gratitude."}

    # Heuristic fast-path 1: Catalog inventory queries
    if any(k in q_lower for k in ["what documents", "which files", "list files", "list documents", "uploaded documents", "show uploaded", "what spreadsheets"]):
        return {"intent": "CATALOG", "routing_reason": "User requested document catalog inventory."}

    # Heuristic fast-path 2: If user query mentions words from any uploaded document file name
    for doc in doc_catalog:
        fn = doc.get("file_name", "").lower()
        base_name = fn.rsplit(".", 1)[0]
        keywords = [w for w in re.split(r"[_\-\s\(\)]+", base_name) if len(w) >= 4]
        if any(kw in q_lower for kw in keywords):
            math_words = ["sum", "total", "average", "avg", "count", "cases", "quota", "sales", "discount", "target", "top", "rank", "percentage", "%"]
            if any(mw in q_lower for mw in math_words):
                return {"intent": "HYBRID", "routing_reason": f"Query mentions document '{doc.get('file_name')}' alongside quantitative metrics."}
            return {"intent": "RAG", "routing_reason": f"Query mentions uploaded document '{doc.get('file_name')}'."}

    # Heuristic fast-path 3: Informational / Explanation / Summary questions route to RAG
    info_triggers = ["what is", "tell me about", "summary of", "summarize", "explain", "overview of", "details of", "how does", "what are"]
    if any(q_lower.startswith(t) or f" {t} " in q_lower for t in info_triggers):
        math_words = ["sum", "total", "average", "avg", "count", "cases", "quota", "discount", "percentage", "%"]
        if not any(mw in q_lower for mw in math_words):
            return {"intent": "RAG", "routing_reason": "Informational query seeking explanation or document knowledge."}

    # Heuristic fast-path 4: If company has NO spreadsheets, route to RAG
    if not has_sheets:
        return {"intent": "RAG", "routing_reason": "No spreadsheets uploaded; defaulting to qualitative RAG."}

    # Format document catalog for LLM router context
    doc_summaries = []
    for d in doc_catalog:
        fn = d.get("file_name", "")
        cat = d.get("category", "")
        period = f", Period: {d['document_period']}" if d.get("document_period") else ""
        topics = f", Topics: {', '.join(d['key_topics'][:3])}" if d.get("key_topics") else ""
        doc_summaries.append(f"- {fn} [{d.get('file_type', '').upper()}] ({cat}{period}{topics})")
    catalog_text = "\n".join(doc_summaries) if doc_summaries else "(No documents currently uploaded)"

    # LLM Router Classification
    context_desc = (
        f"Available Documents in Knowledge Base:\n{catalog_text}\n\n"
        f"Available Sheets: {', '.join(all_sheets)}\n"
        f"Available Columns: {', '.join(all_cols[:25])}\n\n"
        f"Question: {user_query}"
    )

    if OPENAI_API_KEY:
        try:
            from openai import OpenAI
            client = OpenAI(api_key=OPENAI_API_KEY)
            resp = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": ROUTER_SYSTEM_PROMPT},
                    {"role": "user", "content": context_desc}
                ],
                response_format={"type": "json_object"},
                temperature=0.0,
                max_tokens=150
            )
            raw = resp.choices[0].message.content or "{}"
            data = json.loads(raw.strip())
            intent = data.get("intent", "RAG").upper()
            if intent not in ["SQL", "RAG", "HYBRID", "CATALOG", "GENERAL"]:
                intent = "RAG"
            return {"intent": intent, "routing_reason": data.get("reasoning", "")}
        except Exception as e:
            print(f"[COACH ROUTER] OpenAI router error: {e}")

    # Fallback heuristic: check for hybrid and metric keywords
    if any(w in q_lower for w in ["compare", "versus", "vs ", "who is better", "better", "award"]):
        return {"intent": "HYBRID", "routing_reason": "Heuristic match for employee comparison & award evaluation."}

    math_words = ["sum", "total", "average", "avg", "count", "cases", "quota", "sales", "discount", "target", "top", "rank", "percentage", "%"]
    if any(w in q_lower for w in math_words):
        return {"intent": "SQL", "routing_reason": "Heuristic match for quantitative metrics."}

    return {"intent": "RAG", "routing_reason": "Defaulted to qualitative RAG."}


# ============================================================================
# 3. TEXT-TO-SQL NODES (with Self-Healing)
# ============================================================================
def sql_generator_node(state: CoachState) -> Dict[str, Any]:
    """Generates PostgreSQL JSONB query based on introspected schema."""
    user_query = state.get("user_query", "")
    company_id = state.get("company_id", "")
    schema_prompt = state.get("schema_prompt", "")
    emp_name = state.get("target_employee_name")

    res = generate_coach_sql(
        user_query=user_query,
        company_id=company_id,
        schema_prompt=schema_prompt,
        target_employee_name=emp_name
    )

    return {
        "sql_query": res.get("sql_query"),
        "sql_explanation": res.get("explanation"),
        "sql_error": None
    }


def sql_executor_node(state: CoachState) -> Dict[str, Any]:
    """Executes SQL query via safe execute_coach_sql_query RPC."""
    company_id = state.get("company_id", "")
    sql_query = state.get("sql_query") or ""

    exec_res = execute_coach_sql(company_id=company_id, sql_query=sql_query)
    current_retry = state.get("sql_retry_count", 0)

    if exec_res["success"]:
        return {
            "sql_result": exec_res["rows"],
            "sql_row_count": exec_res["row_count"],
            "sql_error": None
        }
    else:
        return {
            "sql_result": None,
            "sql_row_count": 0,
            "sql_error": exec_res["error"],
            "sql_retry_count": current_retry + 1
        }


def sql_fixer_node(state: CoachState) -> Dict[str, Any]:
    """Self-healing node: prompts LLM with Postgres error to fix the query."""
    user_query = state.get("user_query", "")
    company_id = state.get("company_id", "")
    schema_prompt = state.get("schema_prompt", "")
    emp_name = state.get("target_employee_name")
    prev_error = state.get("sql_error")
    prev_query = state.get("sql_query")

    print(f"[COACH SQL FIXER] Self-healing retry #{state.get('sql_retry_count')}: Fixing SQL after error: {prev_error}")

    res = generate_coach_sql(
        user_query=user_query,
        company_id=company_id,
        schema_prompt=schema_prompt,
        target_employee_name=emp_name,
        previous_error=prev_error,
        previous_query=prev_query
    )

    return {
        "sql_query": res.get("sql_query"),
        "sql_explanation": f"Corrected query: {res.get('explanation')}",
        "sql_error": None
    }


# ============================================================================
# 4. VECTOR RAG NODE
# ============================================================================
def rag_node(state: CoachState) -> Dict[str, Any]:
    """Performs dense vector retrieval against coach_document_chunks."""
    user_query = state.get("user_query", "")
    company_id = state.get("company_id", "")
    emp_id = state.get("target_employee_id")

    chunks = search_coach_knowledge(
        query=user_query,
        company_id=company_id,
        target_employee_id=emp_id,
        match_count=6,
        match_threshold=0.20
    )
    citations = extract_citations_from_chunks(chunks)

    return {
        "rag_chunks": chunks,
        "citations": citations
    }


# ============================================================================
# 5. SYNTHESIZER NODE
# ============================================================================
SYNTHESIZER_SYSTEM_PROMPT = """You are an elite, empathetic, and evidence-driven Executive Sales & Performance Coach.
Your goal is to provide actionable, constructive, and accurate performance insights based SOLELY on the retrieved data.

STRICT GROUNDING & CITATION RULES:
1. Base all numerical statements directly on the retrieved SQL data. Do not fabricate or estimate numbers.
2. When referencing qualitative feedback, mention the source document name, section, page, or reporting period.
3. If an employee missed a goal or underperformed, pair the data constructively with feedback on blockers and actionable improvement recommendations.
4. If retrieved data does not fully answer the question, state what is known and what data is missing clearly.
5. Format your response cleanly using GitHub Markdown (headings, bullet points, and tables where appropriate).
"""


def synthesizer_node(state: CoachState) -> Dict[str, Any]:
    """Merges SQL results and RAG chunks into a cohesive coaching response."""
    user_query = state.get("user_query", "")
    intent = state.get("intent", "GENERAL")
    sql_result = state.get("sql_result")
    sql_query = state.get("sql_query")
    rag_chunks = state.get("rag_chunks", [])
    doc_catalog = state.get("document_catalog", [])

    # Case A: Document Catalog Intent
    if intent == "CATALOG":
        if not doc_catalog:
            return {"final_response": "No documents or spreadsheets are currently uploaded for your company."}

        lines = ["### Uploaded Knowledge Base Documents\n"]
        for d in doc_catalog:
            period_str = f" (Period: {d['document_period']})" if d.get("document_period") else ""
            cat_str = f" [{d['category']}]" if d.get("category") else ""
            summary_str = f"\n   *Summary:* {d['summary']}" if d.get("summary") else ""
            lines.append(f"- **{d['file_name']}** (`{d['file_type'].upper()}`){period_str}{cat_str}{summary_str}")
        return {"final_response": "\n".join(lines)}

    # Case B: Conversational Greetings & General Dialogue
    if intent == "GENERAL":
        import re
        clean_q = re.sub(r"[^a-zA-Z\s]", "", user_query.lower()).strip()
        tokens = set(clean_q.split())
        greetings = {"hi", "hii", "hiii", "hello", "ey", "eyy", "hey", "heyy", "heyya", "hola", "namaste", "howdy", "sup", "yo"}
        thanks = {"thanks", "thank", "thx", "appreciate", "grateful"}

        # Fast direct reply for greetings
        if any(w in tokens for w in greetings) or tokens.issubset(greetings | {"there", "coach", "lucid", "assistant", "good", "morning", "afternoon", "evening", "buddy", "bro", "sir"}):
            return {
                "final_response": (
                    "Hello! 👋 I'm your **Performance Coach**.\n\n"
                    "I can help you analyze sales figures, track targets, review team performance metrics, "
                    "or explore insights from your uploaded reports and document plans.\n\n"
                    "How can I assist you today?"
                )
            }

        # Fast direct reply for gratitude
        if any(w in tokens for w in thanks):
            return {
                "final_response": (
                    "You're very welcome! 😊 Let me know if you need any more sales insights, "
                    "performance comparisons, or document analysis. Happy to help!"
                )
            }

        # Self-introduction / capabilities inquiry
        if any(w in clean_q for w in ["who are you", "what can you do", "help me"]):
            return {
                "final_response": (
                    "I am your enterprise **Performance Coach & Analytics Assistant**! 🎯\n\n"
                    "Here is what I can do for you:\n"
                    "- **Spreadsheet Analytics (Text-to-SQL)**: Query sales numbers, case counts, discounts, targets, and employee metrics.\n"
                    "- **Document Knowledge Search (Vector RAG)**: Search SOPs, operational reports, evaluation rubrics, and strategic plans.\n"
                    "- **Hybrid Performance Evaluations**: Compare employee achievements with manager review notes and suggest actionable awards.\n\n"
                    "Try asking questions like:\n"
                    "- *\"Which licensee is leading with highest number of total cases?\"*\n"
                    "- *\"Compare performance of Ansh and Riya and recommend who to award.\"*\n"
                    "- *\"What documents are uploaded?\"*"
                )
            }

        # For general conversational queries, use a warm conversational prompt
        general_prompt = (
            "You are a friendly, encouraging, and highly professional Executive Sales & Performance Coach. "
            "Respond warmly and conversationally to the user's message. Introduce yourself as their AI Performance Coach and "
            "invite them to ask about their sales metrics, employee performance, or uploaded documents."
        )
        if OPENAI_API_KEY:
            try:
                from openai import OpenAI
                client = OpenAI(api_key=OPENAI_API_KEY)
                resp = client.chat.completions.create(
                    model="gpt-4o",
                    messages=[
                        {"role": "system", "content": general_prompt},
                        {"role": "user", "content": user_query}
                    ],
                    temperature=0.7,
                    max_tokens=300
                )
                ans = resp.choices[0].message.content or ""
                return {"final_response": ans.strip()}
            except Exception as e:
                print(f"[COACH SYNTHESIZER] General greeting error: {e}")

        return {
            "final_response": "Hello! I am your Performance Coach. How can I assist you with your sales or team data today?"
        }

    # Build Context Blocks
    context_sections = []

    if sql_result is not None:
        context_sections.append(
            f"### RETRIEVED SPREADSHEET SQL DATA\n"
            f"Executed Query: `{sql_query}`\n"
            f"Rows Returned: {len(sql_result)}\n"
            f"Data:\n{json.dumps(sql_result, indent=2)}"
        )

    if rag_chunks:
        rag_context = format_chunks_for_context(rag_chunks)
        context_sections.append(f"### RETRIEVED QUALITATIVE DOCUMENT EXCERPTS\n{rag_context}")

    combined_context = "\n\n".join(context_sections) if context_sections else "No relevant database records or document excerpts were retrieved."

    user_prompt = (
        f"User Question: {user_query}\n\n"
        f"Retrieved Evidence:\n{combined_context}\n\n"
        "Provide a comprehensive, grounded coaching answer."
    )

    # Call LLM for final synthesis
    if OPENAI_API_KEY:
        try:
            from openai import OpenAI
            client = OpenAI(api_key=OPENAI_API_KEY)
            resp = client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": SYNTHESIZER_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.3,
                max_tokens=900
            )
            ans = resp.choices[0].message.content or ""
            return {"final_response": ans.strip()}
        except Exception as e:
            print(f"[COACH SYNTHESIZER] OpenAI synthesis failed: {e}")

    if GEMINI_API_KEY:
        try:
            from google import genai
            from google.genai.types import GenerateContentConfig

            client = genai.Client(api_key=GEMINI_API_KEY)
            config = GenerateContentConfig(temperature=0.3, max_output_tokens=900)
            gemini_prompt = f"{SYNTHESIZER_SYSTEM_PROMPT}\n\n{user_prompt}"
            res = client.models.generate_content(
                model="gemini-1.5-flash",
                contents=gemini_prompt,
                config=config
            )
            ans = res.text or ""
            return {"final_response": ans.strip()}
        except Exception as e:
            print(f"[COACH SYNTHESIZER] Gemini synthesis failed: {e}")

    # Fallback if no LLM configured
    if sql_result:
        return {"final_response": f"Retrieved {len(sql_result)} records from spreadsheet data:\n\n```json\n{json.dumps(sql_result, indent=2)}\n```"}
    elif rag_chunks:
        return {"final_response": format_chunks_for_context(rag_chunks)}
    return {"final_response": "I was unable to connect to the reasoning model to synthesize an answer."}
