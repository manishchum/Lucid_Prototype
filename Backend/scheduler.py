"""
scheduler.py
------------
Singleton APScheduler BackgroundScheduler with SQLite persistence.
Jobs survive server restarts because APScheduler rehydrates them from the DB.

Usage
-----
    from scheduler import scheduler          # import the instance
    scheduler.start()                        # called once at app startup
    scheduler.shutdown(wait=False)           # called at app shutdown
    scheduler.add_job(fn, 'date', run_date=dt, id='unique-id', ...)
"""

import os
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
from apscheduler.executors.pool import ThreadPoolExecutor

# ── SQLite DB path ────────────────────────────────────────────────────────────
# Stored next to this file so it is always findable regardless of cwd.
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_DB_PATH = os.path.join(_BASE_DIR, "scheduled_jobs.db")
_DB_URL = f"sqlite:///{_DB_PATH}"

# ── Scheduler configuration ───────────────────────────────────────────────────
jobstores = {
    "default": SQLAlchemyJobStore(url=_DB_URL),
}

executors = {
    "default": ThreadPoolExecutor(max_workers=5),
}

job_defaults = {
    "coalesce": True,       # merge missed runs into one
    "max_instances": 1,     # never run the same job twice concurrently
    "misfire_grace_time": 60 * 15,  # allow up to 15 min late if server was down
}

scheduler = BackgroundScheduler(
    jobstores=jobstores,
    executors=executors,
    job_defaults=job_defaults,
)
