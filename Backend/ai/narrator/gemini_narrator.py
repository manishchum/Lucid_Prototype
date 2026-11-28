# Backend/ai/narrator/gemini_narrator.py
"""
Gemini Fast Narrator Adapter for Agent Activity Transparency.
Uses Gemini 1.5 Flash / 2.0 Flash with structured JSON output.
"""

import json
from typing import Dict, Any, Optional
from config import GEMINI_API_KEY
from .base import BaseNarratorProvider

try:
    from google import genai
    from google.genai.types import GenerateContentConfig
    GEMINI_AVAILABLE = True
except ImportError:
    genai = None
    GenerateContentConfig = None
    GEMINI_AVAILABLE = False


class GeminiNarratorProvider(BaseNarratorProvider):
    def __init__(self, api_key: Optional[str] = None, model: str = "gemini-1.5-flash"):
        self._api_key = api_key or GEMINI_API_KEY
        self._model = model
        self._client = None
        if self._api_key and GEMINI_AVAILABLE:
            try:
                self._client = genai.Client(api_key=self._api_key)
            except Exception as e:
                print(f"[GEMINI NARRATOR] Client init note: {e}")

    @property
    def provider_name(self) -> str:
        return "gemini"

    @property
    def model_name(self) -> str:
        return self._model

    async def generate_narration(
        self,
        prompt: str,
        system_instruction: Optional[str] = None
    ) -> Dict[str, str]:
        if not self._client or not GEMINI_AVAILABLE:
            raise RuntimeError("Gemini client is not initialized or API key is missing.")

        config = GenerateContentConfig(
            temperature=0.2,
            response_mime_type="application/json",
            system_instruction=system_instruction or (
                "You are the Agent Narrator. Output a JSON object with 'title' (2-5 words) and 'message' (1-2 sentences)."
            ),
        )

        response = await self._client.aio.models.generate_content(
            model=self._model,
            contents=prompt,
            config=config,
        )

        raw_text = (response.text or "").strip()
        data = json.loads(raw_text)
        return {
            "title": str(data.get("title", "Processing")).strip(),
            "message": str(data.get("message", "")).strip(),
        }

    async def health_check(self) -> bool:
        return bool(self._client and self._api_key)
