import { useEffect, useMemo, useState } from "react";
import { Topbar } from "../../components/Layout/Topbar";
import { api } from "../../api/client";
import { getApiErrorMessage } from "../../api/errors";

type Store = {
  id: number;
  name: string;
  code?: string | null;
  is_active?: boolean;
  created_at?: string | null;
  rider_count?: number;
  rider_limit?: number | null;
  default_base_pay_cents?: number;
  geofence_id?: number | null;
  lat?: number | null;
  lng?: number | null;
  radius_m?: number | null;
  geofence_active?: boolean | null;
};

type Rider = {
  id: number;
  username: string;
  name: string;
  store?: string | null;
  status: string;
  updated_at?: string | null;
  is_active?: boolean;
};

type Captain = {
  id: number;
  username: string;
  name: string;
  store?: string | null;
  is_active?: boolean;
  created_at?: string | null;
};

export default function Stores() {
  const [stores, setStores] = useState<Store[]>([]);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [captains, setCaptains] = useState<Captain[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [radius, setRadius] = useState("1000");
  const [defaultPay, setDefaultPay] = useState("");
  const [riderLimit, setRiderLimit] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [riderStore, setRiderStore] = useState("");
  const [riderQuery, setRiderQuery] = useState("");
  const [riderStatus, setRiderStatus] = useState("all");
  const [riderActive, setRiderActive] = useState("all");
  const [editingStoreId, setEditingStoreId] = useState<number | null>(null);
  const [editLat, setEditLat] = useState("");
  const [editLng, setEditLng] = useState("");
  const [editRadius, setEditRadius] = useState("1000");
  const [savingLocation, setSavingLocation] = useState(false);
  const [editingPriceStoreId, setEditingPriceStoreId] = useState<number | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [savingPrice, setSavingPrice] = useState(false);
  const [editingLimitStoreId, setEditingLimitStoreId] = useState<number | null>(null);
  const [editLimit, setEditLimit] = useState("");
  const [savingLimit, setSavingLimit] = useState(false);
  const [captainName, setCaptainName] = useState("");
  const [captainUsername, setCaptainUsername] = useState("");
  const [captainPassword, setCaptainPassword] = useState("");
  const [captainStore, setCaptainStore] = useState("");
  const [captainLoading, setCaptainLoading] = useState(false);

  const loadStores = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await api.get<Store[]>("/admin/stores");
      setStores(res.data || []);
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to load stores"));
    } finally {
      setLoading(false);
    }
  };

  const loadRiders = async () => {
    setErr(null);
    try {
      const res = await api.get<{ items: Rider[] }>("/admin/riders");
      setRiders(res.data.items || []);
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to load riders"));
    }
  };

  const loadCaptains = async () => {
    setErr(null);
    try {
      const res = await api.get<Captain[]>("/admin/store-captains");
      setCaptains(res.data || []);
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to load store captains"));
    }
  };

  useEffect(() => {
    loadStores();
    loadRiders();
    loadCaptains();
  }, []);

  const fillCurrentLocation = async (onFill: (lat: string, lng: string) => void) => {
    if (!navigator.geolocation) {
      setErr("Geolocation is not supported in this browser");
      return;
    }
    setErr(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onFill(pos.coords.latitude.toFixed(6), pos.coords.longitude.toFixed(6));
      },
      () => {
        setErr("Unable to fetch current location");
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const addStore = async () => {
    const normalized = name.trim();
    if (!normalized) {
      setErr("Store name is required");
      return;
    }
    setErr(null);
    try {
      const hasLat = lat.trim().length > 0;
      const hasLng = lng.trim().length > 0;
      if ((hasLat && !hasLng) || (!hasLat && hasLng)) {
        setErr("Provide both latitude and longitude");
        return;
      }
      const payload: Record<string, any> = {
        name: normalized,
        code: code.trim() || undefined,
      };
      if (defaultPay.trim().length > 0) {
        const payValue = Number(defaultPay);
        if (Number.isNaN(payValue) || payValue < 0) {
          setErr("Default pay must be a positive number");
          return;
        }
        payload.default_base_pay_cents = Math.round(payValue * 100);
      }
      if (riderLimit.trim().length > 0) {
        const limitValue = Number(riderLimit);
        if (!Number.isFinite(limitValue) || limitValue < 0 || !Number.isInteger(limitValue)) {
          setErr("Rider limit must be a whole number");
          return;
        }
        payload.rider_limit = limitValue;
      }
      if (hasLat && hasLng) {
        const radiusValue = radius.trim() ? Number(radius) : 1000;
        if (Number.isNaN(radiusValue) || radiusValue <= 0) {
          setErr("Radius must be a positive number");
          return;
        }
        payload.lat = Number(lat);
        payload.lng = Number(lng);
        payload.radius_m = radiusValue;
      }
      await api.post("/admin/stores", payload);
      setName("");
      setCode("");
      setLat("");
      setLng("");
      setRadius("1000");
      setDefaultPay("");
      setRiderLimit("");
      loadStores();
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to create store"));
    }
  };

  const addCaptain = async () => {
    const nameValue = captainName.trim();
    const usernameValue = captainUsername.trim();
    const storeValue = captainStore.trim();
    if (!nameValue || !usernameValue || !captainPassword || !storeValue) {
      setErr("Captain name, username, password, and store are required");
      return;
    }
    setErr(null);
    try {
      setCaptainLoading(true);
      await api.post("/admin/store-captains", {
        name: nameValue,
        username: usernameValue,
        password: captainPassword,
        store: storeValue,
      });
      setCaptainName("");
      setCaptainUsername("");
      setCaptainPassword("");
      setCaptainStore("");
      loadCaptains();
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to add store captain"));
    } finally {
      setCaptainLoading(false);
    }
  };

  const deleteCaptain = async (captainId: number) => {
    setErr(null);
    try {
      await api.delete(`/admin/store-captains/${captainId}`);
      setCaptains((prev) => prev.filter((c) => c.id !== captainId));
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to delete store captain"));
    }
  };

  const startEditLocation = (store: Store) => {
    setEditingStoreId(store.id);
    setEditLat(store.lat != null ? String(store.lat) : "");
    setEditLng(store.lng != null ? String(store.lng) : "");
    setEditRadius(store.radius_m != null ? String(store.radius_m) : "1000");
  };

  const startEditPrice = (store: Store) => {
    setEditingPriceStoreId(store.id);
    const cents = store.default_base_pay_cents ?? 0;
    setEditPrice((cents / 100).toFixed(2));
  };

  const cancelEditLocation = () => {
    setEditingStoreId(null);
    setEditLat("");
    setEditLng("");
    setEditRadius("1000");
  };

  const cancelEditPrice = () => {
    setEditingPriceStoreId(null);
    setEditPrice("");
  };

  const saveLocation = async () => {
    if (!editingStoreId) return;
    const hasLat = editLat.trim().length > 0;
    const hasLng = editLng.trim().length > 0;
    if (!hasLat || !hasLng) {
      setErr("Latitude and longitude are required to save location");
      return;
    }
    const radiusValue = editRadius.trim() ? Number(editRadius) : 1000;
    if (Number.isNaN(radiusValue) || radiusValue <= 0) {
      setErr("Radius must be a positive number");
      return;
    }
    setSavingLocation(true);
    setErr(null);
    try {
      await api.patch(`/admin/stores/${editingStoreId}/location`, {
        lat: Number(editLat),
        lng: Number(editLng),
        radius_m: radiusValue,
      });
      await loadStores();
      cancelEditLocation();
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to update store location"));
    } finally {
      setSavingLocation(false);
    }
  };

  const savePrice = async () => {
    if (!editingPriceStoreId) return;
    const value = Number(editPrice);
    if (Number.isNaN(value) || value < 0) {
      setErr("Default pay must be 0 or greater");
      return;
    }
    setSavingPrice(true);
    setErr(null);
    try {
      await api.patch(`/admin/stores/${editingPriceStoreId}/pricing`, {
        default_base_pay_cents: Math.round(value * 100),
      });
      await loadStores();
      cancelEditPrice();
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to update store pricing"));
    } finally {
      setSavingPrice(false);
    }
  };

  const startEditLimit = (store: Store) => {
    setEditingLimitStoreId(store.id);
    setEditLimit(store.rider_limit != null ? String(store.rider_limit) : "");
  };

  const cancelEditLimit = () => {
    setEditingLimitStoreId(null);
    setEditLimit("");
    setSavingLimit(false);
  };

  const saveLimit = async () => {
    if (!editingLimitStoreId) return;
    const raw = editLimit.trim();
    let payload: Record<string, any> = {};
    if (!raw) {
      payload.rider_limit = null;
    } else {
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
        setErr("Rider limit must be a whole number");
        return;
      }
      payload.rider_limit = value;
    }
    setSavingLimit(true);
    setErr(null);
    try {
      await api.patch(`/admin/stores/${editingLimitStoreId}/limit`, payload);
      await loadStores();
      cancelEditLimit();
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to update rider limit"));
    } finally {
      setSavingLimit(false);
    }
  };

  const deleteStore = async (storeId: number) => {
    setErr(null);
    try {
      await api.delete(`/admin/stores/${storeId}`);
      setStores((prev) => prev.filter((s) => s.id !== storeId));
      setRiderStore("");
      await loadRiders();
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Failed to delete store"));
    }
  };

  const filteredRiders = useMemo(() => {
    const q = riderQuery.trim().toLowerCase();
    const store = riderStore.trim().toLowerCase();
    const status = riderStatus === "all" ? "" : riderStatus;
    return riders.filter((r) => {
      if (store && (r.store || "").toLowerCase() !== store) return false;
      if (status && (r.status || "offline") !== status) return false;
      if (riderActive === "active" && r.is_active === false) return false;
      if (riderActive === "inactive" && r.is_active !== false) return false;
      if (q && !`${r.name} ${r.username}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [riders, riderQuery, riderStore, riderStatus, riderActive]);

  const formatCoord = (value?: number | null) =>
    value == null ? "-" : Number.isFinite(value) ? value.toFixed(5) : "-";
  const formatMoney = (cents?: number | null) => {
    const value = (cents || 0) / 100;
    return new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED" }).format(value);
  };

  const mapLink = (latValue?: number | null, lngValue?: number | null) => {
    if (latValue == null || lngValue == null) return "";
    return `https://www.google.com/maps?q=${latValue},${lngValue}`;
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Topbar title="Stores" />

      {err && <div style={alert}>{err}</div>}

      <section style={panel}>
        <header style={panelHeader}>
          <div>
            <div style={panelLabel}>Add store</div>
            <div style={panelTitle}>Create a new store</div>
          </div>
          <button style={ghostBtn} onClick={loadStores} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </header>
        <div style={formRow}>
          <input style={input} placeholder="Store name" value={name} onChange={(e) => setName(e.target.value)} />
          <input style={input} placeholder="Code (optional)" value={code} onChange={(e) => setCode(e.target.value)} />
          <input
            style={input}
            type="number"
            min="0"
            step="0.01"
            placeholder="Default delivery pay"
            value={defaultPay}
            onChange={(e) => setDefaultPay(e.target.value)}
          />
          <input
            style={input}
            type="number"
            min="0"
            step="1"
            placeholder="Rider limit (optional)"
            value={riderLimit}
            onChange={(e) => setRiderLimit(e.target.value)}
          />
          <input
            style={input}
            type="number"
            placeholder="Latitude"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
          />
          <input
            style={input}
            type="number"
            placeholder="Longitude"
            value={lng}
            onChange={(e) => setLng(e.target.value)}
          />
          <input
            style={input}
            type="number"
            placeholder="Radius (m)"
            value={radius}
            onChange={(e) => setRadius(e.target.value)}
          />
          <button style={ghostBtn} onClick={() => fillCurrentLocation((nextLat, nextLng) => {
            setLat(nextLat);
            setLng(nextLng);
          })}>
            Use my location
          </button>
          <button style={primaryBtn} onClick={addStore} disabled={!name.trim()}>
            Add store
          </button>
        </div>
        <div style={{ fontSize: 12, opacity: 0.7 }}>
          Location is optional. Add it now or set it later from the store list.
        </div>
      </section>

      <section style={panel}>
        <header style={panelHeader}>
          <div>
            <div style={panelLabel}>Stores</div>
            <div style={panelTitle}>Manage stores</div>
          </div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>{stores.length} total</div>
        </header>
        {stores.length === 0 ? (
          <div style={empty}>No stores yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {stores.map((s) => (
              <div key={s.id} style={{ ...row, flexDirection: "column", alignItems: "stretch", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 800 }}>{s.name}</div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      Code: {s.code || "-"} - Riders: {s.rider_count ?? 0}{s.rider_limit != null ? ` / ${s.rider_limit}` : " (Unlimited)"}
                    </div>
                    {s.rider_limit != null && (
                      <div style={{ fontSize: 12, opacity: 0.7 }}>
                        Slots left: {Math.max(0, (s.rider_limit || 0) - (s.rider_count ?? 0))}
                      </div>
                    )}
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      Default pay: {formatMoney(s.default_base_pay_cents)}
                    </div>
                    {s.lat != null && s.lng != null ? (
                      <>
                        <div style={{ fontSize: 12, opacity: 0.7 }}>
                          Location: {formatCoord(s.lat)}, {formatCoord(s.lng)} {s.radius_m ? `- ${Math.round(s.radius_m)}m` : ""}
                        </div>
                        <a href={mapLink(s.lat, s.lng)} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                          View on map
                        </a>
                      </>
                    ) : (
                      <div style={{ fontSize: 12, opacity: 0.7 }}>Location: not set</div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button style={ghostBtn} onClick={() => setRiderStore(s.name)}>
                      View riders
                    </button>
                    <button style={ghostBtn} onClick={() => startEditPrice(s)}>
                      Set price
                    </button>
                    <button style={ghostBtn} onClick={() => startEditLimit(s)}>
                      Set limit
                    </button>
                    <button style={ghostBtn} onClick={() => startEditLocation(s)}>
                      {s.lat != null && s.lng != null ? "Update location" : "Set location"}
                    </button>
                    <button style={dangerBtn} onClick={() => deleteStore(s.id)}>
                      Delete
                    </button>
                  </div>
                </div>

                {editingPriceStoreId === s.id && (
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={formRow}>
                      <input
                        style={input}
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Default delivery pay"
                        value={editPrice}
                        onChange={(e) => setEditPrice(e.target.value)}
                      />
                      <button style={primaryBtn} onClick={savePrice} disabled={savingPrice}>
                        {savingPrice ? "Saving..." : "Save price"}
                      </button>
                      <button style={ghostBtn} onClick={cancelEditPrice}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {editingLimitStoreId === s.id && (
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={formRow}>
                      <input
                        style={input}
                        type="number"
                        min="0"
                        step="1"
                        placeholder="Rider limit (blank = unlimited)"
                        value={editLimit}
                        onChange={(e) => setEditLimit(e.target.value)}
                      />
                      <button style={primaryBtn} onClick={saveLimit} disabled={savingLimit}>
                        {savingLimit ? "Saving..." : "Save limit"}
                      </button>
                      <button style={ghostBtn} onClick={cancelEditLimit}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {editingStoreId === s.id && (
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={formRow}>
                      <input
                        style={input}
                        type="number"
                        placeholder="Latitude"
                        value={editLat}
                        onChange={(e) => setEditLat(e.target.value)}
                      />
                      <input
                        style={input}
                        type="number"
                        placeholder="Longitude"
                        value={editLng}
                        onChange={(e) => setEditLng(e.target.value)}
                      />
                      <input
                        style={input}
                        type="number"
                        placeholder="Radius (m)"
                        value={editRadius}
                        onChange={(e) => setEditRadius(e.target.value)}
                      />
                      <button
                        style={ghostBtn}
                        onClick={() => fillCurrentLocation((nextLat, nextLng) => {
                          setEditLat(nextLat);
                          setEditLng(nextLng);
                        })}
                      >
                        Use my location
                      </button>
                      <button style={primaryBtn} onClick={saveLocation} disabled={savingLocation}>
                        {savingLocation ? "Saving..." : "Save location"}
                      </button>
                      <button style={ghostBtn} onClick={cancelEditLocation}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={panel}>
        <header style={panelHeader}>
          <div>
            <div style={panelLabel}>Store captains</div>
            <div style={panelTitle}>Assign captains to stores</div>
          </div>
          <button style={ghostBtn} onClick={loadCaptains}>Refresh captains</button>
        </header>
        <div style={formRow}>
          <input
            style={input}
            placeholder="Captain name"
            value={captainName}
            onChange={(e) => setCaptainName(e.target.value)}
          />
          <input
            style={input}
            placeholder="Username"
            value={captainUsername}
            onChange={(e) => setCaptainUsername(e.target.value)}
          />
          <input
            style={input}
            type="password"
            placeholder="Temporary password"
            value={captainPassword}
            onChange={(e) => setCaptainPassword(e.target.value)}
          />
          <select style={input} value={captainStore} onChange={(e) => setCaptainStore(e.target.value)}>
            <option value="">Select store</option>
            {stores.map((s) => (
              <option key={s.id} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
          <button style={primaryBtn} onClick={addCaptain} disabled={captainLoading}>
            {captainLoading ? "Adding..." : "Add captain"}
          </button>
        </div>
        {captains.length === 0 ? (
          <div style={empty}>No store captains yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {captains.map((c) => (
              <div key={c.id} style={row}>
                <div>
                  <div style={{ fontWeight: 800 }}>{c.name}</div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    {c.username} - Store: {c.store || "-"}
                  </div>
                </div>
                <button style={dangerBtn} onClick={() => deleteCaptain(c.id)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={panel}>
        <header style={panelHeader}>
          <div>
            <div style={panelLabel}>Roster</div>
            <div style={panelTitle}>Riders list</div>
          </div>
          <button style={ghostBtn} onClick={loadRiders}>Refresh riders</button>
        </header>
        <div style={filterRow}>
          <input
            style={input}
            placeholder="Search name or username"
            value={riderQuery}
            onChange={(e) => setRiderQuery(e.target.value)}
          />
          <select style={input} value={riderStore} onChange={(e) => setRiderStore(e.target.value)}>
            <option value="">All stores</option>
            {stores.map((s) => (
              <option key={s.id} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
          <select style={input} value={riderStatus} onChange={(e) => setRiderStatus(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="available">Available</option>
            <option value="delivery">On Delivery</option>
            <option value="break">On Break</option>
            <option value="offline">Offline</option>
          </select>
          <select style={input} value={riderActive} onChange={(e) => setRiderActive(e.target.value)}>
            <option value="all">All activity</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <button
            style={ghostBtn}
            onClick={() => {
              setRiderStore("");
              setRiderQuery("");
              setRiderStatus("all");
              setRiderActive("all");
            }}
          >
            Clear filters
          </button>
        </div>
        {filteredRiders.length === 0 ? (
          <div style={empty}>No riders for this filter.</div>
        ) : (
          <table style={{ width: "100%" }}>
            <thead>
              <tr>
                <th align="left">Name</th>
                <th align="left">Username</th>
                <th align="left">Store</th>
                <th align="left">Status</th>
                <th align="left">Active</th>
              </tr>
            </thead>
            <tbody>
              {filteredRiders.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.username}</td>
                  <td>{r.store || "-"}</td>
                  <td>{r.status || "offline"}</td>
                  <td>{r.is_active === false ? "No" : "Yes"}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
const input: React.CSSProperties = { padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb", minWidth: 180 };
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
};

const empty: React.CSSProperties = { padding: 12, border: "1px dashed #e5e7eb", borderRadius: 10, color: "#6b7280" };

const alert: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  background: "#fee2e2",
  color: "#991b1b",
  fontWeight: 700,
};
