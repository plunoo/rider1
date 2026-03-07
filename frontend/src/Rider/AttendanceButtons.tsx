export function AttendanceButtons({ onSet }: { onSet: (s: string) => void }) {
  const buttons = ["present", "absent", "off_day"];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginTop: 12 }}>
      {buttons.map((b) => (
        <button key={b} style={btn} onClick={() => onSet(b)}>
          {b.replaceAll("_", " ").toUpperCase()}
        </button>
      ))}
    </div>
  );
}
const btn: React.CSSProperties = { padding: 14, borderRadius: 16, border: "1px solid #e5e7eb", background: "white", fontWeight: 900, cursor: "pointer" };
