import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Topbar } from "../../components/Layout/Topbar";
import { api } from "../../api/client";
import { getApiErrorMessage } from "../../api/errors";

type AuditLog = {
  id: number;
  actor_id?: number | null;
  actor_name?: string | null;
  action: string;
  entity_type?: string | null;
  entity_id?: number | null;
  details?: Record<string, unknown> | null;
  created_at: string;
};

export default function AuditLogPage() {
  const [params, setParams] = useSearchParams();
  const [entityType, setEntityType] = useState(params.get("entity_type") || "");
  const [entityId, setEntityId] = useState(params.get("entity_id") || "");
  const [items, setItems] = useState<AuditLog[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const queryParams = useMemo(() => {
    const qp: Record<string, string> = { limit: "200", offset: "0" };
    if (entityType.trim()) qp.entity_type = entityType.trim();
    if (/^\d+$/.test(entityId.trim())) qp.entity_id = entityId.trim();
    return qp;
  }, [entityType, entityId]);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await api.get<AuditLog[]>("/admin/audit-logs", { params: queryParams });
      setItems(res.data || []);
    } catch (e) {
      setErr(getApiErrorMessage(e, "Failed to load audit logs"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [queryParams]);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Topbar title="Audit Log" />

      {err && <div style={alert}>{err}</div>}
      {loading && <div style={alert}>Loading logs...</div>}

      <section style={panel}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 800 }}>Recent activity</div>
          <button style={ghostBtn} onClick={load}>Refresh</button>
        </div>
        <div style={filterRow}>
          <input
            style={input}
            placeholder="Entity type (e.g. location_alert)"
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
          />
          <input
            style={input}
            placeholder="Entity ID"
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
          />
          <button
            style={ghostBtn}
            onClick={() => {
              const next: Record<string, string> = {};
              if (entityType.trim()) next.entity_type = entityType.trim();
              if (/^\d+$/.test(entityId.trim())) next.entity_id = entityId.trim();
              setParams(next);
            }}
          >
            Apply filters
          </button>
          <button
            style={ghostBtn}
            onClick={() => {
              setEntityType("");
              setEntityId("");
              setParams({});
            }}
          >
            Clear
          </button>
        </div>
        {items.length === 0 ? (
          <div style={empty}>No audit entries yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {items.map((i) => (
              <div key={i.id} style={row}>
                <div>
                  <div style={{ fontWeight: 700 }}>{i.action}</div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    Actor {i.actor_name || i.actor_id || "system"} - {i.entity_type || "n/a"} {i.entity_id ?? ""}
                  </div>
                  {i.details && (
                    <div style={{ fontSize: 11, opacity: 0.6 }}>{JSON.stringify(i.details)}</div>
                  )}
                </div>
                <div style={{ fontSize: 12 }}>{new Date(i.created_at).toLocaleString()}</div>
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

const filterRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  alignItems: "center",
};

const input: React.CSSProperties = { padding: "8px 10px", borderRadius: 10, border: "1px solid #e5e7eb", minWidth: 180 };

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

const ghostBtn: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  background: "white",
  fontWeight: 700,
  cursor: "pointer",
};

const alert: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  background: "#fee2e2",
  color: "#991b1b",
  fontWeight: 700,
};
