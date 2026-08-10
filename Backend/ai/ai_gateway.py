import os

from ai.types import (
    AIRequest,
    AIResponse,
    UsageLog
)

from ai.model_manager import ModelManager
from ai.provider_manager import ProviderManager
from ai.prompt_manager import PromptManager
from ai.cost_calculator import CostCalculator
from ai.usage_tracker import UsageTracker
from utils.db.ai_db import list_enabled_providers


class AI:

    @staticmethod
    async def execute(
        request: AIRequest
    ) -> AIResponse:

        model = ModelManager.get(
            request.feature
        )

        prompt = PromptManager.get(
            request.feature,
            request.prompt_type
        )

        final_prompt = PromptManager.render(
            prompt,
            request.variables
        )

        enabled_provider_rows = list_enabled_providers()
        enabled_provider_rows = getattr(
            enabled_provider_rows,
            "data",
            enabled_provider_rows
        ) or []

        primary_provider = model.provider.lower()
        enabled_providers = [
            row["provider"].lower()
            for row in enabled_provider_rows
            if row.get("provider")
        ]

        provider_order = []

        if primary_provider in enabled_providers:
            provider_order.append(primary_provider)

        for provider_name in enabled_providers:
            if provider_name != primary_provider:
                provider_order.append(provider_name)
                break

        if not provider_order:
            provider_order.append(primary_provider)

        response = None
        last_error: Exception | None = None

        for provider_name in provider_order[:2]:
            try:
                provider_class = ProviderManager.get(provider_name)

                api_key = os.getenv(
                    f"{provider_name.upper()}_API_KEY"
                )

                if not api_key:
                    raise Exception(
                        f"Missing API key for {provider_name}"
                    )

                response = await provider_class.execute(
                    prompt=final_prompt,
                    model=model,
                    api_key=api_key,
                    response_format=request.response_format
                )

                break

            except Exception as exc:
                last_error = exc

        if not response:
            raise last_error or Exception(
                f"No enabled provider could execute feature '{request.feature}'"
            )

        response.prompt_version = prompt.version

        cost_usd, cost_inr = CostCalculator.calculate(

            input_tokens=response.input_tokens,

            output_tokens=response.output_tokens,

            input_cost_per_million=model.input_cost_per_million,

            output_cost_per_million=model.output_cost_per_million

        )

        UsageTracker.log(

            UsageLog(

                company_id=request.company_id,

                user_id=request.user_id,

                feature_id=model.feature_id,

                provider=response.provider,

                model=response.model,

                route=request.route,

                prompt_version=prompt.version,

                input_tokens=response.input_tokens,

                output_tokens=response.output_tokens,

                total_tokens=response.total_tokens,

                cost_usd=cost_usd,

                cost_inr=cost_inr,

                latency_ms=response.latency_ms,

                status="success"

            )

        )

        return response