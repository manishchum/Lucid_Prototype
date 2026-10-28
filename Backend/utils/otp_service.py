import asyncio
import os
import secrets
import hmac
import logging
import httpx
from typing import Tuple, Optional, Any
from utils.redis_client import redis_client
from utils.logging import mask_phone_number, sanitize_text

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
    masked_phone = mask_phone_number(normalized_phone)
    cooldown_key = f"otp_cooldown:{normalized_phone}"
    try:
        ttl = redis_client.ttl(cooldown_key)
        if ttl > 0:
            return True, ttl
    except Exception as e:
        logger.warning(f"Error checking OTP cooldown for {masked_phone}: {e}")
    return False, 0


def check_hourly_limit(phone: str) -> Tuple[bool, int]:
    """
    Enforces hourly OTP resend limits (max 3 per hour).
    Returns (is_limit_exceeded, remaining_seconds_until_reset).
    """
    normalized_phone = normalize_phone_number(phone)
    masked_phone = mask_phone_number(normalized_phone)
    hourly_key = f"otp_hourly:{normalized_phone}"
    try:
        current_count = redis_client.get(hourly_key)
        if current_count and int(current_count) >= HOURLY_RESEND_LIMIT:
            ttl = redis_client.ttl(hourly_key)
            return True, max(ttl, 1)
    except Exception as e:
        logger.warning(f"Error checking OTP hourly limit for {masked_phone}: {e}")
    return False, 0


def generate_and_store_otp(phone: str) -> str:
    """
    Generates a cryptographically secure 6-digit numeric OTP and stores it in Redis with 5-min TTL.
    Also tracks 30s resend cooldown, 1-hr rate limit, and resets attempt counter.
    """
    normalized_phone = normalize_phone_number(phone)
    masked_phone = mask_phone_number(normalized_phone)
    
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

        logger.info(f"Generated secure OTP for {masked_phone}")
    except Exception as e:
        logger.error(f"Failed to store OTP in Redis for {masked_phone}: {e}")
        raise RuntimeError("Failed to store OTP in cache")

    return otp_code


def verify_otp_code(phone: str, code: str) -> Tuple[bool, str]:
    """
    Verifies OTP using constant-time comparison (hmac.compare_digest).
    Tracks failed attempts and automatically burns/purges OTP after 5 failed guesses.
    Returns (is_valid, reason_code).
    """
    normalized_phone = normalize_phone_number(phone)
    masked_phone = mask_phone_number(normalized_phone)
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
        logger.error(f"Error verifying OTP in Redis for {masked_phone}: {e}")
        return False, "VERIFICATION_ERROR"


_DOVESOFT_CLIENT: Optional[httpx.AsyncClient] = None

def get_dovesoft_client() -> httpx.AsyncClient:
    global _DOVESOFT_CLIENT
    if _DOVESOFT_CLIENT is None or _DOVESOFT_CLIENT.is_closed:
        _DOVESOFT_CLIENT = httpx.AsyncClient(
            timeout=8.0,
            limits=httpx.Limits(max_keepalive_connections=20, max_connections=50),
        )
    return _DOVESOFT_CLIENT


class SMSDeliveryResult:
    """Encapsulates the result of an SMS delivery attempt with dual unpacking support."""
    def __init__(
        self,
        success: bool,
        message: str,
        status_code: Optional[int] = None,
        response_text: Optional[str] = None
    ):
        self.success = success
        self.message = message
        self.status_code = status_code
        self.response_text = response_text

    def __iter__(self):
        # Backwards-compatibility: allows unpacking as `success, message = await send_dovesoft_sms(...)`
        yield self.success
        yield self.message

    def __repr__(self) -> str:
        return f"SMSDeliveryResult(success={self.success}, status_code={self.status_code}, message={self.message!r})"


def mask_phone_number(phone: str) -> str:
    """Masks phone number for privacy and audit logs (e.g., +91 98765 ****10)."""
    digits = "".join(filter(str.isdigit, phone))
    if len(digits) >= 10:
        return f"+{digits[:-10]} {digits[-10:-6]}****{digits[-2:]}" if len(digits) > 10 else f"{digits[:4]}****{digits[-2:]}"
    return "****"


async def record_sms_delivery_log(
    phone: str,
    status: str,
    status_code: Optional[int] = None,
    response_body: Optional[str] = None,
    error_message: Optional[str] = None,
    attempt_number: int = 1,
    max_attempts: int = 2,
    provider: str = "dovesoft",
) -> None:
    """
    Persists an SMS delivery attempt / failure log to Supabase for auditing and support visibility.
    Executes in a threadpool to ensure non-blocking, asynchronous execution.
    """
    try:
        from utils.supabase_client import get_supabase_admin
        supabase_admin = get_supabase_admin()
        masked = mask_phone_number(phone)
        payload = {
            "phone": phone,
            "phone_masked": masked,
            "provider": provider,
            "status": status,
            "status_code": status_code,
            "response_body": response_body[:1000] if response_body else None,
            "error_message": error_message[:1000] if error_message else None,
            "attempt_number": attempt_number,
            "max_attempts": max_attempts,
        }
        await asyncio.to_thread(
            lambda: supabase_admin.table("sms_delivery_logs").insert(payload).execute()
        )
    except Exception as exc:
        logger.error(f"[SMS Audit] Failed to record delivery log to Supabase: {exc}")


