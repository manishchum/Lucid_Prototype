# Backend/coach/graph.py
"""
LangGraph Assembly for the Performance Coach Intelligence Layer.
Wires together Introspection, Routing, SQL Generation, Self-Healing Execution,
Vector RAG, and Grounded Synthesis into an executable StateGraph.
"""






import re
import asyncio
import time
from typing import Dict, Any, Literal, List, Optional, AsyncGenerator
from coach.state import CoachState
from coach.nodes import (
    introspect_node,
    router_node,
    sql_generator_node,
    sql_executor_node,
    sql_fixer_node,
    rag_node,
    crm_node,
    synthesizer_node,
    prepare_synthesis_context,
    stream_synthesis_response,
    _get_role_level
)
from coach.guardrails import check_input_guardrails
from security.pii_firewall import sanitize_final_response

try:
    from langgraph.graph import StateGraph, START, END
    LANGGRAPH_AVAILABLE = True
except ImportError:
    StateGraph, START, END = None, None, None
    LANGGRAPH_AVAILABLE = False


# ============================================================================
# CONDITIONAL ROUTING FUNCTIONS
# ============================================================================
def route_from_router(state: CoachState) -> Literal["sql_generator", "rag", "crm", "synthesizer"]:
    """Routes based on classified intent."""
    if state.get("guardrail_triggered"):
        return "synthesizer"
    intent = state.get("intent", "GENERAL")
    if intent in ["SAFETY", "SECURITY", "SCOPE_DEFLECTION", "OUT_OF_SCOPE", "PERMISSIONS", "PERMISSION_DENIED"]:
        return "synthesizer"
    if intent in ["SQL", "HYBRID"]:
        return "sql_generator"
    elif intent == "CRM":
        return "crm"
    elif intent == "RAG":
        return "rag"
    else:  # "CATALOG", "GENERAL", "OUT_OF_SCOPE"
        return "synthesizer"


def route_from_sql_executor(state: CoachState) -> Literal["sql_fixer", "crm", "rag", "synthesizer"]:
    """
    Self-healing retry edge: If SQL execution failed and retry_count < 2,
    routes to sql_fixer to correct the query. Otherwise proceeds to CRM (if HYBRID with CRM terms), RAG (if HYBRID), or synthesizer.
    """
    sql_error = state.get("sql_error")
    retry_count = state.get("sql_retry_count", 0)
    intent = state.get("intent", "")
    user_q = (state.get("user_query") or "").lower()

    # Self-healing retry check (up to 2 retry attempts)
    if sql_error and retry_count < 2:
        return "sql_fixer"

    # If Hybrid query, execute CRM or RAG next
    if intent == "HYBRID":
        if any(k in user_q for k in ["hubspot", "deal", "pipeline", "crm", "lead", "ticket"]):
            return "crm"
        return "rag"

    return "synthesizer"


def route_from_crm(state: CoachState) -> Literal["rag", "synthesizer"]:
    """If HYBRID intent, proceeds to RAG for document context; otherwise to synthesizer."""
    if state.get("intent") == "HYBRID":
        return "rag"
    return "synthesizer"


# ============================================================================
# COMPILED GRAPH WORKFLOW
# ============================================================================
def build_coach_graph():
    """Builds and compiles the LangGraph StateGraph."""
    if not LANGGRAPH_AVAILABLE:
        return None

    workflow = StateGraph(CoachState)

    # 1. Register Nodes
    workflow.add_node("introspect", introspect_node)
    workflow.add_node("router", router_node)
    workflow.add_node("sql_generator", sql_generator_node)
    workflow.add_node("sql_executor", sql_executor_node)
    workflow.add_node("sql_fixer", sql_fixer_node)
    workflow.add_node("crm", crm_node)
    workflow.add_node("rag", rag_node)
    workflow.add_node("synthesizer", synthesizer_node)

    # 2. Main Flow Edges
    workflow.add_edge(START, "introspect")
    workflow.add_edge("introspect", "router")

    # 3. Router Conditional Branching
    workflow.add_conditional_edges(
        "router",
        route_from_router,
        {
            "sql_generator": "sql_generator",
            "crm": "crm",
            "rag": "rag",
            "synthesizer": "synthesizer"
        }
    )

    # 4. SQL Flow with Self-Healing Retry Loop
    workflow.add_edge("sql_generator", "sql_executor")
    workflow.add_edge("sql_fixer", "sql_executor")

    workflow.add_conditional_edges(
        "sql_executor",
        route_from_sql_executor,
        {
            "sql_fixer": "sql_fixer",
            "crm": "crm",
            "rag": "rag",
            "synthesizer": "synthesizer"
        }
    )

    # 5. CRM conditional branch (to RAG if HYBRID, else to synthesizer)
    workflow.add_conditional_edges(
        "crm",
        route_from_crm,
        {
            "rag": "rag",
            "synthesizer": "synthesizer"
        }
    )

    # 6. RAG to Synthesizer to END
    workflow.add_edge("rag", "synthesizer")
    workflow.add_edge("synthesizer", END)

    return workflow.compile()


