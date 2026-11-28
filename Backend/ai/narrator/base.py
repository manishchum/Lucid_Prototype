# Backend/ai/narrator/base.py
"""
Base Abstract Provider for LLM Narrators.
Allows pluggable model integrations (Gemini, OpenAI, Claude, Open-Source).
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, Optional


class BaseNarratorProvider(ABC):
    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Name of the provider, e.g. 'gemini', 'openai', 'claude'."""
        pass

    @property
    @abstractmethod
    def model_name(self) -> str:
        """Name of the underlying model, e.g. 'gemini-1.5-flash', 'gpt-4o-mini'."""
        pass

    @abstractmethod
    async def generate_narration(
        self,
        prompt: str,
        system_instruction: Optional[str] = None
    ) -> Dict[str, str]:
        """
        Executes a prompt against the narrator model.
        Must return a dictionary with:
          - "title": Concise 2-5 word status header
          - "message": Grounded 1-2 sentence first-person explanation
        """
        pass

    @abstractmethod
    async def health_check(self) -> bool:
        """Verifies API key and basic availability."""
        pass
