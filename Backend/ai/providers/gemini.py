import time

from google import genai
from google.genai.types import GenerateContentConfig

from ai.types import (
    AIResponse,
    ModelConfig
)


class GeminiProvider:

    @staticmethod
    async def execute(
        *,
        prompt: str,
        model: ModelConfig,
        api_key: str,
        response_format: str = "text"
    ) -> AIResponse:

        start = time.perf_counter()

        client = genai.Client(
            api_key=api_key
        )

        config = GenerateContentConfig(
            temperature=model.temperature,
            top_p=model.top_p,
            max_output_tokens=model.max_tokens
        )

        response = client.models.generate_content(
            model=model.model,
            contents=prompt,
            config=config
        )

        latency = int(
            (time.perf_counter() - start) * 1000
        )

        usage = getattr(
            response,
            "usage_metadata",
            None
        )

        input_tokens = (
            usage.prompt_token_count
            if usage else 0
        )

        output_tokens = (
            usage.candidates_token_count
            if usage else 0
        )

        total_tokens = (
            usage.total_token_count
            if usage else input_tokens + output_tokens
        )

        return AIResponse(
            success=True,

            content=response.text,

            provider="gemini",

            model=model.model,

            prompt_version=0,

            finish_reason=getattr(
                response,
                "finish_reason",
                None
            ),

            input_tokens=input_tokens,

            output_tokens=output_tokens,

            total_tokens=total_tokens,

            latency_ms=latency,

            raw_response=response
        )