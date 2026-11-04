import asyncio
import json
import logging
import os
import uuid
from typing import Dict, Optional, Set
from fastapi import WebSocket
import redis.asyncio as aioredis
from utils.redis_client import redis_client, redis_ssl

logger = logging.getLogger("lucid.auth_socket_manager")
AUTH_CHANNEL_PREFIX = "auth_session:"


class AuthConnectionManager:
    """
    Distributed Auth WebSocket Connection Manager for Multi-Worker / Multi-Instance Deployments:
    - Thread-safe and async-safe: manages active auth sockets partitioned by user and platform (web vs mobile).
    - Bridges worker processes and Cloud Run instances via Redis Pub/Sub (channel 'auth_session:{user_id}').
    - Displaces superseded sessions across all worker processes when a user logs in from another device/browser
      on the SAME platform (enforcing exactly 1 active web session and 1 active mobile session concurrently).
    - Gracefully delivers force_logout payload and closes displaced connections with code 4001.
    """

    def __init__(self):
        self.instance_id = uuid.uuid4().hex
        # active_sockets[user_id][platform][device_id] = websocket
        self.active_sockets: Dict[str, Dict[str, Dict[str, WebSocket]]] = {}
        self._lock = asyncio.Lock()
        self._async_redis: Optional[aioredis.Redis] = None
        self._pubsub: Optional[aioredis.client.PubSub] = None
        self._subscribed_channels: Set[str] = set()
        self._listener_task: Optional[asyncio.Task] = None
        self._init_lock = asyncio.Lock()

    @staticmethod
    def _normalize_platform(platform: Optional[str]) -> str:
        if platform and str(platform).strip().lower() == "mobile":
            return "mobile"
        return "web"

    def _get_redis_config(self) -> dict:
        raw_host = os.getenv("REDIS_HOST", "127.0.0.1")
        try:
            import socket
            resolved_host = socket.gethostbyname(raw_host)
        except Exception:
            resolved_host = raw_host

        cfg = {
            "host": resolved_host,
            "port": int(os.getenv("REDIS_PORT", 6379)),
            "username": os.getenv("REDIS_USERNAME"),
            "password": os.getenv("REDIS_PASSWORD"),
            "decode_responses": True,
        }
        if redis_ssl:
            cfg["ssl"] = True
            cfg["ssl_cert_reqs"] = None

        return cfg

    async def _ensure_listener(self) -> None:
        """Initializes the background async Redis Pub/Sub client and listener loop if not running."""
        if self._listener_task and not self._listener_task.done():
            return

        async with self._init_lock:
            if self._listener_task and not self._listener_task.done():
                return

            try:
                cfg = self._get_redis_config()
                self._async_redis = aioredis.Redis(**cfg)
                self._pubsub = self._async_redis.pubsub()

                # Control channel to keep listener connection primed
                await self._pubsub.subscribe("auth_session:__control__")
                self._subscribed_channels.add("auth_session:__control__")

                # Resubscribe any active local channels
                async with self._lock:
                    for uid in list(self.active_sockets.keys()):
                        channel = f"{AUTH_CHANNEL_PREFIX}{uid}"
                        if channel not in self._subscribed_channels:
                            await self._pubsub.subscribe(channel)
                            self._subscribed_channels.add(channel)

                self._listener_task = asyncio.create_task(self._listen_redis_pubsub())
                logger.info(f"[AuthSocketManager] Redis Pub/Sub listener initialized (instance: {self.instance_id})")
            except Exception as e:
                logger.warning(f"[AuthSocketManager] Failed to initialize Redis Pub/Sub listener: {e}")

    async def _listen_redis_pubsub(self) -> None:
        """Async loop consuming cross-worker displacement messages from Redis Pub/Sub."""
        while True:
            try:
                if not self._pubsub:
                    await asyncio.sleep(1.0)
                    continue

                msg = await self._pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if msg and msg.get("type") == "message":
                    channel = msg.get("channel", "")
                    if channel == "auth_session:__control__":
                        continue

                    raw_data = msg.get("data")
                    if raw_data:
                        try:
                            envelope = json.loads(raw_data)
                            sender_instance = envelope.get("sender_instance_id")

                            # If published by this same worker process, local displacement already occurred
                            if sender_instance == self.instance_id:
                                await asyncio.sleep(0.005)
                                continue

                            user_id = str(envelope.get("user_id", ""))
                            keep_device_id = str(envelope.get("keep_device_id", ""))
                            platform = str(envelope.get("platform", "web"))

                            if user_id:
                                await self._displace_local_sockets(user_id, keep_device_id, platform)
                        except Exception as parse_err:
                            logger.error(f"[AuthSocketManager] Error processing auth pubsub message: {parse_err}")

                await asyncio.sleep(0.01)
            except asyncio.CancelledError:
                break
            except Exception as loop_err:
                logger.warning(f"[AuthSocketManager] PubSub loop warning: {loop_err}")
                await asyncio.sleep(1.0)

    async def _displace_local_sockets(self, user_id: str, keep_device_id: str, platform: str) -> None:
        """
        Closes local sockets for user_id on the SPECIFIED platform where device_id != keep_device_id.
        Sockets on the other platform are left completely untouched.
        """
        norm_platform = self._normalize_platform(platform)
        sockets_to_close = []

        async with self._lock:
            user_platforms = self.active_sockets.get(user_id, {})
            device_map = user_platforms.get(norm_platform, {})
            for dev_id, ws in list(device_map.items()):
                if dev_id != keep_device_id:
                    sockets_to_close.append((dev_id, ws))

        for dev_id, ws in sockets_to_close:
            try:
                await ws.send_json({
                    "type": "force_logout",
                    "reason": "session_replaced",
                    "platform": norm_platform,
                    "keep_device_id": keep_device_id,
                })
            except Exception:
                pass

            try:
                await ws.close(code=4001)
            except Exception:
                pass

            await self.unregister(user_id, dev_id, ws, platform=norm_platform)

        try:
            from utils.auth import invalidate_device_session_l1
            invalidate_device_session_l1(user_id, platform=norm_platform)
        except Exception:
            pass

        if sockets_to_close:
            logger.info(
                f"[AuthSocketManager] Displaced {len(sockets_to_close)} {norm_platform} socket(s) for user {user_id} "
                f"(kept device: {keep_device_id})"
            )

    async def register(self, user_id: str, device_id: str, websocket: WebSocket, platform: str = "web") -> None:
        """Registers an incoming auth WebSocket connection partitioned by user and platform."""
        norm_platform = self._normalize_platform(platform)
        async with self._lock:
            user_platforms = self.active_sockets.setdefault(user_id, {})
            device_map = user_platforms.setdefault(norm_platform, {})
            device_map[device_id] = websocket

        await self._ensure_listener()

        channel = f"{AUTH_CHANNEL_PREFIX}{user_id}"
        if self._pubsub and channel not in self._subscribed_channels:
            try:
                await self._pubsub.subscribe(channel)
                self._subscribed_channels.add(channel)
                logger.info(f"[AuthSocketManager] Subscribed to Redis channel '{channel}'")
            except Exception as e:
                logger.warning(f"[AuthSocketManager] Failed to subscribe to '{channel}': {e}")

    async def _safe_unsubscribe(self, channel: str) -> None:
        if self._pubsub:
            try:
                await self._pubsub.unsubscribe(channel)
            except Exception:
                pass

    async def unregister(self, user_id: str, device_id: str, websocket: WebSocket, platform: Optional[str] = None) -> None:
        """Unregisters an auth WebSocket connection and unsubscribes from Redis when all sockets for user close."""
        channel_to_unsub = None
        async with self._lock:
            user_platforms = self.active_sockets.get(user_id)
            if user_platforms:
                platforms_to_check = [self._normalize_platform(platform)] if platform else ["web", "mobile"]
                for plat in platforms_to_check:
                    dev_map = user_platforms.get(plat)
                    if dev_map:
                        current = dev_map.get(device_id)
                        if current is websocket:
                            dev_map.pop(device_id, None)
                        if not dev_map:
                            user_platforms.pop(plat, None)

                if not user_platforms:
                    self.active_sockets.pop(user_id, None)
                    channel = f"{AUTH_CHANNEL_PREFIX}{user_id}"
                    if channel in self._subscribed_channels:
                        self._subscribed_channels.discard(channel)
                        channel_to_unsub = channel

        if channel_to_unsub and self._pubsub:
            try:
                await self._safe_unsubscribe(channel_to_unsub)
            except Exception:
                pass

    async def notify_session_replaced(
        self,
        user_id: str,
        keep_device_id: str,
        platform: str = "web"
    ) -> None:
        """
        Broadcasting session displacement for a specific platform:
        1. Closes displaced local sockets on this process for the target platform immediately.
        2. Publishes to Redis channel 'auth_session:{user_id}' across all worker processes / instances.
        3. Forwards to notification manager for dual defense-in-depth redundancy.
        """
        user_id_str = str(user_id)
        keep_device_id_str = str(keep_device_id)
        norm_platform = self._normalize_platform(platform)

        # 1. Displace local sockets on this process for target platform
        await self._displace_local_sockets(user_id_str, keep_device_id_str, norm_platform)

        # 2. Broadcast via Redis Pub/Sub across all worker processes
        channel = f"{AUTH_CHANNEL_PREFIX}{user_id_str}"
        envelope = json.dumps({
            "sender_instance_id": self.instance_id,
            "action": "session_replaced",
            "user_id": user_id_str,
            "keep_device_id": keep_device_id_str,
            "platform": norm_platform,
        })

        try:
            if self._async_redis:
                await self._async_redis.publish(channel, envelope)
            else:
                await asyncio.to_thread(redis_client.publish, channel, envelope)
        except Exception as e:
            logger.warning(f"[AuthSocketManager] Redis publish failed for channel '{channel}': {e}")

        # 3. Dual-delivery fallback via Notification Connection Manager
        try:
            from utils.websocket_manager import manager as ws_manager
            await ws_manager.send_personal_message(user_id_str, {
                "type": "force_logout",
                "reason": "session_replaced",
                "platform": norm_platform,
                "keep_device_id": keep_device_id_str,
            })
        except Exception as ws_err:
            logger.warning(f"[AuthSocketManager] Notification pubsub fallback error: {ws_err}")

    async def stop(self) -> None:
        """Gracefully closes Redis connections and background tasks on shutdown."""
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


# Global singleton instance
auth_socket_manager = AuthConnectionManager()
