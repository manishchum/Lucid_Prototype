# Backend/ai/narrator/__init__.py
"""
LLM Narrator Engine for the Agent Activity Transparency System.
Converts execution events into humane, grounded, real-time natural language updates.
"""

from .base import BaseNarratorProvider
from .narrator_service import NarratorService, get_narrator_service

__all__ = [
    "BaseNarratorProvider",
    "NarratorService",
    "get_narrator_service",
]
