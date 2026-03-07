import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Topbar } from "../../components/Layout/Topbar";
import { api } from "../../api/client";
import { getApiErrorMessage } from "../../api/errors";

type StatusRow = { rider_id: number; name: string; status: string; updated_at?: string | null };

type Summary = {
  total_riders: number;
  active: number;
  delivery: number;
  available: number;
  on_break: number;
  absent: number;
  updated_at?: string;
};

type LiveLocation = {
  rider_id: number;
  last_seen_minutes?: number | null;
  is_stale?: boolean | null;
  updated_at?: string | null;
};

type AttendanceRow = {
  id?: number;
  rider_id: number;
  rider_name?: string | null;
  date: string;
  status: string;
  created_at?: string | null;
  updated_at?: string | null;
};

type AnalyticsSnapshot = {
  geofence: { entries: number; exits: number };
  sla: { delivery_breaches: number; delivery_total: number; queue_wait_breaches: number };
  freshness: {
    latest_status_at: string | null;
    latest_location_at: string | null;
    latest_delivery_at: string | null;
    latest_attendance_at: string | null;
  };
};

type AuditLog = {
  id: number;
  actor_name?: string | null;
  action: string;
  entity_type?: string | null;
  entity_id?: number | null;
  details?: Record<string, any> | null;
  created_at?: string | null;
};

type Store = { id: number; name: string; default_base_pay_cents?: number };

type Rider = { id: number; name: string; store?: string | null };

const QUEUE_SLA_MINUTES = 60;
const DELIVERY_SLA_MINUTES = 45;

const formatTime = (value?: string | null) => {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.valueOf())) return "-";
  return d.toLocaleTimeString();
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "No data";
  const d = new Date(value);
  if (Number.isNaN(d.valueOf())) return "No data";
  return d.toLocaleString();
};

