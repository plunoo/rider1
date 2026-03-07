import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { getApiErrorMessage } from "../../api/errors";

type Choice = "present" | "absent" | "late" | null;

type TodayResponse = {
  date?: string;
  status?: Choice;
  note?: string | null;
  last_marked_at?: string | null;
  next_available_at?: string | null;
  can_edit?: boolean;
};

type MarkResponse = {
  message?: string;
  skipped?: boolean;
  last_marked_at?: string;
  next_available_at?: string;
  marked_at?: string;
  can_edit?: boolean;
};

type AttendanceHistoryItem = {
  date: string;
  status: Choice;
  note?: string | null;
  updated_at?: string | null;
};

type AttendanceCache = {
  date: string;
  status: Choice | null;
  note?: string | null;
  last_marked_at?: string | null;
  next_available_at?: string | null;
  can_edit?: boolean;
  syncedAt: string;
};

type HistoryCache = {
  items: AttendanceHistoryItem[];
  syncedAt: string;
};

type PendingCheckIn = {
  status: Choice;
  note?: string | null;
  savedAt: string;
};

const CACHE_KEY = "rider_attendance_today_v1";
const HISTORY_CACHE_KEY = "rider_attendance_history_v1";
const PENDING_KEY = "rider_attendance_pending_v1";
const GRACE_MINUTES = 30;
const HISTORY_DAYS = 30;

const statusLabel = (value: Choice) => {
  if (value === "present") return "Present";
  if (value === "late") return "Late";
  if (value === "absent") return "Absent";
  return "Not marked";
};

const statusColor = (value: Choice) => {
  if (value === "present") return "#16a34a";
  if (value === "late") return "#f97316";
  if (value === "absent") return "#ef4444";
  return "#94a3b8";
};

const formatDateLabel = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const formatWeekday = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return "";
  return parsed.toLocaleDateString(undefined, { weekday: "short" });
};

const formatRemaining = (ms: number) => {
  if (ms <= 0) return "0m";
  const totalMinutes = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
};

