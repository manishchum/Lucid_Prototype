import os
import secrets
import hmac
import logging
import httpx
from typing import Tuple, Optional
from utils.redis_client import redis_client

logger = logging.getLogger("lucid.otp_service")

OTP_TTL_SECONDS = 300            # 5 minutes validity
COOLDOWN_TTL_SECONDS = 30        # 30 seconds resend cooldown
MAX_VERIFY_ATTEMPTS = 5          # Max 5 wrong guesses before OTP burn
HOURLY_RESEND_LIMIT = 3          # Max 3 OTP requests per hour per number
HOURLY_TTL_SECONDS = 3600        # 1 hour limit window


def normalize_phone_number(raw_phone: str) -> str:
    """
    Normalizes phone number to E.164 format (+91XXXXXXXXXX).
    """
    digits = "".join(filter(str.isdigit, raw_phone))
    if digits.startswith("91") and len(digits) == 12:
        return f"+{digits}"
    if len(digits) == 10:
        return f"+91{digits}"
    if raw_phone.startswith("+"):
        return raw_phone
    return f"+91{digits}"


def check_resend_cooldown(phone: str) -> Tuple[bool, int]:
    """
    Checks if a 30-second resend cooldown is active for the given phone number.
    Returns (is_cooldown_active, remaining_seconds).
    """
    normalized_phone = normalize_phone_number(phone)
    cooldown_key = f"otp_cooldown:{normalized_phone}"
    try:
        ttl = redis_client.ttl(cooldown_key)
        if ttl > 0:
            return True, ttl
    except Exception as e:
        logger.warning(f"Error checking OTP cooldown for {normalized_phone}: {e}")
    return False, 0


def check_hourly_limit(phone: str) -> Tuple[bool, int]:
    """
    Enforces hourly OTP resend limits (max 3 per hour).
    Returns (is_limit_exceeded, remaining_seconds_until_reset).
    """
    normalized_phone = normalize_phone_number(phone)
    hourly_key = f"otp_hourly:{normalized_phone}"
    try:
        current_count = redis_client.get(hourly_key)
        if current_count and int(current_count) >= HOURLY_RESEND_LIMIT:
            ttl = redis_client.ttl(hourly_key)
            return True, max(ttl, 1)
    except Exception as e:
        logger.warning(f"Error checking OTP hourly limit for {normalized_phone}: {e}")
    return False, 0


def generate_and_store_otp(phone: str) -> str:
    """
    Generates a cryptographically secure 6-digit numeric OTP and stores it in Redis with 5-min TTL.
    Also tracks 30s resend cooldown, 1-hr rate limit, and resets attempt counter.
    """
    normalized_phone = normalize_phone_number(phone)
    
    # Cryptographically secure random 6-digit generation (secrets module)
    otp_code = str(secrets.randbelow(900000) + 100000)

    otp_key = f"otp:{normalized_phone}"
    cooldown_key = f"otp_cooldown:{normalized_phone}"
    attempts_key = f"otp_attempts:{normalized_phone}"
    hourly_key = f"otp_hourly:{normalized_phone}"

    try:
        redis_client.setex(otp_key, OTP_TTL_SECONDS, otp_code)
        redis_client.setex(cooldown_key, COOLDOWN_TTL_SECONDS, "active")
        redis_client.delete(attempts_key)

        # Track hourly requests count
        if not redis_client.exists(hourly_key):
            redis_client.setex(hourly_key, HOURLY_TTL_SECONDS, 1)
        else:
            redis_client.incr(hourly_key)

        logger.info(f"Generated secure OTP for {normalized_phone}")
    except Exception as e:
        logger.error(f"Failed to store OTP in Redis for {normalized_phone}: {e}")
        raise RuntimeError("Failed to store OTP in cache")

    return otp_code


