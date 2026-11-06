# Backend/coach/graph.py
"""
LangGraph Assembly for the Performance Coach Intelligence Layer.
Wires together Introspection, Routing, SQL Generation, Self-Healing Execution,
Vector RAG, and Grounded Synthesis into an executable StateGraph.
"""

from typing import Dict, Any, Literal
from coach.state import CoachState
from coach.nodes import (
    introspect_node,
    router_node,
    sql_generator_node,
    sql_executor_node,
    sql_fixer_node,
    rag_node,
    synthesizer_node
)
from coach.guardrails import check_input_guardrails

try:
    from langgraph.graph import StateGraph, START, END
    LANGGRAPH_AVAILABLE = True
except ImportError:
    StateGraph, START, END = None, None, None
    LANGGRAPH_AVAILABLE = False


# ============================================================================
# CONDITIONAL ROUTING FUNCTIONS
# ============================================================================
def route_from_router(state: CoachState) -> Literal["sql_generator", "rag", "synthesizer"]:
    """Routes based on classified intent."""
    if state.get("guardrail_triggered"):
        return "synthesizer"
    intent = state.get("intent", "GENERAL")
    if intent in ["SAFETY", "SECURITY", "SCOPE_DEFLECTION", "OUT_OF_SCOPE"]:
        return "synthesizer"
    if intent in ["SQL", "HYBRID"]:
        return "sql_generator"
    elif intent == "RAG":
        return "rag"
    else:  # "CATALOG", "GENERAL", "OUT_OF_SCOPE"
        return "synthesizer"


def route_from_sql_executor(state: CoachState) -> Literal["sql_fixer", "rag", "synthesizer"]:
    """
    Self-healing retry edge: If SQL execution failed and retry_count < 2,
    routes to sql_fixer to correct the query. Otherwise proceeds to RAG (if HYBRID) or synthesizer.
    """
    sql_error = state.get("sql_error")
    retry_count = state.get("sql_retry_count", 0)
    intent = state.get("intent", "")

    # Self-healing retry check (up to 2 retry attempts)
    if sql_error and retry_count < 2:
        return "sql_fixer"

    # If Hybrid query, execute RAG next to collect qualitative excerpts
    if intent == "HYBRID":
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
            "rag": "rag",
            "synthesizer": "synthesizer"
        }
    )

    # 5. RAG to Synthesizer to END
    workflow.add_edge("rag", "synthesizer")
    workflow.add_edge("synthesizer", END)

    return workflow.compile()


# Initialize compiled graph instance
compiled_coach_graph = build_coach_graph()


# ============================================================================
# STANDALONE EXECUTION RUNNER (Fallback & Synchronous invocation)
# ============================================================================
def execute_coach_agent(
    user_query: str,
    company_id: str,
    user_id: str = "",
    target_employee_id: str = None,
    target_employee_name: str = None
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

    initial_state: CoachState = {
        "user_query": user_query,
        "company_id": company_id,
        "user_id": user_id,
        "target_employee_id": target_employee_id,
        "target_employee_name": target_employee_name,
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

    if intent in ["SQL", "HYBRID"]:
        state.update(sql_generator_node(state))
        state.update(sql_executor_node(state))

        # Check self-healing
        if state.get("sql_error") and state.get("sql_retry_count", 0) < 2:
            state.update(sql_fixer_node(state))
            state.update(sql_executor_node(state))

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
