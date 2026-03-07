export function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <div style={styles.card}>
      <div style={{ fontSize: 14, opacity: 0.85 }}>{title}</div>
      <div style={{ fontSize: 32, fontWeight: 800, marginTop: 10 }}>{value}</div>
    </div>
  );
}

const styles: Record<string, any> = {
  card: {
    borderRadius: 18,
    padding: 18,
    color: "white",
    background: "linear-gradient(135deg, #6d28d9, #db2777)",
    boxShadow: "0 10px 24px rgba(0,0,0,0.12)",
  },
};
