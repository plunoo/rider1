export function StatusButtons({ onSet }: { onSet: (s: string) => void }) {
  const buttons = ["online", "offline", "off_for_delivery", "available_for_delivery"];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
      {buttons.map((b) => (
        <button key={b} style={btn} onClick={() => onSet(b)}>
          {b.replaceAll("_", " ").toUpperCase()}
        </button>
      ))}
    </div>
  );
}
const btn: React.CSSProperties = { padding: 16, borderRadius: 16, border: 0, color: "white", background: "linear-gradient(135deg,#6d28d9,#db2777)", fontWeight: 900, cursor: "pointer" };
