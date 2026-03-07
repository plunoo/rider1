import { NavLink } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { LanguageSelect } from "../LanguageSelect";
import { useI18n } from "../../i18n/I18nContext";

export function Sidebar({
  links,
  brand = "Admin",
}: {
  links: { to: string; label: string; end?: boolean; badge?: number }[];
  brand?: string;
}) {
  const { logout } = useAuth();
  const { t } = useI18n();

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-brand-group">
          <div className="sidebar-brand">{brand}</div>
          <LanguageSelect compact className="sidebar-lang" />
        </div>
        <button className="sidebar-logout" onClick={logout}>{t("sidebar.logout")}</button>
      </div>
      <nav className="sidebar-nav">
        {links.map((l) => {
          const badge = l.badge && l.badge > 0 ? (l.badge > 99 ? "99+" : String(l.badge)) : null;
          return (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) => `sidebar-link ${isActive ? "is-active" : ""}`}
            >
              <span className="sidebar-link-text">{l.label}</span>
              {badge ? <span className="sidebar-badge">{badge}</span> : null}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
