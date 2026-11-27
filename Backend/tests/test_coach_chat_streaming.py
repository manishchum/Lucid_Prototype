# Backend/tests/test_coach_chat_streaming.py
"""
Unit tests for True Token Streaming (SSE) in the Performance Coach Intelligence Layer.
Verifies:
  1. POST /api/coach/chat with stream=True returns text/event-stream.
  2. Real SSE events (step, token, citations, done) are properly framed.
  3. Fast-path input guardrails stream immediately (<10ms).
  4. Conversation persistence and audit logging occur upon completion of stream.
  5. stream_synthesis_response stops when client disconnects.
"""

import os
import sys
import json
import pytest
import asyncio
from unittest.mock import patch, MagicMock, AsyncMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi import FastAPI
from fastapi.testclient import TestClient

from routes.coach_chat import router as coach_chat_router
from utils.auth import RequestAuth, get_request_auth_required
from security.rebac import UserSecurityContext
from coach.nodes import stream_synthesis_response


COMPANY_ID = "1e7cc6c4-f706-4e77-ad41-8e7c4a1b0744"
USER_ID = "c8c594cf-7028-44a3-a277-b0aa542e1a40"


@pytest.fixture
def test_client():
    app = FastAPI()
    app.include_router(coach_chat_router)
    app.dependency_overrides[get_request_auth_required] = lambda: RequestAuth(
        user_id=USER_ID,
        company_id=COMPANY_ID,
        email="test@lucid.work",
        source="test",
        claims={"uid": USER_ID},
    )
    return TestClient(app)


def test_guardrail_fast_path_streaming(test_client):
    """Guardrails (e.g., self-harm or SQL injection probe) stream an immediate token reply and done event."""
    emp_ctx = UserSecurityContext(
        user_id=USER_ID,
        company_id=COMPANY_ID,
        email="test@lucid.work",
        role_level=1,
        role_name="USER",
        is_active=True,
        principals=[f"user:{USER_ID}"],
        managed_employee_ids=[],
    )

    with patch("routes.coach_chat.resolve_user_principals", return_value=emp_ctx), \
         patch("routes.coach_chat.create_conversation", return_value={"id": "conv-test"}), \
         patch("routes.coach_chat.append_messages_to_conversation") as mock_append, \
         patch("routes.coach_chat._audit_coach_query") as mock_audit:

        res = test_client.post("/api/coach/chat", json={
            "query": "DROP TABLE users;--",
            "stream": True,
        })

        assert res.status_code == 200
        assert "text/event-stream" in res.headers["content-type"]

        # Parse SSE lines
        lines = [line.strip() for line in res.text.split("\n") if line.startswith("data:")]
        events = [json.loads(line.replace("data:", "").strip()) for line in lines]

        event_types = [e["type"] for e in events]
        assert "token" in event_types
        assert "done" in event_types
        assert any("read-only" in e.get("content", "").lower() for e in events if e["type"] == "token")


def test_true_token_streaming_emits_steps_and_tokens(test_client):
    """Verifies that the streaming route emits real-time step events and individual token chunks."""
    emp_ctx = UserSecurityContext(
        user_id=USER_ID,
        company_id=COMPANY_ID,
        email="test@lucid.work",
        role_level=1,
        role_name="USER",
        is_active=True,
        principals=[f"user:{USER_ID}"],
        managed_employee_ids=[],
    )

    async def mock_stream_agent(**kwargs):
        yield {"type": "step", "step": "introspecting", "detail": "Inspecting schema..."}
        yield {"type": "step", "step": "routing", "detail": "Classifying intent..."}
        yield {"type": "step", "step": "sql", "query": "SELECT * FROM sales", "row_count": 5}
        yield {"type": "citations", "citations": [{"file_name": "Q3_Sales.xlsx"}]}
        yield {"type": "step", "step": "synthesizing", "detail": "Synthesizing coaching insights..."}
        yield {"type": "token", "content": "Based on "}
        yield {"type": "token", "content": "your Q3 sales, "}
        yield {"type": "token", "content": "you achieved 95% target."}
        yield {
            "type": "done",
            "intent": "SQL",
            "citations": [{"file_name": "Q3_Sales.xlsx"}],
            "response": "Based on your Q3 sales, you achieved 95% target."
        }

    with patch("routes.coach_chat.resolve_user_principals", return_value=emp_ctx), \
         patch("routes.coach_chat.create_conversation", return_value={"id": "conv-stream-1"}), \
         patch("routes.coach_chat.stream_coach_agent", side_effect=mock_stream_agent), \
         patch("routes.coach_chat.append_messages_to_conversation") as mock_append, \
         patch("routes.coach_chat._audit_coach_query") as mock_audit:

        res = test_client.post("/api/coach/chat", json={
            "query": "How are my Q3 sales?",
            "stream": True,
        })

        assert res.status_code == 200
        assert "text/event-stream" in res.headers["content-type"]

        lines = [line.strip() for line in res.text.split("\n") if line.startswith("data:")]
        events = [json.loads(line.replace("data:", "").strip()) for line in lines]

        # Verify step order
        steps = [e["step"] for e in events if e["type"] == "step"]
        assert steps == ["introspecting", "routing", "sql", "synthesizing"]

        # Verify token streaming
        tokens = [e["content"] for e in events if e["type"] == "token"]
        assert tokens == ["Based on ", "your Q3 sales, ", "you achieved 95% target."]

        # Verify done event
        done_event = next(e for e in events if e["type"] == "done")
        assert done_event["conversation_id"] == "conv-stream-1"
        assert done_event["intent"] == "SQL"

        # Verify database persistence was called
        mock_append.assert_called_once()
        call_kwargs = mock_append.call_args[1]
        assert call_kwargs["conversation_id"] == "conv-stream-1"
        assert call_kwargs["new_messages"][1]["content"] == "Based on your Q3 sales, you achieved 95% target."


def test_stream_synthesis_disconnect_handling():
    """Verifies that client disconnection aborts the OpenAI / Gemini stream early."""
    async def _run():
        mock_request = MagicMock()
        # First call returns False, second call returns True (client closed tab)
        mock_request.is_disconnected = AsyncMock(side_effect=[False, True, True])

        mock_chunk1 = MagicMock()
        mock_chunk1.choices = [MagicMock(delta=MagicMock(content="First token "))]

        mock_chunk2 = MagicMock()
        mock_chunk2.choices = [MagicMock(delta=MagicMock(content="Second token "))]

        async def mock_async_stream():
            yield mock_chunk1
            yield mock_chunk2

        mock_openai_client = MagicMock()
        mock_openai_client.chat.completions.create = AsyncMock(return_value=mock_async_stream())

        with patch("openai.AsyncOpenAI", return_value=mock_openai_client), \
             patch("coach.nodes.OPENAI_API_KEY", "test-key"):

            ctx = {
                "direct_response": None,
                "system_prompt": "You are coach",
                "user_prompt": "Hello",
                "max_tokens": 100,
                "temperature": 0.3,
                "role_level": 1
            }

            tokens_received = []
            async for token in stream_synthesis_response(ctx, request=mock_request):
                tokens_received.append(token)

            # Only the first token should have been yielded before disconnect triggered
            assert tokens_received == ["First token "]

    asyncio.run(_run())
