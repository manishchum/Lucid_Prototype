# Backend/core/agent_activity/__init__.py
"""
Agent Activity & Reasoning Transparency System.
Provides structured event management, monotonic sequencing, and execution lifecycle tracking.
"""

from .event_types import ExecutionStage, EventStatus, EventVisibility
from .event_schema import ExecutionEvent, NarrationEvent, FrontendActivityUpdate
from .execution_context import ExecutionContext, get_current_execution_context, execution_span
from .event_manager import ExecutionEventManager

__all__ = [
    "ExecutionStage",
    "EventStatus",
    "EventVisibility",
    "ExecutionEvent",
    "NarrationEvent",
    "FrontendActivityUpdate",
    "ExecutionContext",
    "get_current_execution_context",
    "execution_span",
    "ExecutionEventManager",
]