export default function Dashboard() {
  const nav = useNavigate();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [statuses, setStatuses] = useState<StatusRow[]>([]);
  const [liveLocations, setLiveLocations] = useState<LiveLocation[]>([]);
  const [attendanceRows, setAttendanceRows] = useState<AttendanceRow[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsSnapshot | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [dispatchRiderId, setDispatchRiderId] = useState("");
  const [dispatchStore, setDispatchStore] = useState("");
  const [dispatchRef, setDispatchRef] = useState("");
  const [dispatchPay, setDispatchPay] = useState("");
  const [dispatchLoading, setDispatchLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    const today = new Date().toISOString().slice(0, 10);
    try {
      const statsRes = await api.get<Summary>("/admin/dashboard-stats");
      const statusRes = await api.get<{ items: StatusRow[] }>("/admin/rider-status");
      const [liveRes, attendanceRes, analyticsRes, auditRes, storesRes, ridersRes] = await Promise.all([
        api.get<LiveLocation[]>("/tracking/live").catch(() => ({ data: [] })),
        api.get<AttendanceRow[]>("/admin/attendance", { params: { from: today, to: today } }).catch(() => ({ data: [] })),
        api.get<AnalyticsSnapshot>("/admin/analytics", { params: { from: today, to: today } }).catch(() => ({ data: null })),
        api.get<AuditLog[]>("/admin/audit-logs", { params: { limit: 8 } }).catch(() => ({ data: [] })),
        api.get<Store[]>("/admin/stores").catch(() => ({ data: [] })),
        api.get<{ items: Rider[] }>("/admin/riders").catch(() => ({ data: { items: [] } })),
      ]);
      setSummary(statsRes.data);
      setStatuses(statusRes.data.items || []);
      setLiveLocations(liveRes.data || []);
      setAttendanceRows(attendanceRes.data || []);
      setAnalytics(analyticsRes.data || null);
      setAuditLogs(auditRes.data || []);
      setStores(storesRes.data || []);
      setRiders(ridersRes.data.items || []);
      setLastRefreshed(new Date());
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to load dashboard data"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);

  const liveMap = useMemo(() => new Map(liveLocations.map((l) => [l.rider_id, l])), [liveLocations]);
  const statusMap = useMemo(() => new Map(statuses.map((s) => [s.rider_id, s])), [statuses]);

  const availableList = useMemo(() => {
    const now = Date.now();
    return statuses
      .filter((s) => s.status === "available")
      .map((s) => {
        const live = liveMap.get(s.rider_id);
        const waitMinutes = s.updated_at ? Math.max(0, Math.round((now - new Date(s.updated_at).getTime()) / 60000)) : null;
        return {
          ...s,
          waitMinutes,
          lastSeenMinutes: live?.last_seen_minutes ?? null,
          isStale: live?.is_stale ?? false,
        };
      })
      .sort((a, b) => (b.waitMinutes || 0) - (a.waitMinutes || 0));
  }, [statuses, liveMap]);

  const deliveryList = useMemo(() => statuses.filter((s) => s.status === "delivery"), [statuses]);
  const breakList = useMemo(() => statuses.filter((s) => s.status === "break"), [statuses]);

  const queueSnapshot = availableList.slice(0, 5);
  const queueSlaBreaches = availableList.filter((r) => (r.waitMinutes || 0) > QUEUE_SLA_MINUTES).length;
  const staleRiders = liveLocations.filter((l) => l.is_stale);

  const deliverySlaBreaches = useMemo(() => {
    const now = Date.now();
    return deliveryList.filter((d) => {
      if (!d.updated_at) return false;
      const mins = Math.round((now - new Date(d.updated_at).getTime()) / 60000);
      return mins > DELIVERY_SLA_MINUTES;
    }).length;
  }, [deliveryList]);

  const attendanceCounts = useMemo(() => {
    const counts = { present: 0, late: 0, absent: 0, off_day: 0 };
    attendanceRows.forEach((row) => {
      if (row.status in counts) {
        counts[row.status as keyof typeof counts] += 1;
      }
    });
    return counts;
  }, [attendanceRows]);

  const statCards = [
    {
      label: "Active Riders",
      value: summary?.active ?? 0,
      delta: `${summary?.total_riders ?? 0} total`,
      color: "linear-gradient(135deg,#0ea5e9,#2563eb)",
    },
    {
      label: "On Delivery",
      value: summary?.delivery ?? 0,
      delta: `${deliveryList.length} live`,
      color: "linear-gradient(135deg,#f59e0b,#ef4444)",
    },
    {
      label: "Queue Waiting",
      value: availableList.length,
      delta: `${queueSlaBreaches} > ${QUEUE_SLA_MINUTES}m`,
      color: "linear-gradient(135deg,#22c55e,#16a34a)",
    },
    {
      label: "Stale GPS",
      value: staleRiders.length,
      delta: `${staleRiders.length} stale`,
      color: "linear-gradient(135deg,#f97316,#ea580c)",
    },
    {
      label: "Attendance Today",
      value: attendanceCounts.present + attendanceCounts.late,
      delta: `Late ${attendanceCounts.late} / Absent ${attendanceCounts.absent + attendanceCounts.off_day}`,
      color: "linear-gradient(135deg,#6366f1,#4f46e5)",
    },
  ];

  const leaderboard = [...statuses]
    .filter((s) => s.status === "delivery" || s.status === "available")
    .slice(0, 5);

  const selectedStore = useMemo(() => stores.find((s) => s.name === dispatchStore), [stores, dispatchStore]);

  useEffect(() => {
    if (!dispatchStore) return;
    if (selectedStore) {
      const cents = selectedStore.default_base_pay_cents ?? 0;
      setDispatchPay((cents / 100).toFixed(2));
    }
  }, [dispatchStore, selectedStore]);

  useEffect(() => {
    if (!dispatchRiderId || dispatchStore) return;
    const rider = riders.find((r) => String(r.id) === dispatchRiderId);
    if (rider?.store) {
      setDispatchStore(rider.store);
    }
  }, [dispatchRiderId, dispatchStore, riders]);

  const assignDispatch = async () => {
    if (!dispatchRiderId) return;
    const payValue = Number(dispatchPay);
    if (!dispatchPay || Number.isNaN(payValue) || payValue < 0) {
      setErr("Delivery price is required and must be 0 or greater.");
      return;
    }
    setDispatchLoading(true);
    try {
      await api.post("/admin/dispatch/assign", {
        rider_id: Number(dispatchRiderId),
        reference: dispatchRef || undefined,
        store: dispatchStore || undefined,
        base_pay_cents: Math.round(payValue * 100),
      });
      setDispatchRiderId("");
      setDispatchStore("");
      setDispatchRef("");
      setDispatchPay("");
      load();
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to assign dispatch"));
    } finally {
      setDispatchLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Topbar title="Command Center" />

      <div style={hero}>
        <div>
          <div style={pill}>Live Ops</div>
          <h2 style={{ margin: "10px 0 6px 0" }}>Today's rider pulse</h2>
          <p style={{ margin: 0, opacity: 0.75 }}>Monitor live capacity, deliveries, and incidents in one view.</p>
        </div>
        <div style={heroBadge}>
          <span style={{ fontSize: 26, fontWeight: 800 }}>{summary ? `${summary.active || 0}/${summary.total_riders || 0}` : "--"}</span>
          <span style={{ fontSize: 13, opacity: 0.8 }}>Active / Total</span>
          {summary?.updated_at && <span style={{ fontSize: 11, opacity: 0.65 }}>Updated {new Date(summary.updated_at).toLocaleTimeString()}</span>}
        </div>
      </div>

      <div style={freshnessBar}>
        <div style={freshnessItem}>
          <div style={freshnessLabel}>Latest status</div>
          <div style={freshnessValue}>{formatDateTime(analytics?.freshness.latest_status_at)}</div>
        </div>
        <div style={freshnessItem}>
          <div style={freshnessLabel}>Latest location</div>
          <div style={freshnessValue}>{formatDateTime(analytics?.freshness.latest_location_at)}</div>
        </div>
        <div style={freshnessItem}>
          <div style={freshnessLabel}>Latest delivery</div>
          <div style={freshnessValue}>{formatDateTime(analytics?.freshness.latest_delivery_at)}</div>
        </div>
        <div style={freshnessItem}>
          <div style={freshnessLabel}>Latest attendance</div>
          <div style={freshnessValue}>{formatDateTime(analytics?.freshness.latest_attendance_at)}</div>
        </div>
        <div style={{ fontSize: 12, color: "#64748b" }}>
          {lastRefreshed ? `Last refresh ${lastRefreshed.toLocaleTimeString()}` : "Not refreshed yet"}
        </div>
      </div>

      {err && <div style={alert}>{err}</div>}
      {loading && <div style={alert}>Refreshing dashboard...</div>}

      <div style={statGrid}>
        {statCards.map((s) => (
          <div key={s.label} style={{ ...statCard, background: s.color }}>
            <div style={{ opacity: 0.85 }}>{s.label}</div>
            <div style={{ fontSize: 32, fontWeight: 800, margin: "8px 0" }}>{s.value}</div>
            <div style={{ fontSize: 13, opacity: 0.9 }}>{s.delta}</div>
          </div>
        ))}
      </div>

      <div style={mainGrid}>
        <div style={panel}>
          <header style={panelHeader}>
            <div>
              <div style={panelLabel}>Live queue</div>
              <div style={panelTitle}>Available now</div>
            </div>
            <button style={ghostBtn} onClick={() => nav("/admin/management")}>View queue</button>
          </header>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {queueSnapshot.length === 0 ? (
              <div style={empty}>No riders available right now.</div>
            ) : (
              queueSnapshot.map((r, idx) => (
                <div key={r.rider_id} style={row}>
                  <div>
                    <div style={{ fontWeight: 700 }}>#{idx + 1} {r.name}</div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      {r.waitMinutes != null ? `Waiting ${r.waitMinutes}m` : "Waiting"}
                      {r.lastSeenMinutes != null ? ` ? Last seen ${r.lastSeenMinutes}m` : ""}
                    </div>
                  </div>
                  <div style={rowBadges}>
                    {r.isStale && <span style={badgeWarning}>Stale</span>}
                    {(r.waitMinutes || 0) > QUEUE_SLA_MINUTES && <span style={badgeDanger}>SLA</span>}
                    <span style={badge}>Ready</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div style={panel}>
          <header style={panelHeader}>
            <div>
              <div style={panelLabel}>SLA alerts</div>
              <div style={panelTitle}>Breaches to review</div>
            </div>
            <span style={chipWarning}>{deliverySlaBreaches + queueSlaBreaches + staleRiders.length} alerts</span>
          </header>
          <div style={{ display: "grid", gap: 10 }}>
            <div style={alertRow}>
              <div>
                <div style={{ fontWeight: 700 }}>Delivery SLA</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>{DELIVERY_SLA_MINUTES}m threshold</div>
              </div>
              <div style={alertValue}>{analytics?.sla.delivery_breaches ?? deliverySlaBreaches}</div>
            </div>
            <div style={alertRow}>
              <div>
                <div style={{ fontWeight: 700 }}>Queue wait SLA</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>{QUEUE_SLA_MINUTES}m threshold</div>
              </div>
              <div style={alertValue}>{analytics?.sla.queue_wait_breaches ?? queueSlaBreaches}</div>
            </div>
            <div style={alertRow}>
              <div>
                <div style={{ fontWeight: 700 }}>Stale location</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>Needs GPS refresh</div>
              </div>
              <div style={alertValue}>{staleRiders.length}</div>
            </div>
            <div style={{ fontSize: 12, color: "#64748b" }}>Deliveries tracked {analytics?.sla.delivery_total ?? 0} today.</div>
          </div>
        </div>

        <div style={panel}>
          <header style={panelHeader}>
            <div>
              <div style={panelLabel}>Dispatch shortcuts</div>
              <div style={panelTitle}>Assign a delivery</div>
            </div>
            {availableList[0] && (
              <button style={ghostBtn} onClick={() => setDispatchRiderId(String(availableList[0].rider_id))}>
                Use next available
              </button>
            )}
          </header>
          <div style={formGrid}>
            <select style={input} value={dispatchRiderId} onChange={(e) => setDispatchRiderId(e.target.value)}>
              <option value="">Select rider</option>
              {riders.map((r) => (
                <option key={r.id} value={String(r.id)}>
                  {r.name} (#{r.id})
                </option>
              ))}
            </select>
            <select style={input} value={dispatchStore} onChange={(e) => setDispatchStore(e.target.value)}>
              <option value="">Store (auto)</option>
              {stores.map((s) => (
                <option key={s.id} value={s.name}>{s.name}</option>
              ))}
            </select>
            <input style={input} placeholder="Reference (optional)" value={dispatchRef} onChange={(e) => setDispatchRef(e.target.value)} />
            <input
              style={input}
              type="number"
              min="0"
              step="0.01"
              placeholder="Delivery price"
              value={dispatchPay}
              onChange={(e) => setDispatchPay(e.target.value)}
            />
            <button style={primaryBtn} onClick={assignDispatch} disabled={!dispatchRiderId || dispatchLoading || !dispatchPay}>
              {dispatchLoading ? "Assigning..." : "Assign delivery"}
            </button>
          </div>
          <div style={{ fontSize: 12, color: "#64748b" }}>Default price fills from the selected store.</div>
        </div>
      </div>

      <div style={secondaryGrid}>
        <div style={panel}>
          <header style={panelHeader}>
            <div>
              <div style={panelLabel}>Attendance</div>
              <div style={panelTitle}>Today</div>
            </div>
            <button style={ghostBtn} onClick={() => nav("/admin/attendance")}>View attendance</button>
          </header>
          <div style={attendanceGrid}>
            <div style={miniCard}>
              <div style={miniLabel}>Present</div>
              <div style={miniValue}>{attendanceCounts.present}</div>
            </div>
            <div style={miniCard}>
              <div style={miniLabel}>Late</div>
              <div style={miniValue}>{attendanceCounts.late}</div>
            </div>
            <div style={miniCard}>
              <div style={miniLabel}>Absent</div>
              <div style={miniValue}>{attendanceCounts.absent}</div>
            </div>
            <div style={miniCard}>
              <div style={miniLabel}>Off day</div>
              <div style={miniValue}>{attendanceCounts.off_day}</div>
            </div>
          </div>
        </div>

        <div style={panel}>
          <header style={panelHeader}>
            <div>
              <div style={panelLabel}>Geofences</div>
              <div style={panelTitle}>Compliance</div>
            </div>
            <button style={ghostBtn} onClick={() => nav("/admin/tracking")}>Open map</button>
          </header>
          <div style={attendanceGrid}>
            <div style={miniCard}>
              <div style={miniLabel}>Entries</div>
              <div style={miniValue}>{analytics?.geofence.entries ?? 0}</div>
            </div>
            <div style={miniCard}>
              <div style={miniLabel}>Exits</div>
              <div style={miniValue}>{analytics?.geofence.exits ?? 0}</div>
            </div>
            <div style={miniCard}>
              <div style={miniLabel}>Alerts</div>
              <div style={miniValue}>{(analytics?.geofence.entries ?? 0) + (analytics?.geofence.exits ?? 0)}</div>
            </div>
          </div>
        </div>

        <div style={panel}>
          <header style={panelHeader}>
            <div>
              <div style={panelLabel}>Recent activity</div>
              <div style={panelTitle}>Ops feed</div>
            </div>
            <button style={ghostBtn} onClick={() => nav("/admin/audit-log")}>View log</button>
          </header>
          <div style={{ display: "grid", gap: 10 }}>
            {auditLogs.length === 0 ? (
              <div style={empty}>No recent activity.</div>
            ) : (
              auditLogs.map((log) => (
                <div key={log.id} style={row}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{log.action}</div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      {log.actor_name ? `${log.actor_name} ? ` : ""}{log.entity_type || "system"}
                    </div>
                  </div>
                  <span style={badgeMuted}>{formatTime(log.created_at)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div style={panel}>
        <header style={panelHeader}>
          <div>
            <div style={panelLabel}>Live status</div>
            <div style={panelTitle}>Deliveries and breaks</div>
          </div>
          <span style={chipWarning}>{deliveryList.length + breakList.length} active</span>
        </header>
        <div style={{ display: "grid", gap: 10 }}>
          {[...deliveryList, ...breakList].slice(0, 8).map((i) => (
            <div key={i.rider_id} style={row}>
              <div>
                <div style={{ fontWeight: 700 }}>{i.name}</div>
                <div style={{ fontSize: 12, opacity: 0.75 }}>{i.status === "delivery" ? "On delivery" : "On break"}</div>
              </div>
              <span style={badgeMuted}>{formatTime(i.updated_at)}</span>
            </div>
          ))}
          {deliveryList.length + breakList.length === 0 && <div style={empty}>No riders on delivery or break.</div>}
        </div>
      </div>

      <div style={panel}>
        <header style={panelHeader}>
          <div>
            <div style={panelLabel}>Top performers</div>
            <div style={panelTitle}>Leaderboard</div>
          </div>
        </header>
        <div style={{ display: "grid", gap: 12 }}>
          {leaderboard.length === 0 ? (
            <div style={empty}>No active riders yet.</div>
          ) : (
            leaderboard.map((l, idx) => (
              <div key={l.rider_id} style={leaderRow}>
                <div style={leaderRank}>#{idx + 1}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 750 }}>{l.name}</div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>{l.status === "delivery" ? "On delivery" : "Available"}</div>
                </div>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{formatTime(l.updated_at)}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const hero: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
  justifyContent: "space-between",
  alignItems: "center",
  padding: "12px clamp(12px, 3vw, 18px)",
  borderRadius: 18,
  background: "linear-gradient(135deg,#0f172a,#1f2937)",
  color: "white",
};

const heroBadge: React.CSSProperties = {
  padding: "12px 16px",
  borderRadius: 14,
  background: "rgba(255,255,255,0.08)",
  display: "flex",
  flexDirection: "column",
  gap: 4,
  alignItems: "flex-end",
  minWidth: 120,
};

const pill: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 10px",
  borderRadius: 999,
  background: "rgba(255,255,255,0.12)",
  fontSize: 12,
  fontWeight: 700,
};

const freshnessBar: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: 10,
  background: "white",
  borderRadius: 16,
  padding: 14,
  boxShadow: "0 10px 24px rgba(0,0,0,0.06)",
  alignItems: "center",
};

const freshnessItem: React.CSSProperties = {
  display: "grid",
  gap: 4,
};

const freshnessLabel: React.CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.4,
  color: "#64748b",
  fontWeight: 700,
};

const freshnessValue: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: "#0f172a",
};

const statGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 14,
};

const statCard: React.CSSProperties = {
  borderRadius: 18,
  padding: "clamp(14px, 3vw, 18px)",
  color: "white",
  boxShadow: "0 10px 22px rgba(0,0,0,0.12)",
};

const mainGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: 14,
  alignItems: "start",
};

const secondaryGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: 14,
  alignItems: "start",
};

const panel: React.CSSProperties = {
  background: "white",
  borderRadius: 16,
  padding: 16,
  boxShadow: "0 10px 24px rgba(0,0,0,0.06)",
};

const panelHeader: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 12,
  gap: 10,
  flexWrap: "wrap",
};

const panelLabel: React.CSSProperties = { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4, opacity: 0.65 };
const panelTitle: React.CSSProperties = { fontSize: 18, fontWeight: 800, marginTop: 4 };
const chip: React.CSSProperties = { padding: "8px 10px", borderRadius: 12, background: "#e0f2fe", color: "#0ea5e9", fontWeight: 700 };
const chipWarning: React.CSSProperties = { padding: "8px 10px", borderRadius: 12, background: "#fff7ed", color: "#ea580c", fontWeight: 700 };

const row: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "12px 0",
  borderBottom: "1px solid #f1f5f9",
  gap: 10,
};

const rowBadges: React.CSSProperties = {
  display: "flex",
  gap: 6,
  flexWrap: "wrap",
  alignItems: "center",
};

const badge: React.CSSProperties = { padding: "6px 10px", borderRadius: 10, background: "#ecfeff", color: "#0891b2", fontWeight: 700 };
const badgeMuted: React.CSSProperties = { padding: "6px 10px", borderRadius: 10, background: "#f1f5f9", color: "#0f172a", fontWeight: 700 };
const badgeWarning: React.CSSProperties = { padding: "6px 10px", borderRadius: 10, background: "#fef3c7", color: "#92400e", fontWeight: 700 };
const badgeDanger: React.CSSProperties = { padding: "6px 10px", borderRadius: 10, background: "#fee2e2", color: "#b91c1c", fontWeight: 700 };

const alertRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "10px 12px",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  background: "#f8fafc",
};

const alertValue: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 800,
  color: "#0f172a",
};

const formGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: 10,
  alignItems: "center",
};

const input: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
};

const ghostBtn: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  background: "white",
  fontWeight: 700,
  cursor: "pointer",
};

const primaryBtn: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: 0,
  color: "white",
  background: "linear-gradient(135deg,#2563eb,#10b981)",
  fontWeight: 800,
  cursor: "pointer",
};

const attendanceGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  gap: 10,
};

const miniCard: React.CSSProperties = {
  padding: 10,
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  background: "#f8fafc",
  display: "grid",
  gap: 4,
};

const miniLabel: React.CSSProperties = { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, color: "#64748b" };
const miniValue: React.CSSProperties = { fontSize: 18, fontWeight: 800 };

const leaderRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "10px 12px",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
};

const leaderRank: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: "50%",
  background: "#0ea5e9",
  color: "white",
  display: "grid",
  placeItems: "center",
  fontWeight: 800,
};

const alert: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  background: "#fee2e2",
  color: "#991b1b",
  fontWeight: 700,
};

const empty: React.CSSProperties = {
  padding: 12,
  border: "1px dashed #e5e7eb",
  borderRadius: 10,
  textAlign: "center",
  color: "#6b7280",
};
