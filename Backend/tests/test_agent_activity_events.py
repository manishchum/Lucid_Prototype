# Backend/tests/test_agent_activity_events.py
"""
Unit tests for the Core Agent Activity Layer.
Tests:
  1. Monotonic sequence incrementing.
  2. ExecutionEvent serialization and schema versioning.
  3. ExecutionContext and execution_span parent-child span linking.
  4. ExecutionEventManager in-memory streaming queue and completion.
"""

import os
import sys
import pytest
import asyncio

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.agent_activity.event_types import ExecutionStage, EventStatus, EventVisibility
from core.agent_activity.event_schema import ExecutionEvent, FrontendActivityUpdate
from core.agent_activity.execution_context import (
    ExecutionContext,
    execution_scope,
    execution_span,
    get_current_execution_context,
)
from core.agent_activity.event_manager import ExecutionEventManager


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_execution_context_and_spans():
    """Verify execution context tracking, monotonic sequencing, and parent span nesting."""
    async with execution_scope(
        company_id="company-123",
        user_id="user-456",
        agent_type="coach",
    ) as ctx:
        assert ctx.company_id == "company-123"
        assert ctx.current_sequence == 0
        seq1 = ctx.next_sequence()
        seq2 = ctx.next_sequence()
        assert seq1 == 1
        assert seq2 == 2

        assert ctx.get_active_span() is None

        async with execution_span("sql_generation") as span_id:
            assert ctx.get_active_span() == span_id

            async with execution_span("sql_execution") as child_span_id:
                assert ctx.get_active_span() == child_span_id
                assert child_span_id != span_id

            # Restores parent span
            assert ctx.get_active_span() == span_id

        assert ctx.get_active_span() is None


@pytest.mark.anyio
async def test_event_manager_lifecycle():
    """Verify event emission, parent-child linking, and streaming update queue."""
    async with execution_scope(company_id="company-test", user_id="user-test") as ctx:
        mgr = ExecutionEventManager(context=ctx, query="What are Q3 sales?")

        # 1. Emit understanding execution event
        ev1 = await mgr.emit_execution_event(
            stage=ExecutionStage.UNDERSTANDING,
            event_type="intent_classified",
            source_component="router",
            payload={"intent": "SQL"},
        )
        assert ev1.sequence == 1
        assert ev1.stage == ExecutionStage.UNDERSTANDING
        assert ev1.parent_event_id is None
        assert ev1.schema_version == "1.0"

        # 2. Emit frontend activity update
        up1 = await mgr.emit_activity_update(
            stage=ExecutionStage.UNDERSTANDING,
            title="Interpreting Query",
            message="I'm checking sales performance figures.",
            status="running",
        )
        assert up1.sequence == 1
        assert up1.title == "Interpreting Query"
        assert up1.status == "running"

        # 3. Test nested span execution event
        async with execution_span("database_lookup") as span_id:
            ev2 = await mgr.emit_execution_event(
                stage=ExecutionStage.TOOL_EXECUTION,
                event_type="sql_executed",
                source_component="sql_executor",
                payload={"rows": 5},
            )
            assert ev2.sequence == 2
            assert ev2.parent_event_id == span_id

        # Complete the event manager
        await mgr.complete(status="COMPLETED")

        # Read from the streaming queue
        updates = []
        async for item in mgr.stream_activity_updates():
            updates.append(item)

        assert len(updates) == 1
        assert updates[0].title == "Interpreting Query"
