import os
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.jobstores.memory import MemoryJobStore
from apscheduler.executors.pool import ThreadPoolExecutor

# ── Scheduler Configuration ──────────────────────────────────────────
# 
# IMPORTANT: Email and WhatsApp schedules are now PERSISTED IN SUPABASE
# This scheduler uses an in-memory job store ONLY for:
#  1. Cron-based job execution (e.g., polling scheduled_emails table)
#  2. Backward compatibility with any existing APScheduler jobs
# 
# Email persistence: stored in scheduled_emails table (see email_db.py)
# WhatsApp persistence: stored in scheduled_whatsapp table
# 
# This prevents loss of scheduled jobs on server restart, as jobs are
# stored in Supabase and queried by cron workers.
# ──────────────────────────────────────────────────────────────────────

jobstores = {
    "default": MemoryJobStore(),  # In-memory store (no persistence across restarts)
}

executors = {
    "default": ThreadPoolExecutor(max_workers=5),
}

job_defaults = {
    "coalesce": True,
    "max_instances": 1,
    "misfire_grace_time": 60 * 15,
}

scheduler = BackgroundScheduler(
    jobstores=jobstores,
    executors=executors,
    job_defaults=job_defaults,
)
