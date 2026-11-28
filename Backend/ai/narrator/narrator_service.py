# Backend/ai/narrator/narrator_service.py
"""
LLM Narrator Service with Asynchronous Concurrency and Instant Heuristic Fallback.
Provides unified narration interface across providers with strict timeout guards.
"""

import time
import asyncio
from typing import Dict, Any, Optional, List
from .base import BaseNarratorProvider
from .gemini_narrator import GeminiNarratorProvider
from .openai_narrator import OpenAINarratorProvider
from .narrator_prompts import (
    NARRATOR_SYSTEM_INSTRUCTION,
    build_planning_prompt,
    build_observation_prompt,
    build_synthesis_prompt,
)
from coach.thought_engine import (
    is_conversational_greeting,
    is_capabilities_inquiry,
    triage_query,
    build_tool_observation,
    build_synthesis_strategy,
    CognitiveThought,
)


class NarratorService:
    def __init__(self, provider: Optional[BaseNarratorProvider] = None, timeout_seconds: float = 1.5):
        self.timeout_seconds = timeout_seconds
        self._provider = provider
        if not self._provider:
            # Auto-select provider: Gemini preferred for sub-second latency, fallback to OpenAI
            try:
                g_provider = GeminiNarratorProvider()
                if g_provider._client:
                    self._provider = g_provider
            except Exception:
                pass

            if not self._provider:
                try:
                    o_provider = OpenAINarratorProvider()
                    if o_provider._client:
                        self._provider = o_provider
                except Exception:
                    pass

    @property
    def provider(self) -> Optional[BaseNarratorProvider]:
        return self._provider

    async def narrate_plan(
        self,
        user_query: str,
        triage: CognitiveThought,
        target_entity: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Narrates understanding and planned actions.
        Fast-paths greetings and small-talk with 0 latency.
        """
        t0 = time.monotonic()
        # 1. Fast-Path: Greeting / Capabilities / Small-talk (< 5ms, 0 tokens)
        if triage.is_conversational:
            return {
                "title": "Welcome" if not any(w in user_query.lower() for w in ["who are you", "what can you do"]) else "Overview",
                "message": triage.understanding,
                "is_fallback": False,
                "provider": "deterministic_fast_path",
                "model": "fast_path",
                "duration_ms": int((time.monotonic() - t0) * 1000),
            }

        # 2. Dynamic LLM Narration with strict timeout
        if self._provider:
            try:
                prompt = build_planning_prompt(
                    user_query=user_query,
                    intent=triage.intent,
                    target_entity=target_entity or triage.target_entity,
                    planned_actions=triage.planned_actions,
                )
                res = await asyncio.wait_for(
                    self._provider.generate_narration(prompt, system_instruction=NARRATOR_SYSTEM_INSTRUCTION),
                    timeout=self.timeout_seconds
                )
                return {
                    "title": res.get("title", "Planning Execution Strategy"),
                    "message": res.get("message", triage.understanding),
                    "is_fallback": False,
                    "provider": self._provider.provider_name,
                    "model": self._provider.model_name,
                    "duration_ms": int((time.monotonic() - t0) * 1000),
                }
            except Exception as e:
                print(f"[NARRATOR SERVICE] LLM planning narration failed or timed out: {e}. Using deterministic fallback.")

        # 3. Deterministic Fallback
        return {
            "title": "Planning Execution Strategy",
            "message": triage.understanding,
            "is_fallback": True,
            "provider": "heuristic_fallback",
            "model": "rule_based",
            "duration_ms": int((time.monotonic() - t0) * 1000),
        }

    async def narrate_observation(
        self,
        user_query: str,
        step: str,
        state: Dict[str, Any],
        row_count: Optional[int] = None,
        target_entity: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Narrates verified tool observation (SQL rows, RAG chunks, CRM deals).
        """
        t0 = time.monotonic()
        fallback_observation = build_tool_observation(step, state, row_count=row_count)
        tool_name = "Database Query (SQL)" if step == "sql" else ("Knowledge Base (RAG)" if step == "rag" else "CRM Pipeline")

        evidence = {}
        if step == "sql":
            evidence = {"row_count": row_count if row_count is not None else len(state.get("sql_result") or [])}
        elif step == "rag":
            evidence = {
                "file_count": len(state.get("matched_files") or []),
                "chunk_count": len(state.get("rag_chunks") or []),
            }
        elif step == "crm":
            deals = state.get("crm_data", {}).get("deals", [])
            evidence = {"deal_count": len(deals)}

        # Try LLM narrator
        if self._provider:
            try:
                prompt = build_observation_prompt(
                    user_query=user_query,
                    stage=step,
                    tool_name=tool_name,
                    result_summary=fallback_observation,
                    evidence=evidence,
                    target_entity=target_entity or state.get("target_employee_name"),
                )
                res = await asyncio.wait_for(
                    self._provider.generate_narration(prompt, system_instruction=NARRATOR_SYSTEM_INSTRUCTION),
                    timeout=self.timeout_seconds
                )
                return {
                    "title": res.get("title", f"{tool_name} Completed"),
                    "message": res.get("message", fallback_observation),
                    "evidence": evidence,
                    "is_fallback": False,
                    "provider": self._provider.provider_name,
                    "model": self._provider.model_name,
                    "duration_ms": int((time.monotonic() - t0) * 1000),
                }
            except Exception as e:
                print(f"[NARRATOR SERVICE] LLM observation narration failed or timed out: {e}. Using fallback.")

        title_map = {
            "sql": "Database Query",
            "rag": "Document Analysis",
            "crm": "CRM Pipeline",
        }
        return {
            "title": title_map.get(step, "Tool Execution"),
            "message": fallback_observation,
            "evidence": evidence,
            "is_fallback": True,
            "provider": "heuristic_fallback",
            "model": "rule_based",
            "duration_ms": int((time.monotonic() - t0) * 1000),
        }

    async def narrate_synthesis(
        self,
        user_query: str,
        state: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Narrates final response synthesis step.
        """
        t0 = time.monotonic()
        strategy = build_synthesis_strategy(state)
        return {
            "title": "Synthesizing Guidance",
            "message": strategy,
            "is_fallback": False,
            "provider": "deterministic",
            "model": "strategy",
            "duration_ms": int((time.monotonic() - t0) * 1000),
        }


# Global singleton instance
_GLOBAL_NARRATOR: Optional[NarratorService] = None


def get_narrator_service() -> NarratorService:
    global _GLOBAL_NARRATOR
    if _GLOBAL_NARRATOR is None:
        _GLOBAL_NARRATOR = NarratorService()
    return _GLOBAL_NARRATOR
