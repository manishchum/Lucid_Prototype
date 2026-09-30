import time
from decimal import Decimal, InvalidOperation

# Keep pricing unpopulated by default unless verified values are provided.
# If a model is not configured, cost calculation defaults to None gracefully.
GEMINI_PRICING = {
    # Example format:
    # "gemini-2.5-flash": {
    #     "input_per_million": 0.075,
    #     "output_per_million": 0.30,
    #     "thinking_per_million": None # Not separately billed in 2.5-flash
    # }
}

# Configurable exchange rate
USD_TO_INR = Decimal("83.50")

GEMINI_PRICING = {
    "gemini-2.5-flash": {
        "input_per_million": Decimal("0.30"),
        "output_per_million": Decimal("2.50"),
    }
}

def extract_gemini_usage(response, model_name: str, start_time: float, end_time: float) -> dict:
    """
    Safely extract token usage metadata from a Gemini SDK response.
    Never fails the evaluation. Falls back to 0 or None if fields are missing.
    """
    usage_dict = {
        "model": model_name,
        "prompt_tokens": 0,
        "output_tokens": 0,
        "thinking_tokens": 0,
        "cached_tokens": 0,
        "total_tokens": 0,
        "duration_ms": round((end_time - start_time) * 1000, 2),
        "pricing_available": False,
        "input_cost_usd": None,
        "output_cost_usd": None,
        "total_cost_usd": None,
        "total_cost_inr": None,
        "status": "SUCCESS"
    }
    
    try:
        # Google GenAI SDK usage_metadata extraction
        meta = getattr(response, "usage_metadata", None)
        if meta:
            usage_dict["prompt_tokens"] = getattr(meta, "prompt_token_count", 0) or 0
            usage_dict["output_tokens"] = getattr(meta, "candidates_token_count", 0) or 0
            usage_dict["total_tokens"] = getattr(meta, "total_token_count", 0) or 0
            
            # Experimental / Optional fields depending on SDK version
            usage_dict["thinking_tokens"] = getattr(meta, "thoughts_token_count", 0) or 0
            usage_dict["cached_tokens"] = getattr(meta, "cached_content_token_count", 0) or 0
            
            # Observability Warning: High reasoning tokens
            p_tokens = usage_dict["prompt_tokens"]
            t_tokens = usage_dict["thinking_tokens"]
            if p_tokens > 0 and t_tokens > p_tokens * 2:
                print(f"[WARNING] High reasoning token usage detected. Thinking tokens: {t_tokens}, Prompt tokens: {p_tokens}")
            
            # Cost Estimation
            pricing = GEMINI_PRICING.get(model_name)
            if pricing:
                try:
                    usage_dict["pricing_available"] = True
                    # As verified by analyzing SDK response, total_token_count = prompt_token_count + candidates_token_count + thoughts_token_count.
                    # Therefore, candidates_token_count is separate from thoughts_token_count.
                    # Thinking tokens are billed at the same rate as output tokens, so we sum them for billing.
                    billed_output_tokens = Decimal(usage_dict["output_tokens"] + usage_dict["thinking_tokens"])
                    
                    in_cost = (Decimal(usage_dict["prompt_tokens"]) / Decimal(1_000_000)) * pricing["input_per_million"]
                    out_cost = (billed_output_tokens / Decimal(1_000_000)) * pricing["output_per_million"]
                    
                    total_usd = in_cost + out_cost
                    
                    # Store as strings preserving full precision as requested, formatted to 8 decimal places
                    usage_dict["input_cost_usd"] = f"{in_cost:.8f}"
                    usage_dict["output_cost_usd"] = f"{out_cost:.8f}"
                    usage_dict["total_cost_usd"] = f"{total_usd:.8f}"
                    usage_dict["total_cost_inr"] = f"{total_usd * USD_TO_INR:.2f}"
                except (InvalidOperation, TypeError, ValueError) as e:
                    print(f"[Gemini Usage] Cost calculation error: {e}")
            else:
                print(f"[Gemini Usage] Pricing unavailable for model: {model_name}")
                
    except Exception as e:
        print(f"[Gemini Usage] Usage extraction failed safely: {e}")

    return usage_dict
