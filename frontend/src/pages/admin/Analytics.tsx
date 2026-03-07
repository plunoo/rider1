import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Topbar } from "../../components/Layout/Topbar";
import { api } from "../../api/client";
import { getApiErrorMessage } from "../../api/errors";
import { exportToExcel } from "../../utils/exportExcel";

type TrendPoint = { date: string; count: number };

type AttendancePoint = {
  date: string;
  present: number;
  late: number;
  absent: number;
  off_day: number;
};

type PerformanceRow = {
  rider_id: number;
  name: string;
  store?: string | null;
  deliveries: number;
  on_time_rate: number;
  avg_delivery_minutes: number;
  cancel_rate: number;
};

type StoreRow = {
  store: string;
  deliveries: number;
  avg_delivery_minutes: number;
  active_riders: number;
  attendance_rate: number;
};

type CaptainRow = {
  captain: string;
  store: string;
  deliveries: number;
  avg_delivery_minutes: number;
  active_riders: number;
  attendance_rate: number;
};

type GeofenceDay = { date: string; entries: number; exits: number };

type AnalyticsResponse = {
  range: { from: string; to: string };
  previous_range: { from: string; to: string };
  kpis: {
    total_deliveries: number;
    on_time_rate: number;
    avg_delivery_minutes: number;
    active_riders: number;
    attendance_rate: number;
    payout_total_cents: number;
  };
  previous: {
    kpis: {
      total_deliveries: number;
      on_time_rate: number;
      avg_delivery_minutes: number;
      active_riders: number;
      attendance_rate: number;
      payout_total_cents: number;
    };
  };
  trends: {
    deliveries: TrendPoint[];
    attendance: AttendancePoint[];
    active_riders: TrendPoint[];
    late_checkins: TrendPoint[];
  };
  rider_performance: {
    top: PerformanceRow[];
    bottom: PerformanceRow[];
  };
  store_comparison: StoreRow[];
  captain_comparison: CaptainRow[];
  queue_health: {
    avg_available_minutes: number;
    p95_available_minutes: number;
    peak_waiting: number;
    stale_rider_rate: number;
    samples: number;
  };
  sla: {
    delivery_breaches: number;
    delivery_total: number;
    queue_wait_breaches: number;
  };
  geofence: {
    entries: number;
    exits: number;
    by_day: GeofenceDay[];
  };
  payouts: {
    base_cents: number;
    tip_cents: number;
    bonus_cents: number;
    total_cents: number;
    avg_per_delivery_cents: number;
  };
  hourly: {
    deliveries: { hour: number; count: number }[];
    checkins: { hour: number; count: number }[];
  };
  freshness: {
    latest_status_at: string | null;
    latest_location_at: string | null;
    latest_delivery_at: string | null;
    latest_attendance_at: string | null;
  };
};

type Store = { id: number; name: string };

type Rider = { id: number; name: string; store?: string | null };

const formatPercent = (value: number) => `${Math.round((value || 0) * 100)}%`;

const formatMoney = (cents: number) => {
  const value = (cents || 0) / 100;
  return new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED" }).format(value);
};

const formatMinutes = (value: number) => {
  if (!value) return "0m";
  if (value < 60) return `${value.toFixed(1)}m`;
  return `${(value / 60).toFixed(1)}h`;
};

const formatDateInput = (d: Date) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const rangeFromToday = (days: number) => {
  const end = new Date();
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  return {
    from: formatDateInput(start),
    to: formatDateInput(end),
  };
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "No data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No data";
  return date.toLocaleString();
};

const deltaPercent = (current: number, previous: number, invert = false) => {
  if (!previous) return null;
  const raw = (current - previous) / previous;
  const adjusted = invert ? -raw : raw;
  return adjusted;
};

