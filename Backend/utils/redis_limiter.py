from typing import Optional
from fastapi import HTTPException, Request
from utils.redis_client import redis_client


LIMITS = {
    "assistant": {
        "limit": 3,
        "window": 60,          # 30 requests/min
    },
    "tts": {
        "limit": 10,
        "window": 3600,        # 20/hour
    },
    "gpt-feedback": {
        "limit": 5,
        "window": 3600,
    },
    "training-plan": {
        "limit": 2,
        "window": 3600,
    },
    "image-analysis": {
        "limit": 1,
        "window": 86400,       # 50/day
    },
    "default": {
        "limit": 60,
        "window": 60,
    },
    "module-chat": {
        "limit": 10,
        "window": 3600,
    },
    "speech-to-text": {
        "limit": 10,
        "window": 3600,
    },
    "client-logs": {
        "limit": 30,
        "window": 60,          # 30 requests/min per IP
    },
    "auth-send-otp": {
        "limit": 5,
        "window": 60,          # 5 OTP requests per minute per IP
    },
    "send-otp": {
        "limit": 5,
        "window": 60,
    },
    "auth-verify-otp": {
        "limit": 10,
        "window": 60,          # 10 OTP verification attempts per minute per IP
    },
    "verify-otp": {
        "limit": 10,
        "window": 60,
    },
}


def get_client_ip(request: Request) -> str:
    """Extract real client IP address from proxy / reverse-proxy headers."""
    # 1. Cloudflare header
    cf_ip = request.headers.get("cf-connecting-ip")
    if cf_ip:
        return cf_ip.strip()

    # 2. X-Forwarded-For header (standard reverse proxy / Cloud Run)
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()

    # 3. X-Real-IP header
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()

    # 4. Direct socket client IP
    return request.client.host if request.client else "unknown"


async def check_rate_limit(
    user_id: str,
    endpoint: str,
    limit: Optional[int] = None,
    window: Optional[int] = None,
):
    """
    Distributed Redis sliding window limiter.
    Raises HTTPException(429) when exceeded.
    """

    config = LIMITS.get(endpoint, LIMITS["default"])

    max_limit = limit if limit is not None else config["limit"]
    win_seconds = window if window is not None else config["window"]

    key = f"ratelimit:{user_id}:{endpoint}"

    try:
        current = redis_client.incr(key)

        if current == 1:
            redis_client.expire(key, win_seconds)

        ttl = redis_client.ttl(key)
        if ttl == -1:
            redis_client.expire(key, win_seconds)
            ttl = win_seconds

    except Exception:
        # Never block users if Redis goes down
        return

    print(
        f"[RATE LIMIT] "
        f"{endpoint} "
        f"user={user_id} "
        f"{current}/{max_limit} "
        f"ttl={ttl}"
    )

    if current > max_limit:
        retry_after = ttl if ttl > 0 else win_seconds
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded. Try again in {retry_after} seconds.",
            headers={"Retry-After": str(retry_after)},
        )