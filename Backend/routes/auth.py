import asyncio
import json
from typing import Dict

from fastapi import APIRouter, Depends, Header, WebSocket, WebSocketDisconnect

from utils.auth import (
    RequestAuth,
    register_device_session,
    _verify_firebase_token,
    get_request_auth_required,
    _build_request_auth_from_verified_claims,
)

AUTH_SOCKET_REGISTRY: Dict[str, Dict[str, WebSocket]] = {}
AUTH_SOCKET_LOCK = asyncio.Lock()

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


async def _register_auth_socket(user_id: str, device_id: str, websocket: WebSocket) -> None:
    async with AUTH_SOCKET_LOCK:
        device_map = AUTH_SOCKET_REGISTRY.setdefault(user_id, {})
        device_map[device_id] = websocket


async def _unregister_auth_socket(user_id: str, device_id: str, websocket: WebSocket) -> None:
    async with AUTH_SOCKET_LOCK:
        device_map = AUTH_SOCKET_REGISTRY.get(user_id)
        if not device_map:
            return
        current = device_map.get(device_id)
        if current is websocket:
            device_map.pop(device_id, None)
        if not device_map:
            AUTH_SOCKET_REGISTRY.pop(user_id, None)


async def notify_session_replaced(user_id: str, keep_device_id: str) -> None:
    async with AUTH_SOCKET_LOCK:
        device_map = AUTH_SOCKET_REGISTRY.get(user_id, {})
        sockets_to_close = [
            (device_id, socket)
            for device_id, socket in device_map.items()
            if device_id != keep_device_id
        ]

    for device_id, socket in sockets_to_close:
        try:
            await socket.send_json({
                "type": "force_logout",
                "reason": "session_replaced",
            })
        except Exception:
            pass

        try:
            await socket.close(code=4001)
        except Exception:
            pass

        await _unregister_auth_socket(user_id, device_id, socket)


@router.websocket("/ws")
async def auth_socket(websocket: WebSocket):
    token = websocket.query_params.get("token")
    device_id = websocket.query_params.get("device_id")

    if not token or not device_id:
        await websocket.close(code=1008)
        return

    try:
        claims = _verify_firebase_token(token)
        auth_ctx = _build_request_auth_from_verified_claims(claims, None)
    except Exception:
        await websocket.close(code=1008)
        return

    if not auth_ctx.user_id:
        await websocket.close(code=1008)
        return

    await websocket.accept()
    await _register_auth_socket(str(auth_ctx.user_id), str(device_id), websocket)

    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
            if message.get("text"):
                try:
                    payload = json.loads(message["text"])
                except Exception:
                    continue
                if payload.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        await _unregister_auth_socket(str(auth_ctx.user_id), str(device_id), websocket)


@router.post("/session")
async def register_session(
    auth: RequestAuth = Depends(get_request_auth_required),
    x_device_id: str | None = Header(None, alias="X-Device-ID"),
    x_register_session: str | None = Header(None, alias="X-Register-Session"),
):
    if auth.user_id and x_device_id and x_register_session == "true":
        register_device_session(auth.user_id, x_device_id)
        await notify_session_replaced(auth.user_id, x_device_id)

    return {"success": True}
