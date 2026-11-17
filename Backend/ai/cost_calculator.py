from decimal import Decimal
from typing import Optional
import logging

from utils.redis_client import redis_client
from utils.db.ai_db import get_currency_exchange_rate

logger = logging.getLogger(__name__)

DEFAULT_USD_TO_INR = Decimal("95.00")
REDIS_KEY_PREFIX = "currency:rate:USD_INR"
CACHE_TTL_SECONDS = 604800  # 7 days (7 * 24 * 3600)


class CostCalculator:

    @classmethod
    def get_usd_to_inr_rate(
        cls,
        year: Optional[int] = None,
        use_cache: bool = True
    ) -> Decimal:
        """
        Retrieves the USD to INR conversion rate.
        - If 'year' is provided, fetches the rate for that specific year.
        - If 'year' is None, automatically picks the latest active rate (e.g. 2026 -> 95, 2027 -> 96).
        
        Checks Redis cache first (TTL: 7 days).
        Falls back to Supabase 'currency_exchange_rates' table, caches in Redis,
        and defaults safely to Decimal('95.00') if unreachable.
        """
        cache_key = f"{REDIS_KEY_PREFIX}:{year}" if year is not None else f"{REDIS_KEY_PREFIX}:latest"

        # 1. Try Redis cache
        if use_cache and redis_client:
            try:
                cached_val = redis_client.get(cache_key)
                if cached_val is not None:
                    return Decimal(str(cached_val).strip())
            except Exception as e:
                logger.warning(f"[CostCalculator] Redis cache read failed for {cache_key}: {e}")

        # 2. Try Database (currency_exchange_rates table)
        try:
            db_val = get_currency_exchange_rate(
                from_currency="USD",
                to_currency="INR",
                year=year
            )
            if db_val is not None:
                rate = Decimal(str(db_val).strip())

                # Store in Redis for 7 days
                if redis_client:
                    try:
                        redis_client.set(
                            cache_key,
                            str(rate),
                            ex=CACHE_TTL_SECONDS
                        )
                    except Exception as e:
                        logger.warning(f"[CostCalculator] Redis cache write failed for {cache_key}: {e}")

                return rate
        except Exception as e:
            logger.warning(f"[CostCalculator] DB fetch failed for USD_INR rate (year={year}): {e}")

        # 3. Safe fallback
        return DEFAULT_USD_TO_INR

    @classmethod
    def invalidate_rate_cache(cls, year: Optional[int] = None) -> None:
        """Clears cached USD to INR exchange rate(s) from Redis."""
        if not redis_client:
            return

        try:
            keys_to_delete = [f"{REDIS_KEY_PREFIX}:latest"]
            if year is not None:
                keys_to_delete.append(f"{REDIS_KEY_PREFIX}:{year}")
            redis_client.delete(*keys_to_delete)
        except Exception as e:
            logger.warning(f"[CostCalculator] Redis cache invalidate failed: {e}")

    @classmethod
    def calculate(
        cls,
        *,
        input_tokens: int,
        output_tokens: int,
        input_cost_per_million: float,
        output_cost_per_million: float,
        usd_to_inr: Optional[Decimal] = None,
        year: Optional[int] = None
    ) -> tuple[float, float]:

        rate = (
            usd_to_inr
            if usd_to_inr is not None
            else cls.get_usd_to_inr_rate(year=year)
        )

        input_cost = (
            Decimal(input_tokens)
            / Decimal(1_000_000)
        ) * Decimal(str(input_cost_per_million))

        output_cost = (
            Decimal(output_tokens)
            / Decimal(1_000_000)
        ) * Decimal(str(output_cost_per_million))

        total_usd = input_cost + output_cost

        total_inr = total_usd * rate

        return (
            round(float(total_usd), 8),
            round(float(total_inr), 6)
        )


def __getattr__(name: str):
    """
    Module-level dynamic attribute resolver (PEP 562).
    Ensures legacy references like `from ai.cost_calculator import USD_TO_INR`
    transparently resolve to the latest live cached rate.
    """
    if name == "USD_TO_INR":
        return CostCalculator.get_usd_to_inr_rate()
    raise AttributeError(f"module '{__name__}' has no attribute '{name}'")