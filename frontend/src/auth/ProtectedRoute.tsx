import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

type Role = "admin" | "rider" | "captain";

export function ProtectedRoute({ role, children }: { role?: Role; children: JSX.Element }) {
  const { user } = useAuth();

  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) {
    const target =
      user.role === "admin"
        ? "/admin"
        : user.role === "captain"
          ? "/captain"
          : "/rider";
    return <Navigate to={target} replace />;
  }

  return children;
}
