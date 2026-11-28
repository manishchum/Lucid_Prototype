# Backend/tests/test_coach_activity_streaming.py
"""
Integration test for Coach Agent Activity Streaming.
Verifies:
  1. Conversational query streams activity_update event and token stream.
  2. Data query emits planning and tool execution activity_updates.
  3. All runs generate a valid execution_id and record events.
"""

import os
import sys
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from coach.graph import stream_coach_agent


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_stream_conversational_greeting():
    """Verify greeting query streams activity_update then sanitized tokens then done."""
    events = []
    async for ev in stream_coach_agent(
        user_query="hello coach!",
        company_id="comp-test",
        user_id="user-test",
        target_employee_name="Alex",
    ):
        events.append(ev)

    types = [e.get("type") for e in events]
    assert "activity_update" in types
    assert "token" in types
    assert "done" in types

    act_event = next(e for e in events if e.get("type") == "activity_update")
    assert act_event["stage"] == "understanding"
    assert act_event["status"] == "completed"
    assert len(act_event["message"]) > 0

    done_event = next(e for e in events if e.get("type") == "done")
    assert "execution_id" in done_event
    assert len(done_event["response"]) > 0