# Initialize compiled graph instance
compiled_coach_graph = build_coach_graph()


# ============================================================================
# QUERY SUBJECT ENTITY EXTRACTOR & STOP WORDS
# ============================================================================
QUERY_STOP_WORDS = {
    "our", "my", "the", "this", "all", "recent", "team", "each", "sales", "quota",
    "trade", "deal", "deals", "playbook", "playbooks", "policy", "policies", "a", "an",
    "company", "today", "yesterday", "tomorrow", "q1", "q2", "q3", "q4", "monthly",
    "weekly", "annual", "superadmin", "store", "management", "user", "users",
    "customer", "experience", "service", "progress", "overview", "what", "which", "where",
    "how", "when", "why", "who", "whom", "can", "could", "should", "would", "is", "are",
    "was", "were", "and", "or", "in", "at", "by", "from", "to", "with", "documents",
    "document", "records", "notes", "tasks", "task", "review", "summary", "performance",
    "them", "they", "their", "him", "her", "his", "hers", "me", "i", "mine", "myself",
    "rece", "recent", "detail", "details", "info", "information", "spreadsheet", "table"
}


def extract_query_subject(user_query: str, caller_name: Optional[str] = None) -> Optional[str]:
    """
    Extracts the specific employee or person being inquired about from user_query.
    - If a third-party person is explicitly mentioned (e.g. 'riya jhamb', 'Khwaish Gahoi'), returns that name.
    - If first-person pronouns are used ('my performance', 'how am I doing'), returns caller_name.
    - Otherwise returns None.
    """
    q = (user_query or "").strip()
    if not q:
        return None

    # 1. Possessive pattern: "riya jhamb's tasks", "Khwaish's performance", "monalika's review"
    m_poss = re.search(r"\b([A-Za-z]+(?:\s+[A-Za-z]+)?)'s\b", q)
    if m_poss:
        cand = m_poss.group(1).strip()
        words = cand.split()
        if not any(w.lower() in QUERY_STOP_WORDS for w in words):
            return cand.title()

    # 2. Preposition pattern: "summary for riya jhamb", "for riya jhamb", "review for Khwaish Gahoi", "about Yomit"
    m_prep = re.search(
        r"\b(?:summary\s+for|review\s+for|performance\s+for|tasks?\s+(?:noted\s+)?for|feedback\s+for|notes?\s+for|metrics\s+for|for|about|of)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)\b",
        q,
        re.IGNORECASE
    )
    if m_prep:
        raw_cand = m_prep.group(1).strip()
        words = raw_cand.split()
        valid_words = []
        for w in words:
            if w.lower() in QUERY_STOP_WORDS:
                break
            valid_words.append(w)
        if valid_words:
            cand = " ".join(valid_words)
            if cand.lower() not in QUERY_STOP_WORDS and len(cand) >= 2:
                return cand.title()

    # 3. Direct name mention pattern if preceded by 'on', 'with', 'regarding'
    m_direct = re.search(r"\b(?:on|with|regarding)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)\b", q, re.IGNORECASE)
    if m_direct:
        raw_cand = m_direct.group(1).strip()
        words = raw_cand.split()
        valid_words = []
        for w in words:
            if w.lower() in QUERY_STOP_WORDS:
                break
            valid_words.append(w)
        if valid_words:
            cand = " ".join(valid_words)
            if cand.lower() not in QUERY_STOP_WORDS and len(cand) >= 2:
                return cand.title()

    # 4. Check for first-person self-reference ("my performance", "my quota", "how am I doing")
    is_first_person = bool(re.search(r"\b(my|i|me|mine|myself)\b", q, re.IGNORECASE))
    if is_first_person and caller_name and caller_name.strip():
        return caller_name.strip()

    return None


