import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

const LOGIN_URL = "http://127.0.0.1:5500/frontend/pages/alumni-login.html";

const ROLE_PATHS = {
  admin: "/admin/dashboard",
  alumni: "/alumni/dashboard",
  coordinator: "/coordinator/dashboard",
  employer: "/employer/dashboard",
};

export default function ProtectedRoute({ children, allowedRole, skipOnboarding = false, skipTracerStudy = false }) {
  const { token, user, firstLogin, tracerStudyCompleted } = useAuth();

  if (!token || !user) {
    window.location.replace(LOGIN_URL);
    return null;
  }

  const validRoles = Object.keys(ROLE_PATHS);
  if (!validRoles.includes(user.role)) {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    localStorage.removeItem("auth_first_login");
    window.location.replace(LOGIN_URL);
    return null;
  }

  if (user.role !== allowedRole) {
    return <Navigate to={ROLE_PATHS[user.role]} replace />;
  }

  if (!skipOnboarding && user.role === "alumni" && firstLogin) {
    return <Navigate to="/alumni/onboarding" replace />;
  }

  if (!skipTracerStudy && user.role === "alumni" && !firstLogin && !tracerStudyCompleted) {
    return <Navigate to="/alumni/tracer-study" replace />;
  }

  return children;
}
