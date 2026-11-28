# Backend/core/agent_activity/event_storage.py
"""
Storage Adapter for Agent Execution and Transparency Events.
Persists records to Supabase PostgreSQL with graceful degradation if database tables are unreachable.
"""

import asyncio
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from utils.supabase_client import supabase_admin
from .event_schema import ExecutionEvent, NarrationEvent


async def record_execution_start(
    execution_id: str,
    company_id: str,
    user_id: Optional[str],
    query: str,
    conversation_id: Optional[str] = None,
    agent_type: str = "coach",
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    """Creates a new agent_executions row."""
    try:
        loop = asyncio.get_event_loop()
        payload = {
            "id": execution_id,
            "company_id": str(company_id),
            "user_id": str(user_id) if user_id else None,
            "conversation_id": str(conversation_id) if conversation_id else None,
            "agent_type": agent_type,
            "query": query,
            "status": "RUNNING",
            "metadata": metadata or {},
            "started_at": datetime.now(timezone.utc).isoformat(),
        }
        await loop.run_in_executor(
            None,
            lambda: supabase_admin.table("agent_executions").insert(payload).execute()
        )
    except Exception as e:
        # Non-blocking operational warning
        print(f"[AGENT ACTIVITY STORAGE] Note: Could not record execution start: {e}")


async def record_execution_finish(
    execution_id: str,
    status: str = "COMPLETED",
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    """Updates status and completed_at on agent_executions row."""
    try:
        loop = asyncio.get_event_loop()
        update_data: Dict[str, Any] = {
            "status": status,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }
        if metadata:
            update_data["metadata"] = metadata

        await loop.run_in_executor(
            None,
            lambda: supabase_admin.table("agent_executions")
            .update(update_data)
            .eq("id", execution_id)
            .execute()
        )
    except Exception as e:
        print(f"[AGENT ACTIVITY STORAGE] Note: Could not update execution finish: {e}")


async def record_execution_event(event: ExecutionEvent) -> None:
    """Inserts a structured execution event."""
    try:
        loop = asyncio.get_event_loop()
        row = {
            "id": event.event_id,
            "execution_id": event.execution_id,
            "parent_event_id": event.parent_event_id,
            "sequence": event.sequence,
            "schema_version": event.schema_version,
            "stage": event.stage.value if hasattr(event.stage, "value") else str(event.stage),
            "event_type": event.event_type,
            "status": event.status.value if hasattr(event.status, "value") else str(event.status),
            "visibility": event.visibility.value if hasattr(event.visibility, "value") else str(event.visibility),
            "source_component": event.source_component,
            "payload": event.payload,
            "duration_ms": event.duration_ms,
            "created_at": event.timestamp,
        }
        await loop.run_in_executor(
            None,
            lambda: supabase_admin.table("agent_execution_events").insert(row).execute()
        )
    except Exception as e:
        print(f"[AGENT ACTIVITY STORAGE] Note: Could not save execution event: {e}")


async def record_narration_event(event: NarrationEvent) -> None:
    """Inserts an LLM/fallback narration event."""
    try:
        loop = asyncio.get_event_loop()
        row = {
            "id": event.id,
            "execution_id": event.execution_id,
            "source_event_id": event.source_event_id,
            "title": event.title,
            "message": event.message,
            "stage": event.stage.value if hasattr(event.stage, "value") else str(event.stage),
            "status": event.status.value if hasattr(event.status, "value") else str(event.status),
            "provider": event.provider,
            "model": event.model,
            "is_fallback": event.is_fallback,
            "duration_ms": event.duration_ms,
            "created_at": event.created_at,
        }
        await loop.run_in_executor(
            None,
            lambda: supabase_admin.table("agent_narration_events").insert(row).execute()
        )
    except Exception as e:
        print(f"[AGENT ACTIVITY STORAGE] Note: Could not save narration event: {e}")


async def get_execution_history(execution_id: str) -> List[Dict[str, Any]]:
    """Retrieves all execution events for a given execution_id ordered by sequence."""
    try:
        loop = asyncio.get_event_loop()
        res = await loop.run_in_executor(
            None,
            lambda: supabase_admin.table("agent_execution_events")
            .select("*")
            .eq("execution_id", execution_id)
            .order("sequence", desc=False)
            .execute()
        )
        return getattr(res, "data", None) or []
    except Exception as e:
        print(f"[AGENT ACTIVITY STORAGE] Note: Error fetching execution history: {e}")
        return []
