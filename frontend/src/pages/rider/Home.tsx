import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { api } from "../../api/client";
import { getApiErrorMessage } from "../../api/errors";
import { useI18n } from "../../i18n/I18nContext";

type RiderStatus = "available" | "delivery" | "break" | "offline";

type QueueEntry = {
  rider_id: number;
  name: string;
  updated_at?: string | null;
};

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

type QueueCache = {
  status: RiderStatus;
  queue: QueueEntry[];
  position: number | null;
  breaksUsed?: number;
  breaksLimit?: number;
  breaksRemaining?: number;
  syncedAt: string;
};

type NotifCache = {
  items: NotificationItem[];
  unread: number;
  syncedAt: string;
};

type AttendanceCache = {
  date?: string;
  status?: string | null;
  note?: string | null;
  last_marked_at?: string | null;
  next_available_at?: string | null;
  can_edit?: boolean;
  syncedAt?: string;
};

type PendingLocation = {
  lat: number;
  lng: number;
  accuracy_m?: number | null;
  speed_mps?: number | null;
  ts: string;
};

const NOTIF_REFRESH_MS = 30000;
const QUEUE_CACHE_KEY = "rider_queue_cache_v1";
const NOTIF_CACHE_KEY = "rider_notif_cache_v1";
const ATTENDANCE_CACHE_KEY = "rider_attendance_today_v1";
const LOCATION_QUEUE_KEY = "rider_location_queue_v1";
const MAX_LOCATION_QUEUE = 50;
const MAX_LOCATION_AGE_MS = 60 * 60 * 1000;
const TRACKING_RETRY_BASE_MS = 5000;
const TRACKING_RETRY_MAX_MS = 60000;
const TIPS_KEY = "rider_tips_dismissed_v1";
const STALE_QUEUE_MINUTES = 5;
const WHATSAPP_NUMBER_KEY = "rider_whatsapp_number_v1";

const statusLabel = (s: RiderStatus) =>
  s === "delivery" ? "On delivery" : s === "break" ? "On break" : s === "available" ? "Available" : "Offline";

const statusColor = (s: RiderStatus) => {
  if (s === "delivery") return "#f97316";
  if (s === "break") return "#64748b";
  if (s === "available") return "#16a34a";
  return "#94a3b8";
};

const normalizeStatus = (value?: string): RiderStatus => {
  if (value === "available" || value === "delivery" || value === "break") return value;
  if (value === "offline") return value;
  return "offline";
};

const formatAgo = (value?: string | null) => {
  if (!value) return "";
  const ts = new Date(value).getTime();
  if (Number.isNaN(ts)) return "";
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins <= 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
};

const formatWhen = (value?: string | null) => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.valueOf())) return "";
  return d.toLocaleString();
};

const normalizeWhatsAppNumber = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let cleaned = trimmed.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("00")) cleaned = cleaned.slice(2);
  if (cleaned.startsWith("+")) cleaned = cleaned.slice(1);
  cleaned = cleaned.replace(/\D/g, "");
  if (cleaned.length < 8 || cleaned.length > 15) return null;
  return cleaned;
};

const buildWhatsAppUrl = (number: string, message?: string) => {
  const base = `https://wa.me/${number}`;
  const trimmed = message?.trim();
  if (!trimmed) return base;
  return `${base}?text=${encodeURIComponent(trimmed)}`;
};

