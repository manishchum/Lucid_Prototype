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
import re
from datetime import datetime
from typing import Dict, Any, List, Optional
from langchain_core.messages import HumanMessage, AIMessage

from config import OPENAI_API_KEY, GEMINI_API_KEY
from coach.state import CoachState
from coach.schema_inspector import (
    get_company_spreadsheet_schema,
    get_company_document_catalog,
    get_company_active_integrations,
    get_user_coach_profile,
    format_schema_for_sql_prompt
)
from coach.tools.sql_tool import generate_coach_sql, execute_coach_sql
from coach.tools.rag_tool import (
    search_coach_knowledge,
    format_chunks_for_context,
    extract_citations_from_chunks
)
from security.pii_firewall import sanitize_final_response


def _get_role_level(state: CoachState) -> int:
    sec = state.get("security_ctx")
    if not sec:
        return 3
    if isinstance(sec, dict):
        return int(sec.get("role_level", 1))
    return int(getattr(sec, "role_level", 1))


# ============================================================================
# 1. INTROSPECTION NODE
# ============================================================================
def introspect_node(state: CoachState) -> Dict[str, Any]:
    """Fetches available spreadsheet schemas, document catalog, and user identity."""
    company_id = state.get("company_id", "")
    user_query = state.get("user_query")
    security_ctx = state.get("security_ctx")

    if not user_query and state.get("messages"):
        last_msg = state["messages"][-1]
        user_query = last_msg.content if isinstance(last_msg, HumanMessage) else str(last_msg)

    schema_dict = get_company_spreadsheet_schema(company_id, security_ctx=security_ctx)
    schema_prompt = format_schema_for_sql_prompt(schema_dict, company_id)
    doc_catalog = get_company_document_catalog(company_id, security_ctx=security_ctx)
    active_integrations = get_company_active_integrations(company_id, security_ctx=security_ctx)
    user_id = state.get("user_id", "")
    user_profile = get_user_coach_profile(user_id, company_id) if user_id else None

    # Fallback lookup for target employee identity if not explicitly passed
    # Keep target_emp_id as None unless explicitly scoping to a target employee,
    # so Zanzibar Pre-Retrieval ACL filtering can still return team/org/shared docs.
    target_emp_name = state.get("target_employee_name")
    target_emp_id = state.get("target_employee_id")
    if not target_emp_name and user_id:
        try:
            from utils.supabase_client import supabase_admin
            res = supabase_admin.table("users").select("name").eq("user_id", user_id).limit(1).execute()
            data = getattr(res, "data", None) or []
            if data and data[0].get("name"):
                target_emp_name = str(data[0]["name"]).strip()
        except Exception as e:
            print(f"[COACH INTROSPECT] Error fetching user name: {e}")

    return {
        "user_query": user_query or "",
        "schema_dict": schema_dict,
        "schema_prompt": schema_prompt,
        "document_catalog": doc_catalog,
        "active_integrations": active_integrations,
        "user_profile": user_profile,
        "target_employee_name": target_emp_name,
        "target_employee_id": target_emp_id,
        "sql_retry_count": state.get("sql_retry_count", 0),
        "citations": state.get("citations", []),
        "rag_chunks": state.get("rag_chunks", [])
    }


