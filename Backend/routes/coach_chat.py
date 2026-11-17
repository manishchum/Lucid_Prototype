# Backend/routes/coach_chat.py
"""
API Endpoints for the Performance Coach Intelligence Layer.
Provides dual Text-to-SQL + Vector RAG reasoning with optional Server-Sent Events (SSE) streaming.
"""

import json
import asyncio
import functools
from datetime import datetime
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from utils.auth import RequestAuth, get_request_auth_required
from utils.supabase_client import supabase_admin
from security.rebac import resolve_user_principals
from coach.graph import execute_coach_agent
from coach.schema_inspector import (
    get_company_spreadsheet_schema,
    get_company_document_catalog,
    get_user_coach_profile,
    save_user_coach_profile
)
from coach.conversation_manager import (
    list_user_conversations,
    get_conversation,
    create_conversation,
    append_messages_to_conversation,
    rename_conversation,
    delete_conversation
)

router = APIRouter(
    prefix="/api/coach",
    tags=["Performance Coach Intelligence Layer"]
)


def _audit_coach_query(
    company_id: str,
    auth: RequestAuth,
    action: str,
    details: Dict[str, Any],
    status: str = "SUCCESS",
) -> None:
    try:
        supabase_admin.table("audit_logs").insert({
            "company_id": str(company_id),
            "actor_id": str(auth.user_id) if auth.user_id else None,
            "actor_email": auth.email,
            "action": action,
            "action_category": "COACH_RBAC",
            "target_type": "coach_query",
            "details": details,
            "status": status,
        }).execute()
    except Exception as e:
        print(f"[COACH AUDIT] Note: {e}")


class CoachChatRequest(BaseModel):
    query: str
    target_employee_id: Optional[str] = None
    target_employee_name: Optional[str] = None
    conversation_id: Optional[str] = None
    stream: bool = False


def _resolve_user_name(user_id: Optional[str], auth: RequestAuth, explicit_name: Optional[str] = None) -> str:
    """
    Resolves the authenticated employee's display name using DB lookup, Firebase claims, or email fallback.
    Ensures first-person queries ('my performance', 'how am I doing') correctly bind to the user's name.
    """
    if explicit_name and explicit_name.strip():
        return explicit_name.strip()

    if user_id:
        try:
            res = supabase_admin.table("users").select("name").eq("user_id", user_id).limit(1).execute()
            data = getattr(res, "data", None) or []
            if data and data[0].get("name"):
                return str(data[0]["name"]).strip()
        except Exception as e:
            print(f"[COACH USER RESOLUTION] Error fetching user name: {e}")

    if auth.claims and isinstance(auth.claims, dict):
        claim_name = auth.claims.get("name") or auth.claims.get("displayName")
        if claim_name:
            return str(claim_name).strip()

    if auth.email:
        return auth.email.split("@")[0].replace(".", " ").title()

    return ""


