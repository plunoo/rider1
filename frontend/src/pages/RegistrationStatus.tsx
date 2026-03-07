import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { getApiErrorMessage } from "../api/errors";
import { LanguageSelect } from "../components/LanguageSelect";
import { useI18n } from "../i18n/I18nContext";
import "./Login.css";

type StatusResponse = {
  status: "pending" | "approved" | "rejected" | "not_found";
  store?: string | null;
  requested_at?: string | null;
  approved_at?: string | null;
  approved_by?: string | null;
  rejected_at?: string | null;
  rejected_by?: string | null;
};

function formatDate(value?: string | null, fallback = "-") {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.valueOf()) ? fallback : d.toLocaleString();
}

export default function RegistrationStatus() {
  const nav = useNavigate();
  const { t } = useI18n();
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<StatusResponse | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setData(null);
    const trimmed = username.trim();
    if (!trimmed) {
      setErr(t("status.error.enterUsername"));
      return;
    }
    setLoading(true);
    try {
      const res = await api.post<StatusResponse>("/auth/registration-status", { username: trimmed });
      setData(res.data);
    } catch (e: any) {
      setErr(getApiErrorMessage(e, t("status.error.fetchFailed")));
    } finally {
      setLoading(false);
    }
  };

  const statusLabel = data?.status ? t(`status.value.${data.status}`) : t("status.value.placeholder");
  const dateFallback = t("status.value.placeholder");

  return (
    <div className="login-page">
      <div className="login-shell">
        <section className="login-hero">
          <div className="hero-badge">
            <span className="status-dot" />
            RiderFlow
          </div>
          <h1>{t("status.hero.title")}</h1>
          <p className="hero-lead">{t("status.hero.subtitle")}</p>

          <div className="hero-grid">
            <div className="hero-card metric">
              <span className="card-title">{t("status.hero.metric.label")}</span>
              <div className="card-value">{statusLabel}</div>
              <span className="card-sub">{t("status.hero.metric.sub")}</span>
            </div>

            <div className="hero-card status">
              <span className="card-title">{t("status.hero.tips.title")}</span>
              <div className="chip-row">
                <span className="chip">{t("status.hero.tips.askCaptain")}</span>
                <span className="chip">{t("status.hero.tips.checkAgain")}</span>
                <span className="chip">{t("status.hero.tips.loginApproved")}</span>
              </div>
              <span className="card-sub">{t("status.hero.tips.sub")}</span>
            </div>
          </div>
        </section>

        <section className="login-panel">
          <div className="panel-top">
            <LanguageSelect compact />
          </div>
          <div className="panel-header">
            <h2>{t("status.panel.title")}</h2>
            <p className="login-sub">{t("status.panel.subtitle")}</p>
          </div>

          <form className="login-form" onSubmit={onSubmit}>
            <label className="form-field">
              <span className="field-label">{t("status.field.username")}</span>
              <div className="input-wrap">
                <input
                  placeholder={t("status.placeholder.username")}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                />
              </div>
            </label>

            {err && <div className="alert">{err}</div>}

            {data && (
              <div className="alert" style={{ borderColor: "#bfdbfe", background: "#eff6ff", color: "#1e3a8a" }}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>{t("status.alert.title", { status: statusLabel })}</div>
                {data.store && <div>{t("status.alert.store", { store: data.store })}</div>}
                {data.requested_at && <div>{t("status.alert.requested", { date: formatDate(data.requested_at, dateFallback) })}</div>}
                {data.approved_at && (
                  <div>
                    {t("status.alert.approved", {
                      date: formatDate(data.approved_at, dateFallback),
                      by: data.approved_by ? t("status.alert.by", { name: data.approved_by }) : "",
                    })}
                  </div>
                )}
                {data.rejected_at && (
                  <div>
                    {t("status.alert.rejected", {
                      date: formatDate(data.rejected_at, dateFallback),
                      by: data.rejected_by ? t("status.alert.by", { name: data.rejected_by }) : "",
                    })}
                  </div>
                )}
                {data.status === "approved" && (
                  <div style={{ marginTop: 8 }}>
                    {t("status.alert.loginNow")}
                  </div>
                )}
              </div>
            )}

            <button className="primary-btn" type="submit" disabled={loading}>
              {loading ? t("status.button.checking") : t("status.button.check")}
            </button>
            <button className="link-btn" type="button" onClick={() => nav("/login")}>
              {t("status.button.back")}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
