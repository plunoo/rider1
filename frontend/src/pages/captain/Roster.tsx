import { useEffect, useMemo, useState } from "react";
import { Topbar } from "../../components/Layout/Topbar";
import { api } from "../../api/client";
import { getApiErrorMessage } from "../../api/errors";
import { useAuth } from "../../auth/AuthContext";

type Rider = {
  id: number;
  username: string;
  name: string;
  store?: string | null;
  status?: string | null;
  updated_at?: string | null;
  is_active?: boolean;
};

type ApprovalInfo = {
  rider_id: number;
  requested_at?: string | null;
  approved_at?: string | null;
  approved_by?: string | null;
  rejected_at?: string | null;
  rejected_by?: string | null;
  deactivated_at?: string | null;
  deactivated_by?: string | null;
};

type RosterResponse = {
  items: Rider[];
  unassigned?: Rider[];
  store?: string | null;
  updated_at?: string | null;
};

export default function CaptainRoster() {
  const { user } = useAuth();
  const [riders, setRiders] = useState<Rider[]>([]);
  const [unassigned, setUnassigned] = useState<Rider[]>([]);
  const [approvals, setApprovals] = useState<Record<number, ApprovalInfo>>({});
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [addRiderId, setAddRiderId] = useState("");
  const [addUsername, setAddUsername] = useState("");
  const [pendingBusy, setPendingBusy] = useState(false);
  const [pendingSelected, setPendingSelected] = useState<number[]>([]);

  const loadRoster = async () => {
    setErr(null);
    setLoading(true);
    try {
      const res = await api.get<RosterResponse>("/captain/roster", { params: { include_unassigned: true } });
      const items = res.data.items || [];
      setRiders(items);
      setUnassigned(res.data.unassigned || []);
      await loadApprovals(items);
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to load roster"));
    } finally {
      setLoading(false);
    }
  };

  const loadApprovals = async (items: Rider[]) => {
    const ids = items.map((r) => r.id).join(",");
    if (!ids) {
      setApprovals({});
      return;
    }
    try {
      const res = await api.get<{ items: ApprovalInfo[] }>("/captain/riders/approvals", { params: { rider_ids: ids } });
      const map: Record<number, ApprovalInfo> = {};
      (res.data.items || []).forEach((row) => {
        map[row.rider_id] = row;
      });
      setApprovals(map);
    } catch {
      setApprovals({});
    }
  };

  useEffect(() => {
    loadRoster();
  }, []);

  const addRider = async () => {
    setErr(null);
    const payload: Record<string, string | number> = {};
    if (addRiderId) {
      payload.rider_id = Number(addRiderId);
    } else if (addUsername.trim()) {
      payload.username = addUsername.trim();
    } else {
      setErr("Select a rider or enter a username.");
      return;
    }
    try {
      await api.post("/captain/roster/add", payload);
      setAddRiderId("");
      setAddUsername("");
      loadRoster();
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to add rider"));
    }
  };

  const removeRider = async (riderId: number) => {
    setErr(null);
    try {
      await api.post("/captain/roster/remove", { rider_id: riderId });
      loadRoster();
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to remove rider"));
    }
  };

  const removeFromQueue = async (riderId: number) => {
    setErr(null);
    try {
      await api.post(`/captain/riders/${riderId}/remove-from-queue`);
      loadRoster();
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to remove rider from queue"));
    }
  };

  const filteredRiders = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return riders;
    return riders.filter((r) => {
      return (
        r.name.toLowerCase().includes(q) ||
        r.username.toLowerCase().includes(q) ||
        String(r.id).includes(q)
      );
    });
  }, [riders, query]);

  const pendingRiders = useMemo(() => riders.filter((r) => r.is_active === false), [riders]);

  useEffect(() => {
    setPendingSelected((prev) => prev.filter((id) => pendingRiders.some((r) => r.id === id)));
  }, [pendingRiders]);

  const formatWhen = (value?: string | null) => {
    if (!value) return "—";
    const d = new Date(value);
    return Number.isNaN(d.valueOf()) ? "—" : d.toLocaleString();
  };

  const renderApproval = (r: Rider) => {
    const info = approvals[r.id];
    if (!info) return "";
    if (r.is_active === false) {
      return info.requested_at ? `Pending since ${formatWhen(info.requested_at)}` : "Pending";
    }
    if (info.approved_at) {
      return `Approved ${formatWhen(info.approved_at)}${info.approved_by ? ` by ${info.approved_by}` : ""}`;
    }
    if (info.deactivated_at) {
      return `Deactivated ${formatWhen(info.deactivated_at)}`;
    }
    return "";
  };

  const togglePending = (id: number) => {
    setPendingSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const togglePendingAll = () => {
    const allIds = pendingRiders.map((r) => r.id);
    const allSelected = allIds.length > 0 && allIds.every((id) => pendingSelected.includes(id));
    if (allSelected) {
      setPendingSelected([]);
    } else {
      setPendingSelected(allIds);
    }
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Topbar title="Store roster" />

      {err && <div style={alert}>{err}</div>}

      <section style={panel}>
        <header style={panelHeader}>
          <div>
            <div style={panelLabel}>Store</div>
            <div style={panelTitle}>{user?.store || "Store not set"}</div>
          </div>
          <button style={ghostBtn} onClick={loadRoster} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </header>
        <div style={{ fontSize: 12, opacity: 0.7 }}>
          Add or remove riders assigned to your store. Only unassigned riders can be added.
        </div>
      </section>

      <section style={panel}>
        <header style={panelHeader}>
          <div>
            <div style={panelLabel}>Add rider</div>
            <div style={panelTitle}>Attach a rider to your store</div>
          </div>
        </header>
        <div style={formRow}>
          <select
            style={input}
            value={addRiderId}
            onChange={(e) => {
              setAddRiderId(e.target.value);
              if (e.target.value) setAddUsername("");
            }}
          >
            <option value="">Select unassigned rider</option>
            {unassigned.map((r) => (
              <option key={r.id} value={String(r.id)}>
                #{r.id} - {r.name} ({r.username})
              </option>
            ))}
          </select>
          <input
            style={input}
            placeholder="Or enter username"
            value={addUsername}
            onChange={(e) => {
              setAddUsername(e.target.value);
              if (e.target.value) setAddRiderId("");
            }}
          />
          <button style={primaryBtn} onClick={addRider} disabled={!addRiderId && !addUsername.trim()}>
            Add to store
          </button>
        </div>
      </section>

      {pendingRiders.length > 0 && (
        <section style={{ ...panel, background: "#fff7ed", border: "1px solid #fed7aa" }}>
          <header style={panelHeader}>
            <div>
              <div style={panelLabel}>Approvals</div>
              <div style={panelTitle}>Pending rider accounts</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#9a3412" }}>{pendingRiders.length} pending</div>
              <button style={ghostBtn} onClick={togglePendingAll} disabled={pendingRiders.length === 0}>
                {pendingSelected.length === pendingRiders.length ? "Clear selection" : "Select all"}
              </button>
              <button
                style={primaryBtn}
                disabled={pendingBusy || pendingSelected.length === 0}
                onClick={async () => {
                  setErr(null);
                  setPendingBusy(true);
                  try {
                    await Promise.all(
                      pendingSelected.map((id) => api.patch(`/captain/riders/${id}/activation`, { is_active: true }))
                    );
                    await loadRoster();
                    setPendingSelected([]);
                  } catch (e: any) {
                    setErr(getApiErrorMessage(e, "Failed to approve riders"));
                  } finally {
                    setPendingBusy(false);
                  }
                }}
              >
                Approve selected
              </button>
              <button
                style={dangerBtn}
                disabled={pendingBusy || pendingSelected.length === 0}
                onClick={async () => {
                  setErr(null);
                  setPendingBusy(true);
                  try {
                    await Promise.all(pendingSelected.map((id) => api.delete(`/captain/riders/${id}`)));
                    await loadRoster();
                    setPendingSelected([]);
                  } catch (e: any) {
                    setErr(getApiErrorMessage(e, "Failed to reject riders"));
                  } finally {
                    setPendingBusy(false);
                  }
                }}
              >
                Reject selected
              </button>
            </div>
          </header>
          <div style={{ display: "grid", gap: 8 }}>
            {pendingRiders.map((r) => (
              <div key={r.id} style={{ ...row, background: "white", borderColor: "#fed7aa" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <input
                    type="checkbox"
                    checked={pendingSelected.includes(r.id)}
                    onChange={() => togglePending(r.id)}
                  />
                  <div>
                    <div style={{ fontWeight: 800 }}>{r.name}</div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      #{r.id} - {r.username}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      Requested: {formatWhen(approvals[r.id]?.requested_at)}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    style={primaryBtn}
                    disabled={pendingBusy}
                    onClick={async () => {
                      setErr(null);
                      setPendingBusy(true);
                      try {
                        await api.patch(`/captain/riders/${r.id}/activation`, { is_active: true });
                        await loadRoster();
                        setPendingSelected((prev) => prev.filter((id) => id !== r.id));
                      } catch (e: any) {
                        setErr(getApiErrorMessage(e, "Failed to approve rider"));
                      } finally {
                        setPendingBusy(false);
                      }
                    }}
                  >
                    Approve
                  </button>
                  <button
                    style={dangerBtn}
                    disabled={pendingBusy}
                    onClick={async () => {
                      setErr(null);
                      setPendingBusy(true);
                      try {
                        await api.delete(`/captain/riders/${r.id}`);
                        await loadRoster();
                        setPendingSelected((prev) => prev.filter((id) => id !== r.id));
                      } catch (e: any) {
                        setErr(getApiErrorMessage(e, "Failed to reject rider"));
                      } finally {
                        setPendingBusy(false);
                      }
                    }}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section style={panel}>
        <header style={panelHeader}>
          <div>
            <div style={panelLabel}>Roster</div>
            <div style={panelTitle}>Riders in your store</div>
          </div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>{riders.length} total</div>
        </header>
        <div style={filterRow}>
          <input
            style={input}
            placeholder="Search name, username, or ID"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {filteredRiders.length === 0 ? (
          <div style={empty}>No riders in this store yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {filteredRiders.map((r) => (
              <div key={r.id} style={row}>
                <div>
                  <div style={{ fontWeight: 800 }}>{r.name}</div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    #{r.id} - {r.username} - {r.status || "offline"}
                  </div>
                  {renderApproval(r) && (
                    <div style={{ fontSize: 12, opacity: 0.7 }}>{renderApproval(r)}</div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {r.status === "available" && (
                    <button style={ghostBtn} onClick={() => removeFromQueue(r.id)}>
                      Remove from queue
                    </button>
                  )}
                  <button style={dangerBtn} onClick={() => removeRider(r.id)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const panel: React.CSSProperties = {
  background: "white",
  borderRadius: 14,
  padding: 14,
  boxShadow: "0 10px 24px rgba(0,0,0,0.06)",
  display: "grid",
  gap: 10,
};

const panelHeader: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
};

const panelLabel: React.CSSProperties = { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4, opacity: 0.65 };
const panelTitle: React.CSSProperties = { fontSize: 18, fontWeight: 800, marginTop: 2 };

const formRow: React.CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap" };
const input: React.CSSProperties = { padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb", minWidth: 200 };
const filterRow: React.CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" };

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

const dangerBtn: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: 0,
  color: "white",
  background: "linear-gradient(135deg,#ef4444,#b91c1c)",
  fontWeight: 800,
  cursor: "pointer",
};

const row: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "10px 12px",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  background: "#f8fafc",
  gap: 12,
};

const empty: React.CSSProperties = { padding: 12, border: "1px dashed #e5e7eb", borderRadius: 10, color: "#6b7280" };

const alert: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  background: "#fee2e2",
  color: "#991b1b",
  fontWeight: 700,
};
