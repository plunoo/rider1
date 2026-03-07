import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import { getApiErrorMessage } from "../../api/errors";

type Shift = {
  id: number;
  rider_id: number;
  start_time: string;
  end_time: string;
};

type ShiftCache = {
  items: Shift[];
  fromDate: string;
  toDate: string;
  syncedAt: string;
};

const CACHE_KEY = "rider_shifts_cache_v1";

const formatDateLabel = (value: string) => {
  const d = new Date(value);
  if (Number.isNaN(d.valueOf())) return value;
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
};

const formatTime = (value: string) => {
  const d = new Date(value);
  if (Number.isNaN(d.valueOf())) return value;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const getDurationHours = (start: string, end: string) => {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (Number.isNaN(s) || Number.isNaN(e)) return "";
  const hours = Math.max(0, (e - s) / 3600000);
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  return `${hours.toFixed(1)}h`;
};

export default function Shifts() {
  const today = new Date();
  const defaultFrom = today.toISOString().slice(0, 10);
  const defaultTo = new Date(today.getTime() + 14 * 86400000).toISOString().slice(0, 10);

  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo);
  const [items, setItems] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  useEffect(() => {
    const cachedRaw = localStorage.getItem(CACHE_KEY);
    if (!cachedRaw) return;
    try {
      const cached = JSON.parse(cachedRaw) as ShiftCache;
      if (cached?.items?.length) {
        setItems(cached.items);
        setLastSynced(cached.syncedAt);
      }
    } catch {
      // ignore cache errors
    }
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

  const load = async () => {
    if (!navigator.onLine) {
      setIsOnline(false);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const res = await api.get<Shift[]>("/shifts/mine", { params: { from: fromDate, to: toDate } });
      const nextItems = res.data || [];
      setItems(nextItems);
      const syncedAt = new Date().toISOString();
      setLastSynced(syncedAt);
      const cache: ShiftCache = { items: nextItems, fromDate, toDate, syncedAt };
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Unable to load shifts"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [fromDate, toDate]);

  const grouped = useMemo(() => {
    const groups = new Map<string, Shift[]>();
    items.forEach((shift) => {
      const day = shift.start_time.slice(0, 10);
      const list = groups.get(day) || [];
      list.push(shift);
      groups.set(day, list);
    });
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  const nextShift = useMemo(() => {
    const now = Date.now();
    return items
      .filter((s) => new Date(s.end_time).getTime() >= now)
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())[0];
  }, [items]);

  const lastSyncText = lastSynced ? new Date(lastSynced).toLocaleTimeString() : "Not synced yet";

  return (
    <div className="rider-stack">
      {!isOnline && <div className="rider-banner">You are offline. Showing cached shifts.</div>}

      <section className="rider-card rider-fade">
        <div className="rider-card-header">
          <div>
            <div className="rider-card-title">Shift schedule</div>
            <div className="rider-card-subtitle">Upcoming and recent shifts.</div>
          </div>
          <div className="rider-card-actions">
            <span className="rider-pill">Last sync {lastSyncText}</span>
          </div>
        </div>

        <div className="rider-filter-bar">
          <div>
            <div className="rider-card-subtitle">From</div>
            <input className="rider-input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <div className="rider-card-subtitle">To</div>
            <input className="rider-input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div className="rider-filter-actions">
            <button type="button" className="rider-btn rider-btn-ghost" onClick={load} disabled={loading}>
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>
        </div>

        {err && <div className="rider-alert" style={{ marginTop: 12 }}>{err}</div>}
      </section>

      <section className="rider-card rider-fade rider-stagger-1">
        <div className="rider-card-header">
          <div>
            <div className="rider-card-title">Next shift</div>
            <div className="rider-card-subtitle">Your upcoming shift details.</div>
          </div>
          <div className="rider-card-actions">
            <span className="rider-pill">{nextShift ? "Upcoming" : "None scheduled"}</span>
          </div>
        </div>
        {nextShift ? (
          <div className="rider-list" style={{ marginTop: 12 }}>
            <div className="rider-list-item rider-highlight">
              <div>
                <div style={{ fontWeight: 700 }}>{formatDateLabel(nextShift.start_time)}</div>
                <div className="rider-card-subtitle">
                  {formatTime(nextShift.start_time)} - {formatTime(nextShift.end_time)}
                </div>
              </div>
              <div className="rider-pill">{getDurationHours(nextShift.start_time, nextShift.end_time)}</div>
            </div>
          </div>
        ) : (
          <div className="rider-empty" style={{ marginTop: 12 }}>No upcoming shifts yet.</div>
        )}
      </section>

      <section className="rider-card rider-fade rider-stagger-2">
        <div className="rider-card-header">
          <div>
            <div className="rider-card-title">All shifts</div>
            <div className="rider-card-subtitle">Grouped by day.</div>
          </div>
          <div className="rider-card-actions">
            <span className="rider-pill">{grouped.length} days</span>
          </div>
        </div>
        {grouped.length === 0 ? (
          <div className="rider-empty" style={{ marginTop: 12 }}>No shifts in this range.</div>
        ) : (
          <div className="rider-stack" style={{ marginTop: 12 }}>
            {grouped.map(([day, shifts]) => (
              <div key={day} className="rider-card rider-day-card" style={{ padding: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>{formatDateLabel(day)}</div>
                <div className="rider-list">
                  {shifts.map((shift) => (
                    <div key={shift.id} className="rider-list-item">
                      <div>
                        <div style={{ fontWeight: 700 }}>
                          {formatTime(shift.start_time)} - {formatTime(shift.end_time)}
                        </div>
                        <div className="rider-card-subtitle">Shift ID #{shift.id}</div>
                      </div>
                      <div className="rider-pill">{getDurationHours(shift.start_time, shift.end_time)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
