import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Topbar } from "../../components/Layout/Topbar";
import { api } from "../../api/client";
import { getApiErrorMessage } from "../../api/errors";

type LiveLocation = {
  rider_id: number;
  rider_name?: string | null;
  store?: string | null;
  status?: string | null;
  status_updated_at?: string | null;
  accuracy_m?: number | null;
  speed_mps?: number | null;
  lat: number;
  lng: number;
  updated_at?: string | null;
};
type Alert = {
  id: number;
  rider_id: number;
  rider_name?: string | null;
  store?: string | null;
  geofence_id?: number | null;
  geofence_name?: string | null;
  message: string;
  lat?: number | null;
  lng?: number | null;
  created_at: string;
};
type AlertsResponse = { items: Alert[]; total: number; limit: number; offset: number };
type HistoryResponse = { items: LiveLocation[]; total: number; limit: number; offset: number };
type Geofence = {
  id: number;
  name: string;
  store?: string | null;
  lat: number;
  lng: number;
  radius_m: number;
  is_active?: boolean | null;
};
type Store = {
  id: number;
  name: string;
  code?: string | null;
  is_active?: boolean;
  created_at?: string | null;
  rider_count?: number;
  geofence_id?: number | null;
  lat?: number | null;
  lng?: number | null;
  radius_m?: number | null;
  geofence_active?: boolean | null;
};

declare global {
  interface Window {
    L: any;
  }
}

const MAP_WIDTH = 720;
const MAP_HEIGHT = 360;
const MAP_PAD = 26;
const STALE_MINUTES = 15;
const TRAIL_LIMIT = 30;
const SNAP_RADIUS_STEP = 50;

