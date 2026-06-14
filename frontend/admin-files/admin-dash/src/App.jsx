import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import ProtectedRoute from "./auth/ProtectedRoute";
import AdminDashboard from "./pages/AdminDashboard";
import AlumniDashboard from "./pages/AlumniDashboard";
import AlumniOnboarding from "./pages/AlumniOnboarding";
import TracerStudyForm from "./pages/TracerStudyForm";
import CoordinatorDashboard from "./pages/CoordinatorDashboard";
import EmployerDashboard from "./pages/EmployerDashboard";

const ROLE_PATHS = {
  admin: "/admin/dashboard",
  alumni: "/alumni/dashboard",
  coordinator: "/coordinator/dashboard",
  employer: "/employer/dashboard",
};

const LOGIN_URL = "/alumni-login.html";

function RoleRedirect() {
  const { token, user } = useAuth();
  if (!token || !user) {
    window.location.replace(LOGIN_URL);
    return null;
  }
  const path = ROLE_PATHS[user.role];
  if (!path) {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    window.location.replace(LOGIN_URL);
    return null;
  }
  return <Navigate to={path} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<RoleRedirect />} />
          <Route
            path="/admin/dashboard"
            element={<ProtectedRoute allowedRole="admin"><AdminDashboard /></ProtectedRoute>}
          />
          <Route
            path="/alumni/dashboard"
            element={<ProtectedRoute allowedRole="alumni"><AlumniDashboard /></ProtectedRoute>}
          />
          <Route
            path="/alumni/onboarding"
            element={<ProtectedRoute allowedRole="alumni" skipOnboarding skipTracerStudy><AlumniOnboarding /></ProtectedRoute>}
          />
          <Route
            path="/alumni/tracer-study"
            element={<ProtectedRoute allowedRole="alumni" skipTracerStudy><TracerStudyForm /></ProtectedRoute>}
          />
          <Route
            path="/coordinator/dashboard"
            element={<ProtectedRoute allowedRole="coordinator"><CoordinatorDashboard /></ProtectedRoute>}
          />
          <Route
            path="/employer/dashboard"
            element={<ProtectedRoute allowedRole="employer"><EmployerDashboard /></ProtectedRoute>}
          />
          <Route path="*" element={<RoleRedirect />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