# ============================================================================
# STANDALONE EXECUTION RUNNER (Fallback & Synchronous invocation)
# ============================================================================
def execute_coach_agent(
    user_query: str,
    company_id: str,
    user_id: str = "",
    target_employee_id: str = None,
    target_employee_name: str = None,
    security_ctx: Any = None,
) -> Dict[str, Any]:
    """
    Executes the Performance Coach workflow.
    Uses compiled LangGraph when available, with deterministic fallback.
    """
    # 0. Fast-Path Input Guardrails (< 5ms: Crisis, Harm, DB Security, Off-topic Poems)
    guardrail_match = check_input_guardrails(user_query)
    if guardrail_match:
        return {
            "response": guardrail_match["response"],
            "intent": guardrail_match["intent"],
            "sql_query": None,
            "sql_result": None,
            "citations": [],
            "error": None
        }

    sec_dict = None
    if security_ctx is not None:
        sec_dict = security_ctx.to_cache_dict() if hasattr(security_ctx, "to_cache_dict") else dict(security_ctx)

    # Determine true target employee subject for this specific query
    query_subject = extract_query_subject(user_query, target_employee_name)
    effective_emp_name = query_subject if query_subject else (
        target_employee_name if re.search(r"\b(my|i|me|mine|myself)\b", user_query, re.IGNORECASE) else None
    )

    initial_state: CoachState = {
        "user_query": user_query,
        "company_id": company_id,
        "user_id": user_id,
        "target_employee_id": target_employee_id,
        "target_employee_name": effective_emp_name,
        "security_ctx": sec_dict,
        "sql_retry_count": 0,
        "citations": [],
        "rag_chunks": []
    }

    # 1. Use LangGraph if installed
    if compiled_coach_graph is not None:
        try:
            final_state = compiled_coach_graph.invoke(initial_state)
            return {
                "response": final_state.get("final_response", ""),
                "intent": final_state.get("intent", ""),
                "sql_query": final_state.get("sql_query"),
                "sql_result": final_state.get("sql_result"),
                "citations": final_state.get("citations", []),
                "error": None
            }
        except Exception as e:
            print(f"[COACH GRAPH] LangGraph invoke error: {e}")

    # 2. Sequential State Machine Execution (Zero-dependency fallback)
    state = dict(initial_state)
    state.update(introspect_node(state))
    state.update(router_node(state))

    intent = state.get("intent", "GENERAL")

    if intent == "CRM":
        state.update(crm_node(state))

    if intent in ["SQL", "HYBRID"]:
        state.update(sql_generator_node(state))
        state.update(sql_executor_node(state))

        # Check self-healing
        if state.get("sql_error") and state.get("sql_retry_count", 0) < 2:
            state.update(sql_fixer_node(state))
            state.update(sql_executor_node(state))

    if intent == "HYBRID":
        q_low = user_query.lower()
        if any(k in q_low for k in ["hubspot", "deal", "pipeline", "crm", "lead", "ticket"]):
            state.update(crm_node(state))

    if intent in ["RAG", "HYBRID"]:
        state.update(rag_node(state))

    state.update(synthesizer_node(state))

    return {
        "response": state.get("final_response", ""),
        "intent": state.get("intent", ""),
        "sql_query": state.get("sql_query"),
        "sql_result": state.get("sql_result"),
        "citations": state.get("citations", []),
        "error": None
    }