async def send_dovesoft_sms(phone: str, otp_code: str) -> SMSDeliveryResult:
    """
    Sends OTP via DoveSoft SMS API using connection pooling.
    Returns SMSDeliveryResult supporting both tuple unpacking and attribute access.
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

    try:
        client = get_dovesoft_client()
        response = await client.post(api_url, json=payload, headers=headers)
        logger.info(f"DoveSoft API response status={response.status_code}")
        if response.status_code == 200:
            return SMSDeliveryResult(
                True,
                f"SMS status {response.status_code}: {response.text}",
                response.status_code,
                response.text
            )
        else:
            return SMSDeliveryResult(
                False,
                f"DoveSoft API returned status code {response.status_code}: {response.text}",
                response.status_code,
                response.text
            )
    except Exception as e:
        print(f"[DOVESOFT ERROR] Exception: {e}")
        logger.error(f"Exception sending SMS via DoveSoft: {e}")
        return SMSDeliveryResult(False, str(e), None, None)


async def send_sms_otp_task(
    ctx: Optional[dict],
    phone: str,
    otp_code: str,
    max_attempts: int = 2,
) -> bool:
    """
    ARQ & Background worker task to send SMS OTP via DoveSoft with:
    1. Invalidation Guard: Prevents out-of-order OTP poisoning by checking if Redis still has this exact OTP.
    2. Fast retry (1 retry after 3s) if DoveSoft fails or times out.
    3. Comprehensive audit logging to sms_delivery_logs table for support visibility.
    """
    normalized_phone = normalize_phone_number(phone)
    masked_phone = mask_phone_number(normalized_phone)

    for attempt in range(1, max_attempts + 1):
        # 1. Invalidation Guard: Ensure this OTP is still the active code in Redis
        try:
            current_otp = redis_client.get(f"otp:{normalized_phone}")
            if not current_otp or current_otp != otp_code:
                logger.info(
                    f"[SMS OTP] Aborting attempt {attempt}/{max_attempts} for {masked_phone}: "
                    f"OTP in Redis is no longer active (user requested newer code or already verified)."
                )
                await record_sms_delivery_log(
                    phone=normalized_phone,
                    status="ABORTED",
                    error_message="Superseded: User requested a newer OTP or already verified",
                    attempt_number=attempt,
                    max_attempts=max_attempts,
                )
                return False
        except Exception as redis_err:
            logger.warning(f"[SMS OTP] Redis check error during attempt {attempt}: {redis_err}")

        # 2. Execute DoveSoft send
        res = await send_dovesoft_sms(normalized_phone, otp_code)

        if res.success:
            logger.info(f"[SMS OTP] Successfully delivered OTP on attempt {attempt}/{max_attempts} to {masked_phone}")
            await record_sms_delivery_log(
                phone=normalized_phone,
                status="SUCCESS",
                status_code=res.status_code,
                response_body=res.response_text,
                attempt_number=attempt,
                max_attempts=max_attempts,
            )
            return True

        # 3. Handle attempt failure
        logger.warning(
            f"[SMS OTP] Delivery attempt {attempt}/{max_attempts} failed for {masked_phone}: {res.message}"
        )

        if attempt < max_attempts:
            await record_sms_delivery_log(
                phone=normalized_phone,
                status="RETRYING",
                status_code=res.status_code,
                response_body=res.response_text,
                error_message=res.message,
                attempt_number=attempt,
                max_attempts=max_attempts,
            )
            # Tight delay (3s) to prevent race condition with user resending
            await asyncio.sleep(3)
        else:
            logger.error(f"[SMS OTP] Final failure delivering OTP to {masked_phone} after {max_attempts} attempts.")
            await record_sms_delivery_log(
                phone=normalized_phone,
                status="FAILED",
                status_code=res.status_code,
                response_body=res.response_text,
                error_message=res.message,
                attempt_number=attempt,
                max_attempts=max_attempts,
            )

    return False


async def dispatch_sms_otp(
    phone: str,
    otp_code: str,
    background_tasks: Optional[Any] = None,
) -> None:
    """
    Dispatches SMS OTP asynchronously:
    1. First attempts to enqueue into Redis ARQ queue for distributed durable execution.
    2. If ARQ is unavailable or pool connection fails, seamlessly falls back to FastAPI BackgroundTasks.
    """
    normalized_phone = normalize_phone_number(phone)
    masked_phone = mask_phone_number(normalized_phone)

    try:
        from utils.arq_client import enqueue_job
        job = await enqueue_job("send_sms_otp_task", normalized_phone, otp_code)
        if job:
            logger.info(f"[SMS Dispatch] Enqueued ARQ job {job.job_id} for {masked_phone}")
            return
    except Exception as arq_err:
        logger.warning(f"[SMS Dispatch] ARQ enqueue failed or unavailable ({arq_err}); falling back to background_tasks")

    if background_tasks:
        background_tasks.add_task(send_sms_otp_task, None, normalized_phone, otp_code)
    else:
        asyncio.create_task(send_sms_otp_task(None, normalized_phone, otp_code))

