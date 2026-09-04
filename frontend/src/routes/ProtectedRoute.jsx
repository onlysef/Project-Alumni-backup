import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const LOGIN_URL = "/alumni-login.html";

const ROLE_PATHS = {
  admin: "/admin/dashboard",
  alumni: "/alumni/dashboard",
  coordinator: "/coordinator/dashboard",
  employer: "/employer/dashboard",
};

export default function ProtectedRoute({ children, allowedRole, allowedRoles, skipOnboarding = false, skipTracerStudy = false }) {
  const { token, user, firstLogin, tracerStudyCompleted, needsTracerUpdate, tracerUpdateChecked } = useAuth();

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

  const permitted = allowedRoles
    ? allowedRoles.includes(user.role)
    : user.role === allowedRole;

  if (!permitted) {
    return <Navigate to={ROLE_PATHS[user.role]} replace />;
  }

  if (!skipOnboarding && user.role === "alumni" && firstLogin) {
    return <Navigate to="/alumni/onboarding" replace />;
  }

  if (!skipTracerStudy && user.role === "alumni" && !firstLogin) {
    if (!tracerStudyCompleted) {
      return <Navigate to="/alumni/tracer-study" replace />;
    }
    // Already submitted before — confirm the college's form hasn't grown new
    // questions since then before letting them through to the dashboard.
    if (!tracerUpdateChecked) {
      return (
        <div style={{
          minHeight: "100vh", display: "flex", alignItems: "center",
          justifyContent: "center", background: "#faf8f8",
        }}>
          <div style={{ width: 36, height: 36, border: "4px solid #7b1a2e30", borderTopColor: "#7b1a2e", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      );
    }
    if (needsTracerUpdate) {
      return <Navigate to="/alumni/tracer-study" replace />;
    }
  }

  return children;
}