# ============================================================================
# HUMANE NATURAL LANGUAGE THOUGHT DETAIL BUILDER
# ============================================================================
def build_humane_thought_detail(step: str, state: Dict[str, Any], **extra) -> str:
    """
    Builds a dynamic, humane, natural language thought monologue reflecting
    the model's actual reasoning, database findings, and document discoveries in real-time.
    """
    user_query = (state.get("user_query") or "").strip()
    target_name = extract_query_subject(user_query, state.get("target_employee_name"))

    intent = state.get("intent", "GENERAL")
    row_count = extra.get("row_count")
    if row_count is None:
        row_count = len(state.get("sql_result") or [])

    matched_files = state.get("matched_files") or []
    chunks = state.get("rag_chunks") or []

    clean_q = user_query
    if len(clean_q) > 90:
        clean_q = clean_q[:87] + "..."

    if step == "introspecting":
        if user_query:
            return f"The user is asking: \"{clean_q}\". Let me inspect our available database tables and company document archives to see where this information is recorded."
        return "Checking our company data catalog to inspect available metrics tables and reference playbooks."

    elif step == "routing":
        if intent == "HYBRID":
            if target_name:
                return f"To provide a complete review for {target_name}, I need a two-pronged approach: query our numerical performance tables for any sales or quota metrics, while also searching qualitative review notes and task reminders."
            return "This inquiry requires cross-referencing: checking our numerical metrics tables for data while scanning our qualitative documents and playbooks for context."
        elif intent == "SQL":
            if target_name:
                return f"This is a quantitative data question focused on {target_name}. I will formulate a SQL query to inspect sales volume, quota pacing, and target attainment in our database."
            return "This is a quantitative performance query. I will formulate a SQL query to pull the relevant sales numbers, quota percentages, and attainment metrics from our tables."
        elif intent == "RAG":
            return "This is a qualitative policy and playbook inquiry. I will search through our company guides and reference documents rather than querying numerical spreadsheet tables."
        elif intent == "CRM":
            return "The user is asking about live CRM deals and pipeline status. I will connect to our CRM integration to fetch current stages, contacts, and deal values."
        else:
            return "Reviewing the inquiry against our coaching capabilities to formulate clear, direct guidance."

    elif step == "crm":
        return "Connecting to our CRM integration to inspect live deals, pipeline stages, and contact activity from HubSpot..."

    elif step == "sql":
        if row_count == 0:
            if target_name:
                return f"Checked our performance metrics tables for {target_name}... No direct numerical spreadsheet rows or sales quotas were recorded under this name, so their contributions appear to be tracked qualitatively in project logs."
            return "Executed a database query across our company performance metrics tables, but found 0 matching rows. I will rely on qualitative documentation and playbooks for relevant context."
        else:
            row_word = "record" if row_count == 1 else "records"
            if target_name:
                return f"Queried our performance metrics tables for {target_name}: retrieved {row_count} matching {row_word} detailing sales volume, quota pacing, and target attainment."
            return f"Executed a database query across our company performance tables: pulled {row_count} matching {row_word} containing verified metrics and attainment data."

    elif step == "rag":
        files_sample = f" (such as {', '.join(matched_files[:2])})" if matched_files else ""
        passage_word = "passage" if len(chunks) == 1 else "passages"
        doc_word = "document" if len(matched_files) == 1 else "documents"

        is_task_related = any("task" in f.lower() or "reminder" in f.lower() or "test" in f.lower() for f in matched_files)
        is_playbook_related = any("playbook" in f.lower() or "policy" in f.lower() or "discount" in f.lower() for f in matched_files)

        if is_task_related:
            if target_name:
                return f"Searched our qualitative document archives for task reminders and review notes. Found {len(chunks)} relevant {passage_word} across {len(matched_files)} {doc_word}{files_sample} documenting {target_name}'s active task completions and project involvement."
            return f"Searched our qualitative document archives for task reminders and review notes. Found {len(chunks)} relevant {passage_word} across {len(matched_files)} {doc_word}{files_sample} detailing completed deliverables, team feedback, and project milestones."
        elif is_playbook_related:
            return f"Searched our playbook archives and policy documentation. Found {len(chunks)} relevant {passage_word} across {len(matched_files)} {doc_word}{files_sample} detailing authorized procedures, guidelines, and operational standards."
        else:
            return f"Searched our company knowledge base. Found {len(chunks)} relevant {passage_word} across {len(matched_files)} {doc_word}{files_sample} containing verified source context."

    elif step == "synthesizing":
        if intent == "HYBRID" and row_count == 0:
            if target_name:
                return f"Bringing everything together into a clear coaching summary for {target_name}: highlighting their documented project milestones, noting the absence of numerical quota rows, and recommending constructive next steps with verified citations."
            return "Bringing everything together into a balanced coaching response: highlighting documented project milestones, clarifying that quantitative quota rows were not found, and providing actionable next steps with citations."
        elif intent == "HYBRID" and row_count > 0:
            if target_name:
                return f"Bringing together both the verified performance metrics and qualitative document findings into an actionable coaching summary for {target_name} with source citations."
            return "Synthesizing both the quantitative database metrics and qualitative document findings into an actionable coaching summary with verified citations."
        elif intent == "SQL":
            return "Structuring the retrieved metrics into an executive-ready performance summary, highlighting pacing, quota attainment, and key trends."
        elif intent == "RAG":
            return "Synthesizing the verified playbook guidelines into a structured, clear response with exact references to the source documents."
        else:
            return "Synthesizing actionable, grounded coaching guidance calibrated to your role and company context."

    return "Analyzing company metrics and knowledge base records..."