# ============================================================================
# 2. ROUTER NODE
# ============================================================================
ROUTER_SYSTEM_PROMPT = """You are a smart, domain-agnostic query classifier for an enterprise Performance Coach.
Analyze the user's question, the available spreadsheet schema (sheets & columns), the uploaded document catalog, and the connected cloud integrations.
Classify the user's intent into EXACTLY ONE of the following categories:

- "SQL": The question strictly asks for concrete numbers, data, calculations, aggregations (SUM, AVG, MIN, MAX, COUNT), rankings, quotas, discounts, or tabular records for entities, dimensions, or columns present in the Available Columns or Sheets (e.g. "What are my sales numbers?", "How many cases did I sell?", "What is my discount %?", "Who are the top 5 reps?").
- "RAG": The question strictly asks about qualitative information, advice, or feedback:
  1. Uploaded qualitative documents, company policies, manuals, handbooks, strategic plans, guidelines, or appraisal documents found in the Available Documents catalog.
  2. Communications, meeting transcripts, 1-on-1 notes, emails, chat messages, or files from the Connected Cloud Integrations (e.g. Google Drive, OneDrive, Zoom meeting transcripts, Google Meet, Microsoft Teams channels, Slack, or Gmail/Outlook email threads) (e.g. "What did my manager note in my 1-on-1?", "What are my improvement areas according to the review doc?").
- "HYBRID": The question requires BOTH tabular spreadsheet data (metrics/numbers/entity performance) AND qualitative document context/reviews from the uploaded document catalog or connected integration streams.
  CRITICAL: Broad, holistic coaching questions like "How am I doing?", "How is my performance?", "Give me an overview of my performance", or questions evaluating numbers against feedback/targets MUST be classified as "HYBRID" whenever BOTH spreadsheets AND qualitative documents/cloud integrations exist.
- "CATALOG": The question asks what documents, spreadsheets, files, or cloud integrations are uploaded or connected in the knowledge base.
- "GENERAL": ONLY for conversational greetings, polite pleasantries (e.g. "Hello", "Hi", "Good morning", "Thank you"), or assistant self-introduction ("Who are you?").
- "OUT_OF_SCOPE": The question is completely UNRELATED to the company's business data, spreadsheets, uploaded documents, or connected integrations. This covers ANY external topic whatsoever (e.g. movies, entertainment, school/academic math or science formulas, recipes/cooking, consumer shopping advice, sports, gaming, medical/health, travel, news, trivia, or general world knowledge).

DECISION GUIDELINES:
1. If the question strictly asks for numerical figures, specific column metrics, or mathematical calculations -> "SQL".
2. If the question strictly asks about uploaded documents, policies, or communications from connected cloud integrations -> "RAG".
3. If the question asks broadly "How am I doing?", "How is my performance?", OR asks for both numbers and qualitative feedback -> "HYBRID" (whenever both spreadsheets and documents/cloud integrations exist).
4. If it asks what files, spreadsheets, or integrations are available -> "CATALOG".
5. If it's a polite greeting or gratitude -> "GENERAL".
6. If the question asks about ANY external topic NOT in the company's spreadsheets, documents, or connected integrations -> ALWAYS choose "OUT_OF_SCOPE".

Return ONLY a JSON object:
{
  "intent": "SQL" | "RAG" | "HYBRID" | "CATALOG" | "GENERAL" | "OUT_OF_SCOPE",
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

    # Heuristic fast-path 0A: Input Safety, Security & Scope Guardrails (< 5ms)
    from coach.guardrails import check_input_guardrails
    guardrail_match = check_input_guardrails(user_query)
    if guardrail_match:
        return {
            "intent": guardrail_match["intent"],
            "routing_reason": guardrail_match["routing_reason"],
            "final_response": guardrail_match["response"],
            "guardrail_triggered": True
        }

    # Heuristic fast-path 0B: Conversational Greetings & Thanks (e.g. "eyy hii", "hello", "thanks")
    clean_greeting = re.sub(r"[^a-zA-Z\s]", "", q_lower).strip()
    greeting_tokens = set(clean_greeting.split())
    greetings = {"hi", "hii", "hiii", "hello", "ey", "eyy", "hey", "heyy", "heyya", "hola", "namaste", "howdy", "sup", "yo"}
    thanks = {"thanks", "thank", "thx", "appreciate", "grateful"}

    if clean_greeting in greetings or (greeting_tokens and greeting_tokens.issubset(greetings | {"there", "coach", "lucid", "assistant", "good", "morning", "afternoon", "evening", "buddy", "bro", "sir"})):
        return {"intent": "GENERAL", "routing_reason": "Conversational greeting."}

    if any(t in greeting_tokens for t in thanks) and len(greeting_tokens) <= 4:
        return {"intent": "GENERAL", "routing_reason": "Conversational gratitude."}

    # Heuristic fast-path 1: Catalog inventory queries
    if any(k in q_lower for k in ["what documents", "which files", "list files", "list documents", "uploaded documents", "show uploaded", "what spreadsheets", "what integrations", "connected integrations", "connected tools", "connected sources", "what connectors"]):
        return {"intent": "CATALOG", "routing_reason": "User requested document catalog or connected integrations inventory."}

    # Extract dynamic column match tokens from all_cols
    col_tokens = set()
    for col in all_cols:
        clean_c = re.sub(r"[^a-zA-Z0-9\s]", " ", col.lower()).strip()
        if clean_c:
            col_tokens.add(clean_c)
            for part in clean_c.split():
                if len(part) >= 3 and part not in {"and", "the", "for", "with", "from", "date"}:
                    col_tokens.add(part)

    # Heuristic fast-path 1B: Connected Cloud Integrations detection
    active_integrations = state.get("active_integrations", [])
    active_providers = {i.get("provider", "").lower() for i in active_integrations}
    connector_keywords = {
        "google_drive": ["google drive", "gdrive", "drive folder", "shared drive", "cloud drive"],
        "onedrive": ["onedrive", "sharepoint"],
        "zoom": ["zoom", "meeting transcript", "zoom call", "zoom recording", "meeting recording", "meeting notes", "meeting summary"],
        "google_meet": ["google meet", "gmeet", "meet call", "meet recording"],
        "teams": ["ms teams", "teams channel", "teams chat", "teams message"],
        "slack": ["slack", "slack channel", "slack message"],
        "gmail": ["email", "emails", "gmail", "inbox", "mail thread", "client email", "customer email"]
    }
    for prov, kws in connector_keywords.items():
        if any(kw in q_lower for kw in kws):
            if not active_providers or prov in active_providers:
                return {"intent": "RAG", "routing_reason": f"Query references connected workplace integration '{prov}'."}

    has_docs_or_connectors = bool(doc_catalog) or bool(active_integrations)

    # Heuristic fast-path 1C: Personal qualitative feedback inquiries (e.g. "my feedback", "my 1-on-1", "manager review", "appraisal")
    qualitative_terms = ["feedback", "1-on-1", "1 on 1", "one on one", "review notes", "appraisal", "transcript", "evaluation", "blockers", "improvement areas"]
    is_qualitative_inquiry = any(term in q_lower for term in qualitative_terms)
    if is_qualitative_inquiry and has_docs_or_connectors:
        if has_sheets and any(k in q_lower for k in ["number", "sales", "quota", "cases", "target", "metric"]):
            return {"intent": "HYBRID", "routing_reason": "Query asks for personal qualitative feedback alongside spreadsheet metrics."}
        return {"intent": "RAG", "routing_reason": "Query asks for personal qualitative feedback from documents or connected integrations."}

    # Heuristic fast-path 1D: Holistic personal performance inquiries (e.g. "how am I doing", "how is my performance", "my standing")
    is_holistic_personal = (
        bool(re.search(r"\bhow am i doing\b", q_lower)) or
        bool(re.search(r"\b(my|i|me)\b.*\b(performance|standing|progress|overview)\b", q_lower)) or
        bool(re.search(r"\bhow is my performance\b", q_lower))
    )
    if is_holistic_personal:
        if has_sheets and has_docs_or_connectors:
            return {"intent": "HYBRID", "routing_reason": "Holistic personal performance query: combining spreadsheet metrics with qualitative documents/connectors."}
        elif has_sheets:
            return {"intent": "SQL", "routing_reason": "Personal performance query routed to SQL (no qualitative documents or connectors available)."}
        elif has_docs_or_connectors:
            return {"intent": "RAG", "routing_reason": "Personal performance query routed to qualitative RAG (no spreadsheets available)."}

    # Heuristic fast-path 1E: Specific quantitative personal metric queries (e.g. "my sales", "my numbers", "my cases", "my discount")
    is_specific_metric = bool(re.search(r"\b(my|i|me|mine)\b.*\b(sales|numbers|cases|quota|target|discount|revenue|volume|attainment|rank)\b", q_lower))
    if has_sheets and is_specific_metric:
        return {"intent": "SQL", "routing_reason": "Specific numerical metric query routed to SQL on spreadsheet data."}

    # Heuristic fast-path 2: If user query mentions words from any uploaded document file name
    matched_doc = None
    for doc in doc_catalog:
        fn = doc.get("file_name", "").lower()
        base_name = fn.rsplit(".", 1)[0]
        keywords = [w for w in re.split(r"[_\-\s\(\)]+", base_name) if len(w) >= 4]
        if any(kw in q_lower for kw in keywords):
            matched_doc = doc
            break

    if matched_doc:
        math_words = ["sum", "total", "average", "avg", "count", "cases", "quota", "sales", "discount", "target", "top", "rank", "percentage", "%"]
        if any(mw in q_lower for mw in math_words) or any(ct in q_lower for ct in col_tokens):
            return {"intent": "HYBRID", "routing_reason": f"Query mentions document '{matched_doc.get('file_name')}' alongside quantitative metrics/spreadsheet columns."}
        return {"intent": "RAG", "routing_reason": f"Query mentions uploaded document '{matched_doc.get('file_name')}'."}

    # Heuristic fast-path 3: Schema-Aware Entity & Dimension Detection
    # If the user asks for insights, details, performance, breakdown, list, or status of an entity or column from the spreadsheet:
    query_mentions_column = any(f" {ct} " in f" {q_lower} " or q_lower.startswith(ct) or q_lower.endswith(ct) for ct in col_tokens)
    entity_inquiry_phrases = ["insights of", "insights for", "details of", "details for", "performance of", "breakdown of", "status of", "list of", "list all", "show me", "records of", "give me insights", "who is", "which is"]

    if has_sheets and query_mentions_column:
        math_words = ["sum", "total", "average", "avg", "count", "cases", "quota", "sales", "discount", "target", "top", "rank", "percentage", "%"]
        is_entity_inquiry = any(p in q_lower for p in entity_inquiry_phrases) or any(mw in q_lower for mw in math_words)
        if is_entity_inquiry:
            return {"intent": "SQL", "routing_reason": "Query references active spreadsheet columns/entities for data retrieval."}

    # Heuristic fast-path 4: Informational / Explanation questions (strictly for general documents when no spreadsheet entity is mentioned)
    info_triggers = ["what is", "tell me about", "summary of", "summarize", "explain", "how does", "what are"]
    if any(q_lower.startswith(t) or f" {t} " in q_lower for t in info_triggers) and not query_mentions_column:
        return {"intent": "RAG", "routing_reason": "Informational query seeking explanation or document knowledge."}

    # Heuristic fast-path 5: If company has NO spreadsheets, route to RAG
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

    # Format connected integrations for LLM router context
    integration_summaries = []
    for it in active_integrations:
        prov = it.get("provider", "")
        acct = f" ({it['account_identifier']})" if it.get("account_identifier") else ""
        sources = f", Monitored: {', '.join(it['monitored_sources'])}" if it.get("monitored_sources") else ""
        integration_summaries.append(f"- {prov.upper()}{acct}{sources}")
    integrations_text = "\n".join(integration_summaries) if integration_summaries else "(No cloud integrations currently connected)"

    # LLM Router Classification
    context_desc = (
        f"Connected Cloud Integrations:\n{integrations_text}\n\n"
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
            if intent not in ["SQL", "RAG", "HYBRID", "CATALOG", "GENERAL", "OUT_OF_SCOPE"]:
                intent = "RAG"
            return {"intent": intent, "routing_reason": data.get("reasoning", "")}
        except Exception as e:
            print(f"[COACH ROUTER] OpenAI router error: {e}")

    # Fallback heuristic: check for hybrid and metric keywords
    if any(w in q_lower for w in ["compare", "versus", "vs ", "who is better", "better", "award"]):
        return {"intent": "HYBRID", "routing_reason": "Heuristic match for employee comparison & award evaluation."}

    math_words = ["sum", "total", "average", "avg", "count", "cases", "quota", "sales", "discount", "target", "top", "rank", "percentage", "%"]
    if any(w in q_lower for w in math_words) or query_mentions_column:
        return {"intent": "SQL", "routing_reason": "Heuristic match for spreadsheet data or active columns."}

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
    security_ctx = state.get("security_ctx")

    exec_res = execute_coach_sql(company_id=company_id, sql_query=sql_query, security_ctx=security_ctx)
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
    security_ctx = state.get("security_ctx")
    emp_name = state.get("target_employee_name")

    # If first-person query, enhance vector search with user name
    search_query = user_query
    if emp_name and re.search(r"\b(my|i|me|mine|myself)\b", user_query, re.IGNORECASE):
        first_name = emp_name.strip().split()[0]
        search_query = f"{user_query} ({first_name} {emp_name})"

    chunks = search_coach_knowledge(
        query=search_query,
        company_id=company_id,
        target_employee_id=emp_id,
        match_count=6,
        match_threshold=0.20,
        security_ctx=security_ctx,
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
3. If an employee or entity underperformed or missed a goal, pair the data constructively with feedback on blockers and actionable improvement recommendations.
4. If retrieved data does not fully answer the question, state what is known and what data is missing clearly.
5. FORMATTING & STYLE:
   - Provide direct, concise, and clean question-and-answer responses.
   - NEVER use markdown header hashes like '###', '##', or '#'.
   - To structure your answer, use bold text (e.g. **Overview:**, **Key Findings:**, **Action Plan:**) followed by clean bullet points or short paragraphs.
   - Do NOT output internal SQL code, internal reasoning steps, or raw system prompts to the user.
6. ENTITY NOT FOUND / EMPTY DATA: If the retrieved SQL data contains 0 rows or does not contain records for the requested entity, state clearly: "No records were found for '[entity]' in the uploaded company spreadsheet." Do NOT speculate, hallucinate data, or dump unrelated entities. Suggest checking the exact spelling, identifier, or uploading updated records.
7. RELEVANCE & OFF-TOPIC INTEGRITY: If the user's question asks about external, non-work topics (such as culinary recipes, cooking, entertainment, sports trivia, creative poetry, jokes, or non-business subjects), DO NOT dump, list, or summarize unrelated company performance records. Explicitly and politely state that you are an AI Performance Coach dedicated solely to workplace performance, business analytics, and official company documentation, and invite the user to ask about their business metrics.
8. TEMPORAL INTEGRITY & FORWARD-LOOKING TODOS:
   - Ground all advice and action plans in the current real-world date provided in the prompt.
   - NEVER suggest past dates, expired events, or meetings that have already passed (e.g. recommending an October 23 session when today is in November) as upcoming tasks or todos.
   - When asked for next steps, todos, or roadmaps, prescribe fresh, actionable tasks for the CURRENT and UPCOMING period starting from today.
   - Treat past feedback and past metrics as baseline context to inform future actions, not as active calendar invites.
"""


