import { Outlet } from "react-router-dom";
import { Sidebar } from "../../components/Layout/Sidebar";
import { NotificationToast } from "../../components/Layout/NotificationToast";
import { useMessageThreads } from "../../hooks/useMessageThreads";
import { playMessageSound } from "../../utils/sound";
import { useI18n } from "../../i18n/I18nContext";

export default function CaptainLayout() {
  const { t } = useI18n();
  const { unreadTotal } = useMessageThreads({
    pollMs: 12000,
    onUnreadIncrease: () => playMessageSound(),
  });

  const links = [
    { to: "/captain", label: t("nav.captain.roster"), end: true },
    { to: "/captain/attendance", label: t("nav.captain.attendance") },
    { to: "/captain/messages", label: t("nav.captain.messages"), badge: unreadTotal > 0 ? unreadTotal : undefined },
  ];

  return (
    <div className="admin-layout">
      <Sidebar links={links} brand={t("sidebar.brand.captain")} />
      <main className="admin-main">
        <div className="admin-shell">
          <Outlet />
        </div>
      </main>
      <NotificationToast />
    </div>
  );
}
