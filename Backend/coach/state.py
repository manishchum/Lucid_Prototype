# Backend/coach/state.py
"""
Typed State Definition for the Performance Coach LangGraph Workflow.
Maintains state across Router, SQL Generation, Self-Correction, RAG, and Synthesis nodes.
"""

from typing import TypedDict, List, Dict, Any, Optional
from langchain_core.messages import BaseMessage


class CoachState(TypedDict, total=False):
    # Session & User Context
    messages: List[BaseMessage]
    user_query: str
    company_id: str
    user_id: str
    target_employee_id: Optional[str]
    target_employee_name: Optional[str]
    security_ctx: Optional[Dict[str, Any]]

    # Introspection State
    schema_dict: Dict[str, Any]
    schema_prompt: str
    document_catalog: List[Dict[str, Any]]
    active_integrations: List[Dict[str, Any]]

    # Routing Decision: "SQL", "RAG", "HYBRID", "CATALOG", "GENERAL", "SAFETY", "SECURITY", "SCOPE_DEFLECTION"
    intent: str
    routing_reason: str
    guardrail_triggered: Optional[bool]

    # Text-to-SQL Engine State
    sql_query: Optional[str]
    sql_explanation: Optional[str]
    sql_result: Optional[List[Dict[str, Any]]]
    sql_row_count: int
    sql_error: Optional[str]
    sql_retry_count: int

    # Vector RAG State
    rag_chunks: List[Dict[str, Any]]

    # Final Output & Grounding
    citations: List[Dict[str, Any]]
    final_response: str
