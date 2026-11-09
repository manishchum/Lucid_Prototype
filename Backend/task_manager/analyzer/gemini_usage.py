"""
[DEPRECATED] analyzer.gemini_usage is deprecated.
Token, latency, cost calculation, and audit logging are now centralized inside the Model Agnostic
AI Gateway (Backend/ai) via CostCalculator and UsageTracker (recording into public.ai_usage_logs).

This module is retained strictly as a backward-compatible shim.
"""
from decimal import Decimal, InvalidOperation
from typing import Any
from ai.cost_calculator import CostCalculator


def extract_gemini_usage(response: Any = None, model_name: str = "gemini-2.5-flash", start_time: float = 0.0, end_time: float = 0.0) -> dict:
    """
    [DEPRECATED] Backward-compatible shim for extracting usage metadata from a model response.
    New code should rely on AI.execute() which automatically logs to public.ai_usage_logs.
    """
    duration_ms = round((end_time - start_time) * 1000, 2) if end_time >= start_time else 0.0

    usage_dict = {
        "model": model_name,
        "prompt_tokens": 0,
        "output_tokens": 0,
        "thinking_tokens": 0,
        "cached_tokens": 0,
        "total_tokens": 0,
        "duration_ms": duration_ms,
        "pricing_available": False,
        "input_cost_usd": None,
        "output_cost_usd": None,
        "total_cost_usd": None,
        "total_cost_inr": None,
        "status": "SUCCESS"
    }

    if not response:
        return usage_dict

    try:
        meta = getattr(response, "usage_metadata", None)
        if meta:
            usage_dict["prompt_tokens"] = getattr(meta, "prompt_token_count", 0) or 0
            usage_dict["output_tokens"] = getattr(meta, "candidates_token_count", 0) or 0
            usage_dict["total_tokens"] = getattr(meta, "total_token_count", 0) or 0
            usage_dict["thinking_tokens"] = getattr(meta, "thoughts_token_count", 0) or 0
            usage_dict["cached_tokens"] = getattr(meta, "cached_content_token_count", 0) or 0

            # Central Cost Calculation
            usd_rate = CostCalculator.get_usd_to_inr_rate()
            # Standard rates: Gemini 2.5 Flash ($0.30/M in, $1.50/M out)
            cost_usd, cost_inr = CostCalculator.calculate(
                input_tokens=usage_dict["prompt_tokens"],
                output_tokens=usage_dict["output_tokens"] + usage_dict["thinking_tokens"],
                input_cost_per_million=0.30,
                output_cost_per_million=1.50,
                usd_to_inr=usd_rate,
            )

            usage_dict["pricing_available"] = True
            usage_dict["total_cost_usd"] = f"{cost_usd:.8f}"
            usage_dict["total_cost_inr"] = f"{cost_inr:.2f}"
    except Exception as e:
        print(f"[Gemini Usage Shim] Usage extraction fallback: {e}")

    return usage_dict