export default function Home() {
  const { t } = useI18n();
  const { user } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const displayName = user?.name || "Rider";
  const rawSelfId = user?.id ? Number(user.id) : NaN;
  const selfId = Number.isFinite(rawSelfId) ? rawSelfId : null;

  const [status, setStatus] = useState<RiderStatus>("offline");
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [position, setPosition] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastQueueUpdate, setLastQueueUpdate] = useState<Date | null>(null);
  const [breaksUsed, setBreaksUsed] = useState(0);
  const [breaksLimit, setBreaksLimit] = useState(0);
  const [breaksRemaining, setBreaksRemaining] = useState(0);
  const [attendanceStatus, setAttendanceStatus] = useState<string | null>(null);
  const [attendanceNote, setAttendanceNote] = useState<string | null>(null);
  const [attendanceLastMarked, setAttendanceLastMarked] = useState<string | null>(null);
  const [attendanceSyncedAt, setAttendanceSyncedAt] = useState<string | null>(null);
  const [attendanceLoading, setAttendanceLoading] = useState(false);

  const [trackingEnabled, setTrackingEnabled] = useState(true);
  const [trackingStatus, setTrackingStatus] = useState<string | null>(null);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const [lastSentAt, setLastSentAt] = useState<Date | null>(null);
  const [lastCoords, setLastCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [lastAccuracy, setLastAccuracy] = useState<number | null>(null);
  const [sharingNow, setSharingNow] = useState(false);
  const watchIdRef = useRef<number | null>(null);
  const lastSentRef = useRef<number>(0);
  const [pendingLocationCount, setPendingLocationCount] = useState(0);
  const locationQueueRef = useRef<PendingLocation[]>([]);
  const flushInProgressRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);

  const [notifItems, setNotifItems] = useState<NotificationItem[]>([]);
  const [notifUnread, setNotifUnread] = useState(0);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifErr, setNotifErr] = useState("");

  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showTips, setShowTips] = useState(() => localStorage.getItem(TIPS_KEY) !== "1");
  const [whatsAppNumber, setWhatsAppNumber] = useState(() => localStorage.getItem(WHATSAPP_NUMBER_KEY) || "");
  const [whatsAppMessage, setWhatsAppMessage] = useState("");
  const [whatsAppError, setWhatsAppError] = useState<string | null>(null);

  useEffect(() => {
    if (location.hash !== "#whatsapp") return;
    const target = document.getElementById("rider-whatsapp");
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [location.hash]);

  const queueSize = queue.length;
  const inQueue = status === "available" && position !== null;
  const shouldTrack = trackingEnabled && status !== "offline";
  const queueAgeMinutes = useMemo(() => {
    if (!lastQueueUpdate) return null;
    const mins = Math.round((Date.now() - lastQueueUpdate.getTime()) / 60000);
    return Math.max(0, mins);
  }, [lastQueueUpdate]);
  const queueAgeLabel = queueAgeMinutes == null ? "Not synced yet" : queueAgeMinutes <= 1 ? "just now" : `${queueAgeMinutes}m ago`;
  const queueStale = queueAgeMinutes != null && queueAgeMinutes >= STALE_QUEUE_MINUTES;
  const queueSyncLabel = !isOnline ? "Offline" : queueStale ? "Stale" : "Live";

  const attendanceLabel =
    attendanceStatus === "present"
      ? "Present"
      : attendanceStatus === "late"
      ? "Late"
      : attendanceStatus === "absent"
      ? "Absent"
      : attendanceStatus === "off_day"
      ? "Off day"
      : "Not checked in";
  const attendanceMeta = attendanceLastMarked
    ? `Last check-in ${formatAgo(attendanceLastMarked)}`
    : attendanceLoading
    ? "Syncing attendance..."
    : attendanceSyncedAt
    ? `Synced ${formatAgo(attendanceSyncedAt)}`
    : "No check-in yet";

  const applyQueueCache = (cache: QueueCache) => {
    setStatus(cache.status || "offline");
    setQueue(cache.queue || []);
    setPosition(typeof cache.position === "number" ? cache.position : null);
    setBreaksUsed(typeof cache.breaksUsed === "number" ? cache.breaksUsed : 0);
    setBreaksLimit(typeof cache.breaksLimit === "number" ? cache.breaksLimit : 0);
    setBreaksRemaining(typeof cache.breaksRemaining === "number" ? cache.breaksRemaining : 0);
    if (cache.syncedAt) setLastQueueUpdate(new Date(cache.syncedAt));
  };

  const applyNotifCache = (cache: NotifCache) => {
    setNotifItems(cache.items || []);
    setNotifUnread(cache.unread || 0);
  };

  const applyAttendanceCache = (cache: AttendanceCache) => {
    setAttendanceStatus(cache.status ?? null);
    setAttendanceNote(cache.note ?? null);
    setAttendanceLastMarked(cache.last_marked_at ?? null);
    setAttendanceSyncedAt(cache.syncedAt ?? null);
  };

  const persistLocationQueue = useCallback((items: PendingLocation[]) => {
    locationQueueRef.current = items;
    setPendingLocationCount(items.length);
    localStorage.setItem(LOCATION_QUEUE_KEY, JSON.stringify(items));
  }, []);

  const loadLocationQueue = useCallback(() => {
    const raw = localStorage.getItem(LOCATION_QUEUE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as PendingLocation[];
      const cleaned = parsed.filter((item) => {
        const ts = new Date(item.ts).getTime();
        return !Number.isNaN(ts) && Date.now() - ts <= MAX_LOCATION_AGE_MS;
      });
      persistLocationQueue(cleaned.slice(-MAX_LOCATION_QUEUE));
    } catch {
      // ignore cache errors
    }
  }, [persistLocationQueue]);

  const enqueueLocation = useCallback(
    (payload: PendingLocation) => {
      const now = Date.now();
      const cleaned = locationQueueRef.current.filter((item) => {
        const ts = new Date(item.ts).getTime();
        return !Number.isNaN(ts) && now - ts <= MAX_LOCATION_AGE_MS;
      });
      const next = [...cleaned, payload].slice(-MAX_LOCATION_QUEUE);
      persistLocationQueue(next);
    },
    [persistLocationQueue]
  );

  const flushLocationQueue = useCallback(async () => {
    if (flushInProgressRef.current || !navigator.onLine) return;
    if (locationQueueRef.current.length === 0) return;
    flushInProgressRef.current = true;
    if (retryTimerRef.current) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    try {
      while (locationQueueRef.current.length > 0) {
        const [item] = locationQueueRef.current;
        const ts = new Date(item.ts).getTime();
        if (Number.isNaN(ts) || Date.now() - ts > MAX_LOCATION_AGE_MS) {
          persistLocationQueue(locationQueueRef.current.slice(1));
          continue;
        }
        const res = await api.post("/tracking/location", null, {
          params: {
            lat: item.lat,
            lng: item.lng,
            accuracy_m: item.accuracy_m ?? undefined,
            speed_mps: item.speed_mps ?? undefined,
          },
        });
        const accepted = res?.data?.accepted !== false;
        persistLocationQueue(locationQueueRef.current.slice(1));
        if (accepted) {
          setTrackingStatus("Location shared");
          setLastSentAt(new Date());
          retryCountRef.current = 0;
        } else if (res?.data?.reason) {
          setTrackingError(res.data.reason);
        }
      }
    } catch {
      const delay = Math.min(TRACKING_RETRY_MAX_MS, TRACKING_RETRY_BASE_MS * Math.pow(2, retryCountRef.current));
      retryCountRef.current += 1;
      retryTimerRef.current = window.setTimeout(() => {
        flushLocationQueue();
      }, delay);
    } finally {
      flushInProgressRef.current = false;
    }
  }, [persistLocationQueue]);

  useEffect(() => {
    const queueRaw = localStorage.getItem(QUEUE_CACHE_KEY);
    if (queueRaw) {
      try {
        applyQueueCache(JSON.parse(queueRaw) as QueueCache);
      } catch {
        // ignore cache errors
      }
    }
    const notifRaw = localStorage.getItem(NOTIF_CACHE_KEY);
    if (notifRaw) {
      try {
        applyNotifCache(JSON.parse(notifRaw) as NotifCache);
      } catch {
        // ignore cache errors
      }
    }
    const attendanceRaw = localStorage.getItem(ATTENDANCE_CACHE_KEY);
    if (attendanceRaw) {
      try {
        applyAttendanceCache(JSON.parse(attendanceRaw) as AttendanceCache);
      } catch {
        // ignore cache errors
      }
    }
    loadLocationQueue();
  }, [loadLocationQueue]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const loadQueue = useCallback(async () => {
    if (!navigator.onLine) {
      setIsOnline(false);
      return;
    }
    setErr(null);
    try {
      const res = await api.get("/rider/queue");
      const data = res.data as {
        status?: string;
        queue?: QueueEntry[];
        position?: number | null;
        breaks_used?: number;
        breaks_limit?: number;
        breaks_remaining?: number;
      };
      const nextStatus = normalizeStatus(data?.status);
      const nextQueue = data?.queue || [];
      const nextPosition = typeof data?.position === "number" ? data.position : null;
      const nextBreaksUsed = typeof data?.breaks_used === "number" ? data.breaks_used : 0;
      const nextBreaksLimit = typeof data?.breaks_limit === "number" ? data.breaks_limit : 0;
      const nextBreaksRemaining =
        typeof data?.breaks_remaining === "number"
          ? data.breaks_remaining
          : Math.max(0, nextBreaksLimit - nextBreaksUsed);
      setStatus(nextStatus);
      setQueue(nextQueue);
      setPosition(nextPosition);
      setBreaksUsed(nextBreaksUsed);
      setBreaksLimit(nextBreaksLimit);
      setBreaksRemaining(nextBreaksRemaining);
      const syncedAt = new Date().toISOString();
      setLastQueueUpdate(new Date(syncedAt));
      const cache: QueueCache = {
        status: nextStatus,
        queue: nextQueue,
        position: nextPosition,
        breaksUsed: nextBreaksUsed,
        breaksLimit: nextBreaksLimit,
        breaksRemaining: nextBreaksRemaining,
        syncedAt,
      };
      localStorage.setItem(QUEUE_CACHE_KEY, JSON.stringify(cache));
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to load queue"));
      const cachedRaw = localStorage.getItem(QUEUE_CACHE_KEY);
      if (cachedRaw) {
        try {
          applyQueueCache(JSON.parse(cachedRaw) as QueueCache);
        } catch {
          // ignore cache errors
        }
      }
    }
  }, []);

  const loadAttendance = useCallback(async () => {
    const cachedRaw = localStorage.getItem(ATTENDANCE_CACHE_KEY);
    if (cachedRaw) {
      try {
        applyAttendanceCache(JSON.parse(cachedRaw) as AttendanceCache);
      } catch {
        // ignore cache errors
      }
    }

    if (!navigator.onLine) {
      setIsOnline(false);
      return;
    }

    setAttendanceLoading(true);
    try {
      const res = await api.get("/attendance/today");
      const payload = (res.data || {}) as AttendanceCache;
      const cache: AttendanceCache = {
        status: payload.status ?? null,
        note: payload.note ?? null,
        date: payload.date,
        last_marked_at: payload.last_marked_at ?? null,
        next_available_at: payload.next_available_at ?? null,
        can_edit: payload.can_edit ?? false,
        syncedAt: new Date().toISOString(),
      };
      applyAttendanceCache(cache);
      localStorage.setItem(ATTENDANCE_CACHE_KEY, JSON.stringify(cache));
    } catch {
      // ignore errors
    } finally {
      setAttendanceLoading(false);
    }
  }, []);

  const loadNotifications = useCallback(async () => {
    if (!navigator.onLine || !user) {
      setIsOnline(navigator.onLine);
      return;
    }
    setNotifLoading(true);
    setNotifErr("");
    try {
      const res = await api.get<NotificationsResponse>("/notifications", { params: { limit: 5 } });
      const nextItems = res.data.items || [];
      const nextUnread = res.data.unread || 0;
      setNotifItems(nextItems);
      setNotifUnread(nextUnread);
      const cache: NotifCache = {
        items: nextItems,
        unread: nextUnread,
        syncedAt: new Date().toISOString(),
      };
      localStorage.setItem(NOTIF_CACHE_KEY, JSON.stringify(cache));
    } catch {
      setNotifErr("Failed to load notifications");
      const cachedRaw = localStorage.getItem(NOTIF_CACHE_KEY);
      if (cachedRaw) {
        try {
          applyNotifCache(JSON.parse(cachedRaw) as NotifCache);
        } catch {
          // ignore cache errors
        }
      }
    } finally {
      setNotifLoading(false);
    }
  }, [user?.id]);

  const markAllNotifications = async () => {
    if (!navigator.onLine) {
      setNotifErr("You are offline.");
      return;
    }
    try {
      await api.post("/notifications/read-all");
      setNotifItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setNotifUnread(0);
    } catch {
      setNotifErr("Failed to mark all notifications");
    }
  };

  const markNotification = async (item: NotificationItem) => {
    if (!navigator.onLine) {
      setNotifErr("You are offline.");
      return;
    }
    if (!item.is_read) {
      try {
        await api.post(`/notifications/${item.id}/read`);
        setNotifItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, is_read: true } : n)));
        setNotifUnread((prev) => (prev > 0 ? prev - 1 : 0));
      } catch {
        setNotifErr("Failed to mark notification");
      }
    }
    if (item.link) nav(item.link);
  };

  useEffect(() => {
    setLoading(true);
    loadQueue().finally(() => setLoading(false));
  }, [loadQueue]);

  useEffect(() => {
    loadAttendance();
  }, [loadAttendance]);

  useEffect(() => {
    const id = setInterval(loadQueue, 10000);
    return () => clearInterval(id);
  }, [loadQueue]);

  useEffect(() => {
    if (!user) return;
    loadNotifications();
    const id = setInterval(loadNotifications, NOTIF_REFRESH_MS);
    return () => clearInterval(id);
  }, [user?.id, loadNotifications]);

  useEffect(() => {
    if (isOnline) {
      loadQueue();
      loadNotifications();
      loadAttendance();
    }
  }, [isOnline, loadQueue, loadNotifications, loadAttendance]);

  useEffect(() => {
    if (isOnline && shouldTrack) {
      flushLocationQueue();
    }
  }, [isOnline, shouldTrack, flushLocationQueue]);

  useEffect(() => {
    if (!shouldTrack) {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      watchIdRef.current = null;
      setTrackingError(null);
      if (!isOnline) {
        setTrackingStatus("Offline. Tracking paused.");
      } else if (!trackingEnabled) {
        setTrackingStatus("Tracking is off.");
      } else if (status === "offline") {
        setTrackingStatus("Go available to start sharing.");
      } else {
        setTrackingStatus("Tracking paused.");
      }
      return;
    }
    if (!navigator.geolocation) {
      setTrackingError("Geolocation is not supported in this browser.");
      return;
    }
    setTrackingError(null);
    setTrackingStatus(isOnline ? "Listening for location..." : "Offline. Queueing updates.");
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setLastCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLastAccuracy(pos.coords.accuracy);
        const now = Date.now();
        if (now - lastSentRef.current < 30000) return;
        lastSentRef.current = now;
        const payload: PendingLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy_m: pos.coords.accuracy,
          speed_mps: pos.coords.speed ?? null,
          ts: new Date().toISOString(),
        };
        if (!navigator.onLine) {
          enqueueLocation(payload);
          setTrackingStatus("Offline. Location queued.");
          return;
        }
        api
          .post("/tracking/location", null, {
            params: {
              lat: payload.lat,
              lng: payload.lng,
              accuracy_m: payload.accuracy_m ?? undefined,
              speed_mps: payload.speed_mps ?? undefined,
            },
          })
          .then((res) => {
            if (res?.data?.accepted === false) {
              if (res?.data?.reason) setTrackingError(res.data.reason);
              return;
            }
            setTrackingStatus("Location shared");
            setLastSentAt(new Date(now));
            flushLocationQueue();
          })
          .catch(() => {
            enqueueLocation(payload);
            setTrackingError("Failed to share location. Saved offline.");
          });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setTrackingError("Location permission denied.");
        } else if (error.code === error.TIMEOUT) {
          setTrackingError("Location request timed out.");
        } else {
          setTrackingError("Unable to fetch location.");
        }
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );
    watchIdRef.current = watchId;
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      watchIdRef.current = null;
    };
  }, [shouldTrack, trackingEnabled, status, isOnline, enqueueLocation, flushLocationQueue]);

  const sendLocationNow = async () => {
    if (!navigator.geolocation) {
      setTrackingError("Geolocation is not supported in this browser.");
      return;
    }
    setSharingNow(true);
    setTrackingError(null);
    setTrackingStatus(navigator.onLine ? "Sharing location..." : "Saving location...");
    try {
      const coords = await new Promise<{ lat: number; lng: number; accuracy?: number }>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (pos) =>
            resolve({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
            }),
          (error) => {
            if (error.code === error.PERMISSION_DENIED) {
              reject(new Error("Location permission denied."));
            } else if (error.code === error.TIMEOUT) {
              reject(new Error("Location request timed out."));
            } else {
              reject(new Error("Unable to fetch location."));
            }
          },
          { enableHighAccuracy: true, timeout: 15000 }
        );
      });
      const payload: PendingLocation = {
        lat: coords.lat,
        lng: coords.lng,
        accuracy_m: coords.accuracy ?? null,
        speed_mps: null,
        ts: new Date().toISOString(),
      };
      if (!navigator.onLine) {
        enqueueLocation(payload);
        setTrackingStatus("Offline. Location queued.");
      } else {
        const res = await api.post("/tracking/location", null, {
          params: {
            lat: payload.lat,
            lng: payload.lng,
            accuracy_m: payload.accuracy_m ?? undefined,
          },
        });
        if (res?.data?.accepted === false) {
          if (res?.data?.reason) setTrackingError(res.data.reason);
        } else {
          setTrackingStatus("Location shared");
          flushLocationQueue();
        }
      }
      setLastCoords({ lat: coords.lat, lng: coords.lng });
      setLastAccuracy(coords.accuracy ?? null);
      setLastSentAt(new Date());
    } catch (e: any) {
      setTrackingError(getApiErrorMessage(e, "Failed to share location"));
    } finally {
      setSharingNow(false);
    }
  };

  const updateStatus = async (next: RiderStatus) => {
    if (!navigator.onLine) {
      setErr("You are offline. Connect to update status.");
      return;
    }
    setErr(null);
    setLoading(true);
    const prev = status;
    setStatus(next);
    if (next !== "available") setPosition(null);
    try {
      if (next === "available") {
        if (!navigator.geolocation) {
          throw new Error("Geolocation is not supported in this browser.");
        }
        const coords = await new Promise<{ lat: number; lng: number; accuracy?: number }>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
            (error) => {
              if (error.code === error.PERMISSION_DENIED) {
                reject(new Error("Location permission denied."));
              } else if (error.code === error.TIMEOUT) {
                reject(new Error("Location request timed out."));
              } else {
                reject(new Error("Unable to fetch location."));
              }
            },
            { enableHighAccuracy: true, timeout: 15000 }
          );
        });
        await api.post("/tracking/location", null, {
          params: {
            lat: coords.lat,
            lng: coords.lng,
            accuracy_m: coords.accuracy,
          },
        });
        setLastCoords({ lat: coords.lat, lng: coords.lng });
        setLastAccuracy(coords.accuracy ?? null);
        setLastSentAt(new Date());
      }
      await api.post("/rider/status", { status: next });
      await loadQueue();
    } catch (e: any) {
      setStatus(prev);
      setErr(getApiErrorMessage(e, "Failed to update status"));
    } finally {
      setLoading(false);
    }
  };

  const breakDetail =
    breaksLimit > 0 ? `Taking a short pause · ${breaksRemaining} left` : "Taking a short pause";
  const statusOptions: { value: RiderStatus; label: string; detail: string }[] = [
    { value: "available", label: "Available", detail: "Ready for assignments" },
    { value: "delivery", label: "On delivery", detail: "Order in progress" },
    { value: "break", label: "On break", detail: breakDetail },
    { value: "offline", label: "Offline", detail: "Not receiving tasks" },
  ];

  const lastQueueText = lastQueueUpdate ? lastQueueUpdate.toLocaleTimeString() : "Not synced yet";

  const queueSorted = useMemo(() => {
    return queue.slice();
  }, [queue]);

  const selfEntry = useMemo(() => {
    if (selfId == null) return null;
    return queueSorted.find((entry) => entry.rider_id === selfId) ?? null;
  }, [queueSorted, selfId]);

  const dismissTips = () => {
    setShowTips(false);
    localStorage.setItem(TIPS_KEY, "1");
  };

  const openWhatsAppChat = () => {
    const normalized = normalizeWhatsAppNumber(whatsAppNumber);
    if (!normalized) {
      setWhatsAppError(t("rider.whatsapp.error.invalid"));
      return;
    }
    setWhatsAppError(null);
    localStorage.setItem(WHATSAPP_NUMBER_KEY, normalized);
    const url = buildWhatsAppUrl(normalized, whatsAppMessage);
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="rider-stack">
      {!isOnline && <div className="rider-banner">You are offline. Showing cached data.</div>}

      <div className="rider-home-hero">
        <section className="rider-card rider-fade">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div className="rider-card-subtitle">Welcome back</div>
              <h2 style={{ margin: "6px 0" }}>{`Hi, ${displayName}`}</h2>
              <div className="rider-muted" style={{ fontSize: 13 }}>
                {`Rider ID: ${user?.id ?? "-"}`} {user?.store ? ` | Store: ${user.store}` : ""}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className="rider-chip" style={{ background: statusColor(status) }}>
                {statusLabel(status)}
              </span>
              <button type="button" className="rider-btn rider-btn-ghost" onClick={() => nav("/rider/check-in")}>
                Check-in
              </button>
            </div>
          </div>
        </section>

        <section className="rider-card rider-fade rider-stagger-1 rider-hero-actions">
          <div className="rider-status-header">
            <div>
              <div className="rider-card-title">Status</div>
              <div className="rider-card-subtitle">Update your availability.</div>
            </div>
            <div className="rider-status-summary">
              <span className="rider-status-badge" data-status={status}>{statusLabel(status)}</span>
              <span className="rider-status-state">{loading ? "Updating..." : "Ready"}</span>
              {breaksLimit > 0 && (
                <span className="rider-status-state">{`Breaks ${breaksUsed}/${breaksLimit}`}</span>
              )}
            </div>
          </div>
          <div className="rider-status-panel">
            {statusOptions.map((item) => {
              const active = status === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  className={`rider-status-option${active ? " is-active" : ""}`}
                  data-status={item.value}
                  onClick={() => updateStatus(item.value)}
                  disabled={loading}
                  aria-pressed={active}
                >
                  <span className="rider-status-dot" aria-hidden="true" />
                  <div className="rider-status-text">
                    <div className="rider-status-title">
                      <span>{item.label}</span>
                      {active && <span className="rider-status-tag">Active</span>}
                    </div>
                    <div className="rider-status-sub">{item.detail}</div>
                  </div>
                  <span className="rider-status-action">{active ? "Active" : "Set"}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section id="rider-whatsapp" className="rider-card rider-fade rider-stagger-1">
          <div className="rider-card-header">
            <div>
              <div className="rider-card-title">{t("rider.whatsapp.title")}</div>
              <div className="rider-card-subtitle">{t("rider.whatsapp.subtitle")}</div>
            </div>
          </div>
          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            <div>
              <div className="rider-card-subtitle">{t("rider.whatsapp.phoneLabel")}</div>
              <input
                className="rider-input"
                inputMode="tel"
                autoComplete="tel"
                placeholder={t("rider.whatsapp.phonePlaceholder")}
                value={whatsAppNumber}
                onChange={(e) => {
                  setWhatsAppNumber(e.target.value);
                  if (whatsAppError) setWhatsAppError(null);
                }}
              />
            </div>
            <div>
              <div className="rider-card-subtitle">{t("rider.whatsapp.messageLabel")}</div>
              <textarea
                className="rider-input"
                rows={3}
                placeholder={t("rider.whatsapp.messagePlaceholder")}
                value={whatsAppMessage}
                onChange={(e) => setWhatsAppMessage(e.target.value)}
                style={{ resize: "vertical" }}
              />
            </div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>{t("rider.whatsapp.hint")}</div>
            {whatsAppError && <div className="rider-alert">{whatsAppError}</div>}
            <button type="button" className="rider-btn rider-btn-primary" onClick={openWhatsAppChat}>
              {t("rider.whatsapp.button")}
            </button>
          </div>
        </section>

      </div>

      <section className="rider-card rider-fade rider-stagger-1 rider-queue-card">
        <div className="rider-queue-header">
          <div>
            <div className="rider-card-title">Queue priority</div>
            <div className="rider-card-subtitle">This is your live spot in line.</div>
          </div>
          <div className="rider-queue-actions">
            <div
              className="rider-pill"
              style={{
                background: !isOnline ? "#fee2e2" : queueStale ? "#fef3c7" : "#dcfce7",
                color: !isOnline ? "#b91c1c" : queueStale ? "#92400e" : "#166534",
              }}
            >
              {queueSyncLabel} - {queueAgeLabel}
            </div>
            <button type="button" className="rider-btn rider-btn-ghost" onClick={loadQueue} disabled={loading || !isOnline}>
              Refresh
            </button>
          </div>
        </div>

        <div className="rider-queue-metrics">
          <div className="rider-queue-metric">
            <div className="rider-queue-value">{inQueue ? `#${position}` : "--"}</div>
            <div className="rider-queue-label">Your position</div>
            <div className="rider-queue-meta">
              {inQueue && selfEntry?.updated_at ? `Joined ${formatAgo(selfEntry.updated_at)}` : "Go available to join."}
            </div>
          </div>
          <div className="rider-queue-metric">
            <div className="rider-queue-value">{queueSize}</div>
            <div className="rider-queue-label">Riders waiting</div>
            <div className="rider-queue-meta">{queueSize === 0 ? "No wait right now." : "Stay ready for dispatch."}</div>
          </div>
          <div className="rider-queue-metric">
            <div className="rider-queue-value">{statusLabel(status)}</div>
            <div className="rider-queue-label">Your status</div>
            <div className="rider-queue-meta">
              {status === "available" ? "Keep it on to hold your spot." : "Set to available to enter queue."}
            </div>
          </div>
        </div>

        {!isOnline || queueStale ? (
          <div className="rider-alert" style={{ marginTop: 12 }}>
            {!isOnline
              ? `You are offline. Showing cached queue data (last sync ${queueAgeLabel}).`
              : `Queue data is stale (last sync ${queueAgeLabel}).`}
          </div>
        ) : null}

        <div className="rider-queue-actions" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="rider-btn rider-btn-primary"
            onClick={() => updateStatus("available")}
            disabled={loading || !isOnline}
          >
            Go available
          </button>
          <button
            type="button"
            className="rider-btn rider-btn-muted"
            onClick={() => updateStatus("offline")}
            disabled={loading || !isOnline}
          >
            Go offline
          </button>
        </div>

        <div className="rider-queue-list">
          <div className="rider-list-item">
            <div>
              <div style={{ fontWeight: 700 }}>{inQueue ? "You are in queue" : "Not in queue"}</div>
              <div className="rider-card-subtitle">
                {inQueue ? "Keep your status available to stay queued." : "Switch to available to join."}
              </div>
            </div>
            <div className="rider-pill">{queueSize} waiting</div>
          </div>

          {queueSorted.length === 0 && !loading ? (
            <div className="rider-empty">No riders waiting right now.</div>
          ) : (
            <div className="rider-list">
              {queueSorted.map((entry, idx) => {
                const isSelf = selfId !== null && entry.rider_id === selfId;
                return (
                  <div
                    key={`${entry.rider_id}-${idx}`}
                    className="rider-list-item"
                    style={{
                      background: isSelf ? "rgba(14, 165, 164, 0.12)" : undefined,
                      borderColor: isSelf ? "rgba(14, 165, 164, 0.45)" : undefined,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700 }}>{`#${idx + 1} ${entry.name}`}</div>
                      <div className="rider-card-subtitle">
                        {formatAgo(entry.updated_at) ? `Joined ${formatAgo(entry.updated_at)}` : ""}
                      </div>
                    </div>
                    {isSelf && <span className="rider-pill">You</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {err && <div className="rider-alert">{err}</div>}

      {showTips && (
        <section className="rider-card rider-fade rider-stagger-1">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div className="rider-card-title">Getting started</div>
              <div className="rider-card-subtitle">Three quick steps for a smooth shift.</div>
            </div>
            <button type="button" className="rider-btn rider-btn-ghost" onClick={dismissTips}>
              Got it
            </button>
          </div>
          <div className="rider-list" style={{ marginTop: 12 }}>
            <div className="rider-list-item">
              <div>
                <div style={{ fontWeight: 700 }}>Check in</div>
                <div className="rider-card-subtitle">Confirm your availability for today.</div>
              </div>
              <div className="rider-pill">1</div>
            </div>
            <div className="rider-list-item">
              <div>
                <div style={{ fontWeight: 700 }}>Go available</div>
                <div className="rider-card-subtitle">Join the queue when you are ready.</div>
              </div>
              <div className="rider-pill">2</div>
            </div>
            <div className="rider-list-item">
              <div>
                <div style={{ fontWeight: 700 }}>Keep tracking on</div>
                <div className="rider-card-subtitle">Stay visible to dispatch and admins.</div>
              </div>
              <div className="rider-pill">3</div>
            </div>
          </div>
        </section>
      )}

      <div className="rider-grid">
        <div className="rider-stack">
          <section className="rider-card rider-fade rider-stagger-3">
            <div className="rider-card-header">
              <div>
                <div className="rider-card-title">Live tracking</div>
                <div className="rider-card-subtitle">Share your location automatically.</div>
              </div>
              <div className="rider-card-actions">
                <label className="rider-toggle">
                  <input type="checkbox" checked={trackingEnabled} onChange={(e) => setTrackingEnabled(e.target.checked)} />
                  <span>{trackingEnabled ? "On" : "Off"}</span>
                </label>
              </div>
            </div>
            <div className="rider-list" style={{ marginTop: 12 }}>
              <div className="rider-list-item">
                <div>
                  <div style={{ fontWeight: 700 }}>Tracking status</div>
                  <div className="rider-card-subtitle">{trackingStatus || "Waiting for location updates."}</div>
                </div>
                <div className="rider-pill">{trackingEnabled ? (isOnline ? "Live" : "Queued") : "Off"}</div>
              </div>
              {pendingLocationCount > 0 && (
                <div className="rider-list-item">
                  <div>
                    <div style={{ fontWeight: 700 }}>Queued updates</div>
                    <div className="rider-card-subtitle">Will sync when online.</div>
                  </div>
                  <div className="rider-pill">{pendingLocationCount}</div>
                </div>
              )}
              <div className="rider-list-item">
                <div>
                  <div style={{ fontWeight: 700 }}>Last shared</div>
                  <div className="rider-card-subtitle">{lastSentAt ? lastSentAt.toLocaleTimeString() : "Not sent yet"}</div>
                </div>
                <button type="button" className="rider-btn rider-btn-ghost" onClick={sendLocationNow} disabled={sharingNow || !isOnline}>
                  {sharingNow ? "Sharing..." : "Share now"}
                </button>
              </div>
              <div className="rider-list-item">
                <div>
                  <div style={{ fontWeight: 700 }}>Last coordinates</div>
                  <div className="rider-card-subtitle">
                    {lastCoords ? `${lastCoords.lat.toFixed(5)}, ${lastCoords.lng.toFixed(5)}` : "Waiting for a fix"}
                  </div>
                </div>
                <div className="rider-pill">
                  {lastAccuracy ? `Accuracy ${Math.round(lastAccuracy)}m` : "-"}
                </div>
              </div>
            </div>
            {trackingError && <div className="rider-alert" style={{ marginTop: 12 }}>{trackingError}</div>}
          </section>
        </div>

        <div className="rider-stack">
          <section className="rider-card rider-fade rider-stagger-3">
            <div className="rider-card-title">Shift snapshot</div>
            <div className="rider-card-subtitle">Live summary of your shift.</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: 12,
                marginTop: 12,
              }}
            >
              <div className="rider-kpi">
                <div className="rider-kpi-value">{queueSize}</div>
                <div className="rider-kpi-label">Riders waiting</div>
              </div>
              <div className="rider-kpi">
                <div className="rider-kpi-value">{inQueue ? position : "-"}</div>
                <div className="rider-kpi-label">Your position</div>
              </div>
              <div className="rider-kpi">
                <div className="rider-kpi-value">{lastSentAt ? lastSentAt.toLocaleTimeString() : "-"}</div>
                <div className="rider-kpi-label">Last location</div>
              </div>
            </div>
            <div className="rider-list" style={{ marginTop: 12 }}>
              <div className="rider-list-item">
                <div>
                  <div style={{ fontWeight: 700 }}>Queue sync</div>
                  <div className="rider-card-subtitle">{lastQueueText}</div>
                </div>
                <button type="button" className="rider-btn rider-btn-ghost" onClick={loadQueue} disabled={loading || !isOnline}>
                  Refresh
                </button>
              </div>
              <div className="rider-list-item">
                <div>
                  <div style={{ fontWeight: 700 }}>Tracking</div>
                  <div className="rider-card-subtitle">{trackingEnabled ? "Enabled" : "Disabled"}</div>
                </div>
                <div className="rider-pill">{trackingEnabled ? (isOnline ? "Live" : "Queued") : "Off"}</div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
