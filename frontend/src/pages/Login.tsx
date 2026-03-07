import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { getApiErrorMessage } from "../api/errors";
import { LanguageSelect } from "../components/LanguageSelect";
import { useI18n } from "../i18n/I18nContext";
import "./Login.css";

export default function Login() {
  const { login } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"admin" | "rider" | "captain">("admin");
  const [err, setErr] = useState<string | null>(null);
  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [locLoading, setLocLoading] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  const requestLocation = async () => {
    setLocError(null);
    if (!navigator.geolocation) {
      setLocError(t("login.location.error.notSupported"));
      return null;
    }
    setLocLoading(true);
    return await new Promise<{ lat: number; lng: number } | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setLoc(coords);
          setLocLoading(false);
          resolve(coords);
        },
        (error) => {
          if (error.code === error.PERMISSION_DENIED) {
            setLocError(t("login.location.error.permissionDenied"));
          } else if (error.code === error.TIMEOUT) {
            setLocError(t("login.location.error.timeout"));
          } else {
            setLocError(t("login.location.error.unable"));
          }
          setLocLoading(false);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      let coords = mode === "rider" ? loc : null;
      if (mode === "rider" && !coords) {
        coords = await requestLocation();
      }
      if (mode === "rider" && !coords) {
        setErr(t("login.error.locationRequired"));
        return;
      }
      const u = await login(username, password, coords || undefined);
      nav(u.role === "admin" ? "/admin" : u.role === "captain" ? "/captain" : "/rider");
    } catch (e: any) {
      setErr(getApiErrorMessage(e, "Login failed"));
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
          <h1>{t("login.hero.title")}</h1>
          <p className="hero-lead">{t("login.hero.subtitle")}</p>

          <div className="hero-grid">
            <div className="hero-card metric">
              <span className="card-title">{t("login.hero.today")}</span>
              <div className="card-value">128</div>
              <span className="card-sub">{t("login.hero.activeRiders")}</span>
            </div>

            <div className="hero-card status">
              <span className="card-title">{t("login.hero.liveStatus")}</span>
              <div className="chip-row">
                <span className="chip">{t("login.hero.status.online")}</span>
                <span className="chip">{t("login.hero.status.delivery")}</span>
                <span className="chip">{t("login.hero.status.break")}</span>
              </div>
              <span className="card-sub">{t("login.hero.updatedRealtime")}</span>
            </div>
          </div>

          <div className="hero-card performance">
            <span className="card-title">{t("login.hero.performance")}</span>
            <svg viewBox="0 0 260 90" aria-hidden="true">
              <path d="M5 65 C40 45, 70 75, 110 55 S185 40, 240 55" />
            </svg>
          </div>
        </section>

        <section className="login-panel">
          <div className="panel-top">
            <LanguageSelect compact />
          </div>
          <div className="panel-tabs" role="tablist" aria-label="Login role">
            <button
              type="button"
              className={`tab ${mode === "admin" ? "active" : ""}`}
              onClick={() => {
                setMode("admin");
                setErr(null);
              }}
              aria-pressed={mode === "admin"}
            >
              {t("login.tabs.admin")}
            </button>
            <button
              type="button"
              className={`tab ${mode === "captain" ? "active" : ""}`}
              onClick={() => {
                setMode("captain");
                setErr(null);
              }}
              aria-pressed={mode === "captain"}
            >
              {t("login.tabs.captain")}
            </button>
            <button
              type="button"
              className={`tab ${mode === "rider" ? "active" : ""}`}
              onClick={() => {
                setMode("rider");
                setErr(null);
              }}
              aria-pressed={mode === "rider"}
            >
              {t("login.tabs.rider")}
            </button>
          </div>

          <div className="panel-header">
            <h2>
              {t("login.welcome")}{" "}
              <span className="wave" aria-hidden="true">
                {"\uD83D\uDC4B"}
              </span>
            </h2>
            <p className="login-sub">{t("login.subtitle", { role: t(`role.${mode}`) })}</p>
          </div>

          <form className="login-form" onSubmit={onSubmit}>
            <label className="form-field">
              <span className="field-label">{t("login.field.username")}</span>
              <div className="input-wrap">
                <input
                  placeholder={t("login.placeholder.username")}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                />
              </div>
            </label>

            <label className="form-field">
              <span className="field-label">{t("login.field.password")}</span>
              <div className="input-wrap">
                <input
                  type="password"
                  placeholder={t("login.placeholder.password")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
            </label>

            {mode === "rider" && (
              <div className="location-box">
                <div className="location-title">{t("login.location.title")}</div>
                <div className="location-meta">
                  {loc
                    ? t("login.location.using", { lat: loc.lat.toFixed(5), lng: loc.lng.toFixed(5) })
                    : locLoading
                      ? t("login.location.detecting")
                      : t("login.location.none")}
                </div>
                {locError && <div className="location-error">{locError}</div>}
                <button
                  className="link-btn"
                  type="button"
                  onClick={requestLocation}
                  disabled={locLoading}
                >
                  {locLoading
                    ? t("login.location.button.detecting")
                    : loc
                      ? t("login.location.button.refresh")
                      : t("login.location.button.use")}
                </button>
              </div>
            )}

            {err && <div className="alert">{err}</div>}

            <button className="primary-btn" type="submit">
              {t("login.button.login")}
            </button>
            <button className="link-btn" type="button" onClick={() => nav("/reset-password")}>
              {t("login.link.forgot")}
            </button>
            {mode === "rider" && (
              <button className="link-btn" type="button" onClick={() => nav("/register")}>
                {t("login.link.newRider")}
              </button>
            )}
            {mode === "rider" && (
              <button className="link-btn" type="button" onClick={() => nav("/register/status")}>
                {t("login.link.checkStatus")}
              </button>
            )}
          </form>

          <p className="footnote">
            {t("login.footnote")}{" "}
            <span aria-hidden="true">{"\uD83D\uDD10"}</span>
          </p>
        </section>
      </div>
    </div>
  );
}
