"""
Compatibility shim for task_manager.service.
Core implementation and routes have been consolidated into task_manager.route.
"""
from .route import *  # noqa: F401, F403
