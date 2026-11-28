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
from core.agent_activity.event_types import ExecutionStage, EventStatus, EventVisibility
from core.agent_activity.execution_context import ExecutionContext, execution_scope, execution_span
from core.agent_activity.event_manager import ExecutionEventManager
from ai.narrator.narrator_service import get_narrator_service

try:
    from langgraph.graph import StateGraph, START, END
    LANGGRAPH_AVAILABLE = True
except ImportError:
    StateGraph, START, END = None, None, None
    LANGGRAPH_AVAILABLE = False


def _tokenize_text_for_stream(text: str) -> List[str]:
    """Splits text into natural word-level tokens preserving spacing for SSE token streaming."""
    if not text:
        return []
    return re.findall(r"\S+\s*|\s+", text)


def build_public_citations(citations: List[Dict[str, Any]], role_level: int) -> List[Dict[str, Any]]:
    """
    Constructs a role-filtered, sanitized public citation payload.
    Omits raw underlying chunk bodies ('content', 'text') and applies role-based
    PII firewall to brief excerpts to guarantee no sensitive data escapes through citations.
    """
    if not citations:
        return []

    public_citations: List[Dict[str, Any]] = []
    for cit in citations:
        if not isinstance(cit, dict):
            continue

        raw_excerpt = str(cit.get("excerpt") or "")
        # Apply role-based PII firewall to the excerpt
        sanitized_excerpt = sanitize_final_response(raw_excerpt[:250], role_level) if raw_excerpt else ""

        public_cit = {
            "index": cit.get("index"),
            "document_id": cit.get("document_id"),
            "filename": cit.get("filename") or cit.get("file_name"),
            "file_name": cit.get("file_name") or cit.get("filename"),
            "title": cit.get("title") or cit.get("filename"),
            "name": cit.get("name") or cit.get("filename"),
            "file_type": cit.get("file_type", "doc"),
            "location": cit.get("location"),
            "page_number": cit.get("page_number"),
            "paragraph_number": cit.get("paragraph_number"),
            "line_range": cit.get("line_range"),
            "slide_number": cit.get("slide_number"),
            "sheet_name": cit.get("sheet_name"),
            "row_number": cit.get("row_number"),
            "section_title": cit.get("section_title"),
            "eval_period": cit.get("eval_period"),
            "score": cit.get("score"),
            "similarity": cit.get("similarity"),
            "excerpt": sanitized_excerpt,
        }
        # Explicitly do NOT include cit.get("content") or cit.get("text")
        public_citations.append(public_cit)

    return public_citations


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
# QUERY SUBJECT ENTITY EXTRACTOR & STOP WORDS (Imported from thought_engine)
# ============================================================================
from coach.thought_engine import extract_query_subject, QUERY_STOP_WORDS


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
            role_level = _get_role_level(final_state)
            return {
                "response": final_state.get("final_response", ""),
                "intent": final_state.get("intent", ""),
                "sql_query": None,  # Omit raw SQL statement to prevent schema/sensitive literal exposure
                "sql_result": None,
                "citations": build_public_citations(final_state.get("citations", []), role_level),
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

        # Check self-healing (up to 2 retries)
        while state.get("sql_error") and state.get("sql_retry_count", 0) < 2:
            state.update(sql_fixer_node(state))
            state.update(sql_executor_node(state))

    if intent == "HYBRID":
        q_low = user_query.lower()
        if any(k in q_low for k in ["hubspot", "deal", "pipeline", "crm", "lead", "ticket"]):
            state.update(crm_node(state))

    if intent in ["RAG", "HYBRID"]:
        state.update(rag_node(state))

    state.update(synthesizer_node(state))
    role_level = _get_role_level(state)

    return {
        "response": state.get("final_response", ""),
        "intent": state.get("intent", ""),
        "sql_query": None,  # Omit raw SQL statement to prevent schema/sensitive literal exposure
        "sql_result": None,
        "citations": build_public_citations(state.get("citations", []), role_level),
        "error": None
    }


# ============================================================================
# HUMANE NATURAL LANGUAGE THOUGHT DETAIL BUILDER
# ============================================================================
def build_humane_thought_detail(step: str, state: Dict[str, Any], **extra) -> str:
    """
    Builds a dynamic, humane, natural language thought reflection
    using the Cognitive Thought Engine.
    """
    from coach.thought_engine import triage_query, build_tool_observation, build_synthesis_strategy

    user_query = (state.get("user_query") or "").strip()
    target_name = extract_query_subject(user_query, state.get("target_employee_name"))

    triage = triage_query(
        user_query,
        caller_name=state.get("target_employee_name"),
        target_employee_name=target_name
    )

    if step in ["introspecting", "cognition"]:
        return triage.understanding

    elif step == "routing":
        intent = state.get("intent", triage.intent)
        if intent == "HYBRID":
            if target_name:
                return f"To provide a complete review for {target_name}, I need a two-pronged approach: query our numerical performance tables for sales and quota metrics, while cross-referencing qualitative review notes and task reminders."
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
            return triage.understanding

    elif step in ["sql", "rag", "crm"]:
        return build_tool_observation(step, state, **extra)

    elif step == "synthesizing":
        return build_synthesis_strategy(state)

    return "Analyzing company metrics and knowledge base records..."


# ============================================================================
# ASYNCHRONOUS TRUE STREAMING RUNNER (SSE) WITH AGENT ACTIVITY TRANSPARENCY
# ============================================================================
async def stream_coach_agent(
    user_query: str,
    company_id: str,
    user_id: str = "",
    target_employee_id: str = None,
    target_employee_name: str = None,
    security_ctx: Any = None,
    request: Optional[Any] = None,
    execution_id: Optional[str] = None,
    conversation_id: Optional[str] = None,
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Asynchronously streams the Performance Coach workflow with real-time natural language
    transparency updates powered by the Agent Activity Layer and LLM Narrator Service.
    """
    start_time = time.time()
    loop = asyncio.get_event_loop()

    # Initialize Execution Context and Event Manager
    ctx = ExecutionContext(
        company_id=company_id,
        user_id=user_id,
        execution_id=execution_id,
        conversation_id=conversation_id,
        agent_type="coach",
    )
    event_mgr = ExecutionEventManager(context=ctx, query=user_query)
    await event_mgr.initialize()
    narrator = get_narrator_service()

    # 0. Fast-Path Input Guardrails (< 5ms: Crisis, Harm, DB Security, Off-topic Poems)
    guardrail_match = check_input_guardrails(user_query)
    if guardrail_match:
        response_text = guardrail_match["response"]
        await event_mgr.emit_execution_event(
            stage=ExecutionStage.VALIDATION,
            event_type="guardrail_triggered",
            source_component="guardrails",
            payload={"intent": guardrail_match["intent"]},
        )
        await event_mgr.emit_activity_update(
            stage=ExecutionStage.VALIDATION,
            title="Safety Verification",
            message="Evaluating query against compliance and safety guidelines.",
            status="completed",
        )
        yield {
            "type": "activity_update",
            "execution_id": ctx.execution_id,
            "sequence": ctx.current_sequence,
            "stage": "validation",
            "step": "cognition",
            "title": "Safety Verification",
            "message": "Evaluated query against compliance and safety guidelines.",
            "detail": "Evaluated query against compliance and safety guidelines.",
            "status": "completed",
            "timestamp": time.time(),
        }
        yield {"type": "token", "content": response_text}
        await event_mgr.complete(status="COMPLETED")
        yield {
            "type": "done",
            "execution_id": ctx.execution_id,
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

    # 0B. Fast-Path Cognitive Triage & Humane Action Planner
    from coach.thought_engine import triage_query
    triage = triage_query(
        user_query,
        caller_name=target_employee_name,
        target_employee_name=effective_emp_name,
    )

    # If conversational greeting, pleasantry, or gratitude: fast-path narration (<5ms)
    if triage.is_conversational:
        plan_narr = await narrator.narrate_plan(user_query, triage, target_entity=effective_emp_name)
        ev_plan = await event_mgr.emit_execution_event(
            stage=ExecutionStage.UNDERSTANDING,
            event_type="intent_classified",
            source_component="thought_engine",
            payload={"intent": triage.intent, "is_conversational": True},
            duration_ms=plan_narr.get("duration_ms"),
        )
        await event_mgr.record_narration(
            title=plan_narr["title"],
            message=plan_narr["message"],
            stage=ExecutionStage.UNDERSTANDING,
            source_event_id=ev_plan.event_id,
            provider=plan_narr.get("provider", "fast_path"),
            model=plan_narr.get("model"),
            is_fallback=plan_narr.get("is_fallback", False),
            duration_ms=plan_narr.get("duration_ms"),
        )
        elapsed = max(round(time.time() - start_time, 2), 0.2)
        yield {
            "type": "activity_update",
            "execution_id": ctx.execution_id,
            "sequence": ctx.current_sequence,
            "stage": "understanding",
            "step": "cognition",
            "title": plan_narr["title"],
            "message": plan_narr["message"],
            "detail": plan_narr["message"],
            "understanding": triage.understanding,
            "planned_actions": triage.planned_actions,
            "synthesis_strategy": triage.synthesis_strategy,
            "status": "completed",
            "duration": elapsed,
            "duration_ms": plan_narr.get("duration_ms"),
            "timestamp": time.time(),
        }

        state["intent"] = triage.intent
        synthesis_ctx = prepare_synthesis_context(state)
        role_level = _get_role_level(state)

        # Buffer full synthesis response to ensure role-based PII firewall runs BEFORE any token reaches the client
        full_response_parts: List[str] = []
        async for token_chunk in stream_synthesis_response(synthesis_ctx, request=request):
            full_response_parts.append(token_chunk)

        raw_response = "".join(full_response_parts)
        sanitized_response = sanitize_final_response(raw_response.strip(), role_level)

        for token in _tokenize_text_for_stream(sanitized_response):
            if request and await request.is_disconnected():
                break
            yield {"type": "token", "content": token}

        await event_mgr.complete(status="COMPLETED")
        yield {
            "type": "done",
            "execution_id": ctx.execution_id,
            "intent": triage.intent,
            "sql_query": None,
            "sql_result": None,
            "citations": [],
            "citations_count": 0,
            "response": sanitized_response,
        }
        return

    # Non-conversational: 1. Planning Stage
    plan_narr = await narrator.narrate_plan(user_query, triage, target_entity=effective_emp_name)
    ev_plan = await event_mgr.emit_execution_event(
        stage=ExecutionStage.PLANNING,
        event_type="plan_formulated",
        source_component="planner",
        payload={
            "intent": triage.intent,
            "planned_actions": triage.planned_actions,
            "target_entity": effective_emp_name
        },
        duration_ms=plan_narr.get("duration_ms"),
    )
    await event_mgr.record_narration(
        title=plan_narr["title"],
        message=plan_narr["message"],
        stage=ExecutionStage.PLANNING,
        source_event_id=ev_plan.event_id,
        provider=plan_narr.get("provider", "gemini"),
        model=plan_narr.get("model"),
        is_fallback=plan_narr.get("is_fallback", False),
        duration_ms=plan_narr.get("duration_ms"),
    )

    yield {
        "type": "activity_update",
        "execution_id": ctx.execution_id,
        "sequence": ctx.current_sequence,
        "stage": "planning",
        "step": "cognition",
        "title": plan_narr["title"],
        "message": plan_narr["message"],
        "detail": plan_narr["message"],
        "understanding": triage.understanding,
        "planned_actions": triage.planned_actions,
        "synthesis_strategy": triage.synthesis_strategy,
        "status": "completed",
        "duration_ms": plan_narr.get("duration_ms"),
        "timestamp": time.time(),
    }

    # Step 1: Introspect Catalog & Schemas
    yield {
        "type": "activity_update",
        "execution_id": ctx.execution_id,
        "sequence": ctx.current_sequence,
        "stage": "information_gathering",
        "step": "introspecting",
        "title": "Inspecting Catalog & Schemas",
        "message": "Scanning accessible spreadsheets, playbooks, and company schemas...",
        "detail": "Scanning accessible spreadsheets, playbooks, and company schemas...",
        "status": "running",
        "timestamp": time.time(),
    }
    t_introspect = time.monotonic()
    try:
        introspect_res = await loop.run_in_executor(None, introspect_node, state)
        state.update(introspect_res)
    except Exception as e:
        print(f"[COACH GRAPH STREAM] Introspect node error: {e}")

    introspect_ms = int((time.monotonic() - t_introspect) * 1000)
    await event_mgr.emit_execution_event(
        stage=ExecutionStage.INFORMATION_GATHERING,
        event_type="catalog_inspected",
        source_component="schema_inspector",
        payload={
            "tables_found": len(state.get("schema_dict", {}).get("all_sheet_names") or []),
            "documents_found": len(state.get("document_catalog") or [])
        },
        duration_ms=introspect_ms,
    )
    yield {
        "type": "activity_update",
        "execution_id": ctx.execution_id,
        "sequence": ctx.current_sequence,
        "stage": "information_gathering",
        "step": "introspecting",
        "title": "Inspecting Catalog & Schemas",
        "message": "Verified accessible company spreadsheets and reference documents.",
        "detail": "Verified accessible company spreadsheets and reference documents.",
        "status": "completed",
        "duration_ms": introspect_ms,
        "timestamp": time.time(),
    }

    # Step 2: Routing
    try:
        router_res = await loop.run_in_executor(None, router_node, state)
        state.update(router_res)
    except Exception as e:
        print(f"[COACH GRAPH STREAM] Router node error: {e}")

    intent = state.get("intent", "GENERAL")
    guardrail_triggered = state.get("guardrail_triggered", False)

    is_non_retrieval = guardrail_triggered or intent in [
        "SAFETY", "SECURITY", "SCOPE_DEFLECTION", "OUT_OF_SCOPE",
        "PERMISSIONS", "PERMISSION_DENIED", "CATALOG", "GENERAL"
    ]

    row_count_for_synthesis = 0

    if not is_non_retrieval:
        # Step 3: CRM Execution
        if intent == "CRM":
            yield {
                "type": "activity_update",
                "execution_id": ctx.execution_id,
                "sequence": ctx.current_sequence,
                "stage": "tool_execution",
                "step": "crm",
                "title": "Querying CRM Pipeline",
                "message": "Connecting to CRM integration to inspect deal stages and pipeline values...",
                "detail": "Connecting to CRM integration to inspect deal stages and pipeline values...",
                "status": "running",
                "timestamp": time.time(),
            }
            t_crm = time.monotonic()
            try:
                crm_res = await loop.run_in_executor(None, crm_node, state)
                state.update(crm_res)
            except Exception as e:
                print(f"[COACH GRAPH STREAM] CRM node error: {e}")
            crm_ms = int((time.monotonic() - t_crm) * 1000)

            obs_crm = await narrator.narrate_observation(
                user_query=user_query,
                step="crm",
                state=state,
                target_entity=effective_emp_name,
            )
            ev_crm = await event_mgr.emit_execution_event(
                stage=ExecutionStage.OBSERVATION,
                event_type="crm_queried",
                source_component="hubspot_mcp",
                payload=obs_crm.get("evidence", {}),
                duration_ms=crm_ms,
            )
            await event_mgr.record_narration(
                title=obs_crm["title"],
                message=obs_crm["message"],
                stage=ExecutionStage.OBSERVATION,
                source_event_id=ev_crm.event_id,
                provider=obs_crm.get("provider", "gemini"),
                model=obs_crm.get("model"),
                is_fallback=obs_crm.get("is_fallback", False),
                duration_ms=obs_crm.get("duration_ms"),
            )
            yield {
                "type": "activity_update",
                "execution_id": ctx.execution_id,
                "sequence": ctx.current_sequence,
                "stage": "observation",
                "step": "crm",
                "title": obs_crm["title"],
                "message": obs_crm["message"],
                "detail": obs_crm["message"],
                "evidence": obs_crm.get("evidence"),
                "status": "completed",
                "duration_ms": crm_ms,
                "timestamp": time.time(),
            }

        # Step 4: Text-to-SQL & Self-Healing Execution
        if intent in ["SQL", "HYBRID"]:
            yield {
                "type": "activity_update",
                "execution_id": ctx.execution_id,
                "sequence": ctx.current_sequence,
                "stage": "tool_execution",
                "step": "sql",
                "title": "Database Query",
                "message": f"Formulating SQL query across metrics tables{f' for {effective_emp_name}' if effective_emp_name else ''}...",
                "detail": f"Formulating SQL query across metrics tables{f' for {effective_emp_name}' if effective_emp_name else ''}...",
                "status": "running",
                "timestamp": time.time(),
            }
            t_sql = time.monotonic()
            sql_gen_res = await loop.run_in_executor(None, sql_generator_node, state)
            state.update(sql_gen_res)

            sql_exec_res = await loop.run_in_executor(None, sql_executor_node, state)
            state.update(sql_exec_res)

            # Self-healing retry check (up to 2 retries)
            while state.get("sql_error") and state.get("sql_retry_count", 0) < 2:
                yield {
                    "type": "activity_update",
                    "execution_id": ctx.execution_id,
                    "sequence": ctx.current_sequence,
                    "stage": "recovery",
                    "step": "sql",
                    "title": "Repairing SQL Query",
                    "message": "Self-healing: correcting SQL schema predicate for accurate execution...",
                    "detail": "Self-healing: correcting SQL schema predicate for accurate execution...",
                    "status": "retrying",
                    "timestamp": time.time(),
                }
                fix_res = await loop.run_in_executor(None, sql_fixer_node, state)
                state.update(fix_res)
                retry_exec_res = await loop.run_in_executor(None, sql_executor_node, state)
                state.update(retry_exec_res)

            sql_ms = int((time.monotonic() - t_sql) * 1000)
            sql_result = state.get("sql_result")
            row_count = len(sql_result or [])
            row_count_for_synthesis = row_count

            obs_sql = await narrator.narrate_observation(
                user_query=user_query,
                step="sql",
                state=state,
                row_count=row_count,
                target_entity=effective_emp_name,
            )
            ev_sql = await event_mgr.emit_execution_event(
                stage=ExecutionStage.OBSERVATION,
                event_type="sql_executed",
                source_component="sql_executor",
                payload={"row_count": row_count, "retries": state.get("sql_retry_count", 0)},
                duration_ms=sql_ms,
            )
            await event_mgr.record_narration(
                title=obs_sql["title"],
                message=obs_sql["message"],
                stage=ExecutionStage.OBSERVATION,
                source_event_id=ev_sql.event_id,
                provider=obs_sql.get("provider", "gemini"),
                model=obs_sql.get("model"),
                is_fallback=obs_sql.get("is_fallback", False),
                duration_ms=obs_sql.get("duration_ms"),
            )
            yield {
                "type": "activity_update",
                "execution_id": ctx.execution_id,
                "sequence": ctx.current_sequence,
                "stage": "observation",
                "step": "sql",
                "title": obs_sql["title"],
                "message": obs_sql["message"],
                "detail": obs_sql["message"],
                "evidence": {"rowCount": row_count},
                "data": {"rowCount": row_count},
                "status": "completed",
                "duration_ms": sql_ms,
                "timestamp": time.time(),
            }

        # Step 5: Hybrid CRM Check
        if intent == "HYBRID":
            q_low = user_query.lower()
            if any(k in q_low for k in ["hubspot", "deal", "pipeline", "crm", "lead", "ticket"]):
                yield {
                    "type": "activity_update",
                    "execution_id": ctx.execution_id,
                    "sequence": ctx.current_sequence,
                    "stage": "tool_execution",
                    "step": "crm",
                    "title": "Connecting to CRM Pipeline",
                    "message": "Cross-referencing live CRM deal status...",
                    "detail": "Cross-referencing live CRM deal status...",
                    "status": "running",
                    "timestamp": time.time(),
                }
                try:
                    crm_res = await loop.run_in_executor(None, crm_node, state)
                    state.update(crm_res)
                    obs_crm = await narrator.narrate_observation(user_query, "crm", state, target_entity=effective_emp_name)
                    yield {
                        "type": "activity_update",
                        "execution_id": ctx.execution_id,
                        "sequence": ctx.current_sequence,
                        "stage": "observation",
                        "step": "crm",
                        "title": obs_crm["title"],
                        "message": obs_crm["message"],
                        "detail": obs_crm["message"],
                        "evidence": obs_crm.get("evidence"),
                        "status": "completed",
                        "timestamp": time.time(),
                    }
                except Exception as e:
                    print(f"[COACH GRAPH STREAM] CRM hybrid node error: {e}")

        # Step 6: RAG Retrieval
        if intent in ["RAG", "HYBRID"]:
            yield {
                "type": "activity_update",
                "execution_id": ctx.execution_id,
                "sequence": ctx.current_sequence,
                "stage": "tool_execution",
                "step": "rag",
                "title": "Document Analysis",
                "message": f"Searching company documents and meeting archives{f' for {effective_emp_name}' if effective_emp_name else ''}...",
                "detail": f"Searching company documents and meeting archives{f' for {effective_emp_name}' if effective_emp_name else ''}...",
                "status": "running",
                "timestamp": time.time(),
            }
            t_rag = time.monotonic()
            try:
                rag_res = await loop.run_in_executor(None, rag_node, state)
                state.update(rag_res)
            except Exception as e:
                print(f"[COACH GRAPH STREAM] RAG node error: {e}")
            rag_ms = int((time.monotonic() - t_rag) * 1000)

            matched_files = state.get("matched_files") or []
            matched_files_details = state.get("matched_files_details") or []
            chunks = state.get("rag_chunks") or []

            obs_rag = await narrator.narrate_observation(
                user_query=user_query,
                step="rag",
                state=state,
                target_entity=effective_emp_name,
            )
            ev_rag = await event_mgr.emit_execution_event(
                stage=ExecutionStage.OBSERVATION,
                event_type="rag_retrieved",
                source_component="rag_tool",
                payload={"file_count": len(matched_files), "chunk_count": len(chunks)},
                duration_ms=rag_ms,
            )
            await event_mgr.record_narration(
                title=obs_rag["title"],
                message=obs_rag["message"],
                stage=ExecutionStage.OBSERVATION,
                source_event_id=ev_rag.event_id,
                provider=obs_rag.get("provider", "gemini"),
                model=obs_rag.get("model"),
                is_fallback=obs_rag.get("is_fallback", False),
                duration_ms=obs_rag.get("duration_ms"),
            )
            yield {
                "type": "activity_update",
                "execution_id": ctx.execution_id,
                "sequence": ctx.current_sequence,
                "stage": "observation",
                "step": "rag",
                "title": obs_rag["title"],
                "message": obs_rag["message"],
                "detail": obs_rag["message"],
                "evidence": {
                    "files": matched_files_details,
                    "fileCount": len(matched_files),
                    "chunkCount": len(chunks)
                },
                "data": {
                    "files": matched_files_details,
                    "fileCount": len(matched_files),
                    "chunkCount": len(chunks)
                },
                "status": "completed",
                "duration_ms": rag_ms,
                "timestamp": time.time(),
            }

    role_level = _get_role_level(state)

    # Citations (Role-filtered public citations with allowlisted metadata and redacted excerpts)
    raw_citations = state.get("citations", [])
    public_citations = build_public_citations(raw_citations, role_level)
    if public_citations:
        yield {"type": "citations", "citations": public_citations}

    # Step 7: Synthesis (Token-by-Token Streaming)
    synth_narr = await narrator.narrate_synthesis(user_query, state)
    elapsed = round(time.time() - start_time, 1)

    yield {
        "type": "activity_update",
        "execution_id": ctx.execution_id,
        "sequence": ctx.current_sequence,
        "stage": "synthesis",
        "step": "synthesizing",
        "title": synth_narr["title"],
        "message": synth_narr["message"],
        "detail": synth_narr["message"],
        "status": "running",
        "duration": elapsed,
        "timestamp": time.time(),
    }

    synthesis_ctx = prepare_synthesis_context(state)

    # Buffer full synthesis response to ensure role-based PII firewall runs BEFORE any token reaches the client
    full_response_parts: List[str] = []
    async for token_chunk in stream_synthesis_response(synthesis_ctx, request=request):
        full_response_parts.append(token_chunk)

    raw_response = "".join(full_response_parts)
    sanitized_response = sanitize_final_response(raw_response.strip(), role_level)

    # Emit sanitized response tokens safely after role-based PII firewall runs
    for token in _tokenize_text_for_stream(sanitized_response):
        if request and await request.is_disconnected():
            break
        yield {"type": "token", "content": token}

    # Mark synthesis step completed
    yield {
        "type": "activity_update",
        "execution_id": ctx.execution_id,
        "sequence": ctx.current_sequence,
        "stage": "synthesis",
        "step": "synthesizing",
        "title": synth_narr["title"],
        "message": "Formulated grounded response with verified citations.",
        "detail": "Formulated grounded response with verified citations.",
        "status": "completed",
        "duration": elapsed,
        "timestamp": time.time(),
    }

    await event_mgr.complete(status="COMPLETED")
    yield {
        "type": "done",
        "execution_id": ctx.execution_id,
        "intent": state.get("intent", intent),
        "sql_query": None,  # Omit raw SQL statement to protect schema/sensitive literals in ordinary responses
        "sql_result": None,  # Omit raw database rows from public SSE events to prevent sensitive data exposure
        "citations": public_citations,
        "citations_count": len(public_citations),
        "response": sanitized_response
    }

