import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";

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
  unread_filtered?: number;
  limit: number;
  offset: number;
};

const REFRESH_MS = 30000;

function formatWhen(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.valueOf())) return "";
  return d.toLocaleString();
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function NotificationsBell() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [unreadFiltered, setUnreadFiltered] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState<"all" | "approval">("all");
  const [pushSupported, setPushSupported] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission>("default");
  const [pushBusy, setPushBusy] = useState(false);
  const [pushErr, setPushErr] = useState("");
  const panelRef = useRef<HTMLDivElement | null>(null);

  const load = async (nextFilter = filter) => {
    if (!user) return;
    setLoading(true);
    setErr("");
    try {
      const params: Record<string, string | number> = { limit: 20 };
      if (nextFilter === "approval") params.kind = "approval";
      const res = await api.get<NotificationsResponse>("/notifications", { params });
      setItems(res.data.items || []);
      setUnread(res.data.unread || 0);
      setUnreadFiltered(res.data.unread_filtered || 0);
    } catch (e: any) {
      setErr("Failed to load notifications");
    } finally {
      setLoading(false);
    }
  };

  const markAll = async () => {
    try {
      await api.post("/notifications/read-all");
      setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnread(0);
    } catch {
      setErr("Failed to mark all as read");
    }
  };

  const markOne = async (id: number) => {
    try {
      await api.post(`/notifications/${id}/read`);
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
      setUnread((prev) => (prev > 0 ? prev - 1 : 0));
    } catch {
      setErr("Failed to mark notification");
    }
  };

  const refreshPushStatus = async () => {
    const ua = navigator.userAgent || "";
    const ios = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    setIsIos(ios);
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setPushSupported(supported);
    if (!supported) return;
    setPushPermission(Notification.permission);
    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      setPushEnabled(!!sub);
    } catch {
      setPushEnabled(false);
    }
  };

  const enablePush = async () => {
    if (!pushSupported) return;
    setPushBusy(true);
    setPushErr("");
    try {
      const permission = await Notification.requestPermission();
      setPushPermission(permission);
      if (permission !== "granted") {
        setPushBusy(false);
        return;
      }
      const keyRes = await api.get<{ public_key?: string | null; enabled?: boolean }>("/push/public-key");
      const publicKey = keyRes.data?.public_key;
      if (!publicKey) {
        throw new Error("Push keys are not configured on the server.");
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const payload = subscription.toJSON ? subscription.toJSON() : subscription;
      await api.post("/push/subscribe", { subscription: payload, device: navigator.platform });
      setPushEnabled(true);
    } catch (e: any) {
      setPushErr(e?.message || "Failed to enable notifications");
    } finally {
      setPushBusy(false);
    }
  };

  const disablePush = async () => {
    if (!pushSupported) return;
    setPushBusy(true);
    setPushErr("");
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await api.post("/push/unsubscribe", { endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      setPushEnabled(false);
    } catch (e: any) {
      setPushErr(e?.message || "Failed to disable notifications");
    } finally {
      setPushBusy(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    load();
    const id = setInterval(() => load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    refreshPushStatus();
  }, [user?.id]);

  useEffect(() => {
    if (!open) return;
    refreshPushStatus();
    const onClick = (event: MouseEvent) => {
      const node = panelRef.current;
      if (!node) return;
      if (!node.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;

  const pushStatus = !pushSupported
    ? isIos
      ? "Install to Home Screen to enable on iOS."
      : "Not supported in this browser."
    : pushPermission === "denied"
    ? "Blocked in browser settings."
    : pushEnabled
    ? "Enabled for this device."
    : "Off. Enable to get alerts.";

  return (
    <div className="notif-wrap" ref={panelRef}>
      <button
        type="button"
        className="notif-btn"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) load();
        }}
        aria-label="Notifications"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22ZM19 17H5c-.6 0-1-.4-1-1 0-.4.2-.7.5-.9l1.5-1.2V9a6 6 0 1 1 12 0v3.9l1.5 1.2c.3.2.5.5.5.9 0 .6-.4 1-1 1Z"
            fill="currentColor"
          />
        </svg>
        {unread > 0 && <span className="notif-count">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="notif-panel">
          <div className="notif-header">
            <div>
              <div className="notif-title">Notifications</div>
              <div className="notif-meta">
                {filter === "approval" ? unreadFiltered : unread} unread
              </div>
            </div>
            <button type="button" className="notif-link" onClick={markAll} disabled={unread === 0}>
              Mark all
            </button>
          </div>
          <div className="notif-filters">
            <button
              type="button"
              className={`notif-filter ${filter === "all" ? "active" : ""}`}
              onClick={() => {
                setFilter("all");
                load("all");
              }}
            >
              All
            </button>
            <button
              type="button"
              className={`notif-filter ${filter === "approval" ? "active" : ""}`}
              onClick={() => {
                setFilter("approval");
                load("approval");
              }}
            >
              Approvals
            </button>
          </div>
          <div className="notif-push">
            <div>
              <div className="notif-push-title">Device notifications</div>
              <div className="notif-push-meta">{pushStatus}</div>
            </div>
            {pushSupported && pushPermission !== "denied" ? (
              <button
                type="button"
                className="notif-link"
                onClick={pushEnabled ? disablePush : enablePush}
                disabled={pushBusy}
              >
                {pushEnabled ? "Disable" : "Enable"}
              </button>
            ) : null}
          </div>
          {pushErr && <div className="notif-error">{pushErr}</div>}
          {err && <div className="notif-error">{err}</div>}
          {loading ? (
            <div className="notif-empty">Loading...</div>
          ) : items.length === 0 ? (
            <div className="notif-empty">No notifications yet.</div>
          ) : (
            <div className="notif-list">
              {items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={`notif-item ${n.is_read ? "" : "unread"}`}
                  onClick={() => {
                    if (!n.is_read) markOne(n.id);
                    if (n.link) nav(n.link);
                    setOpen(false);
                  }}
                >
                  <div className="notif-row">
                    <span className={`notif-dot ${n.is_read ? "" : "active"}`} aria-hidden="true" />
                    <div>
                      <div className="notif-item-title">{n.title}</div>
                      <div className="notif-item-message">{n.message}</div>
                      <div className="notif-item-time">{formatWhen(n.created_at)}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
