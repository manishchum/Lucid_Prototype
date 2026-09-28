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
    except Exception as e:
        print(f"[Redis] get_cache error for {key}: {e}")
        return None

    if data:
        try:
            return json.loads(data)
        except json.JSONDecodeError as e:
            print(f"[Redis] JSON decode error for {key}: {e}")
            return None

    return None


def set_cache(key: str, value, ttl: int = 300) -> None:
    try:
        redis_client.setex(key, ttl, json.dumps(value))
        print(f"[Redis] Successfully set cache for {key} (TTL: {ttl})")
    except Exception as e:
        print(f"[Redis] set_cache error for {key}: {e}")
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


def invalidate_user_caches(user_id: str):
    """
    Centralized, thread-safe cache invalidation function for a user.
    Purges all Redis keys (dashboard summary, module progress, training plans, tasks, rank, gamification)
    as well as Python in-memory L1 cache.
    """
    if not user_id:
        return
    try:
        redis_client.delete(f"dashboard_summary:{user_id}")
        delete_cache_pattern(f"dashboard_summary:{user_id}*")
        delete_cache_pattern(f"module_progress:{user_id}*")
        delete_cache_pattern(f"user_module_progress:{user_id}*")
        delete_cache_pattern(f"training_plan:{user_id}*")
        delete_cache_pattern(f"learning_plan:{user_id}*")
        delete_cache_pattern(f"user_rank:*{user_id}*")
        delete_cache_pattern(f"user_tasks:*{user_id}*")
        delete_cache_pattern(f"gamification:*{user_id}*")
        try:
            from routes.employee_dashboard import invalidate_dashboard_l1_cache
            invalidate_dashboard_l1_cache(user_id)
        except Exception:
            pass
    except Exception as e:
        print(f"[Redis] invalidate_user_caches error for {user_id}: {e}")


def invalidate_dashboard_cache(user_id: str):
    """Alias for invalidate_user_caches for backward compatibility."""
    invalidate_user_caches(user_id)


def invalidate_company_caches(company_id: str):
    """
    Centralized, thread-safe cache invalidation function for company-wide static data.
    Purges company static cache, company leaderboards, module lists, and dashboard summaries.
    """
    if not company_id:
        return
    try:
        redis_client.delete(f"company_static:{company_id}")
        delete_cache_pattern(f"company_leaderboard:{company_id}*")
        delete_cache_pattern(f"training_modules:{company_id}*")
        delete_cache_pattern("dashboard_summary:*")
    except Exception as e:
        print(f"[Redis] invalidate_company_caches error for {company_id}: {e}")


def invalidate_company_dashboard_cache(company_id: str):
    """Alias for invalidate_company_caches for backward compatibility."""
    invalidate_company_caches(company_id)

