import time

from openai import OpenAI

from ai.types import (
    AIResponse,
    ModelConfig
)


class OpenAIProvider:

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

        client = OpenAI(
            api_key=api_key
        )

        if audio is not None:

            response = client.audio.transcriptions.create(
                model=model.model,
                file=audio,
                prompt=prompt,
            )

            latency = int(
                (time.perf_counter() - start) * 1000
            )

            text = getattr(
                response,
                "text",
                ""
            )

            return AIResponse(
                success=True,
                content=text,
                provider="openai",
                model=model.model,
                prompt_version=0,
                finish_reason=None,
                input_tokens=0,
                output_tokens=0,
                total_tokens=0,
                latency_ms=latency,
                raw_response=response,
            )

        response = client.responses.create(
            model=model.model,
            input=prompt,
            temperature=model.temperature,
            top_p=model.top_p,
            max_output_tokens=model.max_tokens
        )

        latency = int(
            (time.perf_counter() - start) * 1000
        )

        usage = getattr(
            response,
            "usage",
            None
        )

        input_tokens = (
            usage.input_tokens
            if usage else 0
        )

        output_tokens = (
            usage.output_tokens
            if usage else 0
        )

        total_tokens = (
            usage.total_tokens
            if usage else input_tokens + output_tokens
        )

        return AIResponse(

            success=True,

            content=response.output_text,

            provider="openai",

            model=model.model,

            prompt_version=0,

            finish_reason=getattr(
                response,
                "status",
                None
            ),

            input_tokens=input_tokens,

            output_tokens=output_tokens,

            total_tokens=total_tokens,

            latency_ms=latency,

            raw_response=response
        )