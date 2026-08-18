import json
from typing import Any

from ai.types import PromptConfig
from utils.db.ai_db import get_prompt
from utils.redis_client import redis_client


PROMPT_CACHE_PREFIX = "ai:prompt:"
PROMPT_CACHE_TTL = 600      # 10 minutes


class PromptManager:

    @staticmethod
    def get(
        feature: str,
        prompt_type: str = "default"
    ) -> PromptConfig:
        """
        Returns the active prompt configuration.

        Parameters
        ----------
        feature:
            learning_plan
            roleplay
            quiz_generation
            ...

        prompt_type:
            default
            system
            user
            feedback
            summary
            ...
        """

        cache_key = (
            f"{PROMPT_CACHE_PREFIX}"
            f"{feature}:{prompt_type}"
        )

        # ---------------------------------------------------
        # Redis
        # ---------------------------------------------------

        try:
            if redis_client:
                cached = redis_client.get(cache_key)

                if cached:
                    return PromptConfig(
                        **json.loads(cached)
                    )
        except Exception:
            pass

        # ---------------------------------------------------
        # Database
        # ---------------------------------------------------

        prompt = get_prompt(
            feature_key=feature,
            prompt_type=prompt_type
        )

        if not prompt:
            raise Exception(
                f"No active prompt configured for "
                f"feature='{feature}', "
                f"type='{prompt_type}'"
            )

        config = PromptConfig(
            feature=feature,
            prompt_type=prompt["prompt_type"],
            prompt=prompt["prompt"],
            version=prompt["version"],
            variables=prompt.get("variables") or [],
            enabled=prompt.get("enabled", True),
            feature_id=prompt.get("feature_id", "")
        )

        # ---------------------------------------------------
        # Cache
        # ---------------------------------------------------

        try:
            if redis_client:
                redis_client.setex(
                    cache_key,
                    PROMPT_CACHE_TTL,
                    json.dumps(config.__dict__)
                )
        except Exception:
            pass

        return config

    @staticmethod
    def render(
        prompt: PromptConfig,
        variables: dict[str, Any] | None = None
    ) -> str:
        """
        Render a prompt template using the variables supplied by the route.
        """

        try:
            return prompt.prompt.format(
                **(variables or {})
            )
        except KeyError as exc:
            missing = exc.args[0]

            raise Exception(
                f"Missing prompt variable '{missing}' for "
                f"feature='{prompt.feature}', type='{prompt.prompt_type}'"
            ) from exc

    @staticmethod
    def invalidate(
        feature: str,
        prompt_type: str = "default"
    ):
        """
        Clears cached prompt.

        Call this after editing prompts
        in the database.
        """

        try:
            if redis_client:
                redis_client.delete(
                    f"{PROMPT_CACHE_PREFIX}"
                    f"{feature}:{prompt_type}"
                )
        except Exception:
            pass