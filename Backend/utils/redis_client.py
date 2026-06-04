import json
import os

import redis

redis_client = redis.Redis(
    host=os.getenv("REDIS_HOST"),
    port=int(os.getenv("REDIS_PORT")),
    username=os.getenv("REDIS_USERNAME"),
    password=os.getenv("REDIS_PASSWORD"),
    decode_responses=True,
    ssl=True
)


def get_cache(key: str):
    try:
        data = redis_client.get(key)
    except Exception:
        return None

    if data:
        try:
            return json.loads(data)
        except json.JSONDecodeError:
            return None

    return None


def set_cache(key: str, value, ttl: int = 300) -> None:
    try:
        redis_client.setex(key, ttl, json.dumps(value))
    except Exception:
        return None