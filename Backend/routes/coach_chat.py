# Backend/routes/coach_chat.py
"""
API Endpoints for the Performance Coach Intelligence Layer.
Provides dual Text-to-SQL + Vector RAG reasoning with optional Server-Sent Events (SSE) streaming.
"""

import json
import asyncio
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from utils.auth import RequestAuth, get_request_auth_required
from coach.graph import execute_coach_agent
from coach.schema_inspector import get_company_spreadsheet_schema, get_company_document_catalog

router = APIRouter(
    prefix="/api/coach",
    tags=["Performance Coach Intelligence Layer"]
)


class CoachChatRequest(BaseModel):
    query: str
    target_employee_id: Optional[str] = None
    target_employee_name: Optional[str] = None
    stream: bool = False


@router.post("/chat")
async def chat_with_coach(
    payload: CoachChatRequest,
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """
    Main intelligence endpoint: executes LangGraph workflow combining
    Text-to-SQL on spreadsheet data and dense vector RAG on qualitative documents.
    """
    company_id = auth.company_id
    user_id = auth.user_id

    if not company_id:
        raise HTTPException(status_code=400, detail="Authenticated company_id is required.")

    query = payload.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    # 1. Non-streaming JSON response
    if not payload.stream:
        result = execute_coach_agent(
            user_query=query,
            company_id=company_id,
            user_id=user_id,
            target_employee_id=payload.target_employee_id,
            target_employee_name=payload.target_employee_name
        )
        return {
            "success": True,
            "response": result.get("response", ""),
            "intent": result.get("intent", ""),
            "sql_query": result.get("sql_query"),
            "sql_result": result.get("sql_result"),
            "citations": result.get("citations", []),
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
            result = await loop.run_in_executor(
                None,
                execute_coach_agent,
                query,
                company_id,
                user_id,
                payload.target_employee_id,
                payload.target_employee_name
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

            yield f"data: {json.dumps({'type': 'done', 'intent': intent, 'citations_count': len(citations)})}\n\n"

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

    schema = get_company_spreadsheet_schema(company_id)
    catalog = get_company_document_catalog(company_id)

    return {
        "success": True,
        "company_id": company_id,
        "spreadsheet_schema": schema,
        "document_catalog": catalog
    }
