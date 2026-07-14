"""
Database helpers for voice_transcripts and voice_daily_reports tables.
"""
from datetime import date
from typing import Any, Dict, List, Optional
from uuid import uuid4

from ..auth_bridge import get_service_supabase_client
from .permissions import check_company_access, check_user_permission
import logging
import traceback

_LOGGER = logging.getLogger("lucid.voice_transcript_db")


def _normalize_user_id(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, (int, float, bool)):
        return str(value)
    text = str(value).strip()
    if not text or text.lower() in {"none", "null", "undefined"}:
        return None
    return text


def _is_active_flag(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "t", "yes", "y", "active", "enabled", "open"}
    return bool(value)


def _row_matches_manager(row: Dict[str, Any], manager_user_id: str) -> bool:
    target_id = _normalize_user_id(manager_user_id)
    row_user_id = _normalize_user_id(row.get("user_id"))
    row_manager_id = _normalize_user_id(row.get("manager_id"))
    return bool(row_user_id) and row_manager_id == target_id


class _SimpleResp:
    def __init__(self, data: Any):
        self.data = data


def _safe_execute(query, single: bool = False):
    try:
        return query.execute()
    except Exception as exc:
        msg = str(exc or "")
        _LOGGER.exception("Supabase execute failed: %s", msg)
        # Handle Postgrest 'Missing response' / 204 No Content by treating as empty result
        if "Missing response" in msg or "204" in msg:
            return _SimpleResp(None if single else [])
        # Re-raise for other exceptions so calling code can handle
        raise


def _get_table(db, table_name: str):
    # Support multiple supabase client versions: prefer .table, fallback to .from_
    try:
        tbl = db.table(table_name)
        if hasattr(tbl, "select"):
            return tbl
    except Exception:
        pass
    try:
        tbl = db.from_(table_name)
        if hasattr(tbl, "select"):
            return tbl
    except Exception:
        pass
    raise RuntimeError(f"Supabase client does not expose a compatible table/from_ API for '{table_name}'")


async def _resolve_user_company_id(user_id: str) -> Optional[str]:
    try:
        db = get_service_supabase_client()
        resp = _safe_execute(_get_table(db, "users").select("company_id").eq("user_id", user_id).maybe_single(), single=True)
        if resp.data and resp.data.get("company_id"):
            return str(resp.data["company_id"])
    except Exception:
        _LOGGER.exception("_resolve_user_company_id failed")
        return None
    return None


async def _can_access_record(requesting_user_id: str, record: Dict[str, Any]) -> bool:
    record_user_id = record.get("user_id")
    if not record_user_id:
        return False

    if str(record_user_id) == str(requesting_user_id):
        return True

    has_permission = await check_user_permission(requesting_user_id, "manager")
    if not has_permission:
        return False

    requesting_company = await _resolve_user_company_id(requesting_user_id)
    record_company = record.get("company_id") or await _resolve_user_company_id(str(record_user_id))
    if not requesting_company or not record_company:
        return False

    return str(requesting_company) == str(record_company)


async def list_team_user_ids(manager_user_id: str) -> Dict[str, Any]:
    """Return a list of `user_id` values for users who report to the given manager.

    Returns: { data: List[str], error: Optional[str] }
    """
    try:
        target_id = _normalize_user_id(manager_user_id)
        if not target_id:
            return {"data": [], "error": None}

        db = get_service_supabase_client()
        resp = _safe_execute(_get_table(db, "users").select("user_id, manager_id, is_active").eq("manager_id", target_id))
        rows = resp.data or []

        if not rows:
            fallback_resp = _safe_execute(_get_table(db, "users").select("user_id, manager_id, is_active").limit(1000))
            all_rows = fallback_resp.data or []
            rows = [row for row in all_rows if _row_matches_manager(row, target_id)]
        else:
            rows = [row for row in rows if _row_matches_manager(row, target_id)]

        user_ids = [_normalize_user_id(row.get("user_id")) for row in rows if _normalize_user_id(row.get("user_id"))]
        return {"data": user_ids, "error": None}
    except Exception as exc:
        _LOGGER.exception("list_team_user_ids failed: %s", exc)
        return {"data": None, "error": str(exc)}


