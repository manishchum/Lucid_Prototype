from ai.providers.gemini import GeminiProvider
from ai.providers.openai import OpenAIProvider

class ProviderManager:

    PROVIDERS = {
        "gemini": GeminiProvider,
        "openai": OpenAIProvider,
    }

    @classmethod
    def get(cls, provider: str):
        provider = provider.lower()

        if provider not in cls.PROVIDERS:
            raise Exception(
                f"Unsupported provider '{provider}'"
            )

        return cls.PROVIDERS[provider]