export default function Tracking() {
  const nav = useNavigate();
  const location = useLocation();
  const [live, setLive] = useState<LiveLocation[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [history, setHistory] = useState<LiveLocation[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshMs, setRefreshMs] = useState(15000);
  const [autoCenter, setAutoCenter] = useState(true);
  const [followRider, setFollowRider] = useState(false);
  const [showMapTrail, setShowMapTrail] = useState(true);

  const [liveSearch, setLiveSearch] = useState("");
  const [liveStoreFilter, setLiveStoreFilter] = useState("");
  const [liveStatusFilter, setLiveStatusFilter] = useState("");
  const [liveFreshMinutes, setLiveFreshMinutes] = useState("60");
  const [liveOnlyAlerted, setLiveOnlyAlerted] = useState(false);
  const [liveStaleOnly, setLiveStaleOnly] = useState(false);
  const [selectedRiderId, setSelectedRiderId] = useState<number | null>(null);

  const [alertRiderId, setAlertRiderId] = useState("");
  const [alertGeofenceId, setAlertGeofenceId] = useState("");
  const [alertQuery, setAlertQuery] = useState("");
  const [alertsOnlyWithCoords, setAlertsOnlyWithCoords] = useState(false);

  const [gfName, setGfName] = useState("");
  const [gfStore, setGfStore] = useState("");
  const [gfLat, setGfLat] = useState("");
  const [gfLng, setGfLng] = useState("");
  const [gfRadius, setGfRadius] = useState("");
  const [geofenceSearch, setGeofenceSearch] = useState("");
  const [geofenceStore, setGeofenceStore] = useState("");
  const [editingGeofenceId, setEditingGeofenceId] = useState<number | null>(null);
  const [editGfName, setEditGfName] = useState("");
  const [editGfStore, setEditGfStore] = useState("");
  const [editGfLat, setEditGfLat] = useState("");
  const [editGfLng, setEditGfLng] = useState("");
  const [editGfRadius, setEditGfRadius] = useState("");
  const [editGfActive, setEditGfActive] = useState(true);

  const today = new Date();
  const [fromDate, setFromDate] = useState(today.toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(today.toISOString().slice(0, 10));
  const [historyRiderId, setHistoryRiderId] = useState("");

  const [alertFromDate, setAlertFromDate] = useState(today.toISOString().slice(0, 10));
  const [alertToDate, setAlertToDate] = useState(today.toISOString().slice(0, 10));

  const [showMapGeofences, setShowMapGeofences] = useState(true);
  const [showMapAlerts, setShowMapAlerts] = useState(true);
  const [showMapHistory, setShowMapHistory] = useState(false);
  const [showMapPlayback, setShowMapPlayback] = useState(true);
  const [mapMode, setMapMode] = useState<"markers" | "clusters" | "heat">("markers");
  const [trailPoints, setTrailPoints] = useState<LiveLocation[]>([]);
  const [storeLocationId, setStoreLocationId] = useState("");
  const [drawnCircle, setDrawnCircle] = useState<{ lat: number; lng: number; radius_m: number } | null>(null);

  const [alertLimit, setAlertLimit] = useState(50);
  const [alertOffset, setAlertOffset] = useState(0);
  const [alertTotal, setAlertTotal] = useState(0);

  const [historyLimit, setHistoryLimit] = useState(200);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyTotal, setHistoryTotal] = useState(0);

  const [useStream, setUseStream] = useState(false);
  const [streamStatus, setStreamStatus] = useState<"idle" | "connected" | "disconnected">("idle");
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [playbackPlaying, setPlaybackPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  const [addressCache, setAddressCache] = useState<Record<string, string>>({});
  const [addressLoading, setAddressLoading] = useState<Record<string, boolean>>({});

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const mapLayerRef = useRef<any>(null);
  const drawLayerRef = useRef<any>(null);
  const drawControlRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);
  const streamRef = useRef<EventSource | null>(null);
  const playbackTimerRef = useRef<number | null>(null);
  const focusedRiderRef = useRef<number | null>(null);

  const loadLiveAndGeofences = async () => {
    setErr(null);
    try {
      const [liveRes, gfRes] = await Promise.all([
        api.get<LiveLocation[]>("/tracking/live"),
        api.get<Geofence[]>("/admin/geofences"),
      ]);
      setLive(liveRes.data || []);
      setGeofences(gfRes.data || []);
    } catch (e) {
      setErr(getApiErrorMessage(e, "Failed to load tracking data"));
    }
  };

  const loadStores = async () => {
    setErr(null);
    try {
      const res = await api.get<Store[]>("/admin/stores");
      setStores(res.data || []);
    } catch (e) {
      setErr(getApiErrorMessage(e, "Failed to load stores"));
    }
  };

  const loadAlerts = async (offset = 0, append = false) => {
    setErr(null);
    try {
      const alertParams: Record<string, string | number> = {
        from: alertFromDate,
        to: alertToDate,
        limit: alertLimit,
        offset,
      };
      const res = await api.get<AlertsResponse>("/admin/location-alerts", { params: alertParams });
      const payload = res.data;
      setAlerts((prev) => (append ? [...prev, ...(payload.items || [])] : payload.items || []));
      setAlertTotal(payload.total || 0);
      setAlertOffset(payload.offset || 0);
    } catch (e) {
      setErr(getApiErrorMessage(e, "Failed to load alerts"));
    }
  };

  const getAgeMinutes = (value?: string | null) => {
    if (!value) return null;
    const ts = new Date(value).getTime();
    if (Number.isNaN(ts)) return null;
    return Math.max(0, Math.round((Date.now() - ts) / 60000));
  };

  const isStale = (value?: string | null) => {
    const age = getAgeMinutes(value);
    return age != null && age > STALE_MINUTES;
  };

  const snapRadius = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return SNAP_RADIUS_STEP;
    return Math.max(SNAP_RADIUS_STEP, Math.round(value / SNAP_RADIUS_STEP) * SNAP_RADIUS_STEP);
  };

  const formatDate = (value: Date) => value.toISOString().slice(0, 10);

  const loadAll = async (resetAlerts = true) => {
    await Promise.all([
      loadLiveAndGeofences(),
      loadAlerts(resetAlerts ? 0 : alertOffset, !resetAlerts),
    ]);
  };

  useEffect(() => {
    loadStores();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const riderParam = params.get("rider_id");
    if (riderParam && /^\d+$/.test(riderParam)) {
      const riderId = Number(riderParam);
      setSelectedRiderId(riderId);
      setHistoryRiderId(String(riderId));
    }
  }, [location.search]);

  useEffect(() => {
    setAlertOffset(0);
    loadAll(true);
  }, [alertFromDate, alertToDate, alertLimit]);

  useEffect(() => {
    if (!autoRefresh || useStream) return;
    const id = setInterval(() => loadAll(true), refreshMs);
    return () => clearInterval(id);
  }, [autoRefresh, refreshMs, alertFromDate, alertToDate, alertLimit, useStream]);

  useEffect(() => {
    if (!useStream) {
      if (streamRef.current) {
        streamRef.current.close();
        streamRef.current = null;
      }
      setStreamStatus("idle");
      return;
    }

    const token = localStorage.getItem("token");
    if (!token) {
      setErr("Missing auth token for live stream");
      setUseStream(false);
      return;
    }
    const base = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");
    const es = new EventSource(`${base}/tracking/stream?token=${encodeURIComponent(token)}`);
    streamRef.current = es;
    setStreamStatus("connected");

    es.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data || "{}");
        if (Array.isArray(data.live)) setLive(data.live);
        if (Array.isArray(data.alerts)) setAlerts(data.alerts);
      } catch {
        // ignore parse errors
      }
    };
    es.onerror = () => {
      setStreamStatus("disconnected");
      es.close();
      streamRef.current = null;
    };

    return () => {
      es.close();
      streamRef.current = null;
    };
  }, [useStream]);

  useEffect(() => {
    let timer: number | undefined;
    const init = () => {
      if (!mapContainerRef.current || mapRef.current) return Boolean(mapRef.current);
      if (!window.L) return false;
      const L = window.L;
      const map = L.map(mapContainerRef.current, { zoomControl: true, attributionControl: false });
      map.setView([0, 0], 2);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
      }).addTo(map);

      if (L.Control && L.Control.Draw) {
        const drawnItems = new L.FeatureGroup();
        map.addLayer(drawnItems);
        drawLayerRef.current = drawnItems;

        const drawControl = new L.Control.Draw({
          edit: { featureGroup: drawnItems, edit: true, remove: true },
          draw: {
            circle: true,
            polygon: false,
            polyline: false,
            rectangle: false,
            marker: false,
            circlemarker: false,
          },
        });
        map.addControl(drawControl);
        drawControlRef.current = drawControl;

        const onCreated = (evt: any) => {
          const layer = evt.layer;
          if (drawLayerRef.current) {
            drawLayerRef.current.clearLayers();
            drawLayerRef.current.addLayer(layer);
          }
          if (layer && layer.getLatLng && layer.getRadius) {
            const center = layer.getLatLng();
            const radius = snapRadius(layer.getRadius());
            if (layer.setRadius) layer.setRadius(radius);
            setGfLat(center.lat.toFixed(6));
            setGfLng(center.lng.toFixed(6));
            setGfRadius(Math.round(radius).toString());
            setDrawnCircle({ lat: center.lat, lng: center.lng, radius_m: Math.round(radius) });
          }
        };

        const onDeleted = (evt: any) => {
          const layers = evt.layers;
          const deletions: Promise<any>[] = [];
          layers.eachLayer((layer: any) => {
            const id = layer?.options?.geofenceId || layer?._geofenceId;
            if (!id) return;
            deletions.push(api.delete(`/admin/geofences/${id}`));
          });
          if (deletions.length) {
            Promise.all(deletions)
              .then(() => loadLiveAndGeofences())
              .catch((e) => setErr(getApiErrorMessage(e, "Failed to delete geofence")));
          }
          if (drawLayerRef.current) drawLayerRef.current.clearLayers();
          setDrawnCircle(null);
        };

        const onEdited = (evt: any) => {
          const layers = evt.layers;
          const updates: Promise<any>[] = [];
          layers.eachLayer((layer: any) => {
            const id = layer?.options?.geofenceId || layer?._geofenceId;
            if (!id || !layer.getLatLng || !layer.getRadius) return;
            const center = layer.getLatLng();
            const radius = snapRadius(layer.getRadius());
            if (layer.setRadius) layer.setRadius(radius);
            updates.push(
              api.patch(`/admin/geofences/${id}`, {
                lat: center.lat,
                lng: center.lng,
                radius_m: Math.round(radius),
              })
            );
          });
          layers.eachLayer((layer: any) => {
            const id = layer?.options?.geofenceId || layer?._geofenceId;
            if (id || !layer.getLatLng || !layer.getRadius) return;
            const center = layer.getLatLng();
            const radius = snapRadius(layer.getRadius());
            if (layer.setRadius) layer.setRadius(radius);
            setGfLat(center.lat.toFixed(6));
            setGfLng(center.lng.toFixed(6));
            setGfRadius(Math.round(radius).toString());
            setDrawnCircle({ lat: center.lat, lng: center.lng, radius_m: Math.round(radius) });
          });
          if (updates.length) {
            Promise.all(updates)
              .then(() => loadLiveAndGeofences())
              .catch((e) => setErr(getApiErrorMessage(e, "Failed to update geofence")));
          }
        };

        map.on(L.Draw.Event.CREATED, onCreated);
        map.on(L.Draw.Event.DELETED, onDeleted);
        map.on(L.Draw.Event.EDITED, onEdited);
      }

      mapRef.current = map;
      setMapReady(true);
      return true;
    };
    if (!init()) {
      timer = window.setInterval(() => {
        if (init() && timer) window.clearInterval(timer);
      }, 200);
    }
    return () => {
      if (timer) window.clearInterval(timer);
      if (mapRef.current) {
        if (drawControlRef.current) {
          mapRef.current.removeControl(drawControlRef.current);
          drawControlRef.current = null;
        }
        if (drawLayerRef.current) {
          drawLayerRef.current.clearLayers();
          drawLayerRef.current = null;
        }
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const id = window.setTimeout(() => {
      map.invalidateSize();
    }, 60);
    return () => window.clearTimeout(id);
  }, [mapReady]);

  useEffect(() => {
    if (!mapReady || !window.L || !drawLayerRef.current) return;
    const L = window.L;
    const layer = drawLayerRef.current;
    layer.clearLayers();
    if (!showMapGeofences) return;
    geofences.forEach((g) => {
      const circle = L.circle([g.lat, g.lng], {
        radius: g.radius_m,
        color: "#3b82f6",
        weight: 2,
        fillColor: "#60a5fa",
        fillOpacity: 0.12,
      });
      circle.options.geofenceId = g.id;
      circle._geofenceId = g.id;
      circle.bindTooltip(g.name);
      layer.addLayer(circle);
    });
  }, [geofences, showMapGeofences, mapReady]);

  const loadHistory = async (offset = 0, append = false) => {
    setErr(null);
    try {
      const params: Record<string, string | number> = { from: fromDate, to: toDate, limit: historyLimit, offset };
      if (/^\d+$/.test(historyRiderId)) params.rider_id = historyRiderId;
      const res = await api.get<HistoryResponse>("/tracking/history", { params });
      setHistory((prev) => (append ? [...prev, ...(res.data.items || [])] : res.data.items || []));
      setHistoryTotal(res.data.total || 0);
      setHistoryOffset(res.data.offset || 0);
      if (/^\d+$/.test(historyRiderId)) setSelectedRiderId(Number(historyRiderId));
    } catch (e) {
      setErr(getApiErrorMessage(e, "Failed to load history"));
    }
  };

  useEffect(() => {
    loadTrail(selectedRiderId);
  }, [selectedRiderId]);

  const loadTrail = async (riderId: number | null) => {
    if (!riderId) {
      setTrailPoints([]);
      return;
    }
    setErr(null);
    try {
      const to = new Date();
      const from = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const params: Record<string, string | number> = {
        from: formatDate(from),
        to: formatDate(to),
        limit: 200,
        offset: 0,
        rider_id: riderId,
      };
      const res = await api.get<HistoryResponse>("/tracking/history", { params });
      const items = (res.data.items || []).slice().sort((a, b) => {
        const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return aTime - bTime;
      });
      setTrailPoints(items.slice(-TRAIL_LIMIT));
    } catch (e) {
      setErr(getApiErrorMessage(e, "Failed to load trail"));
    }
  };

  const createGeofence = async () => {
    setErr(null);
    if (!gfName || !gfLat || !gfLng || !gfRadius) {
      setErr("Name, lat, lng, and radius are required");
      return;
    }
    try {
      await api.post("/admin/geofences", {
        name: gfName,
        store: gfStore || null,
        lat: Number(gfLat),
        lng: Number(gfLng),
        radius_m: Number(gfRadius),
      });
      setGfName("");
      setGfStore("");
      setGfLat("");
      setGfLng("");
      setGfRadius("");
      clearDrawing();
      loadAll();
    } catch (e) {
      setErr(getApiErrorMessage(e, "Failed to create geofence"));
    }
  };

  const startEditGeofence = (g: Geofence) => {
    setEditingGeofenceId(g.id);
    setEditGfName(g.name);
    setEditGfStore(g.store || "");
    setEditGfLat(String(g.lat));
    setEditGfLng(String(g.lng));
    setEditGfRadius(String(g.radius_m));
    setEditGfActive(g.is_active !== false);
  };

  const cancelEditGeofence = () => {
    setEditingGeofenceId(null);
    setEditGfName("");
    setEditGfStore("");
    setEditGfLat("");
    setEditGfLng("");
    setEditGfRadius("");
    setEditGfActive(true);
  };

  const saveEditGeofence = async () => {
    if (!editingGeofenceId) return;
    setErr(null);
    if (!editGfName || !editGfLat || !editGfLng || !editGfRadius) {
      setErr("Name, lat, lng, and radius are required");
      return;
    }
    try {
      await api.patch(`/admin/geofences/${editingGeofenceId}`, {
        name: editGfName,
        store: editGfStore || null,
        lat: Number(editGfLat),
        lng: Number(editGfLng),
        radius_m: Number(editGfRadius),
        is_active: editGfActive,
      });
      cancelEditGeofence();
      loadAll();
    } catch (e) {
      setErr(getApiErrorMessage(e, "Failed to update geofence"));
    }
  };

  const copyCoords = async (lat: number, lng: number) => {
    try {
      await navigator.clipboard.writeText(`${lat}, ${lng}`);
    } catch {
      setErr("Unable to copy coordinates");
    }
  };

  const addressKey = (lat: number, lng: number) => `${lat.toFixed(5)},${lng.toFixed(5)}`;
  const inFlightRef = useRef<Set<string>>(new Set());

  const fetchAddress = async (lat: number, lng: number) => {
    const key = addressKey(lat, lng);
    if (addressCache[key] || inFlightRef.current.has(key)) return;
    inFlightRef.current.add(key);
    setAddressLoading((prev) => ({ ...prev, [key]: true }));
    try {
      const res = await api.get<{ address: string }>("/geo/reverse", { params: { lat, lng } });
      const addr = (res.data?.address || "").trim();
      setAddressCache((prev) => ({ ...prev, [key]: addr }));
    } catch {
      setAddressCache((prev) => ({ ...prev, [key]: "" }));
    } finally {
      inFlightRef.current.delete(key);
      setAddressLoading((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const exportHistory = async () => {
    setErr(null);
    try {
      const params: Record<string, string> = { from: fromDate, to: toDate };
      if (/^\d+$/.test(historyRiderId)) params.rider_id = historyRiderId;
      const res = await api.get("/tracking/history/export", { params, responseType: "blob" });
      const blob = new Blob([res.data], { type: "text/csv" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `tracking_history_${fromDate}_to_${toDate}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setErr(getApiErrorMessage(e, "Failed to export history"));
    }
  };

  const centerOn = (lat: number, lng: number) => {
    if (!mapRef.current) return;
    mapRef.current.setView([lat, lng], Math.max(mapRef.current.getZoom(), 14), { animate: true });
  };

  const fitToPoints = (points: { lat: number; lng: number }[], maxZoom = 16) => {
    if (!mapRef.current || !window.L || points.length === 0) return;
    const bounds = window.L.latLngBounds(points.map((p) => [p.lat, p.lng]));
    mapRef.current.fitBounds(bounds, { padding: [24, 24], maxZoom });
  };

  const clearDrawing = () => {
    if (drawLayerRef.current) {
      drawLayerRef.current.clearLayers();
    }
    setDrawnCircle(null);
  };

  const resolveStoreLocation = () => {
    const id = storeLocationId || "";
    if (id) {
      return stores.find((s) => String(s.id) === id);
    }
    const name = liveStoreFilter.trim().toLowerCase();
    if (!name) return null;
    return stores.find((s) => (s.name || "").toLowerCase() === name) || null;
  };

  const focusOnStore = () => {
    const store = resolveStoreLocation();
    if (!store || store.lat == null || store.lng == null) {
      setErr("Store location is missing. Select a store with a saved location.");
      return;
    }
    if (window.L && typeof store.radius_m === "number") {
      const bounds = window.L.circle([store.lat, store.lng], { radius: store.radius_m }).getBounds();
      mapRef.current?.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 });
    } else {
      centerOn(store.lat, store.lng);
    }
  };

  const focusOnMe = () => {
    if (!navigator.geolocation) {
      setErr("Geolocation is not available in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        centerOn(pos.coords.latitude, pos.coords.longitude);
      },
      () => {
        setErr("Unable to fetch your current location.");
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const saveStoreLocation = async () => {
    if (!storeLocationId) {
      setErr("Select a store to update.");
      return;
    }
    if (!drawnCircle) {
      setErr("Draw a circle on the map to set the store location.");
      return;
    }
    setErr(null);
    try {
      await api.patch(`/admin/stores/${storeLocationId}/location`, {
        lat: drawnCircle.lat,
        lng: drawnCircle.lng,
        radius_m: drawnCircle.radius_m,
      });
      clearDrawing();
      await Promise.all([loadLiveAndGeofences(), loadStores()]);
    } catch (e) {
      setErr(getApiErrorMessage(e, "Failed to update store location"));
    }
  };

  const alertsByRider = useMemo(() => new Set(alerts.map((a) => a.rider_id)), [alerts]);

  const filteredLive = useMemo(() => {
    const search = liveSearch.trim().toLowerCase();
    const storeFilter = liveStoreFilter.trim().toLowerCase();
    const statusFilter = liveStatusFilter.trim().toLowerCase();
    const searchIsId = /^\d+$/.test(search);
    const freshMinutes = Number(liveFreshMinutes);
    const now = Date.now();
    return live
      .filter((l) => {
        if (storeFilter && (l.store || "").toLowerCase() !== storeFilter) return false;
        if (statusFilter && (l.status || "offline").toLowerCase() !== statusFilter) return false;
        if (search) {
          if (searchIsId) {
            if (String(l.rider_id) !== search) return false;
          } else {
            const name = (l.rider_name || "").toLowerCase();
            if (!name.includes(search) && !String(l.rider_id).includes(search)) return false;
          }
        }
        if (liveStaleOnly && !isStale(l.updated_at)) return false;
        if (liveOnlyAlerted && !alertsByRider.has(l.rider_id)) return false;
        if (Number.isFinite(freshMinutes) && freshMinutes > 0 && l.updated_at) {
          const ageMs = now - new Date(l.updated_at).getTime();
          if (ageMs > freshMinutes * 60 * 1000) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return bTime - aTime;
      });
  }, [live, liveSearch, liveStoreFilter, liveStatusFilter, liveFreshMinutes, liveOnlyAlerted, liveStaleOnly, alertsByRider]);

  const filteredAlerts = useMemo(() => {
    const idFilter = alertRiderId.trim();
    const gfFilter = alertGeofenceId.trim();
    const q = alertQuery.trim().toLowerCase();
    return alerts
      .filter((a) => {
        if (idFilter && String(a.rider_id) !== idFilter) return false;
        if (gfFilter && String(a.geofence_id ?? "") !== gfFilter) return false;
        if (alertsOnlyWithCoords && (a.lat == null || a.lng == null)) return false;
        if (q && !a.message.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [alerts, alertRiderId, alertGeofenceId, alertQuery, alertsOnlyWithCoords]);

  useEffect(() => {
    const liveTargets = filteredLive.slice(0, 15).map((l) => ({ lat: l.lat, lng: l.lng }));
    const alertTargets = filteredAlerts.slice(0, 20)
      .filter((a) => a.lat != null && a.lng != null)
      .map((a) => ({ lat: a.lat as number, lng: a.lng as number }));
    [...liveTargets, ...alertTargets].forEach((p) => fetchAddress(p.lat, p.lng));
  }, [filteredLive, filteredAlerts]);

  const filteredGeofences = useMemo(() => {
    const q = geofenceSearch.trim().toLowerCase();
    const store = geofenceStore.trim().toLowerCase();
    return geofences
      .filter((g) => {
        if (store && (g.store || "").toLowerCase() !== store) return false;
        if (q && !`${g.name} ${g.store || ""}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [geofences, geofenceSearch, geofenceStore]);

  const storeOptions = useMemo(() => {
    const storeSet = new Set<string>();
    geofences.forEach((g) => {
      if (g.store) storeSet.add(g.store);
    });
    live.forEach((l) => {
      if (l.store) storeSet.add(l.store);
    });
    stores.forEach((s) => {
      if (s.name) storeSet.add(s.name);
    });
    return Array.from(storeSet.values()).sort();
  }, [geofences, live, stores]);

  const focusOnRider = (riderId?: number | null) => {
    const id = riderId ?? selectedRiderId;
    if (!id) {
      setErr("Select a rider to focus on.");
      return;
    }
    const target = filteredLive.find((l) => l.rider_id === id);
    if (!target) {
      setErr("Selected rider is not in the live list.");
      return;
    }
    centerOn(target.lat, target.lng);
  };

  const geofenceById = useMemo(() => {
    const map = new Map<number, string>();
    geofences.forEach((g) => {
      map.set(g.id, g.name);
    });
    return map;
  }, [geofences]);

  const playbackTargetId = useMemo(() => {
    if (/^\\d+$/.test(historyRiderId)) return Number(historyRiderId);
    return selectedRiderId;
  }, [historyRiderId, selectedRiderId]);

  const playbackData = useMemo(() => {
    if (!playbackTargetId) return [];
    return history
      .filter((h) => h.rider_id === playbackTargetId)
      .slice()
      .sort((a, b) => {
        const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return aTime - bTime;
      });
  }, [history, playbackTargetId]);

  const playbackPoint = playbackData[playbackIndex] || null;

  useEffect(() => {
    setPlaybackIndex(0);
    setPlaybackPlaying(false);
  }, [playbackTargetId, playbackData.length]);

  useEffect(() => {
    if (playbackTimerRef.current) {
      window.clearInterval(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
    if (!playbackPlaying || playbackData.length < 2) return;
    const intervalMs = Math.max(300, 1000 / Math.max(1, playbackSpeed));
    playbackTimerRef.current = window.setInterval(() => {
      setPlaybackIndex((prev) => {
        if (playbackData.length === 0) return 0;
        return prev + 1 < playbackData.length ? prev + 1 : 0;
      });
    }, intervalMs);
    return () => {
      if (playbackTimerRef.current) {
        window.clearInterval(playbackTimerRef.current);
        playbackTimerRef.current = null;
      }
    };
  }, [playbackPlaying, playbackData.length, playbackSpeed]);

  const mapAlerts = showMapAlerts
    ? filteredAlerts.filter((a) => a.lat != null && a.lng != null)
    : [];
  const mapGeofences = showMapGeofences ? filteredGeofences : [];
  const mapHistory = showMapHistory ? history.slice(0, 200) : [];
  const mapPlayback = showMapPlayback && playbackPoint ? [playbackPoint] : [];
  const mapTrail = useMemo(() => {
    if (!showMapTrail) return [];
    let points = trailPoints.slice(-TRAIL_LIMIT);
    if (selectedRiderId) {
      const livePoint = filteredLive.find((l) => l.rider_id === selectedRiderId);
      if (livePoint) {
        const last = points[points.length - 1];
        if (!last || last.lat !== livePoint.lat || last.lng !== livePoint.lng) {
          points = [...points, livePoint];
        }
      }
    }
    return points.slice(-TRAIL_LIMIT);
  }, [showMapTrail, trailPoints, filteredLive, selectedRiderId]);
  const shouldCluster = mapMode === "clusters" && filteredLive.length > 50;
  const shouldHeat = mapMode === "heat" && filteredLive.length > 50;

  const mapPoints = useMemo(() => {
    const points: { lat: number; lng: number }[] = [];
    filteredLive.forEach((l) => points.push({ lat: l.lat, lng: l.lng }));
    mapAlerts.forEach((a) => points.push({ lat: a.lat as number, lng: a.lng as number }));
    mapGeofences.forEach((g) => points.push({ lat: g.lat, lng: g.lng }));
    mapHistory.forEach((h) => points.push({ lat: h.lat, lng: h.lng }));
    mapPlayback.forEach((p) => points.push({ lat: p.lat, lng: p.lng }));
    mapTrail.forEach((t) => points.push({ lat: t.lat, lng: t.lng }));
    return points;
  }, [filteredLive, mapAlerts, mapGeofences, mapHistory, mapPlayback, mapTrail]);

  const bounds = useMemo(() => {
    if (mapPoints.length === 0) {
      return { minLat: 0, maxLat: 0, minLng: 0, maxLng: 0, hasData: false };
    }
    let minLat = mapPoints[0].lat;
    let maxLat = mapPoints[0].lat;
    let minLng = mapPoints[0].lng;
    let maxLng = mapPoints[0].lng;
    mapPoints.forEach((p) => {
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
      minLng = Math.min(minLng, p.lng);
      maxLng = Math.max(maxLng, p.lng);
    });
    if (minLat === maxLat) {
      minLat -= 0.01;
      maxLat += 0.01;
    }
    if (minLng === maxLng) {
      minLng -= 0.01;
      maxLng += 0.01;
    }
    return { minLat, maxLat, minLng, maxLng, hasData: true };
  }, [mapPoints]);

  const liveClusters = useMemo(() => {
    if (!shouldCluster || filteredLive.length === 0) return [];
    const latRange = bounds.maxLat - bounds.minLat || 1;
    const lngRange = bounds.maxLng - bounds.minLng || 1;
    const sizeLat = Math.max(latRange / 18, 0.01);
    const sizeLng = Math.max(lngRange / 18, 0.01);
    const buckets = new Map<string, { latSum: number; lngSum: number; count: number }>();
    filteredLive.forEach((l) => {
      const key = `${Math.floor((l.lat - bounds.minLat) / sizeLat)}:${Math.floor((l.lng - bounds.minLng) / sizeLng)}`;
      const bucket = buckets.get(key) || { latSum: 0, lngSum: 0, count: 0 };
      bucket.latSum += l.lat;
      bucket.lngSum += l.lng;
      bucket.count += 1;
      buckets.set(key, bucket);
    });
    return Array.from(buckets.values()).map((b) => ({
      lat: b.latSum / b.count,
      lng: b.lngSum / b.count,
      count: b.count,
    }));
  }, [filteredLive, bounds, shouldCluster]);

  const project = (lat: number, lng: number) => {
    if (!bounds.hasData) return { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 };
    const latRange = bounds.maxLat - bounds.minLat || 1;
    const lngRange = bounds.maxLng - bounds.minLng || 1;
    const x = MAP_PAD + ((lng - bounds.minLng) / lngRange) * (MAP_WIDTH - MAP_PAD * 2);
    const y = MAP_PAD + ((bounds.maxLat - lat) / latRange) * (MAP_HEIGHT - MAP_PAD * 2);
    return { x, y };
  };

  const radiusToPx = (radiusM: number) => {
    if (!bounds.hasData) return 8;
    const latRange = bounds.maxLat - bounds.minLat || 1;
    const pxPerLat = (MAP_HEIGHT - MAP_PAD * 2) / latRange;
    const metersPerLat = 111320;
    return Math.max(6, Math.min(120, (radiusM / metersPerLat) * pxPerLat));
  };

  const mapHistoryPath = useMemo(() => {
    if (mapHistory.length < 2 || !bounds.hasData) return "";
    return mapHistory
      .map((h) => {
        const { x, y } = project(h.lat, h.lng);
        return `${x},${y}`;
      })
      .join(" ");
  }, [mapHistory, bounds]);

  const mapTrailPath = useMemo(() => {
    if (mapTrail.length < 2 || !bounds.hasData) return "";
    return mapTrail
      .map((h) => {
        const { x, y } = project(h.lat, h.lng);
        return `${x},${y}`;
      })
      .join(" ");
  }, [mapTrail, bounds]);

  const alertHasMore = alerts.length < alertTotal;
  const historyHasMore = history.length < historyTotal;

  const liveStatusLabel = (value?: string | null) => {
    if (value === "available") return "Available";
    if (value === "delivery") return "On Delivery";
    if (value === "break") return "On Break";
    if (value === "offline") return "Offline";
    return value || "Unknown";
  };

  const liveStatusColor = (value?: string | null, stale?: boolean) => {
    if (stale) return "#9ca3af";
    if (value === "available") return "#10b981";
    if (value === "delivery") return "#f97316";
    if (value === "break") return "#6b7280";
    return "#ef4444";
  };

  const bearingBetween = (from: { lat: number; lng: number }, to: { lat: number; lng: number }) => {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const y = Math.sin(toRad(to.lng - from.lng)) * Math.cos(toRad(to.lat));
    const x =
      Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) -
      Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(toRad(to.lng - from.lng));
    const brng = (Math.atan2(y, x) * 180) / Math.PI;
    return (brng + 360) % 360;
  };

  const liveLegendLabel = shouldHeat ? "Heatmap" : shouldCluster ? "Clusters" : "Live riders";
  const liveLegendColor = shouldHeat ? "#ef4444" : shouldCluster ? "#6366f1" : "#10b981";

  const storeSummary = useMemo(() => {
    const map = new Map<string, { store: string; total: number; available: number; delivery: number; break: number; offline: number; stale: number }>();
    live.forEach((l) => {
      const store = l.store || "Unassigned";
      const bucket = map.get(store) || { store, total: 0, available: 0, delivery: 0, break: 0, offline: 0, stale: 0 };
      bucket.total += 1;
      const status = l.status || "offline";
      if (status === "available") bucket.available += 1;
      else if (status === "delivery") bucket.delivery += 1;
      else if (status === "break") bucket.break += 1;
      else bucket.offline += 1;
      if (isStale(l.updated_at)) bucket.stale += 1;
      map.set(store, bucket);
    });
    return Array.from(map.values()).sort((a, b) => a.store.localeCompare(b.store));
  }, [live]);

  useEffect(() => {
    if (!mapRef.current || !window.L) return;
    const L = window.L;
    const map = mapRef.current;

    if (mapLayerRef.current) {
      mapLayerRef.current.remove();
      mapLayerRef.current = null;
    }

    const layer = L.layerGroup().addTo(map);

    if (showMapHistory && mapHistory.length > 1) {
      const line = L.polyline(
        mapHistory.map((h) => [h.lat, h.lng]),
        { color: "#94a3b8", weight: 3, dashArray: "4 3" }
      );
      line.addTo(layer);
    }

    if (showMapTrail && mapTrail.length > 1) {
      const line = L.polyline(
        mapTrail.map((h) => [h.lat, h.lng]),
        { color: "#22c55e", weight: 3 }
      );
      line.addTo(layer);
      const last = mapTrail[mapTrail.length - 1];
      const prev = mapTrail[mapTrail.length - 2];
      if (last && prev) {
        const bearing = bearingBetween(prev, last);
        const icon = L.divIcon({
          className: "direction-arrow",
          html: `<div class="direction-arrow__shape" style="transform: rotate(${bearing}deg)"></div>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        });
        const arrow = L.marker([last.lat, last.lng], { icon }).addTo(layer);
        arrow.bindPopup("Direction");
      }
    }

    if (!drawLayerRef.current) {
      mapGeofences.forEach((g) => {
        L.circle([g.lat, g.lng], {
          radius: g.radius_m,
          color: "#3b82f6",
          weight: 2,
          fillColor: "#60a5fa",
          fillOpacity: 0.12,
        }).addTo(layer);
      });
    }

    mapAlerts.forEach((a) => {
      const marker = L.circleMarker([a.lat as number, a.lng as number], {
        radius: 6,
        color: "#ef4444",
        weight: 2,
        fillColor: "#ef4444",
        fillOpacity: 0.9,
      }).addTo(layer);
      const label = a.rider_name || (a.rider_id ? `Rider ${a.rider_id}` : "Rider");
      const addr = a.lat != null && a.lng != null ? addressCache[addressKey(a.lat, a.lng)] : "";
      const addrLine = addr ? `<br/>${addr}` : "";
      marker.bindPopup(`<strong>${label}</strong><br/>${a.message}${addrLine}`);
    });

    if (shouldHeat && L.heatLayer) {
      const points = filteredLive.map((l) => [l.lat, l.lng, 0.6]);
      const heat = L.heatLayer(points, { radius: 24, blur: 18, maxZoom: 17 });
      heat.addTo(layer);
    } else if (shouldCluster) {
      liveClusters.forEach((c) => {
        const size = Math.min(46, 18 + c.count);
        const icon = L.divIcon({
          className: "cluster-marker",
          html: `<div>${c.count}</div>`,
          iconSize: [size, size],
        });
        const marker = L.marker([c.lat, c.lng], { icon }).addTo(layer);
        marker.bindPopup(`${c.count} riders`);
      });
    } else {
      filteredLive.forEach((l) => {
        const isSelected = selectedRiderId === l.rider_id;
        const stale = isStale(l.updated_at);
        const color = isSelected ? "#0f172a" : liveStatusColor(l.status, stale);
        const marker = L.circleMarker([l.lat, l.lng], {
          radius: isSelected ? 7 : 5,
          color,
          weight: 2,
          fillColor: color,
          fillOpacity: isSelected ? 0.9 : 0.7,
        }).addTo(layer);
        const label = l.rider_name || `Rider ${l.rider_id}`;
        const storeLabel = l.store ? `Store: ${l.store}` : "Store: Unassigned";
        const statusLabel = liveStatusLabel(l.status);
        const age = getAgeMinutes(l.updated_at);
        const ageText = age != null ? `${age}m ago` : "Last seen unknown";
        const staleLabel = stale ? "Stale" : "";
        const addr = addressCache[addressKey(l.lat, l.lng)] || "";
        const addrLine = addr ? `<br/>${addr}` : "";
        const accuracyLine = typeof l.accuracy_m === "number" ? `<br/>Accuracy ${Math.round(l.accuracy_m)}m` : "";
        const speedLine = typeof l.speed_mps === "number" ? `<br/>Speed ${(l.speed_mps * 3.6).toFixed(1)} km/h` : "";
        marker.bindTooltip(`${label} • ${statusLabel}${staleLabel ? ` • ${staleLabel}` : ""} • ${ageText}`, {
          direction: "top",
          offset: [0, -8],
          className: "map-label",
          permanent: isSelected,
          opacity: 0.9,
        });
        marker.bindPopup(
          `<strong>${label}</strong><br/>ID: ${l.rider_id}<br/>${storeLabel}<br/>${statusLabel}<br/>${ageText}${accuracyLine}${speedLine}${addrLine}`
        );
        marker.on("click", () => setSelectedRiderId(l.rider_id));
      });
    }

    if (showMapPlayback && playbackPoint) {
      const marker = L.circleMarker([playbackPoint.lat, playbackPoint.lng], {
        radius: 8,
        color: "#f59e0b",
        weight: 2,
        fillColor: "#f59e0b",
        fillOpacity: 0.9,
      }).addTo(layer);
      marker.bindPopup("Playback position");
    }

    mapLayerRef.current = layer;

    if (autoCenter && !followRider) {
      const focusPoints = filteredLive.map((l) => ({ lat: l.lat, lng: l.lng }));
      if (focusPoints.length > 0) {
        fitToPoints(focusPoints, 16);
      }
    }
  }, [mapPoints, mapGeofences, mapAlerts, mapHistory, showMapHistory, filteredLive, selectedRiderId, playbackPoint, showMapPlayback, addressCache, shouldCluster, shouldHeat, liveClusters, mapTrail, autoCenter, followRider, showMapTrail]);

  useEffect(() => {
    if (!selectedRiderId) {
      focusedRiderRef.current = null;
    }
  }, [selectedRiderId]);

  useEffect(() => {
    if (!mapRef.current || !selectedRiderId || followRider) return;
    const target = filteredLive.find((l) => l.rider_id === selectedRiderId);
    if (!target) return;
    if (focusedRiderRef.current === selectedRiderId) return;
    mapRef.current.setView([target.lat, target.lng], Math.max(mapRef.current.getZoom(), 14), { animate: true });
    focusedRiderRef.current = selectedRiderId;
  }, [selectedRiderId, filteredLive, followRider]);

  useEffect(() => {
    if (!mapRef.current || !selectedRiderId || !followRider) return;
    const target = filteredLive.find((l) => l.rider_id === selectedRiderId);
    if (!target) return;
    mapRef.current.setView([target.lat, target.lng], Math.max(mapRef.current.getZoom(), 14), { animate: true });
  }, [selectedRiderId, filteredLive, followRider]);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Topbar title="Tracking" />

      {err && <div style={alert}>{err}</div>}

      <section style={statsGrid}>
        <div style={statCard}>
          <div style={statLabel}>Live riders</div>
          <div style={statValue}>{filteredLive.length}</div>
          <div style={statMeta}>Showing live locations</div>
        </div>
        <div style={statCard}>
          <div style={statLabel}>Alerts</div>
          <div style={statValue}>{alertTotal ? `${filteredAlerts.length}/${alertTotal}` : filteredAlerts.length}</div>
          <div style={statMeta}>Filtered alerts</div>
        </div>
        <div style={statCard}>
          <div style={statLabel}>Geofences</div>
          <div style={statValue}>{filteredGeofences.length}</div>
          <div style={statMeta}>Active geofences</div>
        </div>
        <div style={statCard}>
          <div style={statLabel}>History points</div>
          <div style={statValue}>{historyTotal ? `${history.length}/${historyTotal}` : history.length}</div>
          <div style={statMeta}>Loaded locations</div>
        </div>
      </section>

      {storeSummary.length > 0 && (
        <section style={panel}>
          <header style={panelHeader}>
            <div>
              <div style={panelLabel}>Stores</div>
              <div style={panelTitle}>Live snapshot</div>
            </div>
          </header>
          <div style={storeGrid}>
            {storeSummary.map((s) => (
              <div key={s.store} style={storeCard}>
                <div style={{ fontWeight: 800 }}>{s.store}</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>Total: {s.total}</div>
                <div style={storeRow}>
                  <span style={storePill("#10b981")}>Available {s.available}</span>
                  <span style={storePill("#f97316")}>Delivery {s.delivery}</span>
                </div>
                <div style={storeRow}>
                  <span style={storePill("#6b7280")}>Break {s.break}</span>
                  <span style={storePill("#ef4444")}>Offline {s.offline}</span>
                </div>
                {s.stale > 0 && <div style={{ fontSize: 12, color: "#b45309" }}>Stale: {s.stale}</div>}
              </div>
            ))}
          </div>
        </section>
      )}

      <section style={panel}>
        <header style={panelHeader}>
          <div>
            <div style={panelLabel}>Map</div>
            <div style={panelTitle}>Live view</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <label style={toggle}>
              <input type="checkbox" checked={showMapAlerts} onChange={(e) => setShowMapAlerts(e.target.checked)} />
              <span>Alerts</span>
            </label>
            <label style={toggle}>
              <input type="checkbox" checked={showMapGeofences} onChange={(e) => setShowMapGeofences(e.target.checked)} />
              <span>Geofences</span>
            </label>
            <label style={toggle}>
              <input type="checkbox" checked={showMapHistory} onChange={(e) => setShowMapHistory(e.target.checked)} />
              <span>History</span>
            </label>
            <label style={toggle}>
              <input type="checkbox" checked={showMapPlayback} onChange={(e) => setShowMapPlayback(e.target.checked)} />
              <span>Playback</span>
            </label>
            <select style={input} value={mapMode} onChange={(e) => setMapMode(e.target.value as "markers" | "clusters" | "heat")}>
              <option value="markers">Markers</option>
              <option value="clusters">Clusters</option>
              <option value="heat">Heatmap</option>
            </select>
            <label style={toggle}>
              <input type="checkbox" checked={useStream} onChange={(e) => setUseStream(e.target.checked)} />
              <span>
                Live stream {streamStatus === "connected" ? "- on" : streamStatus === "disconnected" ? "- off" : ""}
              </span>
            </label>
            <button style={ghostBtn} onClick={loadAll}>Refresh</button>
          </div>
        </header>
        <div style={filterRow}>
          <select style={input} value={liveStoreFilter} onChange={(e) => setLiveStoreFilter(e.target.value)}>
            <option value="">All stores</option>
            {storeOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select style={input} value={liveStatusFilter} onChange={(e) => setLiveStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="available">Available</option>
            <option value="delivery">On Delivery</option>
            <option value="break">On Break</option>
            <option value="offline">Offline</option>
          </select>
          <label style={toggle}>
            <input type="checkbox" checked={liveStaleOnly} onChange={(e) => setLiveStaleOnly(e.target.checked)} />
            <span>Stale only</span>
          </label>
          <label style={toggle}>
            <input type="checkbox" checked={autoCenter} onChange={(e) => setAutoCenter(e.target.checked)} />
            <span>Auto-center</span>
          </label>
          <label style={toggle}>
            <input type="checkbox" checked={followRider} onChange={(e) => setFollowRider(e.target.checked)} />
            <span>Follow rider</span>
          </label>
          <label style={toggle}>
            <input type="checkbox" checked={showMapTrail} onChange={(e) => setShowMapTrail(e.target.checked)} />
            <span>Trail</span>
          </label>
          <button style={ghostBtn} onClick={focusOnMe}>Focus me</button>
          <button style={ghostBtn} onClick={() => focusOnRider()} disabled={!selectedRiderId}>Focus rider</button>
          <button style={ghostBtn} onClick={focusOnStore}>Focus store</button>
        </div>
        <div style={mapShell}>
          <div ref={mapContainerRef} style={{ ...mapCanvas, display: mapReady ? "block" : "none" }} />
          {!mapReady && (
            <svg viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} style={mapCanvas}>
            <defs>
              <linearGradient id="mapGrad" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0%" stopColor="#eef2ff" />
                <stop offset="100%" stopColor="#fef3c7" />
              </linearGradient>
              <pattern id="mapGrid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#cbd5f5" strokeWidth="1" />
              </pattern>
            </defs>
            <rect x="0" y="0" width={MAP_WIDTH} height={MAP_HEIGHT} fill="url(#mapGrad)" />
            <rect x="0" y="0" width={MAP_WIDTH} height={MAP_HEIGHT} fill="url(#mapGrid)" opacity="0.3" />

            {!bounds.hasData && (
              <text x={MAP_WIDTH / 2} y={MAP_HEIGHT / 2} textAnchor="middle" fill="#64748b" fontSize="14">
                No map data
              </text>
            )}

            {bounds.hasData && mapHistoryPath && (
              <polyline points={mapHistoryPath} fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="4 3" />
            )}
            {bounds.hasData && mapTrailPath && (
              <polyline points={mapTrailPath} fill="none" stroke="#22c55e" strokeWidth="2" />
            )}

            {bounds.hasData && mapGeofences.map((g) => {
              const { x, y } = project(g.lat, g.lng);
              const radius = radiusToPx(g.radius_m);
              return (
                <g key={`gf-${g.id}`}>
                  <circle cx={x} cy={y} r={radius} fill="rgba(59,130,246,0.08)" stroke="#3b82f6" strokeWidth="1.5" />
                  <circle cx={x} cy={y} r={4} fill="#1d4ed8" />
                </g>
              );
            })}

            {bounds.hasData && mapAlerts.map((a) => {
              const { x, y } = project(a.lat as number, a.lng as number);
              return <circle key={`alert-${a.id}`} cx={x} cy={y} r={6} fill="#ef4444" stroke="#fff" strokeWidth="1" />;
            })}

            {bounds.hasData && shouldHeat && filteredLive.map((l) => {
              const { x, y } = project(l.lat, l.lng);
              return (
                <circle
                  key={`heat-${l.rider_id}`}
                  cx={x}
                  cy={y}
                  r={10}
                  fill="rgba(239,68,68,0.2)"
                  stroke="none"
                />
              );
            })}
            {bounds.hasData && shouldCluster && liveClusters.map((c, idx) => {
              const { x, y } = project(c.lat, c.lng);
              const radius = Math.min(18, 6 + c.count);
              return (
                <g key={`cluster-${idx}`}>
                  <circle cx={x} cy={y} r={radius} fill="#6366f1" opacity="0.8" />
                  <text x={x} y={y + 4} textAnchor="middle" fontSize="10" fill="#fff">{c.count}</text>
                </g>
              );
            })}
            {bounds.hasData && !shouldCluster && !shouldHeat && filteredLive.map((l) => {
              const { x, y } = project(l.lat, l.lng);
              const isSelected = selectedRiderId === l.rider_id;
              const stale = isStale(l.updated_at);
              const color = isSelected ? "#0f172a" : liveStatusColor(l.status, stale);
              return (
                <circle
                  key={`live-${l.rider_id}`}
                  cx={x}
                  cy={y}
                  r={isSelected ? 7 : 5}
                  fill={color}
                  stroke="#fff"
                  strokeWidth="1"
                />
              );
            })}
            {bounds.hasData && showMapPlayback && playbackPoint && (
              <circle
                cx={project(playbackPoint.lat, playbackPoint.lng).x}
                cy={project(playbackPoint.lat, playbackPoint.lng).y}
                r={8}
                fill="#f59e0b"
                stroke="#fff"
                strokeWidth="1"
              />
            )}
            </svg>
          )}
          {filteredLive.length <= 50 && (mapMode === "clusters" || mapMode === "heat") && (
            <div style={hint}>Clusters and heatmap are best with 50+ live riders.</div>
          )}
          <div style={mapLegend}>
            <div style={legendItem}><span style={{ ...legendDot, background: liveLegendColor }} />{liveLegendLabel}</div>
            <div style={legendItem}><span style={{ ...legendDot, background: "#10b981" }} />Available</div>
            <div style={legendItem}><span style={{ ...legendDot, background: "#f97316" }} />On Delivery</div>
            <div style={legendItem}><span style={{ ...legendDot, background: "#6b7280" }} />On Break</div>
            <div style={legendItem}><span style={{ ...legendDot, background: "#ef4444" }} />Offline</div>
            <div style={legendItem}><span style={{ ...legendDot, background: "#9ca3af" }} />Stale</div>
            <div style={legendItem}><span style={{ ...legendDot, background: "#ef4444" }} />Alerts</div>
            <div style={legendItem}><span style={{ ...legendDot, background: "#1d4ed8" }} />Geofences</div>
            <div style={legendItem}><span style={{ ...legendDot, background: "#22c55e" }} />Trail</div>
            <div style={legendItem}><span style={legendArrow} />Direction</div>
            <div style={legendItem}><span style={{ ...legendDot, background: "#94a3b8" }} />History path</div>
            <div style={legendItem}><span style={{ ...legendDot, background: "#f59e0b" }} />Playback</div>
          </div>
          <div style={mapToolCard}>
            <div style={mapToolTitle}>Set store location</div>
            <div style={mapToolRow}>
              <select style={input} value={storeLocationId} onChange={(e) => setStoreLocationId(e.target.value)}>
                <option value="">Select store</option>
                {stores.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.name}
                  </option>
                ))}
              </select>
              <div style={mapToolHint}>
                {drawnCircle
                  ? `Lat ${drawnCircle.lat.toFixed(5)} / Lng ${drawnCircle.lng.toFixed(5)} - Radius ${Math.round(drawnCircle.radius_m)}m`
                  : "Draw a circle on the map to set store location."}
              </div>
              <button style={ghostBtn} onClick={saveStoreLocation} disabled={!drawnCircle || !storeLocationId}>
                Set location
              </button>
              <button style={ghostBtn} onClick={clearDrawing} disabled={!drawnCircle}>
                Clear drawing
              </button>
            </div>
          </div>
        </div>
      </section>

      <section style={panel}>
        <header style={panelHeader}>
          <div>
            <div style={panelLabel}>Live</div>
            <div style={panelTitle}>Rider locations</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <label style={toggle}>
              <input type="checkbox" checked={autoRefresh} disabled={useStream} onChange={(e) => setAutoRefresh(e.target.checked)} />
              <span>Auto refresh</span>
            </label>
            <select style={input} disabled={useStream} value={String(refreshMs)} onChange={(e) => setRefreshMs(Number(e.target.value))}>
              <option value="5000">Every 5s</option>
              <option value="15000">Every 15s</option>
              <option value="30000">Every 30s</option>
              <option value="60000">Every 60s</option>
            </select>
            <button style={ghostBtn} onClick={loadAll}>Refresh now</button>
          </div>
        </header>
        <div style={filterRow}>
          <input
            style={input}
            placeholder="Search rider name or ID"
            value={liveSearch}
            onChange={(e) => setLiveSearch(e.target.value)}
          />
          <select style={input} value={liveStoreFilter} onChange={(e) => setLiveStoreFilter(e.target.value)}>
            <option value="">All stores</option>
            {storeOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select style={input} value={liveStatusFilter} onChange={(e) => setLiveStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="available">Available</option>
            <option value="delivery">On Delivery</option>
            <option value="break">On Break</option>
            <option value="offline">Offline</option>
          </select>
          <select style={input} value={liveFreshMinutes} onChange={(e) => setLiveFreshMinutes(e.target.value)}>
            <option value="0">Any freshness</option>
            <option value="5">Last 5 minutes</option>
            <option value="15">Last 15 minutes</option>
            <option value="60">Last 60 minutes</option>
            <option value="180">Last 3 hours</option>
          </select>
          <label style={toggle}>
            <input type="checkbox" checked={liveStaleOnly} onChange={(e) => setLiveStaleOnly(e.target.checked)} />
            <span>Stale only</span>
          </label>
          <label style={toggle}>
            <input type="checkbox" checked={liveOnlyAlerted} onChange={(e) => setLiveOnlyAlerted(e.target.checked)} />
            <span>Only with alerts</span>
          </label>
        </div>
        {filteredLive.length === 0 ? (
          <div style={empty}>No live locations matching filters.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {filteredLive.map((l) => {
              const isSelected = selectedRiderId === l.rider_id;
              const stale = isStale(l.updated_at);
              const age = getAgeMinutes(l.updated_at);
              const name = l.rider_name || `Rider ${l.rider_id}`;
              const statusLabel = liveStatusLabel(l.status);
              const statusColor = liveStatusColor(l.status, stale);
              const addrKey = addressKey(l.lat, l.lng);
              const addr = addressCache[addrKey];
              const addrLoading = addressLoading[addrKey];
              return (
                <div
                  key={l.rider_id}
                  style={{ ...row, ...(isSelected ? rowSelected : {}) }}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedRiderId(l.rider_id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") setSelectedRiderId(l.rider_id);
                  }}
                >
                  <div style={{ display: "grid", gap: 4 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700 }}>{name}</span>
                      <span style={statusPill(statusColor)}>{statusLabel}</span>
                      {stale && <span style={stalePill}>Stale</span>}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      Rider ID: {l.rider_id} {l.store ? `- ${l.store}` : ""} {age != null ? `- Last seen ${age}m ago` : ""}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      Address: {addr ? addr : addrLoading ? "Resolving..." : "-"}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      Accuracy: {typeof l.accuracy_m === "number" ? `${Math.round(l.accuracy_m)}m` : "-"} - Speed: {typeof l.speed_mps === "number" ? `${(l.speed_mps * 3.6).toFixed(1)} km/h` : "-"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ fontSize: 12 }}>Lat {l.lat.toFixed(5)} / Lng {l.lng.toFixed(5)}</div>
                    <button
                      style={miniBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        centerOn(l.lat, l.lng);
                      }}
                    >
                      Center
                    </button>
                    <button
                      style={miniBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        copyCoords(l.lat, l.lng);
                      }}
                    >
                      Copy
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section style={panel}>
        <header style={panelHeader}>
          <div>
            <div style={panelLabel}>Alerts</div>
            <div style={panelTitle}>Geofence alerts</div>
          </div>
        </header>
        <div style={filterRow}>
          <input style={input} type="date" value={alertFromDate} onChange={(e) => setAlertFromDate(e.target.value)} />
          <input style={input} type="date" value={alertToDate} onChange={(e) => setAlertToDate(e.target.value)} />
          <input style={input} placeholder="Rider ID" value={alertRiderId} onChange={(e) => setAlertRiderId(e.target.value)} />
          <select style={input} value={alertGeofenceId} onChange={(e) => setAlertGeofenceId(e.target.value)}>
            <option value="">All geofences</option>
            {geofences.map((g) => (
              <option key={g.id} value={String(g.id)}>
                {g.name}
              </option>
            ))}
          </select>
          <select style={input} value={String(alertLimit)} onChange={(e) => setAlertLimit(Number(e.target.value))}>
            <option value="25">25 rows</option>
            <option value="50">50 rows</option>
            <option value="100">100 rows</option>
            <option value="200">200 rows</option>
          </select>
          <input style={input} placeholder="Search message" value={alertQuery} onChange={(e) => setAlertQuery(e.target.value)} />
          <label style={toggle}>
            <input type="checkbox" checked={alertsOnlyWithCoords} onChange={(e) => setAlertsOnlyWithCoords(e.target.checked)} />
            <span>Only with coords</span>
          </label>
        </div>
        {filteredAlerts.length === 0 ? (
          <div style={empty}>No alerts.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {filteredAlerts.map((a) => {
              const gfName = a.geofence_name || (a.geofence_id ? geofenceById.get(a.geofence_id) : null);
              const riderLabel = a.rider_name ? `${a.rider_name} (#${a.rider_id})` : `Rider #${a.rider_id}`;
              const storeLabel = a.store ? `- ${a.store}` : "";
              const addrKey = a.lat != null && a.lng != null ? addressKey(a.lat, a.lng) : "";
              const addr = addrKey ? addressCache[addrKey] : "";
              const addrLoading = addrKey ? addressLoading[addrKey] : false;
              return (
                <div key={a.id} style={row}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{a.message}</div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      {riderLabel} {storeLabel} {gfName ? `- ${gfName}` : ""} - {new Date(a.created_at).toLocaleString()}
                    </div>
                    {addrKey && (
                      <div style={{ fontSize: 12, opacity: 0.7 }}>
                        Address: {addr ? addr : addrLoading ? "Resolving..." : "-"}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    {a.lat != null && a.lng != null && (
                      <div style={{ fontSize: 12 }}>Lat {a.lat.toFixed(5)} / Lng {a.lng.toFixed(5)}</div>
                    )}
                    <button
                      style={miniBtn}
                      onClick={() => nav(`/admin/audit-log?entity_type=location_alert&entity_id=${a.id}`)}
                    >
                      Audit log
                    </button>
                  </div>
                </div>
              );
            })}
            {alertHasMore && (
              <button style={ghostBtn} onClick={() => loadAlerts(alertOffset + alertLimit, true)}>
                Load more
              </button>
            )}
          </div>
        )}
      </section>

      <section style={panel}>
        <header style={panelHeader}>
          <div>
            <div style={panelLabel}>Geofences</div>
            <div style={panelTitle}>Manage geofences</div>
          </div>
        </header>
        <div style={filterRow}>
          <input style={input} placeholder="Search" value={geofenceSearch} onChange={(e) => setGeofenceSearch(e.target.value)} />
          <select style={input} value={geofenceStore} onChange={(e) => setGeofenceStore(e.target.value)}>
            <option value="">All stores</option>
            {storeOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input style={input} placeholder="Name" value={gfName} onChange={(e) => setGfName(e.target.value)} />
          <input style={input} placeholder="Store (optional)" value={gfStore} onChange={(e) => setGfStore(e.target.value)} />
          <input style={input} placeholder="Lat" value={gfLat} onChange={(e) => setGfLat(e.target.value)} />
          <input style={input} placeholder="Lng" value={gfLng} onChange={(e) => setGfLng(e.target.value)} />
          <input style={input} placeholder="Radius (m)" value={gfRadius} onChange={(e) => setGfRadius(e.target.value)} />
          <button style={ghostBtn} onClick={createGeofence}>Add geofence</button>
          <button style={ghostBtn} onClick={clearDrawing}>Clear drawing</button>
        </div>
        <div style={hint}>Tip: use the map draw tool to drop a circle and auto-fill lat/lng/radius (radius snaps to 50m).</div>
        {filteredGeofences.length === 0 ? (
          <div style={empty}>No geofences configured.</div>
        ) : (
          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {filteredGeofences.map((g) => (
              <div key={g.id} style={{ ...row, alignItems: "stretch" }}>
                {editingGeofenceId === g.id ? (
                  <div style={{ display: "grid", gap: 8, width: "100%" }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <input style={input} placeholder="Name" value={editGfName} onChange={(e) => setEditGfName(e.target.value)} />
                      <input style={input} placeholder="Store (optional)" value={editGfStore} onChange={(e) => setEditGfStore(e.target.value)} />
                      <input style={input} placeholder="Lat" value={editGfLat} onChange={(e) => setEditGfLat(e.target.value)} />
                      <input style={input} placeholder="Lng" value={editGfLng} onChange={(e) => setEditGfLng(e.target.value)} />
                      <input style={input} placeholder="Radius (m)" value={editGfRadius} onChange={(e) => setEditGfRadius(e.target.value)} />
                      <label style={toggle}>
                        <input type="checkbox" checked={editGfActive} onChange={(e) => setEditGfActive(e.target.checked)} />
                        <span>Active</span>
                      </label>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button style={ghostBtn} onClick={saveEditGeofence}>Save</button>
                      <button style={ghostBtn} onClick={cancelEditGeofence}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div>
                      <div style={{ fontWeight: 700 }}>{g.name}</div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>
                        Store: {g.store || "Global"} - Radius {g.radius_m}m {g.is_active === false ? "- Inactive" : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button style={ghostBtn} onClick={() => startEditGeofence(g)}>Edit</button>
                      <button
                        style={ghostBtn}
                        onClick={async () => {
                          try {
                            await api.delete(`/admin/geofences/${g.id}`);
                            loadAll();
                          } catch (e) {
                            setErr(getApiErrorMessage(e, "Failed to delete geofence"));
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={panel}>
        <header style={panelHeader}>
          <div>
            <div style={panelLabel}>History</div>
            <div style={panelTitle}>Location history</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={ghostBtn} onClick={() => loadHistory(0, false)}>Load</button>
            <button style={ghostBtn} onClick={exportHistory}>Export CSV</button>
          </div>
        </header>
        <div style={filterRow}>
          <input style={input} type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <input style={input} type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          <input style={input} placeholder="Rider ID (optional)" value={historyRiderId} onChange={(e) => setHistoryRiderId(e.target.value)} />
          <select style={input} value={String(historyLimit)} onChange={(e) => setHistoryLimit(Number(e.target.value))}>
            <option value="100">100 rows</option>
            <option value="200">200 rows</option>
            <option value="500">500 rows</option>
            <option value="1000">1000 rows</option>
          </select>
        </div>
        {playbackData.length > 1 ? (
          <div style={playbackCard}>
            <div>
              <div style={{ fontWeight: 700 }}>Playback</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                Rider #{playbackTargetId} {playbackData[0]?.rider_name ? `- ${playbackData[0].rider_name}` : ""}
              </div>
            </div>
            <input
              style={range}
              type="range"
              min={0}
              max={playbackData.length - 1}
              value={playbackIndex}
              onChange={(e) => setPlaybackIndex(Number(e.target.value))}
            />
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button style={ghostBtn} onClick={() => setPlaybackPlaying((prev) => !prev)}>
                {playbackPlaying ? "Pause" : "Play"}
              </button>
              <select style={input} value={String(playbackSpeed)} onChange={(e) => setPlaybackSpeed(Number(e.target.value))}>
                <option value="1">1x</option>
                <option value="2">2x</option>
                <option value="4">4x</option>
              </select>
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                {playbackPoint?.updated_at ? new Date(playbackPoint.updated_at).toLocaleString() : ""}
              </div>
            </div>
          </div>
        ) : (
          history.length > 0 && (
            <div style={hint}>Load history for a specific rider to enable playback.</div>
          )
        )}
        {history.length === 0 ? (
          <div style={empty}>No history loaded.</div>
        ) : (
          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {history.map((h, idx) => (
              <div key={`${h.rider_id}-${idx}`} style={row}>
                <div>
                  <div style={{ fontWeight: 700 }}>{h.rider_name || `Rider ${h.rider_id}`}</div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    Rider ID: {h.rider_id} {h.store ? `- ${h.store}` : ""} {h.updated_at ? `- ${new Date(h.updated_at).toLocaleString()}` : ""}
                  </div>
                </div>
                <div style={{ fontSize: 12 }}>Lat {h.lat.toFixed(5)} / Lng {h.lng.toFixed(5)}</div>
              </div>
            ))}
            {historyHasMore && (
              <button style={ghostBtn} onClick={() => loadHistory(historyOffset + historyLimit, true)}>
                Load more
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

const statsGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: 12,
};

const statCard: React.CSSProperties = {
  background: "white",
  borderRadius: 14,
  padding: 14,
  boxShadow: "0 10px 24px rgba(0,0,0,0.06)",
  display: "grid",
  gap: 6,
};

const statLabel: React.CSSProperties = { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4, opacity: 0.6 };
const statValue: React.CSSProperties = { fontSize: 26, fontWeight: 800 };
const statMeta: React.CSSProperties = { fontSize: 12, opacity: 0.6 };

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

const ghostBtn: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  background: "white",
  fontWeight: 700,
  cursor: "pointer",
};

const input: React.CSSProperties = { padding: "8px 10px", borderRadius: 10, border: "1px solid #e5e7eb", minWidth: 140 };

const filterRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  alignItems: "center",
};

const toggle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 12,
  color: "#475569",
};

const row: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "10px 12px",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  background: "#f8fafc",
  textAlign: "left",
  gap: 12,
};

const rowSelected: React.CSSProperties = {
  borderColor: "#0f172a",
  background: "#e2e8f0",
};

const statusPill = (color: string): React.CSSProperties => ({
  padding: "4px 8px",
  borderRadius: 999,
  background: color,
  color: "white",
  fontWeight: 700,
  fontSize: 12,
});

const stalePill: React.CSSProperties = {
  padding: "4px 8px",
  borderRadius: 999,
  background: "#fef3c7",
  color: "#92400e",
  fontWeight: 700,
  fontSize: 12,
};

const miniBtn: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  background: "white",
  fontWeight: 700,
  fontSize: 12,
  cursor: "pointer",
};

const empty: React.CSSProperties = { padding: 12, border: "1px dashed #e5e7eb", borderRadius: 10, color: "#6b7280" };
const hint: React.CSSProperties = { padding: 10, borderRadius: 10, background: "#f8fafc", color: "#64748b", fontSize: 12 };

const alert: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  background: "#fee2e2",
  color: "#991b1b",
  fontWeight: 700,
};

const mapShell: React.CSSProperties = {
  display: "grid",
  gap: 10,
};

const mapCanvas: React.CSSProperties = {
  width: "100%",
  height: 360,
  borderRadius: 12,
  border: "1px solid #e2e8f0",
};

const mapLegend: React.CSSProperties = {
  display: "flex",
  gap: 16,
  flexWrap: "wrap",
  fontSize: 12,
  color: "#475569",
};

const legendItem: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6 };
const legendDot: React.CSSProperties = { width: 10, height: 10, borderRadius: 999 };
const legendArrow: React.CSSProperties = {
  width: 0,
  height: 0,
  borderLeft: "6px solid transparent",
  borderRight: "6px solid transparent",
  borderBottom: "12px solid #0ea5e9",
  transform: "rotate(45deg)",
};

const mapToolCard: React.CSSProperties = {
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  padding: 12,
  background: "#f8fafc",
  display: "grid",
  gap: 8,
};

const mapToolTitle: React.CSSProperties = { fontSize: 13, fontWeight: 700 };

const mapToolRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  alignItems: "center",
};

const mapToolHint: React.CSSProperties = { fontSize: 12, color: "#64748b" };

const playbackCard: React.CSSProperties = {
  display: "grid",
  gap: 8,
  padding: 12,
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  background: "#f8fafc",
};

const range: React.CSSProperties = { width: "100%" };

const storeGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: 12,
};

const storeCard: React.CSSProperties = {
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  padding: 12,
  background: "#f8fafc",
  display: "grid",
  gap: 6,
};

const storeRow: React.CSSProperties = { display: "flex", gap: 6, flexWrap: "wrap" };

const storePill = (color: string): React.CSSProperties => ({
  padding: "4px 8px",
  borderRadius: 999,
  background: color,
  color: "white",
  fontWeight: 700,
  fontSize: 11,
});
