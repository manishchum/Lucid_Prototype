import os
from dotenv import load_dotenv
load_dotenv("Backend/.env")
load_dotenv()
import uuid
import pytest
from fastapi import HTTPException

from utils.auth import register_device_session, validate_device_session, _DEVICE_SESSION_L1_CACHE, _get_session_ttl
from utils.redis_client import redis_client


def test_session_lifecycle_and_idle_sliding_expiration():
    """
    Verifies that:
    1. A web session starts with 3600s TTL (1 hour).
    2. Active calls slide the expiration window back to 3600s.
    3. If Redis key expires (simulated by deleting the key), validate_device_session
       strictly raises HTTP 401 Session_Expired and NEVER resurrects the session.
    4. An unauthenticated or replaced device raises HTTP 401 Session_Replaced.
    """
    user_id = str(uuid.uuid4())
    device_id_tab1 = f"dev-chrome-tab1-{uuid.uuid4()}"
    device_id_tab2 = device_id_tab1  # Same browser shares the same device_id
    device_id_browser2 = f"dev-firefox-{uuid.uuid4()}"

    session_key = f"session:{user_id}:web"

    # Step 1: Register initial session on Tab 1
    register_device_session(user_id, device_id_tab1, platform="web")
    ttl_initial = redis_client.ttl(session_key)
    assert 3500 <= ttl_initial <= 3600

    # Step 2: Validate from Tab 2 (same browser) -> succeeds and slides expiration
    validate_device_session(user_id, device_id_tab2, platform="web")
    ttl_after_slide = redis_client.ttl(session_key)
    assert 3500 <= ttl_after_slide <= 3600

    # Step 3: Simulate 1-hour idle timeout expiration in Redis
    redis_client.delete(session_key)
    _DEVICE_SESSION_L1_CACHE.pop(session_key, None)

    # Calling validate after expiration MUST raise Session_Expired (401)
    with pytest.raises(HTTPException) as exc_info:
        validate_device_session(user_id, device_id_tab1, platform="web")
    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Session_Expired"

    # LOOPHOLE VERIFICATION: Ensure the key was NOT resurrected in Redis
    assert redis_client.get(session_key) is None

    # Step 4: Re-register on Browser 2
    register_device_session(user_id, device_id_browser2, platform="web")
    validate_device_session(user_id, device_id_browser2, platform="web")

    # Step 5: Old Browser 1 tries to make request -> raises Session_Replaced (401)
    _DEVICE_SESSION_L1_CACHE.pop(session_key, None)
    with pytest.raises(HTTPException) as exc_displaced:
        validate_device_session(user_id, device_id_tab1, platform="web")
    assert exc_displaced.value.status_code == 401
    assert exc_displaced.value.detail == "Session_Replaced"