def verify_otp_code(phone: str, code: str) -> Tuple[bool, str]:
    """
    Verifies OTP using constant-time comparison (hmac.compare_digest).
    Tracks failed attempts and automatically burns/purges OTP after 5 failed guesses.
    Returns (is_valid, reason_code).
    """
    normalized_phone = normalize_phone_number(phone)
    otp_key = f"otp:{normalized_phone}"
    attempts_key = f"otp_attempts:{normalized_phone}"

    try:
        stored_otp = redis_client.get(otp_key)
        if not stored_otp:
            return False, "EXPIRED_OR_NOT_FOUND"

        # Check existing attempt count
        current_attempts = redis_client.get(attempts_key)
        attempts_num = int(current_attempts) if current_attempts else 0

        if attempts_num >= MAX_VERIFY_ATTEMPTS:
            redis_client.delete(otp_key)
            redis_client.delete(attempts_key)
            return False, "MAX_ATTEMPTS_EXCEEDED"

        # Constant-time string comparison to prevent timing attacks
        user_code_str = str(code).strip()
        stored_otp_str = str(stored_otp).strip()

        if hmac.compare_digest(stored_otp_str.encode("utf-8"), user_code_str.encode("utf-8")):
            redis_client.delete(otp_key)
            redis_client.delete(attempts_key)
            return True, "SUCCESS"
        else:
            # Increment failed attempts
            new_attempts = redis_client.incr(attempts_key)
            redis_client.expire(attempts_key, OTP_TTL_SECONDS)

            if new_attempts >= MAX_VERIFY_ATTEMPTS:
                redis_client.delete(otp_key)
                redis_client.delete(attempts_key)
                return False, "MAX_ATTEMPTS_EXCEEDED"

            return False, f"INVALID_CODE_{MAX_VERIFY_ATTEMPTS - new_attempts}_REMAINING"

    except Exception as e:
        logger.error(f"Error verifying OTP in Redis for {normalized_phone}: {e}")
        return False, "VERIFICATION_ERROR"


async def send_dovesoft_sms(phone: str, otp_code: str) -> Tuple[bool, str]:
    """
    Sends OTP via DoveSoft SMS API.
    """
    api_url = os.getenv("DOVESOFT_API_URL", "https://api.dovesoft.io/api/json/sendsms/")
    sender_id = os.getenv("DOVESOFT_SENDER_ID", "")
    entity_id = os.getenv("DOVESOFT_ENTITY_ID", "")
    temp_id = os.getenv("DOVESOFT_TEMP_ID", "")
    api_key = os.getenv("DOVESOFT_API_KEY", "")

    normalized_phone = normalize_phone_number(phone)
    sms_message = f"The verification code for your LUCID account login is {otp_code}. The code is valid for 5 minutes. Please do not share it with anyone. - Equinox Corp"

    payload = {
        "listsms": [
            {
                "sms": sms_message,
                "mobiles": normalized_phone,
                "senderid": sender_id,
                "entityid": entity_id,
                "tempid": temp_id,
            }
        ]
    }

    headers = {
        "content-type": "application/json",
        "key": api_key
    }

    print("\n==================== [OTP GENERATED] ====================")
    print(f"📱 Phone: {normalized_phone}")
    print(f"🔑 OTP Code: {otp_code}")
    print(f"⚙️  DoveSoft SenderID: {sender_id!r} | EntityID: {entity_id!r} | TempID: {temp_id!r}")
    print("=========================================================\n")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            print(f"[DOVESOFT REQUEST] Posting to {api_url} with headers={headers}: {payload}")
            response = await client.post(api_url, json=payload, headers=headers)
            print(f"[DOVESOFT RESPONSE] Status={response.status_code} Body={response.text}")
            logger.info(f"DoveSoft API response status={response.status_code} body={response.text}")
            if response.status_code == 200:
                return True, f"SMS status {response.status_code}: {response.text}"
            else:
                return False, f"DoveSoft API returned status code {response.status_code}: {response.text}"
    except Exception as e:
        print(f"[DOVESOFT ERROR] Exception: {e}")
        logger.error(f"Exception sending SMS via DoveSoft: {e}")
        return False, str(e)
