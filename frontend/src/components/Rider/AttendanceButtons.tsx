import React from "react";

type Props = {
  onSet: (attendance: string) => void;
};

const options = [
  { key: "present", label: "Present" },
  { key: "off_day", label: "Off Day" },
  { key: "absent", label: "Absent" },
];

export function AttendanceButtons({ onSet }: Props) {
  return (
    <div style={row}>
      {options.map((opt) => (
        <button key={opt.key} style={btn} onClick={() => onSet(opt.key)} type="button">
          {opt.label}
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
