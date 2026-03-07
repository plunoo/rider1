import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { getApiErrorMessage } from "../api/errors";
import { LanguageSelect } from "../components/LanguageSelect";
import { useI18n } from "../i18n/I18nContext";
import "./Login.css";

export default function ResetPassword() {
  const nav = useNavigate();
  const { t } = useI18n();
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      await api.post("/auth/reset-password", { token, new_password: password });
      nav("/login", { replace: true });
    } catch (e) {
      setErr(getApiErrorMessage(e, t("reset.error.failed")));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-shell">
        <section className="login-panel">
          <div className="panel-top">
            <LanguageSelect compact />
          </div>
          <div className="panel-header">
            <h2>{t("reset.title")}</h2>
            <p className="login-sub">{t("reset.subtitle")}</p>
          </div>
          <form className="login-form" onSubmit={onSubmit}>
            <label className="form-field">
              <span className="field-label">{t("reset.field.token")}</span>
              <div className="input-wrap">
                <input value={token} onChange={(e) => setToken(e.target.value)} placeholder={t("reset.placeholder.token")} />
              </div>
            </label>

            <label className="form-field">
              <span className="field-label">{t("reset.field.newPassword")}</span>
              <div className="input-wrap">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("reset.placeholder.password")}
                />
              </div>
            </label>

            {err && <div className="alert">{err}</div>}

            <button className="primary-btn" type="submit" disabled={!token || !password || loading}>
              {loading ? t("reset.button.saving") : t("reset.button.reset")}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
