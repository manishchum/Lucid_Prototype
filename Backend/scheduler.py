"""
================================================================================
DISTRIBUTED REDIS JOB SCHEDULER (ARQ-POWERED)
================================================================================
Replaces in-memory APScheduler with distributed ARQ + Redis job scheduling.

Features:
- Multi-instance safe for GCP Cloud Run and containerized clusters.
- Persistent job storage in Redis ZSETs (deferred/scheduled jobs survive cold starts).
- Unifies execution under `workers/arq_worker.py` (WorkerSettings).
- Database-backed campaign persistence (Supabase) + Redis queue dispatch.
================================================================================
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any, Optional, Union

from utils.arq_client import close_arq_pool, enqueue_job, get_arq_pool

logger = logging.getLogger("lucid.scheduler")


class ArqScheduler:
    """
    Distributed Redis Scheduler using ARQ.
    Jobs submitted here are persisted in Redis sorted sets and dispatched
    by ARQ worker instances.
    """

    async def add_job(
        self,
        func_or_name: Union[str, Any],
        *args: Any,
        run_at: Optional[datetime] = None,
        delay_seconds: Optional[Union[int, float]] = None,
        job_id: Optional[str] = None,
        **kwargs: Any,
    ) -> Optional[Any]:
        """
        Schedules a job in the Redis queue to be executed immediately or at a future time.

        Args:
            func_or_name: Name of registered worker function (or callable with __name__).
            run_at: Optional UTC datetime for delayed execution.
            delay_seconds: Optional seconds to delay before running.
            job_id: Unique job ID to prevent duplicate executions.
            *args, **kwargs: Arguments forwarded to the worker function.

        Returns:
            ARQ Job object or None if enqueue failed.
        """
        func_name = func_or_name if isinstance(func_or_name, str) else getattr(func_or_name, "__name__", str(func_or_name))
        
        defer_by = timedelta(seconds=delay_seconds) if delay_seconds else None

        logger.info(
            f"[Scheduler] Submitting job '{func_name}' to Redis ARQ queue "
            f"(run_at={run_at}, delay={delay_seconds}s)"
        )

        return await enqueue_job(
            func_name,
            *args,
            _defer_until=run_at,
            _defer_by=defer_by,
            _job_id=job_id,
            **kwargs,
        )

    async def start(self) -> None:
        """Pre-warms the Redis connection pool for scheduling."""
        try:
            await get_arq_pool()
            logger.info("[Scheduler] Distributed ARQ Redis scheduler initialized.")
        except Exception as e:
            logger.warning(f"[Scheduler] ARQ Redis pool initialization notice: {e}")

    async def shutdown(self) -> None:
        """Closes the ARQ Redis pool on application shutdown."""
        await close_arq_pool()


# Global distributed scheduler instance
scheduler = ArqScheduler()

# Convenience exports
__all__ = [
    "scheduler",
    "ArqScheduler",
    "enqueue_job",
]