export default function CheckIn() {
  const nav = useNavigate();
  const [choice, setChoice] = useState<Choice>(null);
  const [note, setNote] = useState("");
  const [todayStatus, setTodayStatus] = useState<Choice>(null);
  const [todayNote, setTodayNote] = useState<string | null>(null);
  const [todayDate, setTodayDate] = useState<string>("");
  const [lastMarkedAt, setLastMarkedAt] = useState<string | null>(null);
  const [nextAvailableAt, setNextAvailableAt] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [history, setHistory] = useState<AttendanceHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<Date | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState<PendingCheckIn | null>(null);
  const [nowTs, setNowTs] = useState(Date.now());

  const loadToday = async () => {
    const cachedRaw = localStorage.getItem(CACHE_KEY);
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw) as AttendanceCache;
        setTodayStatus(cached.status ?? null);
        setTodayNote(cached.note ?? null);
        setTodayDate(cached.date ?? "");
        setLastMarkedAt(cached.last_marked_at ?? null);
        setNextAvailableAt(cached.next_available_at ?? null);
        setCanEdit(Boolean(cached.can_edit));
      } catch {
        // ignore cache errors
      }
    }

    if (!navigator.onLine) {
      setIsOnline(false);
      return;
    }

    try {
      const res = await api.get<TodayResponse>("/attendance/today");
      const payload = res.data || {};
      setTodayStatus(payload.status ?? null);
      setTodayNote(payload.note ?? null);
      setTodayDate(payload.date ?? "");
      setLastMarkedAt(payload.last_marked_at ?? null);
      setNextAvailableAt(payload.next_available_at ?? null);
      setCanEdit(Boolean(payload.can_edit));
      const cache: AttendanceCache = {
        status: payload.status ?? null,
        note: payload.note ?? null,
        date: payload.date ?? "",
        last_marked_at: payload.last_marked_at ?? null,
        next_available_at: payload.next_available_at ?? null,
        can_edit: payload.can_edit ?? false,
        syncedAt: new Date().toISOString(),
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      // ignore fetch errors
    }
  };

  const loadHistory = async () => {
    const cachedRaw = localStorage.getItem(HISTORY_CACHE_KEY);
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw) as HistoryCache;
        setHistory(cached.items || []);
      } catch {
        // ignore cache errors
      }
    }

    if (!navigator.onLine) {
      setIsOnline(false);
      return;
    }

    try {
      const res = await api.get<AttendanceHistoryItem[]>("/attendance/history", { params: { days: HISTORY_DAYS } });
      const items = res.data || [];
      setHistory(items);
      const cache: HistoryCache = {
        items,
        syncedAt: new Date().toISOString(),
      };
      localStorage.setItem(HISTORY_CACHE_KEY, JSON.stringify(cache));
    } catch {
      // ignore fetch errors
    }
  };

  useEffect(() => {
    const pendingRaw = localStorage.getItem(PENDING_KEY);
    if (pendingRaw) {
      try {
        const parsed = JSON.parse(pendingRaw) as PendingCheckIn;
        if (parsed?.status) setPending(parsed);
      } catch {
        // ignore
      }
    }
    loadToday();
    loadHistory();
  }, []);

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

  useEffect(() => {
    const id = window.setInterval(() => setNowTs(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (choice !== "late") {
      setNote("");
      return;
    }
    if (!note && todayNote) setNote(todayNote);
  }, [choice]);

  useEffect(() => {
    if (isOnline) {
      loadToday();
      loadHistory();
      if (pending) {
        syncPending();
      }
    }
  }, [isOnline]);

  const formattedDate = useMemo(() => {
    if (!todayDate) return "";
    const parsed = new Date(todayDate);
    if (Number.isNaN(parsed.valueOf())) return todayDate;
    return parsed.toLocaleDateString();
  }, [todayDate]);

const cooldownText = useMemo(() => {
  if (!cooldownUntil) return "";
  return `Next check-in available at ${cooldownUntil.toLocaleString()}.`;
}, [cooldownUntil]);

  const nextAvailableMs = useMemo(() => {
    if (!nextAvailableAt) return null;
    const ts = new Date(nextAvailableAt).getTime();
    if (Number.isNaN(ts)) return null;
    return ts - nowTs;
  }, [nextAvailableAt, nowTs]);

  const editRemainingMs = useMemo(() => {
    if (!lastMarkedAt || !canEdit) return null;
    const ts = new Date(lastMarkedAt).getTime();
    if (Number.isNaN(ts)) return null;
    const editUntil = ts + GRACE_MINUTES * 60000;
    return editUntil - nowTs;
  }, [lastMarkedAt, canEdit, nowTs]);

  const statusSummary = useMemo(() => {
    if (!nextAvailableMs || nextAvailableMs <= 0) return "You can check in now.";
    return `Next check-in in ${formatRemaining(nextAvailableMs)}.`;
  }, [nextAvailableMs]);

  const pendingText = useMemo(() => {
    if (!pending) return "";
    return `Saved offline: ${statusLabel(pending.status)}.`;
  }, [pending]);

  const historyMap = useMemo(() => {
    const map = new Map<string, AttendanceHistoryItem>();
    history.forEach((item) => map.set(item.date, item));
    return map;
  }, [history]);

  const historyDays = useMemo(() => {
    const days: { date: string; item?: AttendanceHistoryItem }[] = [];
    for (let i = 0; i < HISTORY_DAYS; i += 1) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      days.push({ date: dateStr, item: historyMap.get(dateStr) });
    }
    return days;
  }, [historyMap]);

  const syncPending = async () => {
    if (!pending) return;
    if (!navigator.onLine) return;
    setSyncing(true);
    setErr(null);
    try {
      const res = await api.post<MarkResponse>("/attendance/mark", {
        status: pending.status,
        note: pending.note || undefined,
      });
      const payload = res.data || {};
      localStorage.removeItem(PENDING_KEY);
      setPending(null);
      setFeedback("Offline check-in synced.");
      if (payload.last_marked_at) setLastMarkedAt(payload.last_marked_at);
      if (payload.next_available_at) setNextAvailableAt(payload.next_available_at);
      setCanEdit(Boolean(payload.can_edit));
      await loadToday();
      await loadHistory();
    } catch (e: any) {
      const message = getApiErrorMessage(e, "Failed to sync offline check-in");
      setErr(message);
      if (e?.response) {
        localStorage.removeItem(PENDING_KEY);
        setPending(null);
      }
    } finally {
      setSyncing(false);
    }
  };

  const submit = async () => {
    if (!choice) return;
    if (!navigator.onLine) {
      const payload: PendingCheckIn = {
        status: choice,
        note: choice === "late" ? note.trim() || null : null,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(PENDING_KEY, JSON.stringify(payload));
      setPending(payload);
      setErr(null);
      setFeedback("Saved offline. We will sync when you are back online.");
      return;
    }
    setErr(null);
    setFeedback(null);
    setCooldownUntil(null);
    setLoading(true);
    try {
      const res = await api.post<MarkResponse>("/attendance/mark", {
        status: choice,
        note: choice === "late" ? note.trim() || undefined : undefined,
      });
      const payload = res.data || {};
      if (payload.last_marked_at) setLastMarkedAt(payload.last_marked_at);
      if (payload.next_available_at) setNextAvailableAt(payload.next_available_at);
      setCanEdit(Boolean(payload.can_edit));
      if (payload.skipped && payload.next_available_at) {
        const next = new Date(payload.next_available_at);
        if (!Number.isNaN(next.valueOf())) {
          setCooldownUntil(next);
        }
        setFeedback(payload.message || "Attendance already marked recently.");
        return;
      }
      await loadToday();
      await loadHistory();
      nav("/rider", { replace: true });
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to save response"));
    } finally {
      setLoading(false);
    }
  };

  const choices = [
    {
      value: "present" as Choice,
      label: "I am working",
      detail: "Join the queue and share your location.",
    },
    {
      value: "late" as Choice,
      label: "Running late",
      detail: "Mark late and add an optional note.",
    },
    {
      value: "absent" as Choice,
      label: "Not working",
      detail: "Let the team know you are off today.",
    },
  ];

  return (
    <div className="rider-stack">
      {!isOnline && <div className="rider-banner">You are offline. Showing cached status.</div>}
      {pending && (
        <div className="rider-banner" style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <span>{pendingText}</span>
          <button type="button" className="rider-btn rider-btn-ghost" onClick={syncPending} disabled={!isOnline || syncing}>
            {syncing ? "Syncing..." : "Sync now"}
          </button>
        </div>
      )}

      <section className="rider-card rider-fade">
        <div className="rider-card-header">
          <div>
            <div className="rider-card-title">Daily check-in</div>
            <div className="rider-card-subtitle">Share your availability for today.</div>
          </div>
          <div className="rider-card-actions">
            <span className="rider-pill">{isOnline ? "Online" : "Offline"}</span>
          </div>
        </div>

        <div className="rider-choice-grid">
          {choices.map((item) => {
            const active = choice === item.value;
            return (
              <button
                key={item.value}
                type="button"
                className={`rider-choice-card${active ? " is-active" : ""}`}
                data-choice={item.value}
                onClick={() => setChoice(item.value)}
                disabled={loading}
                aria-pressed={active}
              >
                <span className="rider-choice-dot" aria-hidden="true" />
                <div className="rider-choice-body">
                  <div className="rider-choice-title">{item.label}</div>
                  <div className="rider-choice-sub">{item.detail}</div>
                </div>
                <span className="rider-choice-pill">{active ? "Selected" : "Choose"}</span>
              </button>
            );
          })}
        </div>

        {choice === "late" && (
          <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
            <div className="rider-card-subtitle">Why late? (optional)</div>
            <textarea
              className="rider-input"
              rows={3}
              placeholder="Traffic, personal matter, etc."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        )}

        {feedback && (
          <div className="rider-alert" style={{ marginTop: 12 }}>
            {feedback} {cooldownText}
          </div>
        )}
        {err && (
          <div className="rider-alert" style={{ marginTop: 12 }}>
            {err}
          </div>
        )}

        {nextAvailableMs !== null && (
          <div className="rider-card-subtitle" style={{ marginTop: 10 }}>{statusSummary}</div>
        )}
        {editRemainingMs !== null && editRemainingMs > 0 && (
          <div className="rider-card-subtitle" style={{ marginTop: 4 }}>
            You can edit for {formatRemaining(editRemainingMs)}.
          </div>
        )}

        <div className="rider-card-actions" style={{ marginTop: 12 }}>
          <button
            type="button"
            className={`rider-btn ${choice && isOnline ? "rider-btn-primary" : "rider-btn-muted"}`}
            onClick={submit}
            disabled={!choice || loading}
          >
            {loading ? "Saving..." : canEdit && todayStatus ? "Update check-in" : "Save and continue"}
          </button>
          <button type="button" className="rider-btn rider-btn-ghost" onClick={() => nav("/rider")}
          >
            Back to dashboard
          </button>
        </div>
      </section>

      <section className="rider-card rider-fade rider-stagger-1">
        <div className="rider-card-header">
          <div>
            <div className="rider-card-title">Today</div>
            <div className="rider-card-subtitle">{formattedDate || ""}</div>
          </div>
          <div className="rider-card-actions">
            <span className="rider-pill">{todayStatus ? "Marked" : "Pending"}</span>
          </div>
        </div>
        <div className="rider-list" style={{ marginTop: 12 }}>
          <div className="rider-list-item">
            <div>
              <div style={{ fontWeight: 700 }}>Current status</div>
              <div className="rider-card-subtitle">{statusLabel(todayStatus)}</div>
            </div>
            <div className="rider-pill">{todayStatus ? "Marked" : "Pending"}</div>
          </div>
          {todayNote && (
            <div className="rider-list-item">
              <div>
                <div style={{ fontWeight: 700 }}>Note</div>
                <div className="rider-card-subtitle">{todayNote}</div>
              </div>
              <div className="rider-pill">{todayStatus || ""}</div>
            </div>
          )}
          <div className="rider-list-item">
            <div>
              <div style={{ fontWeight: 700 }}>Reminder window</div>
              <div className="rider-card-subtitle">Once per day</div>
            </div>
            <div className="rider-pill">Daily</div>
          </div>
        </div>
      </section>

      <section className="rider-card rider-fade rider-stagger-2">
        <div className="rider-card-header">
          <div>
            <div className="rider-card-title">Last {HISTORY_DAYS} days</div>
            <div className="rider-card-subtitle">Tap a day to see the status.</div>
          </div>
          <div className="rider-card-actions">
            <span className="rider-pill">History</span>
          </div>
        </div>
        <div className="attendance-grid" style={{ marginTop: 12 }}>
          {historyDays.map(({ date, item }) => {
            const status = item?.status ?? null;
            const noteText = item?.note ? ` - ${item.note}` : "";
            return (
              <div
                key={date}
                className="attendance-day"
                title={`${formatDateLabel(date)}: ${statusLabel(status)}${noteText}`}
                style={{ borderColor: status ? statusColor(status) : "#e2e8f0" }}
              >
                <div style={{ fontSize: 11, opacity: 0.7 }}>{formatWeekday(date)}</div>
                <div style={{ fontWeight: 700 }}>{formatDateLabel(date)}</div>
                <div style={{ fontSize: 11, color: status ? statusColor(status) : "#94a3b8" }}>
                  {statusLabel(status)}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