const formatDelta = (delta: number | null) => {
  if (delta === null) return "No prior data";
  const pct = Math.abs(delta * 100);
  const sign = delta >= 0 ? "+" : "-";
  return `${sign}${pct.toFixed(0)}% vs prev`;
};

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (!values.length) return null;
  const height = 40;
  const width = 100;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = values.length === 1 ? 0 : (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={sparklineSvg}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function KpiCard({
  label,
  value,
  hint,
  trend,
  tone,
  deltaText,
  deltaTone,
}: {
  label: string;
  value: string | number;
  hint: string;
  trend?: number[];
  tone: { bg: string; border: string; accent: string };
  deltaText?: string;
  deltaTone?: string;
}) {
  return (
    <div style={{ ...kpiCard, background: tone.bg, borderColor: tone.border }}>
      <div style={kpiLabel}>{label}</div>
      <div style={kpiValue}>{value}</div>
      <div style={kpiHint}>{hint}</div>
      {deltaText ? <div style={{ ...kpiDelta, color: deltaTone || "#475569" }}>{deltaText}</div> : null}
      {trend && trend.length > 1 ? <Sparkline values={trend} color={tone.accent} /> : null}
    </div>
  );
}

function MiniBars({ data, label }: { data: { date: string; value: number }[]; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div style={chartCard}>
      <div style={chartHeader}>{label}</div>
      <div style={barGrid}>
        {data.map((d) => (
          <div key={d.date} style={barItem}>
            <div style={{ ...barFill, height: `${(d.value / max) * 100}%` }} />
            <span style={barLabel}>{d.date.slice(5)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StackedBar({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((acc, p) => acc + p.value, 0) || 1;
  return (
    <div style={stackedWrap}>
      {parts.map((p) => (
        <span
          key={p.label}
          style={{
            ...stackedPiece,
            width: `${(p.value / total) * 100}%`,
            background: p.color,
          }}
        />
      ))}
    </div>
  );
}

function HeatmapRow({ label, values, color }: { label: string; values: number[]; color: string }) {
  const max = Math.max(1, ...values);
  return (
    <div style={heatmapRow}>
      <div style={heatmapLabel}>{label}</div>
      <div style={heatmapGrid}>
        {values.map((value, idx) => {
          const intensity = value === 0 ? 0.12 : 0.18 + (value / max) * 0.82;
          return (
            <div
              key={`${label}-${idx}`}
              title={`Hour ${idx}: ${value}`}
              style={{
                ...heatCell,
                background: `rgba(${color}, ${intensity})`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

export default function Analytics() {
  const nav = useNavigate();
  const initial = rangeFromToday(7);
  const [fromDate, setFromDate] = useState(initial.from);
  const [toDate, setToDate] = useState(initial.to);
  const [storeFilter, setStoreFilter] = useState("");
  const [riderFilter, setRiderFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const [comparisonView, setComparisonView] = useState<"stores" | "captains">("stores");
  const [stores, setStores] = useState<string[]>([]);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const loadFilters = async () => {
    try {
      const [storesRes, ridersRes] = await Promise.all([
        api.get<Store[]>("/admin/stores"),
        api.get<{ items: Rider[] }>("/admin/riders"),
      ]);
      setStores((storesRes.data || []).map((s) => s.name).filter(Boolean));
      setRiders((ridersRes.data.items || []).map((r) => ({ id: r.id, name: r.name, store: r.store })));
    } catch {
      // ignore filter errors
    }
  };

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await api.get<AnalyticsResponse>("/admin/analytics", {
        params: {
          from: fromDate,
          to: toDate,
          store: storeFilter || undefined,
          rider_id: riderFilter || undefined,
          status: statusFilter || undefined,
          active: activeFilter || undefined,
        },
      });
      setData(res.data);
      setLastRefreshed(new Date());
    } catch (e) {
      setErr(getApiErrorMessage(e, "Failed to load analytics"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFilters();
  }, []);

  useEffect(() => {
    load();
  }, [fromDate, toDate, storeFilter, riderFilter, statusFilter, activeFilter]);

  const attendanceTotals = useMemo(() => {
    if (!data) return { present: 0, late: 0, absent: 0, off_day: 0 };
    return data.trends.attendance.reduce(
      (acc, d) => ({
        present: acc.present + d.present,
        late: acc.late + d.late,
        absent: acc.absent + d.absent,
        off_day: acc.off_day + d.off_day,
      }),
      { present: 0, late: 0, absent: 0, off_day: 0 }
    );
  }, [data]);

  const attendanceRateSeries = useMemo(() => {
    if (!data) return [] as number[];
    return data.trends.attendance.map((d) => {
      const total = d.present + d.late + d.absent + d.off_day;
      return total ? (d.present + d.late) / total : 0;
    });
  }, [data]);

  const insights = useMemo(() => {
    if (!data) return [] as string[];
    const notes: string[] = [];
    if (data.kpis.on_time_rate < 0.85) {
      notes.push(`On-time rate is below 85% (${formatPercent(data.kpis.on_time_rate)}).`);
    }
    if (data.queue_health.p95_available_minutes > 60) {
      notes.push(`Queue p95 wait time is ${formatMinutes(data.queue_health.p95_available_minutes)}.`);
    }
    if (data.queue_health.stale_rider_rate > 0.2) {
      notes.push(`Stale location rate is ${formatPercent(data.queue_health.stale_rider_rate)}.`);
    }
    if (data.kpis.attendance_rate < 0.9) {
      notes.push(`Attendance is below 90% (${formatPercent(data.kpis.attendance_rate)}).`);
    }
    if (!notes.length) {
      notes.push("All key metrics are within healthy thresholds.");
    }
    return notes;
  }, [data]);

  const exportPerformance = (rows: PerformanceRow[], label: string) => {
    exportToExcel(rows, label);
  };

  const exportStores = () => {
    exportToExcel(data?.store_comparison || [], "store_comparison");
  };

  const exportSummary = () => {
    if (!data) return;
    exportToExcel(
      [
        {
          from: data.range.from,
          to: data.range.to,
          total_deliveries: data.kpis.total_deliveries,
          on_time_rate: data.kpis.on_time_rate,
          avg_delivery_minutes: data.kpis.avg_delivery_minutes,
          active_riders: data.kpis.active_riders,
          attendance_rate: data.kpis.attendance_rate,
          payout_total_cents: data.kpis.payout_total_cents,
        },
      ],
      "analytics_summary"
    );
  };

  const exportStatusHistory = async () => {
    try {
      const res = await api.get<{
        items: { rider_id: number; rider_name: string; store?: string | null; status: string; updated_at: string }[];
      }>("/admin/status-history", {
        params: { from: fromDate, to: toDate, store: storeFilter || undefined, rider_id: riderFilter || undefined },
      });
      exportToExcel(res.data.items || [], "status_history");
    } catch (e) {
      setErr(getApiErrorMessage(e, "Failed to export status history"));
    }
  };

  const exportAll = async () => {
    exportSummary();
    exportStores();
    if (data?.captain_comparison?.length) {
      exportToExcel(data.captain_comparison, "captain_comparison");
    }
    if (data?.rider_performance?.top?.length) {
      exportPerformance(data.rider_performance.top, "top_riders");
    }
    if (data?.rider_performance?.bottom?.length) {
      exportPerformance(data.rider_performance.bottom, "bottom_riders");
    }
    await exportStatusHistory();
  };

  const deliverySeries = (data?.trends.deliveries || []).map((d) => d.count);
  const activeSeries = (data?.trends.active_riders || []).map((d) => d.count);
  const deliveryBars = (data?.trends.deliveries || []).map((d) => ({ date: d.date, value: d.count }));
  const activeBars = (data?.trends.active_riders || []).map((d) => ({ date: d.date, value: d.count }));
  const lateBars = (data?.trends.late_checkins || []).map((d) => ({ date: d.date, value: d.count }));

  const previous = data?.previous?.kpis;
  const deltaColor = (delta: number | null) => {
    if (delta === null) return "#64748b";
    return delta >= 0 ? "#16a34a" : "#dc2626";
  };
  const deliveryDelta = previous ? deltaPercent(data.kpis.total_deliveries, previous.total_deliveries) : null;
  const onTimeDelta = previous ? deltaPercent(data.kpis.on_time_rate, previous.on_time_rate) : null;
  const avgDeliveryDelta = previous ? deltaPercent(data.kpis.avg_delivery_minutes, previous.avg_delivery_minutes, true) : null;
  const activeDelta = previous ? deltaPercent(data.kpis.active_riders, previous.active_riders) : null;
  const attendanceDelta = previous ? deltaPercent(data.kpis.attendance_rate, previous.attendance_rate) : null;
  const payoutDelta = previous ? deltaPercent(data.kpis.payout_total_cents, previous.payout_total_cents) : null;

  const hourlyDeliveries = (data?.hourly.deliveries || []).map((h) => h.count);
  const hourlyCheckins = (data?.hourly.checkins || []).map((h) => h.count);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Topbar title="Analytics" />

      <div style={banner}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.7, letterSpacing: 0.3 }}>Operational analytics</div>
          <h2 style={{ margin: 0 }}>Performance and compliance</h2>
          <p style={{ margin: "4px 0 0", opacity: 0.8 }}>
            Track delivery velocity, attendance, queue health, and payout impact.
          </p>
          <div style={{ fontSize: 12, marginTop: 6, color: "#64748b" }}>
            {lastRefreshed ? `Last refreshed ${lastRefreshed.toLocaleTimeString()}` : "Not refreshed yet"}
          </div>
        </div>
        <div style={bannerActions}>
          <button style={ghostBtn} onClick={load} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <button style={ghostBtn} onClick={exportAll} disabled={!data}>
            Export all
          </button>
          <button style={ghostBtn} onClick={exportSummary} disabled={!data}>
            Export summary
          </button>
          <button style={ghostBtn} onClick={exportStatusHistory}>
            Export status history
          </button>
        </div>
      </div>

      <section style={panel}>
        <div style={filtersGrid}>
          <div style={filtersRow}>
            <input style={input} type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            <input style={input} type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            <select style={input} value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)}>
              <option value="">All stores</option>
              {stores.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select style={input} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="available">Available</option>
              <option value="delivery">Delivery</option>
              <option value="break">Break</option>
              <option value="offline">Offline</option>
            </select>
            <select style={input} value={activeFilter} onChange={(e) => setActiveFilter(e.target.value)}>
              <option value="">All accounts</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
            <select style={input} value={riderFilter} onChange={(e) => setRiderFilter(e.target.value)}>
              <option value="">All riders</option>
              {riders.map((r) => (
                <option key={r.id} value={String(r.id)}>
                  {r.name} (#{r.id})
                </option>
              ))}
            </select>
          </div>
          <div style={filtersRow}>
            <button style={ghostBtn} onClick={() => {
              const range = rangeFromToday(7);
              setFromDate(range.from);
              setToDate(range.to);
            }}>Last 7 days</button>
            <button style={ghostBtn} onClick={() => {
              const range = rangeFromToday(30);
              setFromDate(range.from);
              setToDate(range.to);
            }}>Last 30 days</button>
            <button style={ghostBtn} onClick={() => {
              const range = rangeFromToday(90);
              setFromDate(range.from);
              setToDate(range.to);
            }}>Last 90 days</button>
            <div style={chip}>Range {fromDate} to {toDate}</div>
            {data?.previous_range && <div style={chip}>Prev {data.previous_range.from} to {data.previous_range.to}</div>}
            {storeFilter && <div style={chip}>Store {storeFilter}</div>}
            {statusFilter && <div style={chip}>Status {statusFilter}</div>}
            {activeFilter && <div style={chip}>{activeFilter === "active" ? "Active only" : "Inactive only"}</div>}
            {riderFilter && <div style={chip}>Rider #{riderFilter}</div>}
          </div>
        </div>
      </section>

      {err && <div style={alert}>{err}</div>}
      {loading && <div style={alert}>Loading analytics...</div>}

      {data && (
        <>
          <section style={kpiGrid}>
            <KpiCard
              label="Total deliveries"
              value={data.kpis.total_deliveries}
              hint="Completed in range"
              trend={deliverySeries}
              tone={kpiTones.primary}
              deltaText={formatDelta(deliveryDelta)}
              deltaTone={deltaColor(deliveryDelta)}
            />
            <KpiCard
              label="On-time rate"
              value={formatPercent(data.kpis.on_time_rate)}
              hint="Delivered within SLA"
              trend={deliverySeries}
              tone={kpiTones.success}
              deltaText={formatDelta(onTimeDelta)}
              deltaTone={deltaColor(onTimeDelta)}
            />
            <KpiCard
              label="Avg delivery time"
              value={formatMinutes(data.kpis.avg_delivery_minutes)}
              hint="Delivered orders"
              trend={deliverySeries}
              tone={kpiTones.warning}
              deltaText={formatDelta(avgDeliveryDelta)}
              deltaTone={deltaColor(avgDeliveryDelta)}
            />
            <KpiCard
              label="Active riders"
              value={data.kpis.active_riders}
              hint="Latest day snapshot"
              trend={activeSeries}
              tone={kpiTones.neutral}
              deltaText={formatDelta(activeDelta)}
              deltaTone={deltaColor(activeDelta)}
            />
            <KpiCard
              label="Attendance rate"
              value={formatPercent(data.kpis.attendance_rate)}
              hint="Present and late"
              trend={attendanceRateSeries}
              tone={kpiTones.info}
              deltaText={formatDelta(attendanceDelta)}
              deltaTone={deltaColor(attendanceDelta)}
            />
            <KpiCard
              label="Payouts"
              value={formatMoney(data.kpis.payout_total_cents)}
              hint="Base, tips, and bonus"
              trend={deliverySeries}
              tone={kpiTones.money}
              deltaText={formatDelta(payoutDelta)}
              deltaTone={deltaColor(payoutDelta)}
            />
          </section>

          <section style={grid}>
            <MiniBars data={deliveryBars} label="Deliveries" />
            <MiniBars data={activeBars} label="Active riders" />
            <MiniBars data={lateBars} label="Late check-ins" />
          </section>

          <section style={panel}>
            <div style={sectionHeader}>
              <div>
                <div style={sectionLabel}>Insights</div>
                <div style={sectionTitle}>Highlights from the range</div>
              </div>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {insights.map((note) => (
                <div key={note} style={insightRow}>{note}</div>
              ))}
            </div>
          </section>

          <section style={panel}>
            <div style={sectionHeader}>
              <div>
                <div style={sectionLabel}>Attendance</div>
                <div style={sectionTitle}>Daily attendance mix</div>
              </div>
              <div style={pill("#e0f2fe", "#0369a1")}>
                Present {attendanceTotals.present} / Late {attendanceTotals.late}
              </div>
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              {data.trends.attendance.map((d) => (
                <div key={d.date} style={attendanceRow}>
                  <div style={{ fontWeight: 700 }}>{d.date}</div>
                  <StackedBar
                    parts={[
                      { label: "present", value: d.present, color: "#4ade80" },
                      { label: "late", value: d.late, color: "#facc15" },
                      { label: "absent", value: d.absent, color: "#f87171" },
                      { label: "off", value: d.off_day, color: "#94a3b8" },
                    ]}
                  />
                  <div style={muted}>
                    P {d.present} / L {d.late} / A {d.absent} / O {d.off_day}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section style={grid}>
            <div style={panel}>
              <div style={sectionHeader}>
                <div>
                  <div style={sectionLabel}>Time of day</div>
                  <div style={sectionTitle}>Heatmap for deliveries and check-ins</div>
                </div>
              </div>
              <HeatmapRow label="Deliveries" values={hourlyDeliveries} color="14,116,144" />
              <HeatmapRow label="Check-ins" values={hourlyCheckins} color="22,163,74" />
              <div style={heatmapTicks}>
                {[0, 6, 12, 18, 23].map((hour) => (
                  <span key={hour} style={heatmapTick}>{hour}h</span>
                ))}
              </div>
            </div>

            <div style={panel}>
              <div style={sectionHeader}>
                <div>
                  <div style={sectionLabel}>Data freshness</div>
                  <div style={sectionTitle}>Latest events in the system</div>
                </div>
              </div>
              <div style={freshnessGrid}>
                <div style={freshnessItem}>
                  <div style={miniLabel}>Latest status</div>
                  <div style={freshnessValue}>{formatDateTime(data.freshness.latest_status_at)}</div>
                </div>
                <div style={freshnessItem}>
                  <div style={miniLabel}>Latest location</div>
                  <div style={freshnessValue}>{formatDateTime(data.freshness.latest_location_at)}</div>
                </div>
                <div style={freshnessItem}>
                  <div style={miniLabel}>Latest delivery</div>
                  <div style={freshnessValue}>{formatDateTime(data.freshness.latest_delivery_at)}</div>
                </div>
                <div style={freshnessItem}>
                  <div style={miniLabel}>Latest attendance</div>
                  <div style={freshnessValue}>{formatDateTime(data.freshness.latest_attendance_at)}</div>
                </div>
              </div>
            </div>
          </section>

          <section style={grid}>
            <div style={panel}>
              <div style={sectionHeader}>
                <div>
                  <div style={sectionLabel}>Top performers</div>
                  <div style={sectionTitle}>Best on-time riders</div>
                </div>
                <button style={ghostBtn} onClick={() => exportPerformance(data.rider_performance.top, "top_riders")}>
                  Export
                </button>
              </div>
              {data.rider_performance.top.length === 0 ? (
                <div style={empty}>No data.</div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {data.rider_performance.top.map((r) => (
                    <div key={r.rider_id} style={row}>
                      <div>
                        <div style={{ fontWeight: 700 }}>{r.name}</div>
                        <div style={muted}>{r.store || "Unassigned"} - #{r.rider_id}</div>
                      </div>
                      <div style={muted}>Deliveries {r.deliveries}</div>
                      <div style={muted}>On-time {formatPercent(r.on_time_rate)}</div>
                      <div style={muted}>{formatMinutes(r.avg_delivery_minutes)}</div>
                      <div style={rowActions}>
                        <button style={tinyBtn} onClick={() => nav(`/admin/tracking?rider_id=${r.rider_id}`)}>
                          View on map
                        </button>
                        <button style={tinyBtn} onClick={() => nav(`/admin/management?search=${encodeURIComponent(String(r.rider_id))}`)}>
                          View rider
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={panel}>
              <div style={sectionHeader}>
                <div>
                  <div style={sectionLabel}>Needs attention</div>
                  <div style={sectionTitle}>Lowest on-time rate</div>
                </div>
                <button style={ghostBtn} onClick={() => exportPerformance(data.rider_performance.bottom, "bottom_riders")}>
                  Export
                </button>
              </div>
              {data.rider_performance.bottom.length === 0 ? (
                <div style={empty}>No data.</div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {data.rider_performance.bottom.map((r) => (
                    <div key={r.rider_id} style={row}>
                      <div>
                        <div style={{ fontWeight: 700 }}>{r.name}</div>
                        <div style={muted}>{r.store || "Unassigned"} - #{r.rider_id}</div>
                      </div>
                      <div style={muted}>Deliveries {r.deliveries}</div>
                      <div style={muted}>On-time {formatPercent(r.on_time_rate)}</div>
                      <div style={muted}>Cancel {formatPercent(r.cancel_rate)}</div>
                      <div style={rowActions}>
                        <button style={tinyBtn} onClick={() => nav(`/admin/tracking?rider_id=${r.rider_id}`)}>
                          View on map
                        </button>
                        <button style={tinyBtn} onClick={() => nav(`/admin/management?search=${encodeURIComponent(String(r.rider_id))}`)}>
                          View rider
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section style={panel}>
            <div style={sectionHeader}>
              <div>
                <div style={sectionLabel}>Stores</div>
                <div style={sectionTitle}>Store and captain comparison</div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <div style={toggleGroup}>
                  <button
                    style={comparisonView === "stores" ? toggleActive : toggleBtn}
                    onClick={() => setComparisonView("stores")}
                  >
                    Stores
                  </button>
                  <button
                    style={comparisonView === "captains" ? toggleActive : toggleBtn}
                    onClick={() => setComparisonView("captains")}
                  >
                    Captains
                  </button>
                </div>
                <button
                  style={ghostBtn}
                  onClick={comparisonView === "stores" ? exportStores : () => exportToExcel(data.captain_comparison || [], "captain_comparison")}
                >
                  Export
                </button>
              </div>
            </div>
            {comparisonView === "stores" ? (
              data.store_comparison.length === 0 ? (
                <div style={empty}>No store data.</div>
              ) : (
                <div style={tableWrap}>
                  <table style={{ width: "100%" }}>
                    <thead>
                      <tr>
                        <th>Store</th>
                        <th>Deliveries</th>
                        <th>Avg time</th>
                        <th>Active riders</th>
                        <th>Attendance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.store_comparison.map((s) => (
                        <tr key={s.store}>
                          <td style={{ fontWeight: 700 }}>{s.store}</td>
                          <td>{s.deliveries}</td>
                          <td>{formatMinutes(s.avg_delivery_minutes)}</td>
                          <td>{s.active_riders}</td>
                          <td>{formatPercent(s.attendance_rate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              data.captain_comparison.length === 0 ? (
                <div style={empty}>No captain data.</div>
              ) : (
                <div style={tableWrap}>
                  <table style={{ width: "100%" }}>
                    <thead>
                      <tr>
                        <th>Captain</th>
                        <th>Store</th>
                        <th>Deliveries</th>
                        <th>Avg time</th>
                        <th>Active riders</th>
                        <th>Attendance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.captain_comparison.map((c) => (
                        <tr key={`${c.captain}-${c.store}`}>
                          <td style={{ fontWeight: 700 }}>{c.captain}</td>
                          <td>{c.store}</td>
                          <td>{c.deliveries}</td>
                          <td>{formatMinutes(c.avg_delivery_minutes)}</td>
                          <td>{c.active_riders}</td>
                          <td>{formatPercent(c.attendance_rate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </section>

          <section style={grid}>
            <div style={panel}>
              <div style={sectionHeader}>
                <div>
                  <div style={sectionLabel}>Queue health</div>
                  <div style={sectionTitle}>Availability and waiting</div>
                </div>
              </div>
              <div style={kpiRow}>
                <div style={miniCard}>
                  <div style={miniLabel}>Avg wait</div>
                  <div style={miniValue}>{formatMinutes(data.queue_health.avg_available_minutes)}</div>
                </div>
                <div style={miniCard}>
                  <div style={miniLabel}>P95 wait</div>
                  <div style={miniValue}>{formatMinutes(data.queue_health.p95_available_minutes)}</div>
                </div>
                <div style={miniCard}>
                  <div style={miniLabel}>Peak waiting</div>
                  <div style={miniValue}>{data.queue_health.peak_waiting}</div>
                </div>
                <div style={miniCard}>
                  <div style={miniLabel}>Stale rate</div>
                  <div style={miniValue}>{formatPercent(data.queue_health.stale_rider_rate)}</div>
                </div>
                <div style={miniCard}>
                  <div style={miniLabel}>Delivery SLA breaches</div>
                  <div style={miniValue}>{data.sla.delivery_breaches}</div>
                </div>
                <div style={miniCard}>
                  <div style={miniLabel}>Queue wait breaches</div>
                  <div style={miniValue}>{data.sla.queue_wait_breaches}</div>
                </div>
              </div>
              <div style={muted}>Samples: queue {data.queue_health.samples} / deliveries {data.sla.delivery_total}</div>
            </div>

            <div style={panel}>
              <div style={sectionHeader}>
                <div>
                  <div style={sectionLabel}>Geofences</div>
                  <div style={sectionTitle}>Compliance</div>
                </div>
              </div>
              <div style={kpiRow}>
                <div style={miniCard}>
                  <div style={miniLabel}>Entries</div>
                  <div style={miniValue}>{data.geofence.entries}</div>
                </div>
                <div style={miniCard}>
                  <div style={miniLabel}>Exits</div>
                  <div style={miniValue}>{data.geofence.exits}</div>
                </div>
              </div>
              <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                {data.geofence.by_day.map((d) => (
                  <div key={d.date} style={row}>
                    <div style={{ fontWeight: 700 }}>{d.date}</div>
                    <div style={muted}>Entries {d.entries}</div>
                    <div style={muted}>Exits {d.exits}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section style={panel}>
            <div style={sectionHeader}>
              <div>
                <div style={sectionLabel}>Payouts</div>
                <div style={sectionTitle}>Earnings breakdown</div>
              </div>
            </div>
            <div style={kpiRow}>
              <div style={miniCard}>
                <div style={miniLabel}>Base</div>
                <div style={miniValue}>{formatMoney(data.payouts.base_cents)}</div>
              </div>
              <div style={miniCard}>
                <div style={miniLabel}>Tips</div>
                <div style={miniValue}>{formatMoney(data.payouts.tip_cents)}</div>
              </div>
              <div style={miniCard}>
                <div style={miniLabel}>Bonus</div>
                <div style={miniValue}>{formatMoney(data.payouts.bonus_cents)}</div>
              </div>
              <div style={miniCard}>
                <div style={miniLabel}>Avg per delivery</div>
                <div style={miniValue}>{formatMoney(data.payouts.avg_per_delivery_cents)}</div>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

const banner: React.CSSProperties = {
  background: "white",
  borderRadius: 14,
  padding: 16,
  boxShadow: "0 10px 24px rgba(0,0,0,0.06)",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
};

const bannerActions: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
};

const panel: React.CSSProperties = {
  background: "white",
  borderRadius: 14,
  padding: 14,
  boxShadow: "0 10px 24px rgba(0,0,0,0.06)",
  display: "grid",
  gap: 10,
};

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12,
};

const kpiGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: 12,
};

const kpiCard: React.CSSProperties = {
  borderRadius: 14,
  padding: 14,
  border: "1px solid #e5e7eb",
  display: "grid",
  gap: 6,
  minHeight: 132,
};

const kpiLabel: React.CSSProperties = { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4, opacity: 0.6 };
const kpiValue: React.CSSProperties = { fontSize: 26, fontWeight: 800 };
const kpiHint: React.CSSProperties = { fontSize: 12, opacity: 0.7 };
const kpiDelta: React.CSSProperties = { fontSize: 12, fontWeight: 700 };

const kpiTones = {
  primary: { bg: "#eef2ff", border: "#c7d2fe", accent: "#4338ca" },
  success: { bg: "#ecfdf3", border: "#bbf7d0", accent: "#16a34a" },
  warning: { bg: "#fff7ed", border: "#fed7aa", accent: "#ea580c" },
  neutral: { bg: "#f8fafc", border: "#e2e8f0", accent: "#475569" },
  info: { bg: "#eff6ff", border: "#bfdbfe", accent: "#2563eb" },
  money: { bg: "#f0fdf4", border: "#bbf7d0", accent: "#16a34a" },
};

const row: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 10px",
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  background: "#f8fafc",
  gap: 8,
  flexWrap: "wrap",
};

const rowActions: React.CSSProperties = {
  display: "flex",
  gap: 6,
  flexWrap: "wrap",
};

const attendanceRow: React.CSSProperties = {
  display: "grid",
  gap: 6,
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  background: "#f8fafc",
};

const input: React.CSSProperties = { padding: "8px 10px", borderRadius: 10, border: "1px solid #e5e7eb" };

const ghostBtn: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  background: "white",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: 12,
};

const tinyBtn: React.CSSProperties = {
  padding: "6px 8px",
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  background: "#fff",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: 11,
};

const alert: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  background: "#fee2e2",
  color: "#991b1b",
  fontWeight: 700,
};

const filtersGrid: React.CSSProperties = {
  display: "grid",
  gap: 10,
};

const filtersRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  alignItems: "center",
};

const sectionHeader: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
};

const sectionLabel: React.CSSProperties = { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4, opacity: 0.6 };
const sectionTitle: React.CSSProperties = { fontSize: 18, fontWeight: 800 };

const pill = (bg: string, color = "#0f172a"): React.CSSProperties => ({
  padding: "6px 10px",
  borderRadius: 999,
  background: bg,
  color,
  fontSize: 12,
  fontWeight: 700,
});

const chip: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 999,
  background: "#f1f5f9",
  color: "#334155",
  fontSize: 12,
  fontWeight: 700,
};

const chartCard: React.CSSProperties = {
  background: "white",
  borderRadius: 14,
  padding: 12,
  boxShadow: "0 10px 24px rgba(0,0,0,0.06)",
  display: "grid",
  gap: 8,
};

const toggleGroup: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: 4,
  borderRadius: 999,
  background: "#f1f5f9",
  border: "1px solid #e2e8f0",
};

const toggleBtn: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 999,
  border: "1px solid transparent",
  background: "transparent",
  fontWeight: 700,
  fontSize: 12,
  cursor: "pointer",
  color: "#475569",
};

const toggleActive: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 999,
  border: "1px solid #c7d2fe",
  background: "#eef2ff",
  fontWeight: 700,
  fontSize: 12,
  cursor: "pointer",
  color: "#1e3a8a",
};

const chartHeader: React.CSSProperties = { fontWeight: 800 };

const barGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(22px, 1fr))",
  gap: 6,
  alignItems: "end",
  minHeight: 120,
};

const barItem: React.CSSProperties = {
  display: "grid",
  alignItems: "end",
  justifyItems: "center",
  gap: 4,
};

const barFill: React.CSSProperties = {
  width: "100%",
  borderRadius: 8,
  background: "linear-gradient(180deg,#3b82f6,#0ea5e9)",
};

const barLabel: React.CSSProperties = { fontSize: 10, color: "#64748b" };

const kpiRow: React.CSSProperties = {
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

const empty: React.CSSProperties = {
  padding: 12,
  border: "1px dashed #e5e7eb",
  borderRadius: 10,
  color: "#6b7280",
  textAlign: "center",
};

const muted: React.CSSProperties = { fontSize: 12, opacity: 0.7 };

const stackedWrap: React.CSSProperties = {
  display: "flex",
  width: "100%",
  height: 10,
  borderRadius: 999,
  overflow: "hidden",
  background: "#e2e8f0",
};

const stackedPiece: React.CSSProperties = {
  height: "100%",
};

const tableWrap: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  overflow: "hidden",
};

const heatmapRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "120px 1fr",
  gap: 10,
  alignItems: "center",
};

const heatmapLabel: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "#475569",
};

const heatmapGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(24, minmax(0, 1fr))",
  gap: 4,
};

const heatCell: React.CSSProperties = {
  height: 16,
  borderRadius: 4,
  border: "1px solid rgba(15, 23, 42, 0.08)",
};

const heatmapTicks: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
  gap: 6,
  marginTop: 8,
  fontSize: 11,
  color: "#64748b",
};

const heatmapTick: React.CSSProperties = {
  textAlign: "center",
};

const freshnessGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: 10,
};

const freshnessItem: React.CSSProperties = {
  padding: 10,
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  background: "#f8fafc",
  display: "grid",
  gap: 6,
};

const freshnessValue: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: "#0f172a",
};

const sparklineSvg: React.CSSProperties = {
  width: "100%",
  height: 40,
  marginTop: 6,
};

const insightRow: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #e2e8f0",
  background: "#f8fafc",
  fontSize: 13,
  color: "#0f172a",
};
