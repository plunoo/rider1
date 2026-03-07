import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { getApiErrorMessage } from "../../api/errors";
import Home from "./Home";

type AttendanceStatus = "present" | "absent" | "late" | null;

export default function Dashboard() {
  const nav = useNavigate();
  const [attendance, setAttendance] = useState<AttendanceStatus | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const fetchAttendance = async () => {
      try {
        const res = await api.get("/attendance/today");
        const status = (res.data?.status as AttendanceStatus) ?? null;
        if (!status) {
          nav("/rider/check-in", { replace: true });
          return;
        }
        setAttendance(status);
      } catch (e: any) {
        setErr(getApiErrorMessage(e, "Unable to load attendance"));
        nav("/rider/check-in", { replace: true });
      }
    };
    fetchAttendance();
  }, [nav]);

  if (attendance === undefined) {
    return (
      <div className="rider-card">
        <div className="rider-card-title">Loading your dashboard</div>
        <div className="rider-card-subtitle">Checking attendance and queue status.</div>
      </div>
    );
  }

  if (attendance === "absent") {
    return (
      <div className="rider-card">
        <div className="rider-card-title">You marked absent today</div>
        <div className="rider-card-subtitle">Update your response if you start working.</div>
        {err && <div className="rider-alert">{err}</div>}
        <button type="button" className="rider-btn rider-btn-primary" onClick={() => nav("/rider/check-in", { replace: true })}>
          Update my response
        </button>
      </div>
    );
  }

  return <Home />;
}
