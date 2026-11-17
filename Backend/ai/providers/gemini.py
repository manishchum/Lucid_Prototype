import base64
import time

from google import genai
from google.genai.types import (
    GenerateContentConfig,
    Part,
    ThinkingConfig,
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
        audio=None,
        generation_config=None,
        **kwargs,
    ) -> AIResponse:

        start = time.perf_counter()

        client = genai.Client(
            api_key=api_key
        )

        images = images or []
        files = files or []
        generation_config = generation_config or {}

        contents = []
        if prompt:
            contents.append(
                Part.from_text(text=prompt)
            )

        for image in images:
            if isinstance(image, bytes):
                contents.append(
                    Part.from_bytes(
                        data=image,
                        mime_type="image/jpeg"
                    )
                )
                continue

            if not isinstance(image, dict):
                continue

            mime_type = image.get("mime_type") or "image/jpeg"
            data = image.get("data")

            if not data:
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
            if isinstance(file, bytes):
                contents.append(
                    Part.from_bytes(
                        data=file,
                        mime_type="application/octet-stream"
                    )
                )
                continue

            if not isinstance(file, dict):
                continue

            mime_type = file.get("mime_type") or "application/octet-stream"
            data = file.get("data")

            if not data:
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

        if audio is not None:
            if isinstance(audio, bytes):
                contents.append(
                    Part.from_bytes(
                        data=audio,
                        mime_type="audio/wav"
                    )
                )
            elif isinstance(audio, dict):
                mime_type = audio.get("mime_type") or "audio/wav"
                data = audio.get("data")
                if isinstance(data, str):
                    if data.startswith("data:"):
                        data = data.split(",", 1)[1]
                    data = base64.b64decode(data)
                if data:
                    contents.append(
                        Part.from_bytes(
                            data=data,
                            mime_type=mime_type
                        )
                    )
            elif hasattr(audio, "read"):
                audio_data = audio.read()
                contents.append(
                    Part.from_bytes(
                        data=audio_data,
                        mime_type="audio/wav"
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

        thinking_config = generation_config.get("thinking_config")
        if thinking_config is not None:
            if isinstance(thinking_config, dict):
                config_kwargs["thinking_config"] = ThinkingConfig(**thinking_config)
            else:
                config_kwargs["thinking_config"] = thinking_config

        response_schema = generation_config.get("response_schema")
        if response_schema is not None:
            config_kwargs["response_schema"] = response_schema

        response_mime_type = generation_config.get("response_mime_type")
        if response_mime_type:
            config_kwargs["response_mime_type"] = response_mime_type
        elif response_format == "json":
            config_kwargs["response_mime_type"] = "application/json"

        config = GenerateContentConfig(
            **config_kwargs
        )

        response = await client.aio.models.generate_content(
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
