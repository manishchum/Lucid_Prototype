from fastapi import HTTPException
from utils.redis_client import redis_client


LIMITS = {
    "assistant": {
        "limit": 3,
        "window": 60,          # 30 requests/min
    },
    "tts": {
        "limit": 20,
        "window": 3600,        # 20/hour
    },
    "gpt-feedback": {
        "limit": 10,
        "window": 3600,
    },
    "training-plan": {
        "limit": 3,
        "window": 3600,
    },
    "image-analysis": {
        "limit": 50,
        "window": 86400,       # 50/day
    },
    "default": {
        "limit": 60,
        "window": 60,
    },
    "module-chat": {
        "limit": 15,
        "window": 3600,
    },
    "speech-to-text": {
        "limit": 3,
        "window": 3600,
    }
}


async def check_rate_limit(
    user_id: str,
    endpoint: str,
):
    """
    Simple Redis sliding window limiter.
    Raises HTTPException(429) when exceeded.
    """

    config = LIMITS.get(endpoint, LIMITS["default"])

    limit = config["limit"]
    window = config["window"]

    key = f"ratelimit:{user_id}:{endpoint}"

    try:

        current = redis_client.incr(key)

        if current == 1:
            redis_client.expire(key, window)

        ttl = redis_client.ttl(key)

    except Exception:
        # Never block users if Redis goes down
        return

    print(
        f"[RATE LIMIT] "
        f"{endpoint} "
        f"user={user_id} "
        f"{current}/{limit} "
        f"ttl={ttl}"
    )

    if current > limit:
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded. Try again in {ttl} seconds."
        )