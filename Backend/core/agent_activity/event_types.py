# Backend/core/agent_activity/event_types.py
"""
Standardized Event Types and Enums for Agent Activity Transparency.
"""

from enum import Enum


class ExecutionStage(str, Enum):
    UNDERSTANDING = "understanding"
    PLANNING = "planning"
    INFORMATION_GATHERING = "information_gathering"
    TOOL_EXECUTION = "tool_execution"
    OBSERVATION = "observation"
    VALIDATION = "validation"
    RECOVERY = "recovery"
    SYNTHESIS = "synthesis"
    COMPLETION = "completion"


class EventStatus(str, Enum):
    STARTED = "started"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    RETRYING = "retrying"


class EventVisibility(str, Enum):
    USER = "user"
    INTERNAL = "internal"
    AUDIT = "audit"
