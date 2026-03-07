import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export type MessageThread = {
  user_id: number;
  name: string;
  role?: string | null;
  store?: string | null;
  last_message?: string | null;
  last_at?: string | null;
  unread_count?: number;
};

type Options = {
  enabled?: boolean;
  pollMs?: number;
  onUnreadIncrease?: (next: number, prev: number) => void;
};

const DEFAULT_POLL_MS = 12000;

export function useMessageThreads(options: Options = {}) {
  const { enabled = true, pollMs = DEFAULT_POLL_MS, onUnreadIncrease } = options;
  const { user } = useAuth();
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const inFlightRef = useRef(false);
  const prevUnreadRef = useRef<number | null>(null);
  const hasLoadedRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!user || !enabled || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await api.get<MessageThread[]>("/messages/threads");
      const nextThreads = res.data || [];
      setThreads(nextThreads);
      if (!hasLoadedRef.current) {
        prevUnreadRef.current = nextThreads.reduce((sum, t) => sum + (t.unread_count || 0), 0);
        hasLoadedRef.current = true;
      }
    } catch {
      // Silent failure: keep last known threads.
    } finally {
      inFlightRef.current = false;
    }
  }, [user?.id, enabled]);

  useEffect(() => {
    if (!user || !enabled) {
      setThreads([]);
      prevUnreadRef.current = null;
      hasLoadedRef.current = false;
      return;
    }
    refresh();
    const id = setInterval(refresh, pollMs);
    return () => clearInterval(id);
  }, [user?.id, enabled, pollMs, refresh]);

  const unreadTotal = useMemo(
    () => threads.reduce((sum, t) => sum + (t.unread_count || 0), 0),
    [threads]
  );

  useEffect(() => {
    if (!onUnreadIncrease) {
      prevUnreadRef.current = unreadTotal;
      return;
    }
    if (!hasLoadedRef.current) return;
    const prev = prevUnreadRef.current;
    if (prev != null && unreadTotal > prev) {
      onUnreadIncrease(unreadTotal, prev);
    }
    prevUnreadRef.current = unreadTotal;
  }, [unreadTotal, onUnreadIncrease]);

  return { threads, unreadTotal, refresh };
}
