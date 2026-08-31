import base64
import time

from google import genai
from google.genai.types import (
    GenerateContentConfig,
    Part,
)

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
        response_format: str = "text",
        images=None,
        files=None,
        generation_config=None,
    ) -> AIResponse:

        start = time.perf_counter()

        client = genai.Client(
            api_key=api_key
        )

        images = images or []
        files = files or []
        generation_config = generation_config or {}

        contents = []
        contents.append(
            Part.from_text(text=prompt)
        )

        for image in images:
            if not isinstance(image, dict):
                continue

            mime_type = image.get("mime_type")
            data = image.get("data")

            if not mime_type or not data:
                continue

            if isinstance(data, str):
                if data.startswith("data:"):
                    data = data.split(",", 1)[1]
                data = base64.b64decode(data)

            contents.append(
                Part.from_bytes(
                    data=data,
                    mime_type=mime_type
                )
            )

        for file in files:
            if not isinstance(file, dict):
                continue

            mime_type = file.get("mime_type")
            data = file.get("data")

            if not mime_type or not data:
                continue

            if isinstance(data, str):
                if data.startswith("data:"):
                    data = data.split(",", 1)[1]
                data = base64.b64decode(data)

            contents.append(
                Part.from_bytes(
                    data=data,
                    mime_type=mime_type
                )
            )

        temperature = generation_config.get("temperature", model.temperature)
        top_p = generation_config.get("top_p", model.top_p)
        max_output_tokens = generation_config.get("max_output_tokens", model.max_tokens)

        config_kwargs = {}

        if temperature is not None:
            config_kwargs["temperature"] = temperature

        if top_p is not None:
            config_kwargs["top_p"] = top_p

        if max_output_tokens is not None:
            config_kwargs["max_output_tokens"] = max_output_tokens

        if response_format == "json":
            config_kwargs["response_mime_type"] = "application/json"

        config = GenerateContentConfig(
            **config_kwargs
        )

        response = client.models.generate_content(
            model=model.model,
            contents=contents,
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