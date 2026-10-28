"""
Legacy alias pointing to canonical worker in Backend/workers/arq_worker.py.
Maintained for backward compatibility.
"""
from workers.arq_worker import (
    WorkerSettings,
    poll_notification_jobs,
    process_single_job,
    redis_settings,
)

__all__ = [
    "WorkerSettings",
    "poll_notification_jobs",
    "process_single_job",
    "redis_settings",
]