async def fetch_user_profiles(user_ids: List[str]) -> Dict[str, Any]:
    """Fetch basic user profile info for a list of user_ids.

    Returns: { data: List[dict], error: Optional[str] }
    Each dict contains at least `user_id` and `full_name` (if available) or `email`.
    """
    try:
        if not user_ids:
            return {"data": [], "error": None}

        db = get_service_supabase_client()
        query = _get_table(db, "users").select("user_id, name, email")
        # use 'in' where supported
        query = query.in_("user_id", user_ids)
        resp = _safe_execute(query.limit(1000))
        rows = resp.data or []

        profiles = []
        for row in rows:
            uid = row.get("user_id")
            full = row.get("name")
            if not full:
                full = row.get("email") or uid
            profiles.append({"user_id": uid, "full_name": full, "email": row.get("email")})

        return {"data": profiles, "error": None}
    except Exception as exc:
        _LOGGER.exception("fetch_user_profiles failed: %s", exc)
        return {"data": None, "error": str(exc)}


async def list_reports_for_user_ids(
    user_ids: List[str],
    report_date: Optional[str] = None,
    limit: int = 500,
) -> Dict[str, Any]:
    """Fetch daily reports for multiple user IDs, optionally filtered by date.

    Returns: { data: List[dict], error: Optional[str] }
    """
    try:
        if not user_ids:
            return {"data": [], "error": None}

        db = get_service_supabase_client()
        query = _get_table(db, "voice_daily_reports").select("*")

        # Filter by user_ids using the 'in' operator (if available)
        query = query.in_("user_id", user_ids)

        if report_date:
            query = query.eq("report_date", report_date)

        resp = _safe_execute(query.order("created_at", desc=True).limit(limit))
        rows = resp.data or []
        return {"data": rows, "error": None}
    except Exception as exc:
        _LOGGER.exception("list_reports_for_user_ids failed: %s", exc)
        return {"data": None, "error": str(exc)}


async def is_user_a_manager(user_id: str) -> Dict[str, Any]:
    """Check if a user is managing any other users (has direct reports).

    Returns: { data: bool, error: Optional[str] }
    """
    try:
        target_id = _normalize_user_id(user_id)
        if not target_id:
            return {"data": False, "error": None}

        db = get_service_supabase_client()
        resp = _safe_execute(_get_table(db, "users").select("user_id, manager_id, is_active").eq("manager_id", target_id).limit(1))
        rows = resp.data or []

        if not rows:
            fallback_resp = _safe_execute(_get_table(db, "users").select("user_id, manager_id, is_active").limit(1000))
            all_rows = fallback_resp.data or []
            rows = [row for row in all_rows if _row_matches_manager(row, target_id)]

        has_direct_reports = len(rows) > 0
        return {"data": has_direct_reports, "error": None}
    except Exception as exc:
        _LOGGER.exception("is_user_a_manager failed: %s", exc)
        return {"data": False, "error": str(exc)}


