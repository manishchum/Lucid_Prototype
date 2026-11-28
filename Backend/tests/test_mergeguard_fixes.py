# Backend/tests/test_mergeguard_fixes.py
"""
Comprehensive production-grade simulation and verification tests for MergeGuards review items:
1. PII firewall applied before streaming tokens over SSE (Issue 5)
2. Terminal SSE event omits raw SQL result rows (Issue 6)
3. Explicit sheet scope preserved, no multi-sheet fallback (Issue 7)
4. Logging contains no raw prompts, schema text, SQL literals, or result rows (Issue 8)
5. HubSpot engagements tool resolution, dispatch, and clarification (Issue 9)
6. Immediate message persistence with local title without synchronous provider delays (Issue 10)
"""

import io
import sys
import json
import time
import pytest
import asyncio
from unittest.mock import patch, MagicMock, AsyncMock

from coach.graph import stream_coach_agent, execute_coach_agent, _tokenize_text_for_stream
from coach.nodes import sql_generator_node, sql_executor_node, crm_node
from coach.conversation_manager import (
    generate_local_title,
    generate_intelligent_title,
    _generate_llm_title_with_deadline,
    append_messages_to_conversation
)
from security.rebac import UserSecurityContext


COMPANY_ID = "1e7cc6c4-f706-4e77-ad41-8e7c4a1b0744"
USER_ID = "c8c594cf-7028-44a3-a277-b0aa542e1a40"


# ============================================================================
# ISSUE 5 & 6 TESTS: PII FIREWALL BEFORE STREAMING & OMISSION OF RAW SQL ROWS
# ============================================================================
def test_pii_firewall_applied_before_emitting_tokens():
    """Verifies that synthesis tokens are buffered and sanitized BEFORE emitting token SSE events."""
    async def _run():
        raw_sensitive_output = "Employee Alice has SSN 123-45-6789 and salary $150,000."
        sanitized_output = "Employee Alice has SSN [REDACTED] and salary [CONFIDENTIAL]."

        async def mock_stream_synthesis(*args, **kwargs):
            # Yield raw chunks containing sensitive data
            yield "Employee Alice "
            yield "has SSN 123-45-6789 "
            yield "and salary $150,000."

        with patch("coach.graph.stream_synthesis_response", side_effect=mock_stream_synthesis), \
             patch("coach.graph.sanitize_final_response", return_value=sanitized_output) as mock_sanitize, \
             patch("coach.graph.check_input_guardrails", return_value=None), \
             patch("coach.graph.introspect_node", return_value={"catalog": [], "schemas": []}), \
             patch("coach.graph.router_node", return_value={"intent": "GENERAL", "routing_reason": "test"}), \
             patch("coach.thought_engine.triage_query") as mock_triage:

            triage_mock = MagicMock()
            triage_mock.is_conversational = True
            triage_mock.intent = "GENERAL"
            triage_mock.understanding = "General conversational query"
            triage_mock.planned_actions = ["Direct conversational reply"]
            triage_mock.synthesis_strategy = "Be helpful"
            mock_triage.return_value = triage_mock

            sec_dict = {
                "has_context": True,
                "role_level": 1,
                "user_id": USER_ID,
                "company_id": COMPANY_ID,
                "is_admin": False,
            }

            events = []
            async for event in stream_coach_agent(
                user_query="Hello coach",
                company_id=COMPANY_ID,
                user_id=USER_ID,
                security_ctx=sec_dict
            ):
                events.append(event)

            # Check all emitted token chunks
            emitted_tokens = [e["content"] for e in events if e.get("type") == "token"]
            full_emitted_text = "".join(emitted_tokens)

            # 1. No raw sensitive PII must EVER appear in any token chunk!
            assert "123-45-6789" not in full_emitted_text
            assert "$150,000" not in full_emitted_text

            # 2. Emitted tokens must match the sanitized text
            assert "[REDACTED]" in full_emitted_text
            assert "[CONFIDENTIAL]" in full_emitted_text
            mock_sanitize.assert_called_once()

            # 3. Terminal done event must contain sanitized response and sql_result=None
            done_event = next(e for e in events if e.get("type") == "done")
            assert done_event["response"] == sanitized_output
            assert done_event["sql_result"] is None

    asyncio.run(_run())


