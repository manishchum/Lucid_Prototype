# Backend/tests/test_thought_engine.py
"""
Unit tests for the Cognitive Reasoning & Thought Engine.
Verifies:
  1. Conversational greetings ("hi", "hello") trigger instant triage with humane understanding and no DB queries.
  2. Gratitude queries ("thanks") trigger courteous conversational reflections.
  3. Capabilities inquiries ("who are you") outline coach features.
  4. Quantitative queries ("What are my Q3 sales?") generate SQL action plans.
  5. Hybrid employee performance queries extract target entity and dual-track action plans.
  6. Tool observations produce natural, readable reflections.
"""

import os
import sys
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from coach.thought_engine import (
    is_conversational_greeting,
    is_capabilities_inquiry,
    triage_query,
    build_tool_observation,
    build_synthesis_strategy,
    CognitiveThought
)


def test_greeting_triage():
    """Verify that a simple 'hi' query produces humane, natural reasoning without database references."""
    for greeting in ["hi", "hi coach", "hello", "Hey there!", "good morning", "howdy"]:
        assert is_conversational_greeting(greeting) is True

    thought = triage_query("hi")
    assert isinstance(thought, CognitiveThought)
    assert thought.is_conversational is True
    assert thought.intent == "GENERAL"
    assert "database tables" not in thought.understanding.lower()
    assert "document archives" not in thought.understanding.lower()
    assert "hello" in thought.understanding.lower() or "greeting" in thought.understanding.lower()
    assert len(thought.planned_actions) >= 2
    assert any("welcome" in a.lower() or "greeting" in a.lower() for a in thought.planned_actions)
    assert thought.duration <= 0.5


def test_gratitude_triage():
    """Verify that gratitude expressions are recognized as conversational."""
    thought = triage_query("thank you so much!")
    assert thought.is_conversational is True
    assert thought.intent == "GENERAL"
    assert "gratitude" in thought.understanding.lower() or "appreciation" in thought.understanding.lower()


def test_capabilities_triage():
    """Verify self-introduction queries produce structured capability action plans."""
    thought = triage_query("Who are you and what can you do?")
    assert thought.is_conversational is True
    assert any("text-to-sql" in a.lower() or "capabilities" in a.lower() for a in thought.planned_actions)


def test_quantitative_sql_planning():
    """Verify quantitative questions generate explicit Text-to-SQL execution plans."""
    thought = triage_query("What are my Q3 sales numbers and quota attainment?")
    assert thought.is_conversational is False
    assert thought.intent == "SQL"
    assert any("sql" in a.lower() for a in thought.planned_actions)
    assert any("schema" in a.lower() for a in thought.planned_actions)


def test_hybrid_performance_review_planning():
    """Verify holistic employee coaching queries extract target entity and generate dual-source plans."""
    thought = triage_query("How is Riya Jhamb performing overall?")
    assert thought.is_conversational is False
    assert thought.intent == "HYBRID"
    assert thought.target_entity == "Riya Jhamb"
    assert any("sql" in a.lower() for a in thought.planned_actions)
    assert any("document" in a.lower() or "rag" in a.lower() for a in thought.planned_actions)


def test_tool_observations():
    """Verify tool observations generate natural language reflections."""
    state_sql = {"target_employee_name": "Riya Jhamb", "sql_result": [{"sales": 100}, {"sales": 200}]}
    obs_sql = build_tool_observation("sql", state_sql, row_count=2)
    assert "2 matching records" in obs_sql
    assert "Riya Jhamb" in obs_sql

    state_rag = {
        "target_employee_name": "Riya Jhamb",
        "matched_files": ["Q3_Review.pdf"],
        "rag_chunks": [{"text": "Great pacing"}]
    }
    obs_rag = build_tool_observation("rag", state_rag)
    assert "Q3_Review.pdf" in obs_rag
    assert "1 relevant passage" in obs_rag


def test_stream_thought_tokens():
    """Verify reasoning monologue formatting and token-by-token asynchronous streaming."""
    import asyncio
    from coach.thought_engine import format_thought_monologue, stream_thought_tokens

    async def _run():
        thought = triage_query("hi")
        monologue = format_thought_monologue(thought)
        assert "Planned Actions" in monologue

        tokens = []
        async for event in stream_thought_tokens(monologue, delay=0):
            assert event["type"] == "thought_token"
            tokens.append(event["content"])

        reconstructed = "".join(tokens)
        assert reconstructed == monologue

    asyncio.run(_run())

