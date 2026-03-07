import { NotificationsBell } from "./NotificationsBell";

export function Topbar({ title }: { title: string }) {
  return (
    <div style={styles.wrap}>
      <h1 style={styles.h1}>{title}</h1>
      <div style={styles.actions}>
        <NotificationsBell />
      </div>
    </div>
  );
}

const styles: Record<string, any> = {
  wrap: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, gap: 12 },
  h1: { fontSize: 34, margin: 0 },
  actions: { display: "flex", alignItems: "center", gap: 12 },
};