@router.post("/chat")
async def chat_with_coach(
    payload: CoachChatRequest,
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """
    Main intelligence endpoint: executes LangGraph workflow combining
    Text-to-SQL on spreadsheet data and dense vector RAG on qualitative documents.
    Automatically persists conversation history to public.coach_conversations.
    """
    company_id = auth.company_id
    user_id = auth.user_id

    if not company_id:
        raise HTTPException(status_code=400, detail="Authenticated company_id is required.")

    query = payload.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    security_ctx = await resolve_user_principals(user_id, company_id)
    if not security_ctx.is_active:
        raise HTTPException(status_code=403, detail="Access denied: inactive user cannot query Performance Coach.")

    # Normalize self-targeting requests (including callers passing their own Firebase UID
    # instead of Supabase UUID). Leaving effective_target_employee_id as None for self
    # ensures Zanzibar Pre-Retrieval ACL can return team/org/connector docs too.
    effective_target_employee_id = payload.target_employee_id
    if effective_target_employee_id:
        raw_target = str(effective_target_employee_id).strip()
        caller_claim_ids = {
            str(auth.claims.get(k)).strip()
            for k in ("uid", "user_id", "sub")
            if isinstance(auth.claims, dict) and auth.claims.get(k)
        }
        if raw_target == str(user_id) or raw_target in caller_claim_ids:
            effective_target_employee_id = None

    if effective_target_employee_id and not security_ctx.can_query_employee(effective_target_employee_id):
        _audit_coach_query(
            company_id=company_id,
            auth=auth,
            action="COACH_CROSS_USER_QUERY_BLOCKED",
            details={
                "target_employee_id": effective_target_employee_id,
                "caller_role_level": security_ctx.role_level,
            },
            status="FAILED",
        )
        raise HTTPException(
            status_code=403,
            detail="Permission denied: You are not authorized to query this employee's performance data.",
        )

    sec_dict = security_ctx.to_cache_dict()
    # Automatically resolve the authenticated user's name so "my performance" binds to them
    resolved_employee_name = _resolve_user_name(user_id, auth, payload.target_employee_name)

    # Ensure conversation thread exists for history
    conv_id = payload.conversation_id
    if conv_id:
        existing_conv = get_conversation(conv_id, user_id=user_id, company_id=company_id)
        if not existing_conv:
            new_conv = create_conversation(user_id=user_id, company_id=company_id, title=query[:45])
            conv_id = str(new_conv.get("id"))
    else:
        new_conv = create_conversation(user_id=user_id, company_id=company_id, title=query[:45])
        conv_id = str(new_conv.get("id"))

    # 1. Non-streaming JSON response
    if not payload.stream:
        result = execute_coach_agent(
            user_query=query,
            company_id=company_id,
            user_id=user_id,
            target_employee_id=effective_target_employee_id,
            target_employee_name=payload.target_employee_name,
            security_ctx=sec_dict,
        )
        _audit_coach_query(
            company_id=company_id,
            auth=auth,
            action="COACH_QUERY_EXECUTED",
            details={
                "intent": result.get("intent"),
                "role_level": security_ctx.role_level,
                "target_employee_id": effective_target_employee_id,
                "target_employee_name": resolved_employee_name,
                "citations_count": len(result.get("citations") or []),
            },
        )
        response_text = result.get("response", "")
        citations = result.get("citations", [])

        if conv_id:
            append_messages_to_conversation(
                conversation_id=conv_id,
                user_id=user_id,
                company_id=company_id,
                new_messages=[
                    {"role": "user", "content": query, "timestamp": datetime.utcnow().isoformat()},
                    {"role": "assistant", "content": response_text, "citations": citations, "timestamp": datetime.utcnow().isoformat()}
                ],
                auto_title_from_query=query
            )

        return {
            "success": True,
            "conversation_id": conv_id,
            "target_employee_name": resolved_employee_name,
            "response": response_text,
            "intent": result.get("intent", ""),
            "sql_query": result.get("sql_query"),
            "sql_result": result.get("sql_result"),
            "citations": citations,
            "error": result.get("error")
        }

    # 2. Server-Sent Events (SSE) Streaming
    async def sse_event_stream():
        try:
            yield f"data: {json.dumps({'type': 'step', 'step': 'introspecting', 'detail': 'Inspecting company schema and document catalog...'})}\n\n"
            await asyncio.sleep(0.05)

            yield f"data: {json.dumps({'type': 'step', 'step': 'routing', 'detail': 'Classifying intent and planning retrieval...'})}\n\n"
            await asyncio.sleep(0.05)

            # Execute agent workflow in thread to avoid blocking the event loop
            loop = asyncio.get_event_loop()
            runner = functools.partial(
                execute_coach_agent,
                user_query=query,
                company_id=company_id,
                user_id=user_id,
                target_employee_id=effective_target_employee_id,
                target_employee_name=payload.target_employee_name,
                security_ctx=sec_dict,
            )
            result = await loop.run_in_executor(None, runner)
            _audit_coach_query(
                company_id=company_id,
                auth=auth,
                action="COACH_QUERY_EXECUTED",
                details={
                    "intent": result.get("intent"),
                    "role_level": security_ctx.role_level,
                    "target_employee_id": effective_target_employee_id,
                    "target_employee_name": resolved_employee_name,
                    "citations_count": len(result.get("citations") or []),
                    "stream": True,
                },
            )
            intent = result.get("intent")
            sql_query = result.get("sql_query")
            sql_result = result.get("sql_result")
            citations = result.get("citations", [])
            response_text = result.get("response", "")

            # Emit SQL step if executed
            if sql_query:
                yield f"data: {json.dumps({'type': 'step', 'step': 'sql', 'query': sql_query, 'row_count': len(sql_result or [])})}\n\n"
                await asyncio.sleep(0.05)

            # Emit citations if available
            if citations:
                yield f"data: {json.dumps({'type': 'citations', 'citations': citations})}\n\n"
                await asyncio.sleep(0.05)

            # Stream words
            chunk_size = 4
            words = response_text.split(" ")
            for i in range(0, len(words), chunk_size):
                token_chunk = " ".join(words[i:i + chunk_size]) + " "
                yield f"data: {json.dumps({'type': 'token', 'content': token_chunk})}\n\n"
                await asyncio.sleep(0.03)

            # Persist to database thread
            if conv_id:
                append_messages_to_conversation(
                    conversation_id=conv_id,
                    user_id=user_id,
                    company_id=company_id,
                    new_messages=[
                        {"role": "user", "content": query, "timestamp": datetime.utcnow().isoformat()},
                        {"role": "assistant", "content": response_text, "citations": citations, "timestamp": datetime.utcnow().isoformat()}
                    ],
                    auto_title_from_query=query
                )

            yield f"data: {json.dumps({'type': 'done', 'intent': intent, 'conversation_id': conv_id, 'citations_count': len(citations)})}\n\n"

        except Exception as e:
            print(f"[COACH CHAT SSE] Stream error: {e}")
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        sse_event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@router.get("/schema")
async def get_coach_schema_catalog(
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """
    Returns current spreadsheet sheet columns and uploaded document catalog
    for developer/admin inspection and prompt preview.
    """
    company_id = auth.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Company context required.")

    security_ctx = await resolve_user_principals(auth.user_id, company_id)
    if not security_ctx.is_active:
        raise HTTPException(status_code=403, detail="Access denied: inactive user.")

    sec_dict = security_ctx.to_cache_dict()
    schema = get_company_spreadsheet_schema(company_id, security_ctx=sec_dict)
    catalog = get_company_document_catalog(company_id, security_ctx=sec_dict)

    return {
        "success": True,
        "company_id": company_id,
        "role_level": security_ctx.role_level,
        "spreadsheet_schema": schema,
        "document_catalog": catalog
    }


class CoachProfilePayload(BaseModel):
    role_title: Optional[str] = ""
    stakeholders: Optional[List[str]] = []
    time_distribution: Optional[Dict[str, Any]] = {}
    three_year_vision: Optional[str] = ""
    current_weight: Optional[str] = ""
    coaching_tone: Optional[str] = "tactical_direct"
    summary_bio: Optional[str] = ""
    skipped_onboarding: Optional[bool] = False

    class Config:
        extra = "allow"


@router.get("/profile")
async def get_coach_profile(
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """Fetches personalized coaching profile for the authenticated user."""
    company_id = auth.company_id
    user_id = auth.user_id
    if not user_id or not company_id:
        raise HTTPException(status_code=400, detail="Authenticated user context required.")

    profile = get_user_coach_profile(user_id=user_id, company_id=company_id)
    return {
        "success": True,
        "onboarded": profile is not None and bool(profile.get("onboarded")),
        "profile": profile
    }


@router.post("/profile")
async def save_coach_profile(
    payload: CoachProfilePayload,
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """Saves or updates personalized onboarding coaching profile for the authenticated user."""
    company_id = auth.company_id
    user_id = auth.user_id
    if not user_id or not company_id:
        raise HTTPException(status_code=400, detail="Authenticated user context required.")

    saved = save_user_coach_profile(
        user_id=user_id,
        company_id=company_id,
        profile_data=payload.dict()
    )
    return {
        "success": True,
        "message": "Coaching profile updated successfully.",
        "profile": saved
    }


# ============================================================================
# CONVERSATION THREAD HISTORY ENDPOINTS (ChatGPT Style)
# ============================================================================

class CreateConversationPayload(BaseModel):
    title: Optional[str] = "New Chat"


class RenameConversationPayload(BaseModel):
    title: str


@router.get("/conversations")
async def list_conversations(
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """Lists conversation history threads for the authenticated user."""
    company_id = auth.company_id
    user_id = auth.user_id
    if not user_id or not company_id:
        raise HTTPException(status_code=400, detail="Authenticated context required.")

    threads = list_user_conversations(user_id=user_id, company_id=company_id)
    return {"success": True, "conversations": threads}


@router.post("/conversations")
async def create_new_conversation(
    payload: CreateConversationPayload,
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """Explicitly creates a new chat thread."""
    company_id = auth.company_id
    user_id = auth.user_id
    if not user_id or not company_id:
        raise HTTPException(status_code=400, detail="Authenticated context required.")

    new_conv = create_conversation(
        user_id=user_id,
        company_id=company_id,
        title=payload.title or "New Chat"
    )
    return {"success": True, "conversation": new_conv}


@router.get("/conversations/{conversation_id}")
async def get_single_conversation(
    conversation_id: str,
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """Retrieves full message history for a specific conversation thread."""
    company_id = auth.company_id
    user_id = auth.user_id
    if not user_id or not company_id:
        raise HTTPException(status_code=400, detail="Authenticated context required.")

    conv = get_conversation(conversation_id=conversation_id, user_id=user_id, company_id=company_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found.")

    return {"success": True, "conversation": conv}


@router.patch("/conversations/{conversation_id}")
async def rename_thread(
    conversation_id: str,
    payload: RenameConversationPayload,
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """Renames an existing chat thread."""
    company_id = auth.company_id
    user_id = auth.user_id
    if not user_id or not company_id:
        raise HTTPException(status_code=400, detail="Authenticated context required.")

    ok = rename_conversation(
        conversation_id=conversation_id,
        user_id=user_id,
        company_id=company_id,
        new_title=payload.title
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Conversation not found or could not be updated.")

    return {"success": True, "message": "Conversation renamed successfully."}


@router.delete("/conversations/{conversation_id}")
async def delete_thread(
    conversation_id: str,
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """Deletes a conversation thread and all its messages."""
    company_id = auth.company_id
    user_id = auth.user_id
    if not user_id or not company_id:
        raise HTTPException(status_code=400, detail="Authenticated context required.")

    ok = delete_conversation(
        conversation_id=conversation_id,
        user_id=user_id,
        company_id=company_id
    )
    return {"success": ok}