async def create_voice_transcript(requesting_user_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        db = get_service_supabase_client()
        user_company_id = payload.get("company_id") or await _resolve_user_company_id(requesting_user_id)
        if not user_company_id:
            return {"data": None, "error": "User company not found"}

        payload["company_id"] = user_company_id
        payload["user_id"] = payload.get("user_id") or requesting_user_id
        payload["transcript_id"] = payload.get("transcript_id") or str(uuid4())
        payload["transcript_date"] = payload.get("transcript_date") or date.today().isoformat()

        if str(payload["user_id"]) != str(requesting_user_id):
            has_permission = await check_user_permission(requesting_user_id, "manager")
            if not has_permission:
                return {"data": None, "error": "Permission denied: Manager role required"}

            if not await check_company_access(requesting_user_id, str(payload["user_id"])):
                return {"data": None, "error": "Access denied: Different company"}

        resp = _safe_execute(_get_table(db, "voice_transcripts").insert(payload))
        return {"data": resp.data, "error": None}
    except Exception as exc:
        _LOGGER.exception("create_voice_transcript failed: %s", exc)
        return {"data": None, "error": str(exc)}


async def get_voice_transcript_by_id(requesting_user_id: str, transcript_id: str) -> Dict[str, Any]:
    try:
        db = get_service_supabase_client()
        resp = _safe_execute(
            _get_table(db, "voice_transcripts").select("*").eq("transcript_id", transcript_id).maybe_single(),
            single=True,
        )
        if not resp.data:
            return {"data": None, "error": "Voice transcript not found"}

        if not await _can_access_record(requesting_user_id, resp.data):
            return {"data": None, "error": "Permission denied: No access to this voice transcript"}

        return {"data": resp.data, "error": None}
    except Exception as exc:
        _LOGGER.exception("get_voice_transcript_by_id failed: %s", exc)
        return {"data": None, "error": str(exc)}


async def list_voice_transcripts(
    requesting_user_id: str,
    user_id: Optional[str] = None,
    transcript_date: Optional[str] = None,
    include_deleted: bool = False,
    limit: int = 100,
) -> Dict[str, Any]:
    try:
        db = get_service_supabase_client()
        requesting_company_id = await _resolve_user_company_id(requesting_user_id)
        has_manager_access = await check_user_permission(requesting_user_id, "manager")

        query = _get_table(db, "voice_transcripts").select("*")

        # Default behavior: return only the requesting user's transcripts.
        # Allow querying another user's transcripts only when an explicit
        # `user_id` is provided and the requesting user has manager permission.
        if user_id:
            # If user asks for someone else's data, enforce manager permission.
            if str(user_id) != str(requesting_user_id) and not has_manager_access:
                return {"data": [], "error": "Permission denied: Manager role required"}
            query = query.eq("user_id", user_id)
        else:
            query = query.eq("user_id", requesting_user_id)

        if transcript_date:
            query = query.eq("transcript_date", transcript_date)

        if not include_deleted:
            query = query.eq("is_deleted", False)

        resp = _safe_execute(query.order("created_at", desc=True).limit(limit))
        rows = resp.data or []

        # Safety: if caller lacks manager access, ensure only own rows are returned
        if not has_manager_access:
            rows = [row for row in rows if str(row.get("user_id")) == str(requesting_user_id)]

        return {"data": rows, "error": None}
    except Exception as exc:
        _LOGGER.exception("list_voice_transcripts failed: %s", exc)
        return {"data": None, "error": str(exc)}


async def update_voice_transcript(
    requesting_user_id: str,
    transcript_id: str,
    updates: Dict[str, Any],
) -> Dict[str, Any]:
    try:
        db = get_service_supabase_client()
        existing = await get_voice_transcript_by_id(requesting_user_id, transcript_id)
        if existing.get("error"):
            return existing

        updates.pop("transcript_id", None)
        updates.pop("user_id", None)
        updates.pop("company_id", None)
        updates.pop("created_at", None)

        resp = _safe_execute(_get_table(db, "voice_transcripts").update(updates).eq("transcript_id", transcript_id))

        return {"data": resp.data, "error": None}
    except Exception as exc:
        _LOGGER.exception("get_voice_daily_report_by_id failed: %s", exc)
        return {"data": None, "error": str(exc)}


async def soft_delete_voice_transcript(requesting_user_id: str, transcript_id: str) -> Dict[str, Any]:
    return await update_voice_transcript(requesting_user_id, transcript_id, {"is_deleted": True})


async def get_voice_daily_report_by_id(requesting_user_id: str, report_id: str) -> Dict[str, Any]:
    try:
        db = get_service_supabase_client()
        resp = _safe_execute(
            _get_table(db, "voice_daily_reports").select("*").eq("report_id", report_id).maybe_single(),
            single=True,
        )
        if not resp.data:
            return {"data": None, "error": "Voice daily report not found"}

        if not await _can_access_record(requesting_user_id, resp.data):
            return {"data": None, "error": "Permission denied: No access to this daily report"}

        return {"data": resp.data, "error": None}
    except Exception as exc:
        _LOGGER.exception("get_voice_daily_report_by_user_date failed: %s", exc)
        return {"data": None, "error": str(exc)}


async def get_voice_daily_report_by_user_date(
    requesting_user_id: str,
    user_id: str,
    report_date: str,
) -> Dict[str, Any]:
    try:
        db = get_service_supabase_client()
        resp = _safe_execute(
            _get_table(db, "voice_daily_reports").select("*").eq("user_id", user_id).eq("report_date", report_date).maybe_single(),
            single=True,
        )
        if not resp.data:
            return {"data": None, "error": "Voice daily report not found"}

        if not await _can_access_record(requesting_user_id, resp.data):
            return {"data": None, "error": "Permission denied: No access to this daily report"}

        return {"data": resp.data, "error": None}
    except Exception as exc:
        _LOGGER.exception("create_voice_daily_report failed: %s", exc)
        return {"data": None, "error": str(exc)}


async def create_voice_daily_report(requesting_user_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        db = get_service_supabase_client()
        user_company_id = payload.get("company_id") or await _resolve_user_company_id(requesting_user_id)
        if not user_company_id:
            return {"data": None, "error": "User company not found"}

        payload["company_id"] = user_company_id
        payload["user_id"] = payload.get("user_id") or requesting_user_id
        payload["report_id"] = payload.get("report_id") or str(uuid4())
        payload["report_date"] = payload.get("report_date") or date.today().isoformat()

        if str(payload["user_id"]) != str(requesting_user_id):
            has_permission = await check_user_permission(requesting_user_id, "manager")
            if not has_permission:
                return {"data": None, "error": "Permission denied: Manager role required"}

            if not await check_company_access(requesting_user_id, str(payload["user_id"])):
                return {"data": None, "error": "Access denied: Different company"}

        resp = _safe_execute(_get_table(db, "voice_daily_reports").insert(payload))
        return {"data": resp.data, "error": None}
    except Exception as exc:
        _LOGGER.exception("create_voice_daily_report failed: %s", exc)
        return {"data": None, "error": str(exc)}


async def update_voice_daily_report(
    requesting_user_id: str,
    report_id: str,
    updates: Dict[str, Any],
) -> Dict[str, Any]:
    try:
        db = get_service_supabase_client()
        existing = await get_voice_daily_report_by_id(requesting_user_id, report_id)
        if existing.get("error"):
            return existing

        updates.pop("report_id", None)
        updates.pop("user_id", None)
        updates.pop("company_id", None)
        updates.pop("created_at", None)

        resp = _safe_execute(_get_table(db, "voice_daily_reports").update(updates).eq("report_id", report_id))
        return {"data": resp.data, "error": None}
    except Exception as exc:
        _LOGGER.exception("update_voice_daily_report failed: %s", exc)
        return {"data": None, "error": str(exc)}


async def list_voice_daily_reports(
    requesting_user_id: str,
    user_id: Optional[str] = None,
    report_date: Optional[str] = None,
    limit: int = 100,
) -> Dict[str, Any]:
    try:
        db = get_service_supabase_client()
        requesting_company_id = await _resolve_user_company_id(requesting_user_id)
        has_manager_access = await check_user_permission(requesting_user_id, "manager")

        query = _get_table(db, "voice_daily_reports").select("*")

        # Default: only return reports belonging to the requesting user.
        # Allow requesting another user's reports only for managers.
        if user_id:
            if str(user_id) != str(requesting_user_id) and not has_manager_access:
                return {"data": [], "error": "Permission denied: Manager role required"}
            query = query.eq("user_id", user_id)
        else:
            query = query.eq("user_id", requesting_user_id)

        if report_date:
            query = query.eq("report_date", report_date)

        resp = _safe_execute(query.order("created_at", desc=True).limit(limit))
        rows = resp.data or []

        # If caller is not a manager, ensure only their own reports are returned
        if not has_manager_access:
            rows = [row for row in rows if str(row.get("user_id")) == str(requesting_user_id)]

        return {"data": rows, "error": None}
    except Exception as exc:
        return {"data": None, "error": str(exc)}
