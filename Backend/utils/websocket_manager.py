import asyncio
import json
import logging
import os
import uuid
from typing import Dict, List, Optional
from fastapi import WebSocket
import redis.asyncio as aioredis
from utils.redis_client import redis_client

logger = logging.getLogger("lucid.websocket_manager")
NOTIFICATION_CHANNEL_PREFIX = "notifications:"


class NotificationConnectionManager:
    """
    Distributed WebSocket Connection Manager for Multi-Instance / Cloud Run Deployments:
    - Maintains in-memory active sockets for the local process/container.
    - Bridges instances via Redis Pub/Sub using per-user channels: 'notifications:{user_id}'.
    - When a user connects to this instance, subscribes to 'notifications:{user_id}'.
    - When a user disconnects, unsubscribes from 'notifications:{user_id}'.
    - Ensures notifications pushed from any Cloud Run instance or ARQ worker reach the user
      regardless of which instance holds the active WebSocket connection.
    - Uses sender_instance_id to prevent duplicate delivery when a message is published
      by the same instance that holds the local socket.
    """
    def __init__(self):
        self.instance_id = uuid.uuid4().hex
        self.active_connections: Dict[str, List[WebSocket]] = {}
        self._async_redis: Optional[aioredis.Redis] = None
        self._pubsub: Optional[aioredis.client.PubSub] = None
        self._subscribed_channels: set = set()
        self._listener_task: Optional[asyncio.Task] = None
        self._init_lock = asyncio.Lock()

    def _get_redis_config(self) -> dict:
        return {
            "host": os.getenv("REDIS_HOST", "127.0.0.1"),
            "port": int(os.getenv("REDIS_PORT", 6379)),
            "username": os.getenv("REDIS_USERNAME"),
            "password": os.getenv("REDIS_PASSWORD"),
            "decode_responses": True,
        }

    async def _ensure_listener(self):
        """Initializes the background async Redis Pub/Sub client and loop if not running."""
        if self._listener_task and not self._listener_task.done():
            return

        async with self._init_lock:
            if self._listener_task and not self._listener_task.done():
                return

            try:
                cfg = self._get_redis_config()
                self._async_redis = aioredis.Redis(**cfg)
                self._pubsub = self._async_redis.pubsub()
                # Establish connection by subscribing to an internal control channel
                await self._pubsub.subscribe("notifications:__control__")
                self._subscribed_channels.add("notifications:__control__")

                # Re-subscribe any currently active local user channels
                for uid in list(self.active_connections.keys()):
                    channel = f"{NOTIFICATION_CHANNEL_PREFIX}{uid}"
                    if channel not in self._subscribed_channels:
                        await self._pubsub.subscribe(channel)
                        self._subscribed_channels.add(channel)

                self._listener_task = asyncio.create_task(self._listen_redis_pubsub())
                logger.info(f"[WebSocketManager] Redis Pub/Sub listener initialized (instance: {self.instance_id})")
            except Exception as e:
                logger.warning(f"[WebSocketManager] Failed to initialize Redis Pub/Sub listener: {e}")

    async def _listen_redis_pubsub(self):
        """Async loop consuming messages from Redis Pub/Sub for subscribed user channels."""
        while True:
            try:
                if not self._pubsub:
                    await asyncio.sleep(1.0)
                    continue

                msg = await self._pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if msg and msg.get("type") == "message":
                    channel = msg.get("channel", "")
                    if channel == "notifications:__control__":
                        continue

                    raw_data = msg.get("data")
                    if raw_data:
                        try:
                            payload_obj = json.loads(raw_data)
                            sender_instance = payload_obj.get("sender_instance_id")
                            # If sent by this same instance, local delivery already occurred. Skip to prevent duplicates.
                            if sender_instance == self.instance_id:
                                await asyncio.sleep(0.005)
                                continue

                            target_user_id = payload_obj.get("user_id")
                            if not target_user_id and channel.startswith(NOTIFICATION_CHANNEL_PREFIX):
                                target_user_id = channel[len(NOTIFICATION_CHANNEL_PREFIX):]

                            ws_payload = payload_obj.get("payload", payload_obj)
                            if target_user_id and target_user_id in self.active_connections:
                                await self._deliver_local(target_user_id, ws_payload)
                        except Exception as parse_err:
                            logger.error(f"[WebSocketManager] Error processing pubsub message: {parse_err}")

                await asyncio.sleep(0.01)
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

        await self._ensure_listener()

        # Subscribe to user channel notifications:{user_id}
        channel = f"{NOTIFICATION_CHANNEL_PREFIX}{user_id}"
        if channel not in self._subscribed_channels and self._pubsub:
            try:
                await self._pubsub.subscribe(channel)
                self._subscribed_channels.add(channel)
                logger.info(f"[WebSocketManager] Subscribed to Redis channel '{channel}'")
            except Exception as e:
                logger.warning(f"[WebSocketManager] Failed to subscribe to channel '{channel}': {e}")

        logger.info(f"[WebSocketManager] User {user_id} connected. Active connections on this instance: {len(self.active_connections[user_id])}")

    async def _safe_unsubscribe(self, channel: str):
        if self._pubsub:
            try:
                await self._pubsub.unsubscribe(channel)
            except Exception:
                pass

    def disconnect(self, user_id: str, websocket: WebSocket):
        if user_id in self.active_connections:
            if websocket in self.active_connections[user_id]:
                self.active_connections[user_id].remove(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
                channel = f"{NOTIFICATION_CHANNEL_PREFIX}{user_id}"
                if channel in self._subscribed_channels and self._pubsub:
                    self._subscribed_channels.discard(channel)
                    try:
                        loop = asyncio.get_running_loop()
                        loop.create_task(self._safe_unsubscribe(channel))
                    except RuntimeError:
                        pass
        logger.info(f"[WebSocketManager] User {user_id} disconnected from this instance.")

    async def send_personal_message(self, user_id: str, message: dict):
        """
        Broadcasts message via Redis Pub/Sub on channel notifications:{user_id}.
        Also delivers locally immediately if user has active sockets on this instance.
        """
        # 1. Local delivery if user is connected to this instance
        if user_id in self.active_connections:
            await self._deliver_local(user_id, message)

        # 2. Redis Pub/Sub broadcast on notifications:{user_id} for other instances/containers
        channel = f"{NOTIFICATION_CHANNEL_PREFIX}{user_id}"
        try:
            envelope = json.dumps({
                "sender_instance_id": self.instance_id,
                "user_id": user_id,
                "payload": message,
            })
            if self._async_redis:
                await self._async_redis.publish(channel, envelope)
            else:
                await asyncio.to_thread(redis_client.publish, channel, envelope)
        except Exception as e:
            logger.warning(f"[WebSocketManager] Redis publish failed for channel '{channel}': {e}")

    async def start(self):
        """Pre-warms the Redis Pub/Sub connection on app startup."""
        await self._ensure_listener()

    async def stop(self):
        """Cleans up Redis connections and background tasks on shutdown."""
        if self._listener_task:
            self._listener_task.cancel()
        if self._pubsub:
            try:
                await self._pubsub.aclose()
            except Exception:
                pass
        if self._async_redis:
            try:
                await self._async_redis.aclose()
            except Exception:
                pass


# Global instance
manager = NotificationConnectionManager()
