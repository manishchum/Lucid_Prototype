# Backend/ai/narrator/openai_narrator.py
"""
OpenAI Fast Narrator Adapter for Agent Activity Transparency.
Uses GPT-4o-mini with structured JSON output.
"""

import json
from typing import Dict, Any, Optional
from config import OPENAI_API_KEY
from .base import BaseNarratorProvider

try:
    from openai import AsyncOpenAI
    OPENAI_AVAILABLE = True
except ImportError:
    AsyncOpenAI = None
    OPENAI_AVAILABLE = False


class OpenAINarratorProvider(BaseNarratorProvider):
    def __init__(self, api_key: Optional[str] = None, model: str = "gpt-4o-mini"):
        self._api_key = api_key or OPENAI_API_KEY
        self._model = model
        self._client = None
        if self._api_key and OPENAI_AVAILABLE:
            try:
                self._client = AsyncOpenAI(api_key=self._api_key)
            except Exception as e:
                print(f"[OPENAI NARRATOR] Client init note: {e}")

    @property
    def provider_name(self) -> str:
        return "openai"

    @property
    def model_name(self) -> str:
        return self._model

    async def generate_narration(
        self,
        prompt: str,
        system_instruction: Optional[str] = None
    ) -> Dict[str, str]:
        if not self._client or not OPENAI_AVAILABLE:
            raise RuntimeError("OpenAI client is not initialized or API key is missing.")

        messages = []
        if system_instruction:
            messages.append({"role": "system", "content": system_instruction})
        else:
            messages.append({
                "role": "system",
                "content": (
                    "You are the Agent Narrator. Output a JSON object with 'title' (2-5 words) and 'message' (1-2 sentences)."
                ),
            })
        messages.append({"role": "user", "content": prompt})

        resp = await self._client.chat.completions.create(
            model=self._model,
            messages=messages,
            response_format={"type": "json_object"},
            temperature=0.2,
            max_tokens=150,
        )

        raw_text = resp.choices[0].message.content or "{}"
        data = json.loads(raw_text)
        return {
            "title": str(data.get("title", "Processing")).strip(),
            "message": str(data.get("message", "")).strip(),
        }

    async def health_check(self) -> bool:
        return bool(self._client and self._api_key)
