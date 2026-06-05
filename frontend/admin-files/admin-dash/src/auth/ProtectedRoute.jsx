import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

const LOGIN_URL = "http://127.0.0.1:5500/frontend/pages/alumni-login.html";

const ROLE_PATHS = {
  admin: "/admin/dashboard",
  alumni: "/alumni/dashboard",
  coordinator: "/coordinator/dashboard",
  employer: "/employer/dashboard",
};

export default function ProtectedRoute({ children, allowedRole }) {
  const { token, user } = useAuth();

  if (!token || !user) {
    window.location.replace(LOGIN_URL);
    return null;
  }

  const validRoles = Object.keys(ROLE_PATHS);
  if (!validRoles.includes(user.role)) {
    // Invalid or missing role — force logout
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    window.location.replace(LOGIN_URL);
    return null;
  }

  if (user.role !== allowedRole) {
    // Logged in but wrong dashboard — redirect to their correct one
    return <Navigate to={ROLE_PATHS[user.role]} replace />;
  }

  return children;
}
