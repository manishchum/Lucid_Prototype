from typing import Optional

import tiktoken


class TokenCounter:
    """
    Utility for estimating token counts.

    NOTE:
    Actual provider usage should always be preferred.
    This class is mainly used for estimation before
    sending requests.
    """

    DEFAULT_ENCODING = "cl100k_base"

    @staticmethod
    def estimate(
        text: str,
        encoding: str = DEFAULT_ENCODING
    ) -> int:

        if not text:
            return 0

        encoder = tiktoken.get_encoding(
            encoding
        )

        return len(
            encoder.encode(text)
        )

    @staticmethod
    def total(
        prompt: str,
        completion: str
    ) -> dict:

        input_tokens = TokenCounter.estimate(
            prompt
        )

        output_tokens = TokenCounter.estimate(
            completion
        )

        return {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": input_tokens + output_tokens
        }

    @staticmethod
    def from_provider(
        *,
        input_tokens: Optional[int],
        output_tokens: Optional[int]
    ) -> dict:

        input_tokens = input_tokens or 0
        output_tokens = output_tokens or 0

        return {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": input_tokens + output_tokens
        }