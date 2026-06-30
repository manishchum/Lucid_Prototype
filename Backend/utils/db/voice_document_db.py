"""
Database helpers for the voice_documents table.
"""
from typing import Any, Dict, List, Optional

from ..auth_bridge import get_service_supabase_client
from .permissions import check_company_access, check_user_permission


async def _resolve_user_company_id(user_id: str) -> Optional[str]:
    try:
        db = get_service_supabase_client()
        resp = (
            db.table("users")
            .select("company_id")
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
        if resp.data and resp.data.get("company_id"):
            return str(resp.data["company_id"])
    except Exception:
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


async def create_voice_document(requesting_user_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        db = get_service_supabase_client()
        user_company_id = payload.get("company_id") or await _resolve_user_company_id(requesting_user_id)
        if not user_company_id:
            return {"data": None, "error": "User company not found"}

        payload["company_id"] = user_company_id
        payload["user_id"] = payload.get("user_id") or requesting_user_id

        if str(payload["user_id"]) != str(requesting_user_id):
            has_permission = await check_user_permission(requesting_user_id, "manager")
            if not has_permission:
                return {"data": None, "error": "Permission denied: Manager role required"}

            if not await check_company_access(requesting_user_id, str(payload["user_id"])):
                return {"data": None, "error": "Access denied: Different company"}

        resp = db.table("voice_documents").insert(payload).execute()
        return {"data": resp.data, "error": None}
    except Exception as exc:
        return {"data": None, "error": str(exc)}


async def get_voice_document_by_id(requesting_user_id: str, voice_document_id: str) -> Dict[str, Any]:
    try:
        db = get_service_supabase_client()
        resp = (
            db.table("voice_documents")
            .select("*")
            .eq("voice_document_id", voice_document_id)
            .maybe_single()
            .execute()
        )
        if not resp.data:
            return {"data": None, "error": "Voice document not found"}

        if not await _can_access_record(requesting_user_id, resp.data):
            return {"data": None, "error": "Permission denied: No access to this voice document"}

        return {"data": resp.data, "error": None}
    except Exception as exc:
        return {"data": None, "error": str(exc)}


async def list_voice_documents(
    requesting_user_id: str,
    user_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
) -> Dict[str, Any]:
    try:
        db = get_service_supabase_client()
        requesting_company_id = await _resolve_user_company_id(requesting_user_id)
        has_manager_access = await check_user_permission(requesting_user_id, "manager")

        query = db.table("voice_documents").select("*")

        if user_id:
            query = query.eq("user_id", user_id)
        elif not has_manager_access:
            query = query.eq("user_id", requesting_user_id)
        elif requesting_company_id:
            query = query.eq("company_id", requesting_company_id)

        if status:
            query = query.eq("status", status)

        resp = query.order("created_at", desc=True).limit(limit).execute()
        rows = resp.data or []

        if not has_manager_access:
            rows = [row for row in rows if str(row.get("user_id")) == str(requesting_user_id)]

        return {"data": rows, "error": None}
    except Exception as exc:
        return {"data": None, "error": str(exc)}


async def update_voice_document(
    requesting_user_id: str,
    voice_document_id: str,
    updates: Dict[str, Any],
) -> Dict[str, Any]:
    try:
        db = get_service_supabase_client()
        existing = await get_voice_document_by_id(requesting_user_id, voice_document_id)
        if existing.get("error"):
            return existing

        updates.pop("voice_document_id", None)
        updates.pop("user_id", None)
        updates.pop("company_id", None)
        updates.pop("created_at", None)

        resp = (
            db.table("voice_documents")
            .update(updates)
            .eq("voice_document_id", voice_document_id)
            .execute()
        )
        return {"data": resp.data, "error": None}
    except Exception as exc:
        return {"data": None, "error": str(exc)}


async def set_voice_document_status(
    requesting_user_id: str,
    voice_document_id: str,
    status: str,
    error_message: Optional[str] = None,
    extra_updates: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {"status": status}
    if error_message is not None:
        payload["processing_error"] = error_message
    if extra_updates:
        payload.update(extra_updates)
    return await update_voice_document(requesting_user_id, voice_document_id, payload)
