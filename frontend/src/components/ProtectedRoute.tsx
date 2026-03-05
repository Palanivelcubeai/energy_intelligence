import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { roleAccess } from "@/lib/authConfig";
import { useLocation } from "react-router-dom";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, role } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (role && !roleAccess[role].includes(location.pathname)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
