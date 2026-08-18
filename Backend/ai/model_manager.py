from ai.types import ModelConfig
from utils.db.ai_db import (
    get_feature,
    get_model_config,
)
from utils.redis_client import redis_client


MODEL_CACHE_PREFIX = "ai:model:"
MODEL_CACHE_TTL = 600      # 10 minutes


class ModelManager:

    @staticmethod
    def get(feature: str) -> ModelConfig:
        """
        Returns the active model configuration
        for the requested feature.
        """

        cache_key = f"{MODEL_CACHE_PREFIX}{feature}"

        # --------------------------------------------------
        # Redis Cache
        # --------------------------------------------------

        try:
            if redis_client:
                cached = redis_client.get(cache_key)

                if cached:
                    import json

                    return ModelConfig(**json.loads(cached))
        except Exception:
            pass

        # --------------------------------------------------
        # Database
        # --------------------------------------------------

        feature_row = get_feature(feature)

        if not feature_row:
            raise Exception(
                f"No active AI feature configured for '{feature}'"
            )

        model = get_model_config(feature)

        if not model:
            raise Exception(
                f"No enabled AI model configured for feature '{feature}'"
            )

        config = ModelConfig(
            provider=model["provider"],
            model=model["model_name"],
            feature_id=model.get(
                "feature_id",
                feature_row["feature_id"]
            ),
            temperature=model.get("temperature"),
            top_p=model.get("top_p"),
            max_tokens=model.get("max_tokens"),
            input_cost_per_million=model.get(
                "input_cost_per_million",
                0.0
            ),
            output_cost_per_million=model.get(
                "output_cost_per_million",
                0.0
            ),
            priority=model.get("priority", 1),
            enabled=model.get("enabled", True),
        )

        # --------------------------------------------------
        # Cache
        # --------------------------------------------------

        try:
            if redis_client:
                import json

                redis_client.setex(
                    cache_key,
                    MODEL_CACHE_TTL,
                    json.dumps(config.__dict__)
                )
        except Exception:
            pass

        return config

    @staticmethod
    def invalidate(feature: str):
        """
        Clears cached configuration
        after model changes.
        """

        try:
            if redis_client:
                redis_client.delete(
                    f"{MODEL_CACHE_PREFIX}{feature}"
                )
        except Exception:
            pass