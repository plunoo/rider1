import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Topbar } from "../../components/Layout/Topbar";
import { api } from "../../api/client";
import { getApiErrorMessage } from "../../api/errors";

type Rider = {
  id: number;
  username: string;
  name: string;
  store?: string | null;
  status: string;
  updated_at?: string | null;
  is_active: boolean;
};

type LiveLocation = {
  rider_id: number;
  last_seen_minutes?: number | null;
  is_stale?: boolean | null;
  updated_at?: string | null;
};

type RiderNote = {
  rider_id: number;
  note: string;
  updated_at?: string | null;
};

type Store = { id: number; name: string; default_base_pay_cents?: number };
type QueuePin = { rider_id: number; created_at?: string | null };

type RiderRow = Rider & {
  last_seen_minutes?: number | null;
  is_stale?: boolean | null;
  note?: string;
};

const DELIVERY_SLA_MINUTES = 45;
const AVAILABLE_SLA_MINUTES = 60;

export default function Management() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const [items, setItems] = useState<RiderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [stores, setStores] = useState<Store[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [storeFilter, setStoreFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [staleOnly, setStaleOnly] = useState(false);
  const [pinned, setPinned] = useState<number[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkLoading, setBulkLoading] = useState(false);
  const [dispatchRiderId, setDispatchRiderId] = useState("");
  const [dispatchRef, setDispatchRef] = useState("");
  const [dispatchStore, setDispatchStore] = useState("");
  const [dispatchPay, setDispatchPay] = useState("");
  const [dispatchLoading, setDispatchLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const [ridersRes, liveRes, storesRes] = await Promise.all([
        api.get<{ items: Rider[] }>("/admin/riders"),
        api.get<LiveLocation[]>("/tracking/live"),
        api.get<Store[]>("/admin/stores"),
      ]);
      const notesRes = await api.get<RiderNote[]>("/admin/rider-notes").catch(() => ({ data: [] }));
      const pinsRes = await api.get<QueuePin[]>("/admin/queue-pins").catch(() => ({ data: [] }));
      const liveMap = new Map<number, LiveLocation>();
      (liveRes.data || []).forEach((l) => liveMap.set(l.rider_id, l));
      const noteMap = new Map<number, RiderNote>();
      (notesRes.data || []).forEach((n) => noteMap.set(n.rider_id, n));
      const merged: RiderRow[] = (ridersRes.data.items || []).map((r) => {
        const live = liveMap.get(r.id);
        const note = noteMap.get(r.id);
        return {
          ...r,
          last_seen_minutes: live?.last_seen_minutes ?? null,
          is_stale: live?.is_stale ?? false,
          note: note?.note ?? "",
        };
      });
      setItems(merged);
      setStores(
        (storesRes.data || [])
          .map((s) => ({ id: s.id, name: s.name, default_base_pay_cents: s.default_base_pay_cents ?? 0 }))
          .filter((s) => Boolean(s.name))
      );
      setPinned((pinsRes.data || []).map((p) => p.rider_id));
      setLastRefreshed(new Date());
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to load management data"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const preset = searchParams.get("search");
    if (preset) {
      setSearch(preset);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [autoRefresh]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (storeFilter && (r.store || "") !== storeFilter) return false;
      if (activeFilter === "active" && !r.is_active) return false;
      if (activeFilter === "inactive" && r.is_active) return false;
      if (staleOnly && !r.is_stale) return false;
      if (!query) return true;
      return (
        r.name.toLowerCase().includes(query) ||
        r.username.toLowerCase().includes(query) ||
        String(r.id).includes(query) ||
        (r.store || "").toLowerCase().includes(query)
      );
    });
  }, [items, search, statusFilter, storeFilter, activeFilter, staleOnly]);

  const pinnedSet = useMemo(() => new Set(pinned), [pinned]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const waiting = useMemo(() => {
    const list = filtered.filter((i) => i.status === "available");
    return list.sort((a, b) => {
      const ap = pinnedSet.has(a.id) ? 0 : 1;
      const bp = pinnedSet.has(b.id) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return aTime - bTime;
    });
  }, [filtered, pinnedSet]);

  const onDelivery = useMemo(() => filtered.filter((i) => i.status === "delivery"), [filtered]);
  const onBreak = useMemo(() => filtered.filter((i) => i.status === "break"), [filtered]);
  const offline = useMemo(() => filtered.filter((i) => i.status === "offline"), [filtered]);
  const riderOptions = useMemo(() => items.slice().sort((a, b) => a.name.localeCompare(b.name)), [items]);
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
    const rider = items.find((r) => String(r.id) === dispatchRiderId);
    if (rider?.store) {
      setDispatchStore(rider.store);
    }
  }, [dispatchRiderId, dispatchStore, items]);

  const togglePin = async (id: number) => {
    try {
      if (pinnedSet.has(id)) {
        await api.delete(`/admin/queue-pins/${id}`);
        setPinned((prev) => prev.filter((p) => p !== id));
      } else {
        await api.post("/admin/queue-pins", { rider_id: id });
        setPinned((prev) => [id, ...prev]);
      }
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to update pin"));
    }
  };

  const setStatus = async (id: number, status: string) => {
    try {
      await api.patch(`/admin/riders/${id}/status`, { status });
      load();
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to update rider status"));
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((pid) => pid !== id) : [...prev, id]));
  };

  const selectAll = (rows: RiderRow[]) => {
    const ids = rows.map((r) => r.id);
    setSelectedIds((prev) => Array.from(new Set([...prev, ...ids])));
  };

  const clearSelection = () => setSelectedIds([]);

  const applyBulkStatus = async () => {
    if (!bulkStatus || selectedIds.length === 0) return;
    setBulkLoading(true);
    try {
      await api.post("/admin/riders/bulk-status", { rider_ids: selectedIds, status: bulkStatus });
      setSelectedIds([]);
      setBulkStatus("");
      load();
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to update statuses"));
    } finally {
      setBulkLoading(false);
    }
  };

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
      setDispatchRef("");
      setDispatchStore("");
      setDispatchPay("");
      load();
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to assign dispatch"));
    } finally {
      setDispatchLoading(false);
    }
  };

  const useSelectedForDispatch = () => {
    if (selectedIds.length === 1) {
      setDispatchRiderId(String(selectedIds[0]));
    }
  };

  const openNote = (r: RiderRow) => {
    setEditingNoteId(r.id);
    setNoteDraft(r.note || "");
  };

  const saveNote = async (r: RiderRow) => {
    try {
      await api.post(`/admin/riders/${r.id}/note`, { note: noteDraft });
      setEditingNoteId(null);
      setNoteDraft("");
      load();
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to save note"));
    }
  };

  const exportCsv = () => {
    const rows = filtered.map((r) => ({
      rider_id: r.id,
      name: r.name,
      username: r.username,
      store: r.store || "",
      status: r.status,
      updated_at: r.updated_at || "",
      last_seen_minutes: r.last_seen_minutes ?? "",
      is_stale: r.is_stale ? "yes" : "no",
      is_active: r.is_active ? "yes" : "no",
      note: r.note || "",
    }));
    const header = Object.keys(rows[0] || {
      rider_id: "",
      name: "",
      username: "",
      store: "",
      status: "",
      updated_at: "",
      last_seen_minutes: "",
      is_stale: "",
      is_active: "",
      note: "",
    }).join(",");
    const body = rows
      .map((row) =>
        Object.values(row)
          .map((val) => `"${String(val).replace(/"/g, "\"\"")}"`)
          .join(",")
      )
      .join("\n");
    const csv = `${header}\n${body}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `queue_export_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const renderRow = (r: RiderRow, idx: number, allowPin = false) => {
    const lastSeen =
      r.last_seen_minutes == null ? "No location" : r.last_seen_minutes <= 1 ? "Just now" : `${r.last_seen_minutes}m ago`;
    const staleLabel = r.is_stale ? "Stale" : "Fresh";
    const statusAgeMinutes = r.updated_at ? Math.round((Date.now() - new Date(r.updated_at).getTime()) / 60000) : null;
    const deliverySlaBreach = r.status === "delivery" && statusAgeMinutes != null && statusAgeMinutes > DELIVERY_SLA_MINUTES;
    const availableSlaBreach = r.status === "available" && statusAgeMinutes != null && statusAgeMinutes > AVAILABLE_SLA_MINUTES;
    const isSelected = selectedSet.has(r.id);
    const rowStyle = {
      ...queueRow,
      borderColor: isSelected ? "#2563eb" : r.is_stale ? "#fcd34d" : queueRow.borderColor,
      background: r.is_stale ? "#fffbeb" : queueRow.background,
      boxShadow: isSelected ? "0 0 0 2px rgba(37, 99, 235, 0.12)" : undefined,
    };
    return (
      <div key={r.id} style={rowStyle}>
        <div style={{ display: "grid", gap: 6 }}>
          <div style={nameText}>
            <label style={checkboxWrap}>
              <input
                type="checkbox"
                checked={selectedSet.has(r.id)}
                onChange={() => toggleSelect(r.id)}
              />
            </label>
            {allowPin && (
              <button style={tinyBtn} type="button" onClick={() => togglePin(r.id)}>
                {pinnedSet.has(r.id) ? "Pinned" : "Pin top"}
              </button>
            )}
            <span>
              {allowPin ? `#${idx + 1} ` : ""}{r.name}
            </span>
            <span style={pill("#e0f2fe", "#0369a1")}>ID {r.id}</span>
            {!r.is_active && <span style={pill("#fee2e2", "#b91c1c")}>Inactive</span>}
          </div>
          <div style={meta}>
            {r.store ? `${r.store} - ` : ""}{r.updated_at ? `Status updated ${new Date(r.updated_at).toLocaleTimeString()}` : "No status update"}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12, color: "#475569" }}>
            <span style={pill(r.is_stale ? "#fef3c7" : "#dcfce7", r.is_stale ? "#92400e" : "#166534")}>
              {staleLabel}
            </span>
            <span>Last seen {lastSeen}</span>
            {deliverySlaBreach && (
              <span style={pill("#fee2e2", "#b91c1c")}>Delivery SLA {DELIVERY_SLA_MINUTES}m+</span>
            )}
            {availableSlaBreach && (
              <span style={pill("#ffedd5", "#c2410c")}>Queue wait {AVAILABLE_SLA_MINUTES}m+</span>
            )}
          </div>
          {editingNoteId === r.id ? (
            <div style={noteBox}>
              <textarea
                style={noteInput}
                rows={2}
                value={noteDraft}
                placeholder="Add a dispatch note..."
                onChange={(e) => setNoteDraft(e.target.value)}
              />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button style={ghostBtn} type="button" onClick={() => saveNote(r)}>
                  Save note
                </button>
                <button style={ghostBtn} type="button" onClick={() => setEditingNoteId(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div style={notePreview}>
              <span>{r.note ? `Note: ${r.note}` : "No dispatch note."}</span>
              <button style={ghostBtn} type="button" onClick={() => openNote(r)}>
                {r.note ? "Edit note" : "Add note"}
              </button>
            </div>
          )}
        </div>

        <div style={{ display: "grid", gap: 8, justifyItems: "end" }}>
          <div style={pill(statusTone(r.status).bg, statusTone(r.status).color)}>{statusLabel(r.status)}</div>
          <div style={{ display: "grid", gap: 6 }}>
            <button style={tinyBtn} type="button" onClick={() => setStatus(r.id, "available")}>Available</button>
            <button style={tinyBtn} type="button" onClick={() => setStatus(r.id, "delivery")}>Delivery</button>
            <button style={tinyBtn} type="button" onClick={() => setStatus(r.id, "break")}>Break</button>
          </div>
          <button style={ghostBtn} type="button" onClick={() => nav(`/admin/tracking?rider_id=${r.id}`)}>
            View on map
          </button>
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Topbar title="Management" />

      <div style={banner}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: 0.3, opacity: 0.7 }}>Dispatch control center</div>
          <h2 style={{ margin: 0 }}>Rider Management</h2>
          <p style={{ margin: "4px 0 0", opacity: 0.8 }}>
            Manage queue priority, status changes, and dispatch notes in one place.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label style={toggle}>
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            <span>Auto refresh</span>
          </label>
          <button style={ghostBtn} onClick={load} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <button style={ghostBtn} onClick={exportCsv}>
            Export CSV
          </button>
        </div>
      </div>

      <div style={filterRow}>
        <input
          style={input}
          placeholder="Search rider, store, or ID"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select style={input} value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)}>
          <option value="">All stores</option>
          {stores.map((s) => (
            <option key={s.id} value={s.name}>{s.name}</option>
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
          <option value="all">All accounts</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
        </select>
        <label style={toggle}>
          <input type="checkbox" checked={staleOnly} onChange={(e) => setStaleOnly(e.target.checked)} />
          <span>Stale only</span>
        </label>
        <div style={{ fontSize: 12, color: "#64748b" }}>
          {lastRefreshed ? `Last refreshed ${lastRefreshed.toLocaleTimeString()}` : "Not refreshed yet"}
        </div>
      </div>

      <div style={controlGrid}>
        <div style={queueCard}>
          <div style={queueHead}>
            <div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Bulk actions</div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>Queue controls</div>
            </div>
            <div style={pill("#e0f2fe", "#0369a1")}>{selectedIds.length} selected</div>
          </div>
          <div style={bulkRow}>
            <button style={ghostBtn} type="button" onClick={() => selectAll(filtered)}>
              Select all filtered
            </button>
            <button style={ghostBtn} type="button" onClick={clearSelection} disabled={selectedIds.length === 0}>
              Clear selection
            </button>
          </div>
          <div style={bulkRow}>
            <select style={input} value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
              <option value="">Set status...</option>
              <option value="available">Available</option>
              <option value="delivery">Delivery</option>
              <option value="break">Break</option>
            </select>
            <button
              style={ghostBtn}
              type="button"
              onClick={applyBulkStatus}
              disabled={!bulkStatus || selectedIds.length === 0 || bulkLoading}
            >
              {bulkLoading ? "Updating..." : "Apply status"}
            </button>
          </div>
        </div>

        <div style={queueCard}>
          <div style={queueHead}>
            <div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Dispatch</div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>Assign delivery</div>
            </div>
            {selectedIds.length === 1 && (
              <button style={ghostBtn} type="button" onClick={useSelectedForDispatch}>
                Use selected
              </button>
            )}
          </div>
        <div style={bulkRow}>
          <select style={input} value={dispatchRiderId} onChange={(e) => setDispatchRiderId(e.target.value)}>
            <option value="">Select rider</option>
            {riderOptions.map((r) => (
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
          <input
            style={input}
            placeholder="Reference (optional)"
            value={dispatchRef}
            onChange={(e) => setDispatchRef(e.target.value)}
          />
          <input
            style={input}
            type="number"
            min="0"
            step="0.01"
            placeholder="Delivery price"
            value={dispatchPay}
            onChange={(e) => setDispatchPay(e.target.value)}
          />
        </div>
        <div style={bulkRow}>
          <button
            style={ghostBtn}
            type="button"
            onClick={assignDispatch}
            disabled={!dispatchRiderId || dispatchLoading || !dispatchPay}
          >
            {dispatchLoading ? "Assigning..." : "Assign delivery"}
          </button>
        </div>
        </div>
      </div>

      {err && <div style={alert}>{err}</div>}

      <div style={queueCard}>
        <div style={queueHead}>
          <div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Waiting (Available)</div>
            <div style={{ fontSize: 28, fontWeight: 800 }}>{waiting.length}</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button style={ghostBtn} type="button" onClick={() => selectAll(waiting)}>
              Select waiting
            </button>
            <div style={pill("#dcfce7", "#166534")}>Queue</div>
          </div>
        </div>
        {waiting.length === 0 ? (
          <div style={empty}>No riders waiting.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {waiting.map((r, idx) => renderRow(r, idx, true))}
          </div>
        )}
      </div>

      <div style={grid}>
        <div style={queueCard}>
          <div style={queueHead}>
            <div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>On Delivery</div>
              <div style={{ fontSize: 24, fontWeight: 800 }}>{onDelivery.length}</div>
            </div>
            <div style={pill("#ffedd5", "#ea580c")}>Delivery</div>
          </div>
          {onDelivery.length === 0 ? (
            <div style={empty}>None</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {onDelivery.map((r, idx) => renderRow(r, idx))}
            </div>
          )}
        </div>

        <div style={queueCard}>
          <div style={queueHead}>
            <div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>On Break</div>
              <div style={{ fontSize: 24, fontWeight: 800 }}>{onBreak.length}</div>
            </div>
            <div style={pill("#f1f5f9", "#475569")}>Break</div>
          </div>
          {onBreak.length === 0 ? (
            <div style={empty}>None</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {onBreak.map((r, idx) => renderRow(r, idx))}
            </div>
          )}
        </div>

        <div style={queueCard}>
          <div style={queueHead}>
            <div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Offline</div>
              <div style={{ fontSize: 24, fontWeight: 800 }}>{offline.length}</div>
            </div>
            <div style={pill("#e2e8f0", "#475569")}>Offline</div>
          </div>
          {offline.length === 0 ? (
            <div style={empty}>None</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {offline.map((r, idx) => renderRow(r, idx))}
            </div>
          )}
        </div>
      </div>
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

const queueCard: React.CSSProperties = {
  background: "white",
  borderRadius: 14,
  padding: 14,
  boxShadow: "0 10px 24px rgba(0,0,0,0.06)",
  display: "grid",
  gap: 12,
};

const queueHead: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  flexWrap: "wrap",
};

const queueRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 16,
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: "12px 14px",
  background: "#f8fafc",
};

const empty: React.CSSProperties = {
  padding: 14,
  textAlign: "center",
  color: "#6b7280",
};

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
  padding: "6px 10px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  background: "#fff",
  fontWeight: 700,
  fontSize: 11,
  cursor: "pointer",
};

const alert: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  background: "#fee2e2",
  color: "#991b1b",
  fontWeight: 700,
};

const nameText: React.CSSProperties = { fontWeight: 800, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" };
const meta: React.CSSProperties = { fontSize: 12, color: "#6b7280", marginTop: 2 };
const pill = (bg: string, color = "#0f172a"): React.CSSProperties => ({
  padding: "6px 10px",
  borderRadius: 999,
  background: bg,
  color,
  fontSize: 12,
  fontWeight: 700,
});

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: 12,
};

const controlGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: 12,
};

const filterRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  alignItems: "center",
};

