import { useEffect, useMemo, useState } from "react";
import "./Shifts.css";
import { Topbar } from "../../components/Layout/Topbar";
import { api } from "../../api/client";
import { getApiErrorMessage } from "../../api/errors";
import { exportToExcel } from "../../utils/exportExcel";

type Tone = "green" | "blue" | "pink" | "yellow";

type ApiShift = {
  id: number;
  rider_id: number;
  start_time: string;
  end_time: string;
};

type GroupedShift = {
  riderId: number;
  riderName: string;
  days: Record<
    string,
    Array<{ time: string; blocks: string; tone: Tone; breakLabel?: string }>
  >;
};

type ViewMode = "calendar" | "list";

const tones: Tone[] = ["green", "blue", "pink", "yellow"];

// Helpers
const startOfWeek = (date: Date) => {
  const d = new Date(date);
  const diff = d.getDay(); // Sunday as day 0
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - diff);
  return d;
};

const addDays = (date: Date, days: number) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

const fmtDayKey = (d: Date) => d.toISOString().slice(0, 10);

const fmtDayLabel = (d: Date) =>
  d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

const fmtWeekRange = (start: Date) => {
  const end = addDays(start, 6);
  return `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${end.toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric" }
  )}`;
};

export default function Shifts() {
  const [view, setView] = useState<ViewMode>("calendar");
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [shifts, setShifts] = useState<ApiShift[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [riderId, setRiderId] = useState("");
  const [riderName, setRiderName] = useState("");
  const [start, setStart] = useState("");
  const [breakTime, setBreakTime] = useState("");
  const [end, setEnd] = useState("");
  const [saving, setSaving] = useState(false);
  const [breaks, setBreaks] = useState<Record<number, string>>({});

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekRangeLabel = useMemo(() => fmtWeekRange(weekStart), [weekStart]);

  const weekShiftData = useMemo(() => {
    const startDate = weekStart.getTime();
    const endDate = addDays(weekStart, 7).getTime();

    const grouped = new Map<number, GroupedShift>();

    shifts.forEach((s, idx) => {
      const st = new Date(s.start_time);
      const et = new Date(s.end_time);
      if (st.getTime() < startDate || st.getTime() >= endDate) return;

      const key = fmtDayKey(st);
      const tone = tones[idx % tones.length];

      const rider = grouped.get(s.rider_id) || {
        riderId: s.rider_id,
        riderName: `Rider #${s.rider_id}`,
        days: {},
      };

      const blocks = rider.days[key] || [];
      blocks.push({
        time: st.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
        blocks: `${Math.max(1, Math.round((et.getTime() - st.getTime()) / (60 * 60 * 1000)))}h`,
        tone,
        breakLabel: breaks[s.id],
      });
      rider.days[key] = blocks;
      grouped.set(s.rider_id, rider);
    });

    return Array.from(grouped.values());
  }, [shifts, weekStart, breaks]);

  const rosterStats = useMemo(() => {
    const counts: Record<string, number> = {};
    weekDays.forEach((d) => (counts[fmtDayKey(d)] = 0));
    weekShiftData.forEach((r) => {
      Object.entries(r.days).forEach(([dayKey, list]) => {
        counts[dayKey] = (counts[dayKey] || 0) + list.length;
      });
    });
    return counts;
  }, [weekDays, weekShiftData]);

  const loadShifts = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<ApiShift[]>("/shifts/list");
      setShifts(res.data);
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Failed to load shifts"));
    } finally {
      setLoading(false);
    }
  };

  const persistBreaks = (next: Record<number, string>) => {
    setBreaks(next);
    localStorage.setItem("shiftBreaks", JSON.stringify(next));
  };

  const createShift = async () => {
    if (!riderId || !start || !end) return;
    if (!/^\d+$/.test(riderId)) {
      setError("Rider ID must be a number");
      return;
    }
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      setError("Please provide valid start and end times");
      return;
    }
    if (endDate <= startDate) {
      setError("End time must be after start time");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await api.post<ApiShift>("/shifts/create", {
        rider_id: Number(riderId),
        start_time: startDate.toISOString(),
        end_time: endDate.toISOString(),
      });
      // record break locally
      const created = res.data;
      if (breakTime) {
        const next = { ...breaks, [created.id]: breakTime };
        persistBreaks(next);
      }
      // keep in-memory list fresh without refetch
      setShifts((prev) => [...prev, created]);
      setShowModal(false);
      setRiderId("");
      setRiderName("");
      setStart("");
      setBreakTime("");
      setEnd("");
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Failed to create shift"));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const raw = localStorage.getItem("shiftBreaks");
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        setBreaks(parsed);
      } catch {
        setBreaks({});
      }
    }
    loadShifts();
  }, []);

  return (
    <div className="shift-page">
      <Topbar title="Shifts" />

      <section className="shift-toolbar">
        <div className="toolbar-left">
          <button className="pill-btn" onClick={() => setWeekStart(addDays(weekStart, -7))}>
            <
          </button>
          <div>
            <div className="week-label">Week of {weekRangeLabel}</div>
            <div className="week-range">{weekDays[0].getFullYear()}</div>
          </div>
          <button className="pill-btn" onClick={() => setWeekStart(addDays(weekStart, 7))}>
            >
          </button>
        </div>

        <div className="toolbar-right">
          <div className="view-tabs">
            <button
              className={`tab-btn ${view === "calendar" ? "is-active" : ""}`}
              onClick={() => setView("calendar")}
            >
              Calendar
            </button>
            <button className={`tab-btn ${view === "list" ? "is-active" : ""}`} onClick={() => setView("list")}>
              List
            </button>
          </div>
          <button
            className="ghost-btn"
            onClick={() =>
              exportToExcel(
                shifts.map((s) => ({
                  rider_id: s.rider_id,
                  start_time: s.start_time,
                  end_time: s.end_time,
                })),
                "shifts"
              )
            }
            disabled={shifts.length === 0}
          >
            Export
          </button>
          <button className="primary-btn" onClick={() => setShowModal(true)}>
            Add Shift
          </button>
        </div>
      </section>

      {error && <div className="alert error">{error}</div>}
      {loading && <div className="alert">Loading shifts...</div>}

      {view === "calendar" ? (
        <section className="shift-board">
          <div className="shift-grid shift-head">
            <div className="head-cell riders-col">Riders</div>
            {weekDays.map((d) => {
              const dayKey = fmtDayKey(d);
              return (
                <div key={dayKey} className="head-cell">
                  <div className="day-top">
                    <span className="day-label">{fmtDayLabel(d)}</span>
                    <span className="more-dots">...</span>
                  </div>
                  <div className="roster-line">
                    <span className="alert-dot">!</span>
                    <span className="roster-text">{rosterStats[dayKey] || 0} scheduled</span>
                  </div>
                  <div className="auto-roster">Auto-roster</div>
                  <div className="scheduled-count">{rosterStats[dayKey] || 0}</div>
                </div>
              );
            })}
          </div>

          <div className="shift-body">
            {weekShiftData.length === 0 ? (
              <div className="empty-state">No shifts in this week yet.</div>
            ) : (
              weekShiftData.map((rider) => (
                <div key={rider.riderId} className="shift-grid shift-row">
                  <div className="rider-cell">
                    <div className="rider-name">{rider.riderName}</div>
                    <div className="rider-meta">ID: {rider.riderId}</div>
                  </div>

                  {weekDays.map((d) => {
                    const dayKey = fmtDayKey(d);
                    const blocks = rider.days[dayKey] || [];
                    return (
                      <div key={dayKey} className="shift-cell">
                        {blocks.length === 0 ? (
                          <div className="empty-cell">No shift</div>
                        ) : (
                          <div className="cell-stack">
                        {blocks.map((s, idx) => (
                          <div key={idx} className={`shift-block tone-${s.tone}`}>
                            <div className="shift-time">{s.time}</div>
                            <div className="shift-blocks">{s.blocks}</div>
                            {s.breakLabel && <div className="shift-break">Break: {s.breakLabel}</div>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </section>
      ) : (
        <section className="list-view">
          <div className="list-head">
            <div>Rider</div>
            <div>Start</div>
            <div>End</div>
          </div>
          {shifts.length === 0 ? (
            <div className="empty-state">No shifts recorded.</div>
          ) : (
            shifts.map((s) => (
              <div key={s.id} className="list-row">
                <div>#{s.rider_id}</div>
                <div>{new Date(s.start_time).toLocaleString()}</div>
                <div>{new Date(s.end_time).toLocaleString()}</div>
              </div>
            ))
          )}
        </section>
      )}

      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add Shift</h3>
              <button className="pill-btn" onClick={() => setShowModal(false)}>
                x
              </button>
            </div>
            <div className="form-grid">
              <label className="form-field">
                <span className="field-label">Rider Name</span>
                <input value={riderName} onChange={(e) => setRiderName(e.target.value)} placeholder="e.g. Ali" />
              </label>
              <label className="form-field">
                <span className="field-label">Rider ID</span>
                <input value={riderId} onChange={(e) => setRiderId(e.target.value)} placeholder="e.g. 2" />
              </label>
              <label className="form-field">
                <span className="field-label">Shift Start</span>
                <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
              </label>
              <label className="form-field">
                <span className="field-label">Break Time</span>
                <input type="time" value={breakTime} onChange={(e) => setBreakTime(e.target.value)} placeholder="e.g. 13:00" />
              </label>
              <label className="form-field">
                <span className="field-label">Closing Time</span>
                <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
              </label>
            </div>
            <div className="modal-actions">
              <button className="ghost-btn" onClick={() => setShowModal(false)}>
                Cancel
              </button>
              <button className="primary-btn" onClick={createShift} disabled={!riderId || !start || !end || saving}>
                {saving ? "Saving..." : "Save shift"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
