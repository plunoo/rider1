import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";

const POLL_MS = 15000;
const AUTO_HIDE_MS = 6000;

type NotificationItem = {
  id: number;
  title: string;
  message: string;
  kind: string;
  link?: string | null;
  is_read: boolean;
  created_at?: string | null;
};

type NotificationsResponse = {
  items: NotificationItem[];
  total: number;
  unread: number;
  limit: number;
  offset: number;
};

export function NotificationToast() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [queue, setQueue] = useState<NotificationItem[]>([]);
  const [active, setActive] = useState<NotificationItem | null>(null);
  const [ready, setReady] = useState(false);
  const [lastSeenId, setLastSeenId] = useState<number>(0);

  const storageKey = useMemo(() => (user?.id ? `notif_toast_last_${user.id}` : ""), [user?.id]);

  useEffect(() => {
    if (!user || !storageKey) return;
    const stored = Number(localStorage.getItem(storageKey) || "0");
    setLastSeenId(Number.isFinite(stored) ? stored : 0);
    setReady(false);
    setQueue([]);
    setActive(null);
  }, [user?.id, storageKey]);

  const load = useCallback(async () => {
    if (!user || !navigator.onLine) return;
    const res = await api.get<NotificationsResponse>("/notifications", { params: { limit: 10 } });
    const items = res.data.items || [];
    if (!ready) {
      const newest = items[0]?.id || 0;
      const baseline = Math.max(lastSeenId || 0, newest);
      setLastSeenId(baseline);
      if (storageKey) localStorage.setItem(storageKey, String(baseline));
      setReady(true);
      return;
    }
    const fresh = items.filter((n) => n.id > (lastSeenId || 0)).sort((a, b) => a.id - b.id);
    if (fresh.length > 0) {
      setQueue((prev) => [...prev, ...fresh]);
      const newest = fresh[fresh.length - 1].id;
      setLastSeenId(newest);
      if (storageKey) localStorage.setItem(storageKey, String(newest));
    }
  }, [user, ready, lastSeenId, storageKey]);

  useEffect(() => {
    if (!user) return;
    load().catch(() => undefined);
    const id = window.setInterval(() => load().catch(() => undefined), POLL_MS);
    return () => window.clearInterval(id);
  }, [user?.id, load]);

  useEffect(() => {
    if (active || queue.length === 0) return;
    const [next, ...rest] = queue;
    setActive(next);
    setQueue(rest);
  }, [queue, active]);

  useEffect(() => {
    if (!active) return;
    const id = window.setTimeout(() => setActive(null), AUTO_HIDE_MS);
    return () => window.clearTimeout(id);
  }, [active]);

  const markRead = async (id: number) => {
    try {
      await api.post(`/notifications/${id}/read`);
    } catch {
      // ignore
    }
  };

  if (!user || !active) return null;

  return (
    <div className="notif-toast">
      <div className="notif-toast-card" role="status" aria-live="polite">
        <div className="notif-toast-title">{active.title}</div>
        <div className="notif-toast-message">{active.message}</div>
        <div className="notif-toast-actions">
          <button
            type="button"
            className="notif-toast-btn"
            onClick={() => setActive(null)}
          >
            Dismiss
          </button>
          {active.link ? (
            <button
              type="button"
              className="notif-toast-btn primary"
              onClick={() => {
                markRead(active.id);
                nav(active.link as string);
                setActive(null);
              }}
            >
              View
            </button>
          ) : (
            <button
              type="button"
              className="notif-toast-btn primary"
              onClick={() => {
                markRead(active.id);
                setActive(null);
              }}
            >
              Mark read
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