# ============================================================================
# ASYNCHRONOUS TRUE STREAMING RUNNER (SSE)
# ============================================================================
async def stream_coach_agent(
    user_query: str,
    company_id: str,
    user_id: str = "",
    target_employee_id: str = None,
    target_employee_name: str = None,
    security_ctx: Any = None,
    request: Optional[Any] = None,
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Asynchronously streams the Performance Coach workflow.
    Emits real-time SSE progress steps during retrieval, followed by true token-by-token
    synthesis directly from AsyncOpenAI / Gemini async streaming.
    """
    # 0. Fast-Path Input Guardrails (< 5ms: Crisis, Harm, DB Security, Off-topic Poems)
    guardrail_match = check_input_guardrails(user_query)
    if guardrail_match:
        response_text = guardrail_match["response"]
        yield {"type": "token", "content": response_text}
        yield {
            "type": "done",
            "intent": guardrail_match["intent"],
            "sql_query": None,
            "sql_result": None,
            "citations_count": 0,
            "citations": [],
            "response": response_text,
        }
        return

    sec_dict = None
    if security_ctx is not None:
        sec_dict = security_ctx.to_cache_dict() if hasattr(security_ctx, "to_cache_dict") else dict(security_ctx)

    # Determine true target employee subject for this specific query
    query_subject = extract_query_subject(user_query, target_employee_name)
    effective_emp_name = query_subject if query_subject else (
        target_employee_name if re.search(r"\b(my|i|me|mine|myself)\b", user_query, re.IGNORECASE) else None
    )

    state: CoachState = {
        "user_query": user_query,
        "company_id": company_id,
        "user_id": user_id,
        "target_employee_id": target_employee_id,
        "target_employee_name": effective_emp_name,
        "security_ctx": sec_dict,
        "sql_retry_count": 0,
        "citations": [],
        "rag_chunks": []
    }

    start_time = time.time()
    loop = asyncio.get_event_loop()

    # Step 1: Introspect
    yield {
        "type": "step",
        "step": "introspecting",
        "title": "Inspecting Catalog & Schemas",
        "detail": build_humane_thought_detail("introspecting", state),
        "timestamp": time.time(),
    }
    try:
        introspect_res = await loop.run_in_executor(None, introspect_node, state)
        state.update(introspect_res)
    except Exception as e:
        print(f"[COACH GRAPH STREAM] Introspect node error: {e}")

    schema_dict = state.get("schema_dict") or {}
    all_tables = schema_dict.get("all_sheet_names") or []
    doc_catalog = state.get("document_catalog") or []

    # Step 2: Routing (run router first so the humane thought reflects the classified strategy)
    try:
        router_res = await loop.run_in_executor(None, router_node, state)
        state.update(router_res)
    except Exception as e:
        print(f"[COACH GRAPH STREAM] Router node error: {e}")

    intent = state.get("intent", "GENERAL")
    guardrail_triggered = state.get("guardrail_triggered", False)
    reason = state.get("routing_reason") or ""

    yield {
        "type": "step",
        "step": "routing",
        "title": "Planning Execution Strategy",
        "detail": build_humane_thought_detail("routing", state),
        "timestamp": time.time(),
    }

    # If guardrail triggered or non-retrieval intent, skip directly to synthesis
    is_non_retrieval = guardrail_triggered or intent in [
        "SAFETY", "SECURITY", "SCOPE_DEFLECTION", "OUT_OF_SCOPE",
        "PERMISSIONS", "PERMISSION_DENIED", "CATALOG", "GENERAL"
    ]

    row_count_for_synthesis = 0

    if not is_non_retrieval:
        # Step 3: CRM (if CRM intent)
        if intent == "CRM":
            yield {
                "type": "step",
                "step": "crm",
                "title": "Connecting to CRM Pipeline",
                "detail": build_humane_thought_detail("crm", state),
                "timestamp": time.time(),
            }
            try:
                crm_res = await loop.run_in_executor(None, crm_node, state)
                state.update(crm_res)
            except Exception as e:
                print(f"[COACH GRAPH STREAM] CRM node error: {e}")

        # Step 4: Text-to-SQL & Self-Healing (if SQL or HYBRID)
        if intent in ["SQL", "HYBRID"]:
            sql_gen_res = await loop.run_in_executor(None, sql_generator_node, state)
            state.update(sql_gen_res)

            sql_query = state.get("sql_query") or ""
            sql_exec_res = await loop.run_in_executor(None, sql_executor_node, state)
            state.update(sql_exec_res)

            # Self-healing retry check (up to 2 retries)
            if state.get("sql_error") and state.get("sql_retry_count", 0) < 2:
                fix_res = await loop.run_in_executor(None, sql_fixer_node, state)
                state.update(fix_res)
                retry_exec_res = await loop.run_in_executor(None, sql_executor_node, state)
                state.update(retry_exec_res)

            sql_query = state.get("sql_query")
            sql_result = state.get("sql_result")
            row_count = len(sql_result or [])
            row_count_for_synthesis = row_count
            if sql_query:
                yield {
                    "type": "step",
                    "step": "sql",
                    "title": "Database Query",
                    "detail": build_humane_thought_detail("sql", state, row_count=row_count),
                    "query": sql_query,
                    "row_count": row_count,
                    "data": {
                        "sqlQuery": sql_query,
                        "rowCount": row_count,
                        "tables": all_tables[:4]
                    },
                    "timestamp": time.time(),
                }

        # Step 5: Hybrid CRM check
        if intent == "HYBRID":
            q_low = user_query.lower()
            if any(k in q_low for k in ["hubspot", "deal", "pipeline", "crm", "lead", "ticket"]):
                yield {
                    "type": "step",
                    "step": "crm",
                    "title": "Connecting to CRM Pipeline",
                    "detail": build_humane_thought_detail("crm", state),
                    "timestamp": time.time(),
                }
                try:
                    crm_res = await loop.run_in_executor(None, crm_node, state)
                    state.update(crm_res)
                except Exception as e:
                    print(f"[COACH GRAPH STREAM] CRM hybrid node error: {e}")

        # Step 6: RAG retrieval (if RAG or HYBRID)
        if intent in ["RAG", "HYBRID"]:
            try:
                rag_res = await loop.run_in_executor(None, rag_node, state)
                state.update(rag_res)
            except Exception as e:
                print(f"[COACH GRAPH STREAM] RAG node error: {e}")

            matched_files = state.get("matched_files") or []
            matched_files_details = state.get("matched_files_details") or []
            chunks = state.get("rag_chunks") or []

            yield {
                "type": "step",
                "step": "rag",
                "title": "Document Analysis",
                "detail": build_humane_thought_detail("rag", state),
                "data": {
                    "files": matched_files_details,
                    "fileCount": len(matched_files),
                    "chunkCount": len(chunks)
                },
                "timestamp": time.time(),
            }

    # Citations
    citations = state.get("citations", [])
    if citations:
        yield {"type": "citations", "citations": citations}

    # Step 7: Synthesis (Token-by-Token Streaming)
    elapsed = round(time.time() - start_time, 1)
    yield {
        "type": "step",
        "step": "synthesizing",
        "title": "Synthesizing Coaching Guidance",
        "detail": build_humane_thought_detail("synthesizing", state, row_count=row_count_for_synthesis),
        "duration": elapsed,
        "timestamp": time.time(),
    }
    ctx = prepare_synthesis_context(state)
    role_level = _get_role_level(state)

    full_response_parts: List[str] = []
    async for token_chunk in stream_synthesis_response(ctx, request=request):
        full_response_parts.append(token_chunk)
        yield {"type": "token", "content": token_chunk}

    raw_response = "".join(full_response_parts)
    sanitized_response = sanitize_final_response(raw_response.strip(), role_level)

    yield {
        "type": "done",
        "intent": state.get("intent", intent),
        "sql_query": state.get("sql_query"),
        "sql_result": state.get("sql_result"),
        "citations": citations,
        "citations_count": len(citations),
        "response": sanitized_response
    }
