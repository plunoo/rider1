import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { getApiErrorMessage } from "../api/errors";
import { LanguageSelect } from "../components/LanguageSelect";
import { useI18n } from "../i18n/I18nContext";
import "./Login.css";

type Store = { id: number; name: string; code?: string | null };

export default function Register() {
  const nav = useNavigate();
  const { t } = useI18n();
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [storeId, setStoreId] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const loadStores = async () => {
    setErr(null);
    try {
      const res = await api.get<Store[]>("/auth/stores");
      setStores(res.data || []);
    } catch (e: any) {
      setErr(getApiErrorMessage(e, t("register.error.loadStores")));
    }
  };

  useEffect(() => {
    loadStores();
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSuccess(null);
    setFieldErrors({});

    const trimmedName = name.trim();
    const trimmedUsername = username.trim();
    const errors: Record<string, string> = {};
    const usernameRe = /^[a-zA-Z0-9._-]{3,24}$/;
    if (!trimmedName) errors.name = t("register.error.nameRequired");
    if (!trimmedUsername) errors.username = t("register.error.usernameRequired");
    if (trimmedUsername && !usernameRe.test(trimmedUsername)) {
      errors.username = t("register.error.usernameInvalid");
    }
    if (!storeId) errors.store = t("register.error.storeRequired");
    if (!password) errors.password = t("register.error.passwordRequired");
    if (password && password.length < 8) errors.password = t("register.error.passwordMin");
    if (password && !/[a-zA-Z]/.test(password)) errors.password = t("register.error.passwordLetter");
    if (password && !/[0-9]/.test(password)) errors.password = t("register.error.passwordNumber");
    if (!confirm) errors.confirm = t("register.error.confirmRequired");
    if (password && confirm && password !== confirm) errors.confirm = t("register.error.passwordMismatch");
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setErr(t("register.error.fixFields"));
      return;
    }

    setLoading(true);
    try {
      await api.post("/auth/register", {
        name: trimmedName,
        username: trimmedUsername,
        password,
        store_id: Number(storeId),
      });
      setSuccess(t("register.success.submitted"));
      setName("");
      setUsername("");
      setPassword("");
      setConfirm("");
      setStoreId("");
    } catch (e: any) {
      const msg = getApiErrorMessage(e, t("register.error.registrationFailed"));
      if (msg.toLowerCase().includes("username already exists")) {
        setFieldErrors({ username: t("register.error.usernameExists") });
      }
      setErr(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-shell">
        <section className="login-hero">
          <div className="hero-badge">
            <span className="status-dot" />
            RiderFlow
          </div>
          <h1>{t("register.hero.title")}</h1>
          <p className="hero-lead">{t("register.hero.subtitle")}</p>

          <div className="hero-grid">
            <div className="hero-card metric">
              <span className="card-title">{t("register.hero.metric.title")}</span>
              <div className="card-value">{t("register.hero.metric.value")}</div>
              <span className="card-sub">{t("register.hero.metric.sub")}</span>
            </div>

            <div className="hero-card status">
              <span className="card-title">{t("register.hero.needs.title")}</span>
              <div className="chip-row">
                <span className="chip">{t("register.hero.needs.fullName")}</span>
                <span className="chip">{t("register.hero.needs.store")}</span>
                <span className="chip">{t("register.hero.needs.password")}</span>
              </div>
              <span className="card-sub">{t("register.hero.needs.sub")}</span>
            </div>
          </div>
        </section>

        <section className="login-panel">
          <div className="panel-top">
            <LanguageSelect compact />
          </div>
          <div className="panel-header">
            <h2>{t("register.panel.title")}</h2>
            <p className="login-sub">{t("register.panel.subtitle")}</p>
          </div>

          <form className="login-form" onSubmit={onSubmit}>
            <label className="form-field">
              <span className="field-label">{t("register.field.name")}</span>
              <div
                className="input-wrap"
                style={fieldErrors.name ? { borderColor: "#fca5a5", background: "#fff5f5" } : undefined}
              >
                <input
                  placeholder={t("register.placeholder.name")}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (fieldErrors.name) setFieldErrors((prev) => ({ ...prev, name: "" }));
                  }}
                  autoComplete="name"
                />
              </div>
              {fieldErrors.name && <div style={{ color: "#b91c1c", fontSize: 12 }}>{fieldErrors.name}</div>}
            </label>

            <label className="form-field">
              <span className="field-label">{t("register.field.username")}</span>
              <div
                className="input-wrap"
                style={fieldErrors.username ? { borderColor: "#fca5a5", background: "#fff5f5" } : undefined}
              >
                <input
                  placeholder={t("register.placeholder.username")}
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    if (fieldErrors.username) setFieldErrors((prev) => ({ ...prev, username: "" }));
                  }}
                  autoComplete="username"
                />
              </div>
              {fieldErrors.username && <div style={{ color: "#b91c1c", fontSize: 12 }}>{fieldErrors.username}</div>}
            </label>

            <label className="form-field">
              <span className="field-label">{t("register.field.store")}</span>
              <div
                className="input-wrap"
                style={fieldErrors.store ? { borderColor: "#fca5a5", background: "#fff5f5" } : undefined}
              >
                <select
                  style={{ width: "100%", border: 0, background: "transparent", fontSize: 15 }}
                  value={storeId}
                  onChange={(e) => {
                    setStoreId(e.target.value);
                    if (fieldErrors.store) setFieldErrors((prev) => ({ ...prev, store: "" }));
                  }}
                >
                  <option value="">{t("register.placeholder.store")}</option>
                  {stores.map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              {fieldErrors.store && <div style={{ color: "#b91c1c", fontSize: 12 }}>{fieldErrors.store}</div>}
            </label>

            <label className="form-field">
              <span className="field-label">{t("register.field.password")}</span>
              <div
                className="input-wrap"
                style={fieldErrors.password ? { borderColor: "#fca5a5", background: "#fff5f5" } : undefined}
              >
                <input
                  type="password"
                  placeholder={t("register.placeholder.password")}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: "" }));
                  }}
                  autoComplete="new-password"
                />
              </div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>{t("register.help.passwordRule")}</div>
              {fieldErrors.password && <div style={{ color: "#b91c1c", fontSize: 12 }}>{fieldErrors.password}</div>}
            </label>

            <label className="form-field">
              <span className="field-label">{t("register.field.confirm")}</span>
              <div
                className="input-wrap"
                style={fieldErrors.confirm ? { borderColor: "#fca5a5", background: "#fff5f5" } : undefined}
              >
                <input
                  type="password"
                  placeholder={t("register.placeholder.confirm")}
                  value={confirm}
                  onChange={(e) => {
                    setConfirm(e.target.value);
                    if (fieldErrors.confirm) setFieldErrors((prev) => ({ ...prev, confirm: "" }));
                  }}
                  autoComplete="new-password"
                />
              </div>
              {fieldErrors.confirm && <div style={{ color: "#b91c1c", fontSize: 12 }}>{fieldErrors.confirm}</div>}
            </label>

            {err && <div className="alert">{err}</div>}
            {success && (
              <div className="alert" style={{ borderColor: "#bbf7d0", background: "#dcfce7", color: "#166534" }}>
                {success}
              </div>
            )}

            <button className="primary-btn" type="submit" disabled={loading || stores.length === 0}>
              {loading ? t("register.button.submitting") : t("register.button.submit")}
            </button>
            <button className="link-btn" type="button" onClick={() => nav("/login")}>
              {t("register.link.login")}
            </button>
            <button className="link-btn" type="button" onClick={() => nav("/register/status")}>
              {t("register.link.checkStatus")}
            </button>
          </form>

          <p className="footnote">{t("register.footnote")}</p>
        </section>
      </div>
    </div>
  );
}
