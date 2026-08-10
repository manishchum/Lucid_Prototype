from ai.types import UsageLog
from utils.db.ai_db import insert_usage_log


class UsageTracker:

    @staticmethod
    def log(
        usage: UsageLog
    ) -> None:

        insert_usage_log({

            "company_id": usage.company_id,

            "user_id": usage.user_id,

            "feature_id": usage.feature_id,

            "provider": usage.provider,

            "model_name": usage.model,

            "route": usage.route,

            "prompt_version": usage.prompt_version,

            "input_tokens": usage.input_tokens,

            "output_tokens": usage.output_tokens,

            "total_tokens": usage.total_tokens,

            "cost_usd": usage.cost_usd,

            "cost_inr": usage.cost_inr,

            "latency_ms": usage.latency_ms,

            "status": usage.status,

            "error_message": usage.error_message

        })