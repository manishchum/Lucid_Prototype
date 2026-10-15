import asyncio
import json
import logging
from typing import Dict, List, Optional
from fastapi import WebSocket
from utils.redis_client import redis_client

logger = logging.getLogger("lucid.websocket_manager")
NOTIFICATION_CHANNEL = "channel:notifications:broadcast"


import uuid

class NotificationConnectionManager:
    """
    Distributed WebSocket Connection Manager:
    - Maintains in-memory active sockets for the current process.
    - Bridges multi-process / multi-instance workers via Redis Pub/Sub.
    - Ensures notifications sent from ARQ worker or any API process reach the user instantly.
    - Prevents double delivery by ignoring pubsub messages published by this instance.
    """
    def __init__(self):
        self.instance_id = uuid.uuid4().hex
        self.active_connections: Dict[str, List[WebSocket]] = {}
        self._pubsub = None
        self._listener_task: Optional[asyncio.Task] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def _ensure_listener(self):
        """Initializes the background Redis Pub/Sub reader if not already running."""
        try:
            current_loop = asyncio.get_running_loop()
        except RuntimeError:
            current_loop = None

        if current_loop:
            self._loop = current_loop

        if self._listener_task is None or self._listener_task.done():
            if self._loop:
                self._listener_task = self._loop.create_task(self._listen_redis_pubsub())

    async def _listen_redis_pubsub(self):
        """Async loop consuming messages from Redis Pub/Sub."""
        try:
            self._pubsub = redis_client.pubsub()
            self._pubsub.subscribe(NOTIFICATION_CHANNEL)
            logger.info(f"[WebSocketManager] Subscribed to Redis channel '{NOTIFICATION_CHANNEL}' (instance: {self.instance_id})")
        except Exception as e:
            logger.warning(f"[WebSocketManager] Could not subscribe to Redis Pub/Sub: {e}")
            return

        while True:
            try:
                # get_message in a non-blocking asyncio manner
                msg = await asyncio.to_thread(self._pubsub.get_message, ignore_subscribe_messages=True, timeout=1.0)
                if msg and msg.get("type") == "message":
                    raw_data = msg.get("data")
                    if raw_data:
                        try:
                            payload_obj = json.loads(raw_data)
                            sender_instance = payload_obj.get("sender_instance_id")
                            # If published by this same instance, local delivery already occurred. Skip to prevent duplicates.
                            if sender_instance == self.instance_id:
                                await asyncio.sleep(0.01)
                                continue

                            target_user_id = payload_obj.get("user_id")
                            ws_payload = payload_obj.get("payload")
                            if target_user_id and target_user_id in self.active_connections:
                                await self._deliver_local(target_user_id, ws_payload)
                        except Exception as parse_err:
                            logger.error(f"[WebSocketManager] Error processing pubsub message: {parse_err}")
                await asyncio.sleep(0.05)
            except asyncio.CancelledError:
                break
            except Exception as loop_err:
                logger.warning(f"[WebSocketManager] PubSub loop warning: {loop_err}")
                await asyncio.sleep(1.0)

    async def _deliver_local(self, user_id: str, message: dict):
        """Delivers payload to all active local WebSocket connections for a user."""
        sockets = list(self.active_connections.get(user_id, []))
        for ws in sockets:
            try:
                await ws.send_json(message)
            except Exception as e:
                logger.info(f"[WebSocketManager] Dead socket for user {user_id}: {e}")
                self.disconnect(user_id, ws)

    async def connect(self, user_id: str, websocket: WebSocket):
        try:
            from starlette.websockets import WebSocketState
            if websocket.client_state != WebSocketState.CONNECTED:
                await websocket.accept()
        except Exception:
            pass

        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        if websocket not in self.active_connections[user_id]:
            self.active_connections[user_id].append(websocket)

        self._ensure_listener()
        logger.info(f"[WebSocketManager] User {user_id} connected. Active connections: {len(self.active_connections[user_id])}")

    def disconnect(self, user_id: str, websocket: WebSocket):
        if user_id in self.active_connections:
            if websocket in self.active_connections[user_id]:
                self.active_connections[user_id].remove(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
        logger.info(f"[WebSocketManager] User {user_id} disconnected.")

    async def send_personal_message(self, user_id: str, message: dict):
        """
        Broadcasts message via Redis Pub/Sub so all server instances deliver it to the user.
        Also delivers locally immediately if connected to this instance.
        """
        # 1. Local delivery if present
        if user_id in self.active_connections:
            await self._deliver_local(user_id, message)

        # 2. Redis Pub/Sub broadcast for other workers/instances
        try:
            envelope = json.dumps({
                "sender_instance_id": self.instance_id,
                "user_id": user_id,
                "payload": message
            })
            await asyncio.to_thread(redis_client.publish, NOTIFICATION_CHANNEL, envelope)
        except Exception as e:
            logger.warning(f"[WebSocketManager] Redis publish failed for user {user_id}: {e}")


# Global instance
manager = NotificationConnectionManager()
