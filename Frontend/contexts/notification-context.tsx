'use client'

import * as React from 'react';
import { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { fetchWithAuth, getFirebaseIdToken } from '@/lib/fetch-with-auth';
import { getDeviceId } from '@/lib/device';
import { useToast } from '@/hooks/use-toast';

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: string;
  metadata?: Record<string, any>;
  read: boolean;
  created_at: string;
}

interface NotificationContextType {
  notifications: NotificationItem[];
  unreadCount: number;
  isLoading: boolean;
  isDrawerOpen: boolean;
  setIsDrawerOpen: (open: boolean) => void;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  connectionStatus: 'connected' | 'connecting' | 'disconnected';
}

const NotificationContext = createContext<NotificationContextType>({
  notifications: [],
  unreadCount: 0,
  isLoading: false,
  isDrawerOpen: false,
  setIsDrawerOpen: () => {},
  markAsRead: async () => {},
  markAllAsRead: async () => {},
  refreshNotifications: async () => {},
  connectionStatus: 'disconnected',
});

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'disconnected'>('disconnected');

  const userId = user?.uid;
  const userRef = useRef(user);
  userRef.current = user;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const inFlightUnreadRef = useRef<Promise<void> | null>(null);
  const inFlightNotificationsRef = useRef<Promise<void> | null>(null);
  const lastFetchedUserIdRef = useRef<string | null>(null);

  const fetchUnreadCount = useCallback(async () => {
    if (!userRef.current?.uid) return;
    if (inFlightUnreadRef.current) return inFlightUnreadRef.current;

    inFlightUnreadRef.current = (async () => {
      try {
        const res = await fetchWithAuth(`${BACKEND_URL}/api/notifications/unread-count`);
        if (res.ok) {
          const data = await res.json();
          if (typeof data.unread_count === 'number') {
            setUnreadCount(data.unread_count);
          }
        }
      } catch (err) {
        console.warn('[NotificationContext] Failed to fetch unread count:', err);
      } finally {
        inFlightUnreadRef.current = null;
      }
    })();

    return inFlightUnreadRef.current;
  }, []);

  const fetchNotifications = useCallback(async () => {
    if (!userRef.current?.uid) return;
    if (inFlightNotificationsRef.current) return inFlightNotificationsRef.current;

    inFlightNotificationsRef.current = (async () => {
      setIsLoading(true);
      try {
        const res = await fetchWithAuth(`${BACKEND_URL}/api/notifications/?limit=40`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.notifications)) {
            setNotifications(data.notifications);
          }
        }
      } catch (err) {
        console.warn('[NotificationContext] Failed to fetch notifications:', err);
      } finally {
        setIsLoading(false);
        inFlightNotificationsRef.current = null;
      }
    })();

    return inFlightNotificationsRef.current;
  }, []);

  const markAsRead = useCallback(async (id: string) => {
    // Optimistic update
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));

    try {
      await fetchWithAuth(`${BACKEND_URL}/api/notifications/${id}/read`, {
        method: 'PUT',
      });
    } catch (err) {
      console.error('[NotificationContext] Failed to mark as read:', err);
      // Re-sync on error
      fetchUnreadCount();
    }
  }, [fetchUnreadCount]);

  const markAllAsRead = useCallback(async () => {
    // Optimistic update
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);

    try {
      await fetchWithAuth(`${BACKEND_URL}/api/notifications/read-all`, {
        method: 'PUT',
      });
    } catch (err) {
      console.error('[NotificationContext] Failed to mark all as read:', err);
      fetchUnreadCount();
      fetchNotifications();
    }
  }, [fetchUnreadCount, fetchNotifications]);

  // Setup WebSocket connection
  const connectWebSocket = useCallback(async () => {
    if (!userRef.current?.uid) return;
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      setConnectionStatus('connecting');
      const token = await getFirebaseIdToken();
      if (!token) {
        setConnectionStatus('disconnected');
        return;
      }

      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      let wsHost = window.location.host;
      if (BACKEND_URL.startsWith('http://') || BACKEND_URL.startsWith('https://')) {
        const parsed = new URL(BACKEND_URL);
        wsHost = parsed.host;
      }

      const wsUrl = `${wsProtocol}//${wsHost}/api/notifications/ws?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnectionStatus('connected');
        reconnectAttemptsRef.current = 0;

        // Start heartbeat ping
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send('ping');
          }
        }, 25000);
      };

      ws.onmessage = (event) => {
        try {
          if (event.data === 'pong') return;
          const raw = JSON.parse(event.data);
          if (raw.type === 'pong') return;

          // Unpack payload: handle both envelope { event: 'new_notification', data: { ... } } and direct payload
          const data = (raw && typeof raw === 'object' && raw.data) ? raw.data : raw;
          if (!data || typeof data !== 'object') return;

          // Intercept internal auth/session displacement messages - do NOT toast or display as notification
          if (
            data.type === 'force_logout' ||
            data.reason === 'session_replaced' ||
            raw.type === 'force_logout' ||
            raw.reason === 'session_replaced'
          ) {
            const currentDeviceId = getDeviceId();
            const targetPlatform = String(data.platform || raw.platform || 'web').toLowerCase();
            const keepDeviceId = data.keep_device_id || raw.keep_device_id || (raw.payload && raw.payload.keep_device_id);

            // Platform check: Web clients only react to web displacement events
            if (targetPlatform !== 'web') {
              return;
            }

            // Kept device immunity: The newly logged-in browser device MUST NEVER logout itself
            if (keepDeviceId && currentDeviceId && keepDeviceId === currentDeviceId) {
              console.log("[NotificationContext] Ignored displacement: this is the newly kept device", { currentDeviceId });
              return;
            }

            // Only displace if keep_device_id is provided and strictly different from this device
            if (keepDeviceId && currentDeviceId && keepDeviceId !== currentDeviceId) {
              console.warn(`[NotificationContext] Displacing old session. Current: ${currentDeviceId}, Kept: ${keepDeviceId}`);
              try {
                ws.close();
              } catch {}
              window.dispatchEvent(
                new CustomEvent('lucid:auth:force-logout', { detail: { reason: 'session_replaced' } })
              );
            }
            return;
          }

          // Received notification payload
          const newNotif: NotificationItem = {
            id: data.id || `ws-${Date.now()}`,
            title: data.title || 'New Notification',
            message: data.message || '',
            type: data.type || 'SYSTEM',
            metadata: data.metadata || {},
            read: false,
            created_at: data.created_at || new Date().toISOString(),
          };

          setNotifications((prev) => {
            if (prev.some((n) => n.id === newNotif.id)) return prev;
            return [newNotif, ...prev];
          });
          setUnreadCount((prev) => prev + 1);

          // Alert user with standard toast
          toast({
            title: newNotif.title,
            description: newNotif.message,
          });
        } catch (e) {
          // Non-JSON or raw text message
        }
      };

      ws.onerror = () => {
        setConnectionStatus('disconnected');
      };

      ws.onclose = () => {
        setConnectionStatus('disconnected');
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);

        // Exponential backoff reconnect
        if (userRef.current?.uid) {
          const attempt = reconnectAttemptsRef.current;
          const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 1000, 30000);
          reconnectAttemptsRef.current += 1;
          reconnectTimeoutRef.current = setTimeout(() => {
            connectWebSocket();
          }, delay);
        }
      };
    } catch (err) {
      console.warn('[NotificationContext] WebSocket init error:', err);
      setConnectionStatus('disconnected');
    }
  }, [toast]);

  // Initial load and WebSocket lifecycle
  useEffect(() => {
    if (userId) {
      if (lastFetchedUserIdRef.current !== userId) {
        lastFetchedUserIdRef.current = userId;
        fetchUnreadCount();
        fetchNotifications();
      }
      connectWebSocket();
    } else {
      lastFetchedUserIdRef.current = null;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      setNotifications([]);
      setUnreadCount(0);
      setConnectionStatus('disconnected');
    }
  }, [userId, fetchUnreadCount, fetchNotifications, connectWebSocket]);

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, []);

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        isLoading,
        isDrawerOpen,
        setIsDrawerOpen,
        markAsRead,
        markAllAsRead,
        refreshNotifications: fetchNotifications,
        connectionStatus,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => useContext(NotificationContext);
