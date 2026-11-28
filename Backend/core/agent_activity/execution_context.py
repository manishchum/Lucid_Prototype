# Backend/core/agent_activity/execution_context.py
"""
Execution Context Management and Span Tracing for Agent Activity.
Uses contextvars to maintain execution state across asynchronous coroutines.
"""

import time
import uuid
from contextvars import ContextVar
from contextlib import asynccontextmanager
from typing import Optional, Dict, Any

_CURRENT_EXECUTION_CONTEXT: ContextVar[Optional["ExecutionContext"]] = ContextVar(
    "_CURRENT_EXECUTION_CONTEXT", default=None
)


class ExecutionContext:
    def __init__(
        self,
        company_id: str,
        user_id: Optional[str] = None,
        execution_id: Optional[str] = None,
        conversation_id: Optional[str] = None,
        agent_type: str = "coach",
        metadata: Optional[Dict[str, Any]] = None,
    ):
        self.execution_id = execution_id or str(uuid.uuid4())
        self.company_id = company_id
        self.user_id = user_id
        self.conversation_id = conversation_id
        self.agent_type = agent_type
        self.metadata = metadata or {}
        self.start_time = time.monotonic()
        self._sequence = 0
        self._active_span_id: Optional[str] = None

    def next_sequence(self) -> int:
        self._sequence += 1
        return self._sequence

    @property
    def current_sequence(self) -> int:
        return self._sequence

    def get_active_span(self) -> Optional[str]:
        return self._active_span_id

    def set_active_span(self, span_id: Optional[str]):
        self._active_span_id = span_id

    def elapsed_ms(self) -> int:
        return int((time.monotonic() - self.start_time) * 1000)


def get_current_execution_context() -> Optional[ExecutionContext]:
    return _CURRENT_EXECUTION_CONTEXT.get()


def set_current_execution_context(ctx: Optional[ExecutionContext]):
    return _CURRENT_EXECUTION_CONTEXT.set(ctx)


@asynccontextmanager
async def execution_scope(
    company_id: str,
    user_id: Optional[str] = None,
    execution_id: Optional[str] = None,
    conversation_id: Optional[str] = None,
    agent_type: str = "coach",
    metadata: Optional[Dict[str, Any]] = None,
):
    """
    Context manager establishing an active execution context for an agent query.
    """
    ctx = ExecutionContext(
        company_id=company_id,
        user_id=user_id,
        execution_id=execution_id,
        conversation_id=conversation_id,
        agent_type=agent_type,
        metadata=metadata,
    )
    token = set_current_execution_context(ctx)
    try:
        yield ctx
    finally:
        set_current_execution_context(None)


@asynccontextmanager
async def execution_span(span_name: str, context: Optional[ExecutionContext] = None):
    """
    Tracks a nested sub-operation / tool call span within the active execution context.
    """
    ctx = context or get_current_execution_context()
    prev_span = ctx.get_active_span() if ctx else None
    span_id = str(uuid.uuid4())
    if ctx:
        ctx.set_active_span(span_id)
    try:
        yield span_id
    finally:
        if ctx:
            ctx.set_active_span(prev_span)
