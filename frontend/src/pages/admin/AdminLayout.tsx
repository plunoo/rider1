import { Outlet } from "react-router-dom";
import { Sidebar } from "../../components/Layout/Sidebar";
import { NotificationToast } from "../../components/Layout/NotificationToast";
import FloatingMessages from "../../components/Messages/FloatingMessages";
import { useI18n } from "../../i18n/I18nContext";

export default function AdminLayout() {
  const { t } = useI18n();
  const links = [
    { to: "/admin", label: t("nav.admin.dashboard"), end: true },
    { to: "/admin/riders", label: t("nav.admin.riders") },
    { to: "/admin/attendance", label: t("nav.admin.attendance") },
    { to: "/admin/management", label: t("nav.admin.management") },
    { to: "/admin/tracking", label: t("nav.admin.tracking") },
    { to: "/admin/stores", label: t("nav.admin.stores") },
    { to: "/admin/analytics", label: t("nav.admin.analytics") },
    { to: "/admin/audit-log", label: t("nav.admin.auditLog") },
    { to: "/admin/rider-access", label: t("nav.admin.riderAccess") },
  ];

  return (
    <div className="admin-layout">
      <Sidebar links={links} brand={t("sidebar.brand.admin")} />
      <main className="admin-main">
        <div className="admin-shell">
          <Outlet />
        </div>
      </main>
      <NotificationToast />
      <FloatingMessages />
    </div>
  );
}
