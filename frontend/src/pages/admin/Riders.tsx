import React, { useEffect, useMemo, useState } from "react";
import { Topbar } from "../../components/Layout/Topbar";
import { api } from "../../api/client";
import { getApiErrorMessage } from "../../api/errors";

type Rider = { id: number; username: string; name: string; store?: string | null; status: string; updated_at?: string | null; is_active?: boolean };
type Store = { id: number; name: string };
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

const statusMeta: Record<
  string,
  { label: string; bg: string; color: string }
> = {
  available: { label: "Available", bg: "#ecfeff", color: "#0284c7" },
  delivery: { label: "On Delivery", bg: "#fef3c7", color: "#c2410c" },
  break: { label: "On Break", bg: "#f3f4f6", color: "#4b5563" },
  offline: { label: "Offline", bg: "#fee2e2", color: "#b91c1c" },
};

function RidersInner() {
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [store, setStore] = useState("");
  const [stores, setStores] = useState<Store[]>([]);
  const [delUsername, setDelUsername] = useState("");
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [resetTarget, setResetTarget] = useState<Rider | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [tokenForId, setTokenForId] = useState<number | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [approvals, setApprovals] = useState<Record<number, ApprovalInfo>>({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [storeFilter, setStoreFilter] = useState("all");
  const [activeFilter, setActiveFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkStore, setBulkStore] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [rowStoreEdits, setRowStoreEdits] = useState<Record<number, string>>({});
  const [rowStoreBusy, setRowStoreBusy] = useState<Record<number, boolean>>({});
  const [pendingBusy, setPendingBusy] = useState(false);
  const [pendingSelected, setPendingSelected] = useState<number[]>([]);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await api.get<{ items: Rider[] }>("/admin/riders");
      const items = res.data.items || [];
      setRiders(items);
      await loadApprovals(items);
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to load riders"));
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
      const res = await api.get<{ items: ApprovalInfo[] }>("/admin/riders/approvals", { params: { rider_ids: ids } });
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
    load();
    loadStores();
  }, []);

  const loadStores = async () => {
    try {
      const res = await api.get<Store[]>("/admin/stores");
      setStores(res.data || []);
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to load stores"));
    }
  };

  const addRider = async () => {
    const normalizedUsername = username.trim();
    const normalizedName = name.trim();
    const normalizedStore = store.trim();
    if (!normalizedUsername || !normalizedName || !password || !normalizedStore) {
      setErr("Username, name, password, and store are required");
      return;
    }
    setErr(null);
    try {
      await api.post("/admin/add-rider", {
        username: normalizedUsername,
        name: normalizedName,
        password,
        store: normalizedStore,
      });
      setUsername("");
      setName("");
      setStore("");
      setPassword("");
      load();
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to add rider"));
    }
  };

  const deleteRider = async () => {
    const raw = delUsername.trim();
    if (!raw) return;
    setDeleteMsg(null);
    setErr(null);
    setDeleting(true);
    try {
      const isNumeric = /^\d+$/.test(raw);
      const payload = isNumeric ? { id: Number(raw) } : { username: raw };
      await api.delete("/admin/delete-rider", { data: payload });
      setRiders((prev) => prev.filter((r) => (isNumeric ? r.id !== Number(raw) : r.username !== raw)));
      setDeleteMsg(`Deleted rider ${raw} (if existed)`);
      setDelUsername("");
    } catch (e: any) {
      const msg = getApiErrorMessage(e, "Delete failed");
      setErr(msg);
      setDeleteMsg(msg);
    } finally {
      setDeleting(false);
    }
  };

  const statusCounts = Object.keys(statusMeta).map((key) => ({
    key,
    label: statusMeta[key].label,
    count: riders.filter((r) => r.status === key).length,
  }));

  const upNext = riders.filter((r) => r.status === "delivery");
  const pendingRiders = useMemo(() => riders.filter((r) => r.is_active === false), [riders]);

  const formatWhen = (value?: string | null) => {
    if (!value) return "—";
    const d = new Date(value);
    return Number.isNaN(d.valueOf()) ? "—" : d.toLocaleString();
  };

  const renderApproval = (r: Rider) => {
    const info = approvals[r.id];
    if (!info) return "—";
    if (r.is_active === false) {
      return info.requested_at ? `Pending since ${formatWhen(info.requested_at)}` : "Pending";
    }
    if (info.approved_at) {
      return `Approved ${formatWhen(info.approved_at)}${info.approved_by ? ` by ${info.approved_by}` : ""}`;
    }
    if (info.deactivated_at) {
      return `Deactivated ${formatWhen(info.deactivated_at)}${info.deactivated_by ? ` by ${info.deactivated_by}` : ""}`;
    }
    return "Active";
  };

  useEffect(() => {
    setPendingSelected((prev) => prev.filter((id) => pendingRiders.some((r) => r.id === id)));
  }, [pendingRiders]);

  const filteredRiders = useMemo(() => {
    const q = search.trim().toLowerCase();
    const status = statusFilter === "all" ? "" : statusFilter;
    const storeValue = storeFilter === "all" ? "" : storeFilter.trim().toLowerCase();
    return riders.filter((r) => {
      if (status && r.status !== status) return false;
      if (storeValue && (r.store || "").toLowerCase() !== storeValue) return false;
      if (activeFilter === "active" && r.is_active === false) return false;
      if (activeFilter === "inactive" && r.is_active !== false) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.username.toLowerCase().includes(q) ||
        String(r.id).includes(q)
      );
    });
  }, [riders, search, statusFilter, storeFilter, activeFilter]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allFilteredSelected =
    filteredRiders.length > 0 && filteredRiders.every((r) => selectedSet.has(r.id));

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => riders.some((r) => r.id === id)));
  }, [riders]);

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds((prev) => prev.filter((id) => !filteredRiders.some((r) => r.id === id)));
    } else {
      const next = new Set(selectedIds);
      filteredRiders.forEach((r) => next.add(r.id));
      setSelectedIds(Array.from(next));
    }
  };

  const toggleSelected = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
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

  const applyBulkActivation = async (isActive: boolean) => {
    if (selectedIds.length === 0) return;
    const targetIds = new Set(selectedIds);
    setErr(null);
    setBulkBusy(true);
    try {
      await Promise.all(selectedIds.map((id) => api.patch(`/admin/riders/${id}/activation`, { is_active: isActive })));
      setRiders((prev) => prev.map((r) => (targetIds.has(r.id) ? { ...r, is_active: isActive } : r)));
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to update activation"));
    } finally {
      setBulkBusy(false);
    }
  };

  const applyBulkStore = async (storeName: string | null) => {
    if (selectedIds.length === 0) return;
    const targetIds = new Set(selectedIds);
    setErr(null);
    setBulkBusy(true);
    try {
      await Promise.all(
        selectedIds.map((id) =>
          api.patch(`/admin/riders/${id}/store`, { store: storeName && storeName.trim() ? storeName : null })
        )
      );
      setRiders((prev) =>
        prev.map((r) =>
          targetIds.has(r.id)
            ? { ...r, store: storeName && storeName.trim() ? storeName.trim() : null }
            : r
        )
      );
      setBulkStore("");
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to update store"));
    } finally {
      setBulkBusy(false);
    }
  };

  const updateStoreForRider = async (riderId: number, storeName: string | null) => {
    setErr(null);
    setRowStoreBusy((prev) => ({ ...prev, [riderId]: true }));
    try {
      await api.patch(`/admin/riders/${riderId}/store`, { store: storeName });
      setRiders((prev) =>
        prev.map((r) => (r.id === riderId ? { ...r, store: storeName && storeName.trim() ? storeName.trim() : null } : r))
      );
      setRowStoreEdits((prev) => {
        if (!(riderId in prev)) return prev;
        const next = { ...prev };
        delete next[riderId];
        return next;
      });
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to update store"));
    } finally {
      setRowStoreBusy((prev) => ({ ...prev, [riderId]: false }));
    }
  };

  const statCards = statusCounts.map((c) => ({
    ...c,
    color:
      c.key === "available"
        ? "linear-gradient(135deg,#0ea5e9,#2563eb)"
        : c.key === "delivery"
        ? "linear-gradient(135deg,#f97316,#ef4444)"
        : c.key === "break"
        ? "linear-gradient(135deg,#6b7280,#4b5563)"
        : "linear-gradient(135deg,#a855f7,#6366f1)",
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Topbar title="Riders" />

      <div style={hero}>
        <div>
          <div style={pill}>Live Ops</div>
          <h2 style={{ margin: "8px 0 4px 0" }}>Rider roster & actions</h2>
          <p style={{ margin: 0, opacity: 0.8 }}>Manage riders, see live status, and queue updates in one place.</p>
        </div>
        <div style={heroBadge}>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{riders.length || 0}</div>
          <div style={{ fontSize: 12, opacity: 0.75 }}>Total riders</div>
          <button style={ghostBtn} onClick={load} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          {err && <span style={{ fontSize: 12, color: "#fecdd3", fontWeight: 700 }}>{err}</span>}
        </div>
      </div>

      <div style={statGrid}>
        {statCards.map((s) => (
          <div key={s.key} style={{ ...statCard, background: s.color }}>
            <div style={{ opacity: 0.85 }}>{s.label}</div>
            <div style={{ fontSize: 30, fontWeight: 800, margin: "6px 0" }}>{s.count}</div>
            <div style={{ fontSize: 13, opacity: 0.9 }}>{s.label === "Available" ? "Ready to assign" : "Live count"}</div>
          </div>
        ))}
      </div>

      <div style={mainGrid}>
        <div style={panel}>
          <header style={panelHeader}>
            <div>
              <div style={panelLabel}>Delivery queue</div>
              <div style={panelTitle}>Up next</div>
            </div>
            <span style={chip}>{upNext.length || 0} on delivery</span>
          </header>
          {upNext.length === 0 ? (
            <div style={empty}>No riders currently on delivery.</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {upNext.map((r, idx) => (
                <div key={r.id} style={queueItem}>
                  <div>
                    <div style={{ fontWeight: 750 }}>{`#${idx + 1}`} {r.name}</div>
                    <div style={{ fontSize: 12, opacity: 0.65 }}>{r.username}</div>
                  </div>
                  <span style={badgeMuted}>Live</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={panel}>
          <header style={panelHeader}>
            <div>
              <div style={panelLabel}>Rider actions</div>
              <div style={panelTitle}>Add rider</div>
            </div>
          </header>
          <div className="form-grid" style={{ gap: 10 }}>
            <input style={inp} placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
            <input style={inp} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
            <select style={inp} value={store} onChange={(e) => setStore(e.target.value)}>
              <option value="">Select store</option>
              {stores.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
            <input style={inp} type="password" placeholder="Temp password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button className="full-button" style={btn} onClick={addRider} disabled={!name || !username || !password || !store}>Add</button>
          </div>
        </div>

        <div style={panel}>
          <header style={panelHeader}>
            <div>
              <div style={panelLabel}>Danger zone</div>
              <div style={panelTitle}>Delete rider</div>
            </div>
          </header>
          <div className="form-grid" style={{ gap: 10 }}>
            <input style={inp} placeholder="Rider username" value={delUsername} onChange={(e) => setDelUsername(e.target.value)} />
            <button className="full-button" style={btnDanger} onClick={deleteRider} disabled={!delUsername || deleting}>
              {deleting ? "Deleting..." : "Delete"}
            </button>
          </div>
          {deleteMsg && <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700 }}>{deleteMsg}</div>}
        </div>

        <div style={panel}>
          <header style={panelHeader}>
            <div>
              <div style={panelLabel}>Security</div>
              <div style={panelTitle}>Reset password</div>
            </div>
          </header>
          {resetTarget ? (
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ fontWeight: 700 }}>Reset for {resetTarget.name}</div>
              <input
                style={inp}
                type="password"
                placeholder="New password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="full-button"
                  style={btn}
                  onClick={async () => {
                    if (!newPassword) return;
                    setErr(null);
                    try {
                      await api.post(`/admin/riders/${resetTarget.id}/reset-password`, { new_password: newPassword });
                      setNewPassword("");
                      setResetTarget(null);
                      setDeleteMsg("Password updated");
                    } catch (e: any) {
                      setErr(getApiErrorMessage(e, "Failed to reset password"));
                    }
                  }}
                >
                  Save new password
                </button>
                <button className="full-button" style={ghostBtn} onClick={() => { setResetTarget(null); setNewPassword(""); }}>
                  Cancel
                </button>
              </div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>This will revoke existing sessions for the rider.</div>
            </div>
          ) : (
            <div style={{ fontSize: 13, opacity: 0.75 }}>Select a rider from the list to reset their password.</div>
          )}
        </div>
      </div>

      {pendingRiders.length > 0 && (
        <div style={{ ...panel, background: "#fff7ed", border: "1px solid #fed7aa" }}>
          <header style={panelHeader}>
            <div>
              <div style={panelLabel}>Approvals</div>
              <div style={panelTitle}>Pending rider accounts</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ ...chip, background: "#fed7aa", color: "#9a3412" }}>{pendingRiders.length} pending</span>
              <button style={lightBtn} onClick={togglePendingAll} disabled={pendingRiders.length === 0}>
                {pendingSelected.length === pendingRiders.length ? "Clear selection" : "Select all"}
              </button>
              <button
                style={btn}
                disabled={pendingBusy || pendingSelected.length === 0}
                onClick={async () => {
                  setPendingBusy(true);
                  setErr(null);
                  try {
                    await Promise.all(
                      pendingSelected.map((id) => api.patch(`/admin/riders/${id}/activation`, { is_active: true }))
                    );
                    setRiders((prev) => {
                      const next = prev.map((x) => (pendingSelected.includes(x.id) ? { ...x, is_active: true } : x));
                      loadApprovals(next);
                      return next;
                    });
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
                style={btnDanger}
                disabled={pendingBusy || pendingSelected.length === 0}
                onClick={async () => {
                  setPendingBusy(true);
                  setErr(null);
                  try {
                    await Promise.all(pendingSelected.map((id) => api.post(`/admin/riders/${id}/reject`)));
                    setRiders((prev) => {
                      const next = prev.filter((x) => !pendingSelected.includes(x.id));
                      loadApprovals(next);
                      return next;
                    });
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
              <div key={r.id} style={{ ...queueItem, background: "white", borderColor: "#fed7aa" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <input
                    type="checkbox"
                    checked={pendingSelected.includes(r.id)}
                    onChange={() => togglePending(r.id)}
                  />
                  <div>
                    <div style={{ fontWeight: 800 }}>{r.name}</div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      #{r.id} - {r.username} - {r.store || "No store"}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      Requested: {formatWhen(approvals[r.id]?.requested_at)}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    style={btn}
                    disabled={pendingBusy}
                    onClick={async () => {
                      setPendingBusy(true);
                      setErr(null);
                      try {
                        await api.patch(`/admin/riders/${r.id}/activation`, { is_active: true });
                        setRiders((prev) => {
                          const next = prev.map((x) => (x.id === r.id ? { ...x, is_active: true } : x));
                          loadApprovals(next);
                          return next;
                        });
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
                    style={btnDanger}
                    disabled={pendingBusy}
                    onClick={async () => {
                      setPendingBusy(true);
                      setErr(null);
                      try {
                        await api.post(`/admin/riders/${r.id}/reject`);
                        setRiders((prev) => {
                          const next = prev.filter((x) => x.id !== r.id);
                          loadApprovals(next);
                          return next;
                        });
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
        </div>
      )}

      <div style={panel}>
        <header style={panelHeader}>
          <div>
            <div style={panelLabel}>Roster</div>
            <div style={panelTitle}>Riders list</div>
          </div>
        </header>
        <div style={filterRow}>
          <input
            style={{ ...filterInput, flex: 1, minWidth: 220 }}
            placeholder="Search name, username, or ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select style={filterInput} value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)}>
            <option value="all">All stores</option>
            {stores.map((s) => (
              <option key={s.id} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
          <select style={filterInput} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            {Object.keys(statusMeta).map((key) => (
              <option key={key} value={key}>
                {statusMeta[key].label}
              </option>
            ))}
          </select>
          <select style={filterInput} value={activeFilter} onChange={(e) => setActiveFilter(e.target.value)}>
            <option value="all">All activity</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <button
            style={lightBtn}
            onClick={() => {
              setSearch("");
              setStoreFilter("all");
              setStatusFilter("all");
              setActiveFilter("all");
            }}
          >
            Clear filters
          </button>
        </div>
        <div style={bulkRow}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            Selected {selectedIds.length} of {filteredRiders.length}
          </div>
          <button style={lightBtn} disabled={bulkBusy || selectedIds.length === 0} onClick={() => applyBulkActivation(true)}>
            Activate
          </button>
          <button style={lightBtn} disabled={bulkBusy || selectedIds.length === 0} onClick={() => applyBulkActivation(false)}>
            Deactivate
          </button>
          <select style={filterInput} value={bulkStore} onChange={(e) => setBulkStore(e.target.value)}>
            <option value="">Assign store</option>
            {stores.map((s) => (
              <option key={s.id} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            style={lightBtn}
            disabled={bulkBusy || selectedIds.length === 0 || !bulkStore}
            onClick={() => applyBulkStore(bulkStore)}
          >
            Set store
          </button>
          <button style={lightBtn} disabled={bulkBusy || selectedIds.length === 0} onClick={() => applyBulkStore(null)}>
            Clear store
          </button>
          <button style={lightBtn} disabled={selectedIds.length === 0} onClick={() => setSelectedIds([])}>
            Clear selection
          </button>
        </div>
        {filteredRiders.length === 0 ? (
          <div style={empty}>No riders match these filters.</div>
        ) : (
          <table style={{ width: "100%" }}>
            <thead>
              <tr>
                <th align="left">
                  <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll} />
                </th>
                <th align="left">Rider ID</th>
                <th align="left">Name</th>
                <th align="left">Username</th>
                <th align="left">Store</th>
                <th align="left">Status</th>
                <th align="left">Active</th>
                <th align="left">Approval</th>
                <th align="left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRiders.map(r => (
                <tr key={r.id}>
                  <td>
                    <input type="checkbox" checked={selectedSet.has(r.id)} onChange={() => toggleSelected(r.id)} />
                  </td>
                  <td>{r.id}</td>
                  <td>{r.name}</td>
                  <td>{r.username}</td>
                  <td>{r.store || "-"}</td>
                  <td>{renderStatus(r.status)}</td>
                  <td>{r.is_active === false ? "No" : "Yes"}</td>
                  <td style={{ fontSize: 12, color: "#475569" }}>{renderApproval(r)}</td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button
                        style={r.is_active === false ? btn : btnDanger}
                        onClick={async () => {
                          try {
                            await api.patch(`/admin/riders/${r.id}/activation`, { is_active: r.is_active === false });
                            setRiders((prev) => {
                              const next = prev.map((x) => (x.id === r.id ? { ...x, is_active: r.is_active === false } : x));
                              loadApprovals(next);
                              return next;
                            });
                          } catch (e: any) {
                            setErr(getApiErrorMessage(e, "Failed to update activation"));
                          }
                        }}
                      >
                        {r.is_active === false ? "Activate" : "Deactivate"}
                      </button>
                      <button style={ghostBtn} onClick={() => setResetTarget(r)}>
                        Reset password
                      </button>
                      <button
                        style={ghostBtn}
                        disabled={tokenLoading}
                        onClick={async () => {
                          setTokenLoading(true);
                          setResetToken(null);
                          setTokenForId(r.id);
                          try {
                            const res = await api.post<{ token: string }>("/auth/request-password-reset", { username: r.username });
                            setResetToken(res.data.token);
                          } catch (e: any) {
                            setErr(getApiErrorMessage(e, "Failed to generate reset token"));
                          } finally {
                            setTokenLoading(false);
                          }
                        }}
                      >
                        {tokenLoading ? "Generating..." : "Generate token"}
                      </button>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
                      {(() => {
                        const currentStore = r.store || "";
                        const edited = rowStoreEdits[r.id];
                        const value = edited !== undefined ? edited : currentStore;
                        const trimmed = value.trim();
                        const isBusy = Boolean(rowStoreBusy[r.id]);
                        const canSave = trimmed.length > 0 && trimmed !== currentStore;
                        const canClear = Boolean(currentStore);
                        return (
                          <>
                            <select
                              style={filterInput}
                              value={value}
                              onChange={(e) => setRowStoreEdits((prev) => ({ ...prev, [r.id]: e.target.value }))}
                              disabled={isBusy}
                            >
                              <option value="">Assign store</option>
                              {stores.map((s) => (
                                <option key={s.id} value={s.name}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                            <button
                              style={lightBtn}
                              disabled={isBusy || !canSave}
                              onClick={() => updateStoreForRider(r.id, trimmed)}
                            >
                              {isBusy ? "Saving..." : "Save store"}
                            </button>
                            <button
                              style={lightBtn}
                              disabled={isBusy || !canClear}
                              onClick={() => updateStoreForRider(r.id, null)}
                            >
                              Clear store
                            </button>
                          </>
                        );
                      })()}
                    </div>
                    {resetToken && tokenForId === r.id && (
                      <div style={{ fontSize: 12, marginTop: 4 }}>Token: {resetToken}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

class RidersBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: any) {
    console.error("Riders page error", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={panel}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Something went wrong</div>
          <div style={{ fontSize: 13, color: "#b91c1c" }}>{this.state.error.message}</div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function Riders() {
  return (
    <RidersBoundary>
      <RidersInner />
    </RidersBoundary>
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
  gap: 6,
  alignItems: "flex-end",
  minWidth: 180,
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

const inp: React.CSSProperties = { flex: 1, padding: 12, borderRadius: 12, border: "1px solid #e5e7eb" };
const filterRow: React.CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" };
const filterInput: React.CSSProperties = { padding: 10, borderRadius: 12, border: "1px solid #e5e7eb", minWidth: 160 };
const lightBtn: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  background: "white",
  fontWeight: 700,
  cursor: "pointer",
};
const bulkRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  alignItems: "center",
  padding: 10,
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  background: "#f8fafc",
};
const btn: React.CSSProperties = { padding: "12px 14px", borderRadius: 12, border: 0, color: "white", background: "linear-gradient(135deg,#0ea5e9,#2563eb)", cursor: "pointer", fontWeight: 800 };
const btnDanger: React.CSSProperties = { ...btn, background: "linear-gradient(135deg,#ef4444,#b91c1c)" };
const ghostBtn: React.CSSProperties = { padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.2)", background: "transparent", color: "white", fontWeight: 700, cursor: "pointer" };

const statGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 };
const statCard: React.CSSProperties = { borderRadius: 14, padding: 14, color: "white", boxShadow: "0 10px 24px rgba(0,0,0,0.12)" };

const mainGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, alignItems: "start" };
const panel: React.CSSProperties = { background: "white", borderRadius: 16, padding: 14, boxShadow: "0 10px 24px rgba(0,0,0,0.06)", display: "grid", gap: 10 };
const panelHeader: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center" };
const panelLabel: React.CSSProperties = { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4, opacity: 0.65 };
const panelTitle: React.CSSProperties = { fontSize: 18, fontWeight: 800, marginTop: 2 };
const chip: React.CSSProperties = { padding: "6px 10px", borderRadius: 10, background: "#e0f2fe", color: "#0369a1", fontWeight: 700, fontSize: 12 };
const badgeMuted: React.CSSProperties = { padding: "6px 10px", borderRadius: 10, background: "#f1f5f9", color: "#0f172a", fontWeight: 700, fontSize: 12 };
const queueItem: React.CSSProperties = { padding: "10px 12px", borderRadius: 12, border: "1px solid #e5e7eb", background: "#f8fafc", display: "flex", justifyContent: "space-between", alignItems: "center" };
const empty: React.CSSProperties = { padding: 12, border: "1px dashed #e5e7eb", borderRadius: 10, textAlign: "center", color: "#6b7280" };

function renderStatus(status: string) {
  const meta = statusMeta[status] || { label: status || "Unknown", bg: "#f3f4f6", color: "#111827" };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 999,
        background: meta.bg,
        color: meta.color,
        fontWeight: 700,
      }}
    >
      {meta.label}
    </span>
  );
}
