import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { NotificationsBell } from "../../components/Layout/NotificationsBell";
import { NotificationToast } from "../../components/Layout/NotificationToast";
import { LanguageSelect } from "../../components/LanguageSelect";
import { useAuth } from "../../auth/AuthContext";
import FloatingMessages from "../../components/Messages/FloatingMessages";
import { useI18n } from "../../i18n/I18nContext";

export default function RiderLayout() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `rider-nav-link${isActive ? " is-active" : ""}`;
  const handleWhatsApp = () => {
    const target = document.getElementById("rider-whatsapp");
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    nav("/rider#whatsapp");
  };

  return (
    <div className="rider-shell">
      <div className="rider-content">
        <header className="rider-header rider-fade">
          <div>
            <div className="rider-brand">{t("rider.brand")}</div>
            <div className="rider-subtitle">{t("rider.subtitle")}</div>
          </div>
          <div className="rider-header-actions">
            <div className="rider-user">
              <div className="rider-user-name">{user?.name || t("rider.user.defaultName")}</div>
              <div className="rider-user-meta">
                {user?.store ? t("rider.user.store", { store: user.store }) : t("rider.user.noStore")}
              </div>
            </div>
            <LanguageSelect compact className="rider-lang" />
            <button
              type="button"
              className="notif-btn whatsapp-btn"
              onClick={handleWhatsApp}
              aria-label={t("rider.whatsapp.title")}
              title={t("rider.whatsapp.title")}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M12 3c-4.96 0-9 3.82-9 8.5 0 1.9.67 3.7 1.9 5.17L4 22l5.6-1.85c.76.21 1.57.35 2.4.35 4.96 0 9-3.82 9-8.5S16.96 3 12 3Zm0 2c3.86 0 7 2.92 7 6.5S15.86 18 12 18c-.72 0-1.42-.1-2.08-.3l-.66-.2-3.26 1.08.9-3.02-.46-.6C5.5 13.87 5 12.7 5 11.5 5 7.92 8.14 5 12 5Zm-2.2 3.6c.28-.28.68-.4 1.06-.32l.98.2c.26.05.48.22.6.46l.5.98c.13.25.11.56-.04.8l-.66 1.02c.52.95 1.27 1.74 2.18 2.26l1-.64c.25-.16.56-.18.8-.04l.98.5c.24.12.41.34.46.6l.2.98c.08.38-.04.78-.32 1.06l-.54.54c-.28.28-.68.42-1.08.37-1.7-.18-3.31-1.06-4.53-2.28-1.22-1.22-2.1-2.83-2.28-4.53-.05-.4.1-.8.37-1.08l.54-.54Z"
                  fill="currentColor"
                />
              </svg>
            </button>
            <NotificationsBell />
            <button type="button" className="rider-btn rider-btn-ghost" onClick={logout}>
              {t("rider.logout")}
            </button>
          </div>
        </header>

        <nav className="rider-nav rider-fade rider-stagger-1">
          <NavLink to="/rider" end className={navLinkClass}>
            {t("nav.rider.home")}
          </NavLink>
          <NavLink to="/rider/check-in" className={navLinkClass}>
            {t("nav.rider.checkin")}
          </NavLink>
          <NavLink to="/rider/shifts" className={navLinkClass}>
            {t("nav.rider.shifts")}
          </NavLink>
          <NavLink to="/rider/deliveries" className={navLinkClass}>
            {t("nav.rider.earnings")}
          </NavLink>
        </nav>

        <main className="rider-main rider-fade rider-stagger-2">
          <Outlet />
        </main>

        <NotificationToast />
        <FloatingMessages />

        <nav className="rider-mobile-nav">
          <NavLink to="/rider" end className={navLinkClass}>
            {t("nav.rider.home")}
          </NavLink>
          <NavLink to="/rider/check-in" className={navLinkClass}>
            {t("nav.rider.checkin")}
          </NavLink>
          <NavLink to="/rider/shifts" className={navLinkClass}>
            {t("nav.rider.shifts")}
          </NavLink>
          <NavLink to="/rider/deliveries" className={navLinkClass}>
            {t("nav.rider.earnings")}
          </NavLink>
        </nav>
      </div>
    </div>
  );
}
