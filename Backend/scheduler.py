import os
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
from apscheduler.executors.pool import ThreadPoolExecutor

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_DB_PATH = os.path.join(_BASE_DIR, "scheduled_jobs.db")
_DB_URL = f"sqlite:///{_DB_PATH}"

jobstores = {
    "default": SQLAlchemyJobStore(url=_DB_URL),
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
