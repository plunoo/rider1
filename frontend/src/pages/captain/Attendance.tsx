import { useEffect, useMemo, useState } from "react";
import { Topbar } from "../../components/Layout/Topbar";
import { exportToExcel } from "../../utils/exportExcel";
import { api } from "../../api/client";
import { getApiErrorMessage } from "../../api/errors";

type Status = "present" | "absent" | "off_day" | "late";
type AttendanceItem = { id: number; rider_id: number; rider_name: string; date: string; status: Status };
type CalendarDay = { id: string; day: string; date: string; events: { rider: string; status: Status }[] };

const statusMeta: Record<Status, { bg: string; color: string; label: string }> = {
  present: { bg: "#e0f2fe", color: "#0369a1", label: "Present" },
  absent: { bg: "#fee2e2", color: "#b91c1c", label: "Absent" },
  off_day: { bg: "#f3e8ff", color: "#7e22ce", label: "Off Day" },
  late: { bg: "#fef9c3", color: "#a16207", label: "Late" },
};

const toDateInput = (d: Date) => d.toISOString().slice(0, 10);

export default function CaptainAttendance() {
  const today = new Date();
  const [fromDate, setFromDate] = useState(toDateInput(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6)));
  const [toDate, setToDate] = useState(toDateInput(today));
  const [items, setItems] = useState<AttendanceItem[]>([]);
  const [filter, setFilter] = useState<Status | "all">("all");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [riderIdFilter, setRiderIdFilter] = useState("");

  const [markRiderId, setMarkRiderId] = useState("");
  const [markDate, setMarkDate] = useState(toDateInput(today));
  const [markStatus, setMarkStatus] = useState<Status>("present");

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await api.get<AttendanceItem[]>("/captain/attendance", {
        params: { from: fromDate, to: toDate },
      });
      setItems(res.data || []);
    } catch (e) {
      setErr(getApiErrorMessage(e, "Failed to load attendance"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [fromDate, toDate]);

  const grouped = useMemo(() => {
    const byDate = new Map<string, CalendarDay>();
    items.forEach((i) => {
      if (filter !== "all" && i.status !== filter) return;
      if (riderIdFilter.trim() && String(i.rider_id) !== riderIdFilter.trim()) return;
      const q = search.trim().toLowerCase();
      if (q && !i.rider_name.toLowerCase().includes(q) && !String(i.rider_id).includes(q)) return;
      const key = i.date;
      if (!byDate.has(key)) {
        const d = new Date(key);
        byDate.set(key, {
          id: key,
          day: d.toLocaleDateString("en-US", { weekday: "short" }),
          date: key,
          events: [],
        });
      }
      byDate.get(key)!.events.push({ rider: i.rider_name, status: i.status });
    });
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [items, filter, search, riderIdFilter]);

  const exportRows = useMemo(
    () =>
      items.map((i) => ({
        date: i.date,
        rider: i.rider_name,
        status: statusMeta[i.status].label,
      })),
    [items]
  );

  const markAttendance = async () => {
    if (!/^\d+$/.test(markRiderId)) {
      setErr("Rider ID must be a number");
      return;
    }
    setErr(null);
    try {
      await api.post("/captain/attendance/mark", {
        rider_id: Number(markRiderId),
        date: markDate,
        status: markStatus,
      });
      await load();
      setMarkRiderId("");
    } catch (e) {
      setErr(getApiErrorMessage(e, "Failed to mark attendance"));
    }
  };

  const hasEvents = grouped.some((d) => d.events.length > 0);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Topbar title="Attendance" />

      <section style={toolbar}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Date range</div>
          <h3 style={{ margin: 0 }}>{hasEvents ? "Attendance records" : "No attendance yet"}</h3>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input style={dateInput} type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <input style={dateInput} type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          <input
            style={dateInput}
            placeholder="Search rider"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <input
            style={dateInput}
            placeholder="Rider ID"
            value={riderIdFilter}
            onChange={(e) => setRiderIdFilter(e.target.value)}
          />
          {(["all", "present", "late", "off_day", "absent"] as const).map((s) => (
            <button key={s} style={{ ...chip, ...(filter === s ? chipActive : {}) }} onClick={() => setFilter(s)}>
              {s === "all" ? "All" : statusMeta[s].label}
            </button>
          ))}
          <button style={ghostBtn} onClick={() => exportToExcel(exportRows, "attendance")} disabled={items.length === 0}>
            Export
          </button>
        </div>
      </section>

      <section style={panel}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Mark attendance</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            style={dateInput}
            placeholder="Rider ID"
            value={markRiderId}
            onChange={(e) => setMarkRiderId(e.target.value)}
          />
          <input style={dateInput} type="date" value={markDate} onChange={(e) => setMarkDate(e.target.value)} />
          <select style={dateInput} value={markStatus} onChange={(e) => setMarkStatus(e.target.value as Status)}>
            {(Object.keys(statusMeta) as Status[]).map((s) => (
              <option key={s} value={s}>
                {statusMeta[s].label}
              </option>
            ))}
          </select>
          <button style={ghostBtn} onClick={markAttendance}>Save</button>
        </div>
      </section>

      {err && <div style={alert}>{err}</div>}
      {loading && <div style={alert}>Loading attendance...</div>}

      {!hasEvents ? (
        <section style={grid}>
          <div style={dayCard}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>No attendance yet</div>
            <div style={{ fontSize: 13, opacity: 0.75 }}>Records will appear once riders sign in.</div>
          </div>
        </section>
      ) : (
        <section style={grid}>
          {grouped.map((d) => {
            const counts: Record<Status, number> = { present: 0, absent: 0, off_day: 0, late: 0 };
            d.events.forEach((e) => {
              counts[e.status] += 1;
            });
            return (
              <div key={d.id} style={dayCard}>
                <div style={dayHeader}>
                  <div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>{d.day}</div>
                    <div style={{ fontWeight: 800 }}>{d.date}</div>
                  </div>
                  <div style={dayBadges}>
                    {Object.entries(counts).map(([k, v]) => (
                      <span key={k} style={tinyBadge(statusMeta[k as Status].color, statusMeta[k as Status].bg)}>{v}</span>
                    ))}
                  </div>
                </div>
                {d.events.length === 0 ? (
                  <div style={{ opacity: 0.6, fontSize: 12 }}>No records</div>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {d.events.map((e, idx) => (
                      <div key={idx} style={eventCard(statusMeta[e.status].bg, statusMeta[e.status].color)}>
                        <div style={{ fontWeight: 700 }}>{e.rider}</div>
                        <div style={{ fontSize: 12, opacity: 0.75 }}>{statusMeta[e.status].label}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

const toolbar: React.CSSProperties = {
  background: "white",
  borderRadius: 14,
  padding: 14,
  boxShadow: "0 10px 24px rgba(0,0,0,0.06)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
};

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12,
};

const dayCard: React.CSSProperties = {
  background: "white",
  borderRadius: 14,
  padding: 12,
  boxShadow: "0 8px 18px rgba(0,0,0,0.06)",
  display: "grid",
  gap: 10,
};

const dayHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
};

const dayBadges: React.CSSProperties = { display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" };

const eventCard = (bg: string, color: string): React.CSSProperties => ({
  background: bg,
  color,
  borderRadius: 12,
  padding: 10,
  boxShadow: "0 4px 10px rgba(0,0,0,0.05)",
});

const chip: React.CSSProperties = { padding: "8px 12px", borderRadius: 999, border: "1px solid #e5e7eb", background: "white", cursor: "pointer", fontWeight: 700 };
const chipActive: React.CSSProperties = { background: "#e0f2fe", color: "#0ea5e9", borderColor: "#0ea5e9" };

const ghostBtn: React.CSSProperties = { padding: "8px 12px", borderRadius: 10, border: "1px solid #e5e7eb", background: "white", fontWeight: 700, cursor: "pointer" };
const dateInput: React.CSSProperties = { padding: "8px 10px", borderRadius: 10, border: "1px solid #e5e7eb", minWidth: 120 };

const tinyBadge = (color: string, bg: string): React.CSSProperties => ({
  padding: "4px 8px",
  borderRadius: 999,
  fontSize: 11,
  color,
  background: bg,
  fontWeight: 700,
});

const panel: React.CSSProperties = {
  background: "white",
  borderRadius: 14,
  padding: 14,
  boxShadow: "0 10px 24px rgba(0,0,0,0.06)",
  display: "grid",
  gap: 10,
};

const alert: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  background: "#fee2e2",
  color: "#991b1b",
  fontWeight: 700,
};
