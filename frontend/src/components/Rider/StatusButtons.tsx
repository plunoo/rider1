import React from "react";

type Props = {
  onSet: (status: string) => void;
};

const statuses = [
  { key: "online", label: "Online" },
  { key: "delivery", label: "Delivery" },
  { key: "break", label: "Break" },
  { key: "offline", label: "Offline" },
];

export function StatusButtons({ onSet }: Props) {
  return (
    <div style={row}>
      {statuses.map((s) => (
        <button key={s.key} style={btn} onClick={() => onSet(s.key)} type="button">
          {s.label}
        </button>
      ))}
    </div>
  );
}

const row: React.CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap" };
const btn: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  background: "white",
  cursor: "pointer",
  boxShadow: "0 4px 10px rgba(0,0,0,0.06)",
  fontWeight: 700,
};
