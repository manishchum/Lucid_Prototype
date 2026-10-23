"""
Distributed ARQ Client & Job Dispatcher for Redis.
Allows any FastAPI endpoint, service, or background task to enqueue immediate
or deferred/scheduled jobs into the Redis-backed ARQ queue.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta
from typing import Any, Optional, Union

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings

logger = logging.getLogger("lucid.arq_client")

_arq_pool: Optional[ArqRedis] = None
_pool_lock = asyncio.Lock()


def get_redis_settings() -> RedisSettings:
    """Returns RedisSettings configured from environment variables."""
    raw_host = os.getenv("REDIS_HOST", "127.0.0.1")
    try:
        import socket
        resolved_host = socket.gethostbyname(raw_host)
    except Exception:
        resolved_host = raw_host

    import redis as py_redis
    return RedisSettings(
        host=resolved_host,
        port=int(os.getenv("REDIS_PORT", "6379")),
        username=os.getenv("REDIS_USERNAME", None),
        password=os.getenv("REDIS_PASSWORD", None),
        conn_timeout=10,
        conn_retries=5,
        conn_retry_delay=1,
        retry_on_timeout=True,
        max_connections=3,
        retry_on_error=[py_redis.exceptions.ConnectionError, ConnectionResetError, OSError],
    )


async def get_arq_pool() -> ArqRedis:
    """Returns a shared ArqRedis connection pool instance (thread-safe, async-safe)."""
    global _arq_pool
    if _arq_pool is not None:
        return _arq_pool

    async with _pool_lock:
        if _arq_pool is None:
            settings = get_redis_settings()
            _arq_pool = await create_pool(settings)
            logger.info("[ARQ Client] Redis connection pool established.")
        return _arq_pool


async def enqueue_job(
    function_name: str,
    *args: Any,
    _defer_until: Optional[datetime] = None,
    _defer_by: Optional[Union[int, float, timedelta]] = None,
    _job_id: Optional[str] = None,
    **kwargs: Any,
) -> Optional[Any]:
    """
    Enqueues a job into the distributed Redis queue for background execution by ARQ workers.

    Args:
        function_name: Name of the registered worker function.
        *args: Positional arguments to forward to the worker function.
        _defer_until: Exact UTC datetime when the job should become active.
        _defer_by: Delay duration (seconds or timedelta) before the job becomes active.
        _job_id: Optional unique job identifier to prevent duplicate submissions.
        **kwargs: Keyword arguments to forward to the worker function.

    Returns:
        Job object or None if enqueue failed.
    """
    try:
        pool = await get_arq_pool()
        job = await pool.enqueue_job(
            function_name,
            *args,
            _defer_until=_defer_until,
            _defer_by=_defer_by,
            _job_id=_job_id,
            **kwargs,
        )
        logger.info(f"[ARQ Client] Enqueued job '{function_name}' (ID: {job.job_id if job else 'unknown'})")
        return job
    except Exception as e:
        logger.error(f"[ARQ Client] Failed to enqueue job '{function_name}': {e}", exc_info=True)
        return None


async def close_arq_pool() -> None:
    """Gracefully closes the ARQ Redis pool on application shutdown."""
    global _arq_pool
    if _arq_pool is not None:
        try:
            await _arq_pool.close()
            logger.info("[ARQ Client] ARQ Redis connection pool closed.")
        except Exception as e:
            logger.warning(f"[ARQ Client] Error closing ARQ pool: {e}")
        finally:
            _arq_pool = None