const input: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  minWidth: 180,
};

const toggle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 12,
  color: "#475569",
  fontWeight: 700,
};

const noteBox: React.CSSProperties = {
  display: "grid",
  gap: 8,
  padding: 10,
  borderRadius: 10,
  background: "#eef2ff",
  border: "1px solid #c7d2fe",
};

const noteInput: React.CSSProperties = {
  width: "100%",
  borderRadius: 8,
  border: "1px solid #e2e8f0",
  padding: "8px 10px",
  fontFamily: "inherit",
  fontSize: 12,
};

const notePreview: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  flexWrap: "wrap",
  fontSize: 12,
  color: "#475569",
};

const bulkRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  alignItems: "center",
};

const checkboxWrap: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "4px",
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  background: "#ffffff",
};

const statusTone = (status: string) => {
  if (status === "available") return { bg: "#dcfce7", color: "#166534" };
  if (status === "delivery") return { bg: "#ffedd5", color: "#ea580c" };
  if (status === "break") return { bg: "#f1f5f9", color: "#475569" };
  return { bg: "#e2e8f0", color: "#475569" };
};

const statusLabel = (status: string) => {
  if (status === "available") return "Available";
  if (status === "delivery") return "Delivery";
  if (status === "break") return "Break";
  return "Offline";
};
