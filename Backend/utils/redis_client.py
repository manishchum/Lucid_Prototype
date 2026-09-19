import json
import os

import redis

redis_client = redis.Redis(
    host=os.getenv("REDIS_HOST"),
    port=int(os.getenv("REDIS_PORT")),
    username=os.getenv("REDIS_USERNAME"),
    password=os.getenv("REDIS_PASSWORD"),
    decode_responses=True,
    # ssl=True
)

try:
    print("Testing Redis connection...")
    print(redis_client.ping())
except Exception as e:
    print(f"Redis connection failed: {e}")



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
    
def delete_cache_pattern(pattern: str):
    try:

        cursor = 0

        while True:

            cursor, keys = redis_client.scan(
                cursor=cursor,
                match=pattern,
                count=100
            )

            if keys:

                try:
                    redis_client.unlink(*keys)
                except Exception:
                    redis_client.delete(*keys)

            if cursor == 0:
                break

    except Exception:
        return None


def invalidate_dashboard_cache(user_id: str):
    """Invalidates employee dashboard cache instantly upon write mutation (< 1s freshness)."""
    if not user_id:
        return
    try:
        redis_client.delete(f"dashboard_summary:{user_id}")
    except Exception as e:
        print(f"[Redis] Failed to invalidate dashboard_summary:{user_id}: {e}")


def invalidate_company_dashboard_cache(company_id: str):
    """Invalidates company-wide static dashboard data cache when modules/company are updated."""
    if not company_id:
        return
    try:
        redis_client.delete(f"company_static:{company_id}")
        delete_cache_pattern(f"dashboard_summary:*")
    except Exception as e:
        print(f"[Redis] Failed to invalidate company_static:{company_id}: {e}")