def test_terminal_event_omits_raw_sql_rows_in_multi_step():
    """Verifies that terminal done event in multi-step agent omits raw SQL result rows (Issue 6)."""
    async def _run():
        raw_rows = [{"employee": "Bob", "salary": 200000, "ssn": "987-65-4321"}]

        async def mock_stream_synthesis(*args, **kwargs):
            yield "Bob's performance summary."

        with patch("coach.graph.stream_synthesis_response", side_effect=mock_stream_synthesis), \
             patch("coach.graph.sanitize_final_response", return_value="Bob's performance summary."), \
             patch("coach.graph.check_input_guardrails", return_value=None), \
             patch("coach.graph.introspect_node", return_value={"catalog": [], "schemas": []}), \
             patch("coach.graph.router_node", return_value={"intent": "SQL", "routing_reason": "SQL query"}), \
             patch("coach.graph.sql_generator_node", return_value={"sql_query": "SELECT * FROM sales"}), \
             patch("coach.graph.sql_executor_node", return_value={"sql_query": "SELECT * FROM sales", "sql_result": raw_rows, "sql_row_count": 1, "sql_error": None}), \
             patch("coach.thought_engine.triage_query") as mock_triage:

            triage_mock = MagicMock()
            triage_mock.is_conversational = False
            triage_mock.intent = "SQL"
            triage_mock.understanding = "SQL analysis"
            triage_mock.planned_actions = ["Execute SQL query"]
            triage_mock.synthesis_strategy = "Synthesize metrics"
            mock_triage.return_value = triage_mock

            sec_dict = {
                "has_context": True,
                "role_level": 1,
                "user_id": USER_ID,
                "company_id": COMPANY_ID,
                "is_admin": False,
            }

            events = []
            async for event in stream_coach_agent(
                user_query="Show Bob's compensation",
                company_id=COMPANY_ID,
                user_id=USER_ID,
                security_ctx=sec_dict
            ):
                events.append(event)

            done_event = next(e for e in events if e.get("type") == "done")
            # Ensure sql_result is explicitly None in public SSE events
            assert done_event["sql_result"] is None
            assert done_event["sql_query"] == "SELECT * FROM sales"

    asyncio.run(_run())


# ============================================================================
# ISSUE 7 TESTS: PRESERVE EXPLICIT SHEET SCOPE
# ============================================================================
def test_explicit_sheet_scope_preserved_on_empty_result():
    """Empty result for a specific sheet must NOT retry without sheet filter (Issue 7)."""
    state = {
        "company_id": COMPANY_ID,
        "sql_query": "SELECT * FROM coach_spreadsheet_rows WHERE company_id = '1e7cc6c4' AND sheet_name = 'Q3 Sales'",
        "security_ctx": {"has_context": True, "role_level": 1, "user_id": USER_ID},
    }

    # Mock execute_coach_sql returning 0 rows
    empty_exec_res = {"success": True, "rows": [], "row_count": 0, "error": None}
    with patch("coach.nodes.execute_coach_sql", return_value=empty_exec_res) as mock_exec:
        result = sql_executor_node(state)

        # execute_coach_sql should be called ONCE with the scoped query, NEVER retried with broader query!
        assert mock_exec.call_count == 1
        assert "sheet_name = 'Q3 Sales'" in mock_exec.call_args[1]["sql_query"]
        assert result["sql_result"] == []
        assert result["sql_row_count"] == 0


def test_generator_preserves_sheet_predicates_and_normalizes_casing():
    """Generator must not drop sheet predicates when name check fails; it normalizes casing if matched (Issue 7)."""
    schema_prompt = "VALID SHEET NAMES IN DATABASE: ['Q3 Sales', 'Employee Roster']"

    # Case 1: Case difference is normalized
    state = {
        "user_query": "Show q3 sales",
        "company_id": COMPANY_ID,
        "schema_prompt": schema_prompt,
        "target_employee_name": None
    }
    with patch("coach.nodes.generate_coach_sql", return_value={"sql_query": "SELECT * FROM coach_spreadsheet_rows WHERE sheet_name = 'q3 sales'", "explanation": "test"}):
        res = sql_generator_node(state)
        # Should normalize 'q3 sales' to 'Q3 Sales'
        assert "sheet_name = 'Q3 Sales'" in res["sql_query"]

    # Case 2: Unmatched sheet name is NOT stripped into an unbounded multi-sheet query
    with patch("coach.nodes.generate_coach_sql", return_value={"sql_query": "SELECT * FROM coach_spreadsheet_rows WHERE company_id = '123' AND sheet_name = 'NonexistentSheet'", "explanation": "test"}):
        res2 = sql_generator_node(state)
        # Predicate must be preserved
        assert "sheet_name = 'NonexistentSheet'" in res2["sql_query"]


