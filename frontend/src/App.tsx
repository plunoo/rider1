import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Register from "./pages/Register";
import RegistrationStatus from "./pages/RegistrationStatus";
import ResetPassword from "./pages/ResetPassword";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import AdminLayout from "./pages/admin/AdminLayout";
import AdminDashboard from "./pages/admin/Dashboard";
import Riders from "./pages/admin/Riders";
import Attendance from "./pages/admin/Attendance";
import Management from "./pages/admin/Management";
import RiderAccess from "./pages/admin/RiderAccess";
import Tracking from "./pages/admin/Tracking";
import Analytics from "./pages/admin/Analytics";
import AuditLog from "./pages/admin/AuditLog";
import Stores from "./pages/admin/Stores";
import AdminMessages from "./pages/admin/Messages";
import RiderLayout from "./pages/rider/RiderLayout";
import RiderDashboard from "./pages/rider/Dashboard";
import CheckIn from "./pages/rider/CheckIn";
import RiderShifts from "./pages/rider/Shifts";
import RiderDeliveries from "./pages/rider/Deliveries";
import RiderMessages from "./pages/rider/Messages";
import CaptainLayout from "./pages/captain/CaptainLayout";
import CaptainRoster from "./pages/captain/Roster";
import CaptainMessages from "./pages/captain/Messages";
import CaptainAttendance from "./pages/captain/Attendance";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/register/status" element={<RegistrationStatus />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        <Route
          path="/admin"
          element={
            <ProtectedRoute role="admin">
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<AdminDashboard />} />
          <Route path="riders" element={<Riders />} />
          <Route path="attendance" element={<Attendance />} />
          <Route path="management" element={<Management />} />
          <Route path="tracking" element={<Tracking />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="audit-log" element={<AuditLog />} />
          <Route path="rider-access" element={<RiderAccess />} />
          <Route path="stores" element={<Stores />} />
          <Route path="messages" element={<AdminMessages />} />
        </Route>

        <Route
          path="/rider"
          element={
            <ProtectedRoute role="rider">
              <RiderLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<RiderDashboard />} />
          <Route path="check-in" element={<CheckIn />} />
          <Route path="shifts" element={<RiderShifts />} />
          <Route path="deliveries" element={<RiderDeliveries />} />
          <Route path="messages" element={<RiderMessages />} />
        </Route>

        <Route
          path="/captain"
          element={
            <ProtectedRoute role="captain">
              <CaptainLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<CaptainRoster />} />
          <Route path="attendance" element={<CaptainAttendance />} />
          <Route path="messages" element={<CaptainMessages />} />
        </Route>

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
