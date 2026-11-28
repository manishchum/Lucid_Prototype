# Backend/tests/test_narrator_service.py
"""
Unit tests for the LLM Narrator Service.
Verifies:
  1. Fast-path conversational greetings bypass LLM calls with zero latency.
  2. Pluggable BaseNarratorProvider generates structured {title, message}.
  3. Automatic fallback to heuristic templates when provider raises exception or times out.
  4. Tool observations correctly format verified evidence.
"""

import os
import sys
import pytest
import asyncio
from typing import Dict, Optional

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from ai.narrator.base import BaseNarratorProvider
from ai.narrator.narrator_service import NarratorService
from coach.thought_engine import triage_query


@pytest.fixture
def anyio_backend():
    return "asyncio"


class MockFastNarrator(BaseNarratorProvider):
    @property
    def provider_name(self) -> str:
        return "mock_provider"

    @property
    def model_name(self) -> str:
        return "mock-flash"

    async def generate_narration(self, prompt: str, system_instruction: Optional[str] = None) -> Dict[str, str]:
        return {
            "title": "Mock Strategy Title",
            "message": "I am reviewing sales metrics to answer your inquiry.",
        }

    async def health_check(self) -> bool:
        return True


class MockTimingOutNarrator(BaseNarratorProvider):
    @property
    def provider_name(self) -> str:
        return "timeout_provider"

    @property
    def model_name(self) -> str:
        return "slow-model"

    async def generate_narration(self, prompt: str, system_instruction: Optional[str] = None) -> Dict[str, str]:
        await asyncio.sleep(2.0)  # Exceeds 0.2s timeout
        return {"title": "Slow", "message": "Too late"}

    async def health_check(self) -> bool:
        return True


@pytest.mark.anyio
async def test_greeting_fast_path():
    """Verify conversational queries use zero-latency deterministic fast path."""
    narrator = NarratorService(provider=MockFastNarrator())
    triage = triage_query("hello coach")
    assert triage.is_conversational is True

    res = await narrator.narrate_plan("hello coach", triage)
    assert res["is_fallback"] is False
    assert res["provider"] == "deterministic_fast_path"
    assert "hello" in res["message"].lower() or "greeting" in res["message"].lower() or "coach" in res["message"].lower()


@pytest.mark.anyio
async def test_mock_llm_narration():
    """Verify normal queries call provider and receive {title, message}."""
    narrator = NarratorService(provider=MockFastNarrator())
    triage = triage_query("What are the Q3 sales figures?")
    assert triage.is_conversational is False

    res = await narrator.narrate_plan("What are the Q3 sales figures?", triage)
    assert res["title"] == "Mock Strategy Title"
    assert "sales metrics" in res["message"]
    assert res["is_fallback"] is False
    assert res["provider"] == "mock_provider"


@pytest.mark.anyio
async def test_narrator_timeout_fallback():
    """Verify that when a model times out, the service falls back to rule-based templates gracefully."""
    # Set timeout to 0.1s so MockTimingOutNarrator triggers fallback
    narrator = NarratorService(provider=MockTimingOutNarrator(), timeout_seconds=0.1)
    triage = triage_query("What are the Q3 sales figures?")

    res = await narrator.narrate_plan("What are the Q3 sales figures?", triage)
    assert res["is_fallback"] is True
    assert res["provider"] == "heuristic_fallback"
    assert res["title"] == "Planning Execution Strategy"
    assert len(res["message"]) > 0


@pytest.mark.anyio
async def test_tool_observation_narration():
    """Verify tool observations summarize SQL query results accurately."""
    narrator = NarratorService(provider=None)  # Uses deterministic fallback directly
    state = {
        "target_employee_name": "Riya Jhamb",
        "sql_result": [{"sales": 100}, {"sales": 200}],
    }
    obs = await narrator.narrate_observation(
        user_query="How is Riya Jhamb performing?",
        step="sql",
        state=state,
        row_count=2,
    )
    assert obs["title"] == "Database Query"
    assert "2 matching records" in obs["message"]
    assert obs["evidence"]["row_count"] == 2