# ============================================================================
# ISSUE 8 TESTS: NO RAW ROWS, PROMPTS, OR SQL LITERALS IN LOGS
# ============================================================================
def test_sql_nodes_do_not_log_raw_queries_prompts_or_rows():
    """Execution and generation nodes must not log prompts, schemas, queries, or rows (Issue 8)."""
    secret_ssn = "SECRET-SSN-456"
    secret_prompt = "CONFIDENTIAL_USER_PROMPT_ABC"
    secret_schema = "INTERNAL_CONFIDENTIAL_SCHEMA_XYZ"
    secret_sql = "SELECT salary FROM employees WHERE ssn = 'SECRET-SSN-456'"

    state = {
        "user_query": secret_prompt,
        "company_id": COMPANY_ID,
        "schema_prompt": secret_schema,
        "sql_query": secret_sql,
        "target_employee_name": None,
        "security_ctx": {"has_context": True, "role_level": 1, "user_id": USER_ID}
    }

    # Intercept stdout
    captured_output = io.StringIO()
    with patch("sys.stdout", captured_output), \
         patch("coach.nodes.generate_coach_sql", return_value={"sql_query": secret_sql, "explanation": "test"}), \
         patch("coach.nodes.execute_coach_sql", return_value={"success": True, "rows": [{"ssn": secret_ssn}], "row_count": 1, "error": None}):

        sql_generator_node(state)
        sql_executor_node(state)

    log_output = captured_output.getvalue()

    # None of the sensitive text may be in stdout
    assert secret_ssn not in log_output
    assert secret_prompt not in log_output
    assert secret_schema not in log_output
    assert secret_sql not in log_output


# ============================================================================
# ISSUE 9 TESTS: HUBSPOT ENGAGEMENTS TOOL DISPATCH AND RESOLUTION
# ============================================================================
def test_crm_node_dispatches_engagements_tool_with_resolved_id():
    """CRM node resolves record ID and dispatches to hubspot_list_engagements (Issue 9)."""
    state = {
        "company_id": COMPANY_ID,
        "user_query": "Show meeting notes for deal 78912345",
        "security_ctx": {"has_context": True, "role_level": 1, "user_id": USER_ID}
    }

    with patch("coach.tools.hubspot_mcp.hubspot_list_engagements", return_value={"engagements": [{"body": "Discussed terms"}], "count": 1}) as mock_eng:
        res = crm_node(state)

        assert mock_eng.call_count == 1
        call_kwargs = mock_eng.call_args[1]
        assert call_kwargs["object_id"] == "78912345"
        assert call_kwargs["object_type"] == "deals"
        assert "crm_data" in res
        assert res["crm_data"]["count"] == 1


def test_crm_node_asks_clarification_when_engagement_record_unresolved():
    """When notes/activity requested without record or unresolvable, ask for clarification (Issue 9)."""
    state = {
        "company_id": COMPANY_ID,
        "user_query": "show me notes and activity log",
        "security_ctx": {"has_context": True, "role_level": 1, "user_id": USER_ID}
    }

    with patch("coach.tools.hubspot_mcp.hubspot_search_deals") as mock_deals:
        res = crm_node(state)

        # Must NOT fall through to hubspot_search_deals!
        mock_deals.assert_not_called()
        assert res["crm_data"].get("needs_clarification") is True
        assert "specify" in res["crm_data"].get("message", "").lower()


# ============================================================================
# ISSUE 10 TESTS: IMMEDIATE MESSAGE PERSISTENCE WITHOUT SYNC MODEL DELAYS
# ============================================================================
def test_append_messages_persists_immediately_with_local_title():
    """First message persistence uses local title immediately without waiting on LLMs (Issue 10)."""
    mock_supabase_table = MagicMock()
    mock_query = MagicMock()
    mock_query.eq.return_value = mock_query
    mock_query.execute.return_value = MagicMock(data=[{"id": "conv-1", "title": "Show Q3 Sales Targets"}])
    mock_supabase_table.update.return_value = mock_query

    mock_get = MagicMock(return_value={"id": "conv-1", "title": "New Chat", "messages": []})

    with patch("coach.conversation_manager.supabase_admin.table", return_value=mock_supabase_table), \
         patch("coach.conversation_manager.get_conversation", mock_get), \
         patch("coach.conversation_manager._async_refine_title_in_background") as mock_bg:

        t0 = time.time()
        result = append_messages_to_conversation(
            conversation_id="conv-1",
            user_id=USER_ID,
            company_id=COMPANY_ID,
            new_messages=[{"role": "user", "content": "Can you show me the Q3 sales targets?"}],
            auto_title_from_query="Can you show me the Q3 sales targets?"
        )
        elapsed = time.time() - t0

        # Must complete instantaneously (<0.1s), zero LLM wait
        assert elapsed < 0.1
        # Title updated in payload to local title
        update_call = mock_supabase_table.update.call_args[0][0]
        assert update_call["title"] == "Show Me The Q3 Sales"
        # Background worker was launched for async refinement
        mock_bg.assert_called_once()


def test_llm_title_total_deadline_enforced():
    """Total timeout across retries and fallback must be strictly enforced (Issue 10)."""
    t0 = time.time()
    # Without API keys or with slow provider, must return None within timeout
    res = _generate_llm_title_with_deadline("Some prompt", total_timeout=0.3)
    elapsed = time.time() - t0
    assert elapsed < 0.5