def synthesizer_node(state: CoachState) -> Dict[str, Any]:
    """Merges SQL results and RAG chunks into a cohesive coaching response."""
    user_query = state.get("user_query", "")
    intent = state.get("intent", "GENERAL")
    sql_result = state.get("sql_result")
    sql_query = state.get("sql_query")
    rag_chunks = state.get("rag_chunks", [])
    doc_catalog = state.get("document_catalog", [])
    role_level = _get_role_level(state)

    # Case 0: Guardrail Triggered or Out-of-Scope Deflection
    if state.get("guardrail_triggered") or intent in ["SAFETY", "SECURITY", "SCOPE_DEFLECTION", "OUT_OF_SCOPE"]:
        if intent == "OUT_OF_SCOPE":
            return {
                "final_response": (
                    "I am your company's **AI Performance Coach**, dedicated solely to analyzing team metrics, "
                    "sales performance, incentive policies, uploaded company documentation, and connected workplace tools (Google Drive, Meetings, Emails, Teams).\n\n"
                    "I cannot assist with questions regarding external topics, general knowledge, movies, academic homework, or non-work matters. "
                    "Please feel free to ask about your team's KPI reports, case performance, incentives, meeting summaries, or company files!"
                ),
                "citations": []
            }
        return {
            "final_response": state.get("final_response", ""),
            "citations": []
        }

    # Case A: Document & Connected Integrations Catalog Intent
    if intent == "CATALOG":
        active_integrations = state.get("active_integrations", [])
        if not doc_catalog and not active_integrations:
            return {"final_response": "No documents, spreadsheets, or cloud integrations are currently connected for your company."}

        lines = ["### Uploaded Knowledge Base & Connected Integrations\n"]
        if doc_catalog:
            lines.append("#### Uploaded Documents & Spreadsheets:")
            for d in doc_catalog:
                period_str = f" (Period: {d['document_period']})" if d.get("document_period") else ""
                cat_str = f" [{d['category']}]" if d.get("category") else ""
                summary_str = f"\n   *Summary:* {d['summary']}" if d.get("summary") else ""
                lines.append(f"- **{d['file_name']}** (`{d['file_type'].upper()}`){period_str}{cat_str}{summary_str}")
            lines.append("")

        if active_integrations:
            lines.append("#### Connected Cloud Integrations:")
            for it in active_integrations:
                prov = it.get("provider", "").upper()
                acct = f" ({it['account_identifier']})" if it.get("account_identifier") else ""
                sources = f" | Monitored: {', '.join(it['monitored_sources'])}" if it.get("monitored_sources") else ""
                lines.append(f"- **{prov}**{acct}{sources}")

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

        # For general conversational queries, enforce domain boundary
        general_prompt = (
            "You are an enterprise AI Performance Coach dedicated solely to sales metrics, team performance, and uploaded company documentation.\n"
            "STRICT DOMAIN BOUNDARY:\n"
            "- If the user asks general pleasantries (e.g. 'how are you', 'what do you know about me'), respond warmly and politely explain that you are their AI Performance Coach ready to assist with company sales and performance data.\n"
            "- If the user asks off-topic questions (academic school math/science like formulas, trigonometry, calculus, homework, movies, shopping, or general trivia), DO NOT solve or answer the question! Explicitly and politely decline by stating that you are dedicated solely to workplace performance analytics and company documents, and invite them to ask about their business data."
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
            f"RETRIEVED SPREADSHEET SQL DATA:\n"
            f"Executed Query: `{sql_query}`\n"
            f"Rows Returned: {len(sql_result)}\n"
            f"Data:\n{json.dumps(sql_result, indent=2)}"
        )

    if rag_chunks:
        rag_context = format_chunks_for_context(rag_chunks)
        context_sections.append(f"RETRIEVED QUALITATIVE DOCUMENT EXCERPTS:\n{rag_context}")

    combined_context = "\n\n".join(context_sections) if context_sections else "No relevant database records or document excerpts were retrieved."

    user_prompt = (
        f"User Question: {user_query}\n\n"
        f"Retrieved Evidence:\n{combined_context}\n\n"
        "Provide a comprehensive, grounded coaching answer."
    )

    # Condition Synthesizer with User Persona and Tonality Preferences
    user_profile = state.get("user_profile") or {}
    persona_system_prompt = SYNTHESIZER_SYSTEM_PROMPT
    if user_profile and user_profile.get("onboarded") and not user_profile.get("skipped_onboarding"):
        role_title = (user_profile.get("role_title") or "").strip()
        stakeholder_list = user_profile.get("stakeholders") or []
        stakeholders = ", ".join(stakeholder_list) if stakeholder_list else ""
        tone = user_profile.get("coaching_tone") or "tactical_direct"
        vision = (user_profile.get("three_year_vision") or "").strip()
        weight = (user_profile.get("current_weight") or "").strip()
        bio = (user_profile.get("summary_bio") or "").strip()

        tone_instructions = {
            "tactical_direct": "Use crisp, action-oriented bullet points, concrete numbers, and immediate tactical next steps. Zero corporate fluff.",
            "inspiring": "Use an encouraging, energizing tone. Acknowledge wins, frame performance gaps positively, and build momentum.",
            "thought_partner": "Act as an analytical thought partner. Provide strategic benchmarks, unpack root causes, and ask thoughtful coaching reflection questions."
        }.get(tone, "")

        persona_parts = []
        if role_title:
            role_line = f"- User Role: {role_title}"
            if stakeholders:
                role_line += f" (primary stakeholders: {stakeholders})"
            persona_parts.append(role_line)
        elif stakeholders:
            persona_parts.append(f"- Stakeholders Context: {stakeholders}")

        if bio:
            persona_parts.append(f"- Profile Summary: {bio}")
        if vision:
            persona_parts.append(f"- 3-Year Career Aspiration: '{vision}'. Anchor performance insights back to how achieving these targets unlocks this vision.")
        if weight:
            persona_parts.append(f"- Current Priority / Friction: '{weight}'. Directly address or alleviate this pressure.")
        if tone_instructions:
            persona_parts.append(f"- Preferred Tonality Directive: {tone_instructions}")

        # Dynamically include any custom or newly added onboarding questions
        standard_keys = {
            "onboarded", "skipped_onboarding", "role_title", "stakeholders", "coaching_tone",
            "three_year_vision", "current_weight", "summary_bio",
            "updated_at", "time_distribution"
        }
        custom_fields = [
            f"  * {k.replace('_', ' ').capitalize()}: {v}"
            for k, v in user_profile.items()
            if k not in standard_keys and v
        ]
        if custom_fields:
            persona_parts.append("- Additional Questionnaire Context:\n" + "\n".join(custom_fields))

        if persona_parts:
            persona_block = "\n\nUSER PERSONALIZATION & COACHING PERSONA:\n" + "\n".join(persona_parts) + "\n"
            persona_system_prompt += persona_block

    # Inject Authenticated User Identity & Addressing Rules
    target_emp_name = state.get("target_employee_name")
    if target_emp_name:
        first_name = target_emp_name.strip().split()[0]
        persona_system_prompt += (
            f"\n\nAUTHENTICATED USER IDENTITY & ADDRESSAL DIRECTIVE:\n"
            f"- You are speaking directly with '{target_emp_name}'.\n"
            f"- When the user asks about 'my', 'I', 'me', 'mine', or how they are doing, they are referring to themselves ({target_emp_name}).\n"
            f"- In the retrieved spreadsheet SQL data and document excerpts, records matching '{target_emp_name}' OR '{first_name}' represent this user's personal metrics.\n"
            f"- Address them directly and naturally in the second person as 'you' or '{first_name}' (e.g. 'Your total sales this month are...', '{first_name}, you achieved 94% of target...').\n"
            f"- NEVER refer to the authenticated user in the third person (do NOT say '{target_emp_name} achieved...' or '{target_emp_name} had 12 cases').\n"
            f"- When the user explicitly asks about someone else or a peer by name, refer to that third party in the third person.\n"
        )

    # Dynamic Temporal Grounding (Current Date & Forward-Looking Planning)
    current_dt = datetime.utcnow()
    today_str = current_dt.strftime("%A, %B %d, %Y")
    current_month_str = current_dt.strftime("%B %Y")

    persona_system_prompt += (
        f"\n\nCURRENT DATE & TEMPORAL PLANNING RULES (CRITICAL):\n"
        f"- Today's Real-World Date: {today_str} (Current Month: {current_month_str}).\n"
        f"- PAST VS FUTURE TIMELINE:\n"
        f"  * Any dates, months, or events before {today_str} (e.g. August 2026, October 23, Q2/Q3 2026) are already in the PAST.\n"
        f"  * NEVER recommend past dates or expired events as upcoming todos or action items (e.g. do NOT say 'Attend Reflection Session on October 23rd' if today is {today_str})!\n"
        f"- FORWARD-LOOKING TODOS & ACTION PLANS:\n"
        f"  * When the user asks for 'next steps', 'todos', 'what should I do', or 'action items', prescribe fresh, actionable priorities for {current_month_str} starting from today ({today_str}).\n"
        f"  * If historical reports (e.g. from August or October) highlight gaps or uncompleted goals, transform those past learnings into active, forward-looking goals for {current_month_str}.\n"
        f"  * Acknowledge the timeline explicitly (e.g. 'Drawing from your October review notes and August performance baseline, here are your strategic priorities and action items for {current_month_str}:').\n"
    )

    # Call LLM for final synthesis
    if OPENAI_API_KEY:
        try:
            from openai import OpenAI
            client = OpenAI(api_key=OPENAI_API_KEY)
            resp = client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": persona_system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.3,
                max_tokens=900
            )
            ans = resp.choices[0].message.content or ""
            return {"final_response": sanitize_final_response(ans.strip(), role_level)}
        except Exception as e:
            print(f"[COACH SYNTHESIZER] OpenAI synthesis failed: {e}")

    if GEMINI_API_KEY:
        try:
            from google import genai
            from google.genai.types import GenerateContentConfig

            client = genai.Client(api_key=GEMINI_API_KEY)
            config = GenerateContentConfig(temperature=0.3, max_output_tokens=900)
            gemini_prompt = f"{persona_system_prompt}\n\n{user_prompt}"
            res = client.models.generate_content(
                model="gemini-1.5-flash",
                contents=gemini_prompt,
                config=config
            )
            ans = res.text or ""
            return {"final_response": sanitize_final_response(ans.strip(), role_level)}
        except Exception as e:
            print(f"[COACH SYNTHESIZER] Gemini synthesis failed: {e}")

    # Fallback if no LLM configured
    if sql_result:
        fallback_txt = f"Retrieved {len(sql_result)} records from spreadsheet data:\n\n```json\n{json.dumps(sql_result, indent=2)}\n```"
        return {"final_response": sanitize_final_response(fallback_txt, role_level)}
    elif rag_chunks:
        return {"final_response": sanitize_final_response(format_chunks_for_context(rag_chunks), role_level)}
    return {"final_response": "I was unable to connect to the reasoning model to synthesize an answer."}
