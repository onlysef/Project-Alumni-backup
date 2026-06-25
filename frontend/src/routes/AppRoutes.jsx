import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "../context/AuthContext";
import ProtectedRoute from "./ProtectedRoute";

import AdminLayout from "../layouts/AdminLayout";
import CoordinatorLayout from "../layouts/CoordinatorLayout";
import AlumniLayout from "../layouts/AlumniLayout";
import EmployerLayout from "../layouts/EmployerLayout";

// Admin pages
import DashboardView from "../pages/admin/DashboardView";
import EmploymentView from "../pages/admin/EmploymentView";
import AppointmentsView from "../pages/admin/AppointmentsView";
import AccountsView from "../pages/admin/AccountsView";
import AnnouncementsView from "../pages/admin/AnnouncementsView";
import PartnershipsView from "../pages/admin/PartnershipsView";
import AiAssistantView from "../pages/admin/AiAssistantView";
import AboutView from "../pages/admin/AboutView";

// Coordinator pages
import CoordinatorHome from "../pages/coordinator/CoordinatorHome";
import EventManagement from "../pages/coordinator/EventManagement";
import EventParticipation from "../pages/coordinator/EventParticipation";
import CoordinatorEmploymentView from "../pages/coordinator/CoordinatorEmploymentView";
import AlumniContacts from "../pages/coordinator/AlumniContacts";
import CoordinatorAboutView from "../pages/admin/AboutView";

// Alumni pages
import AlumniDashboard from "../pages/alumni/AlumniDashboard";
import AlumniOnboarding from "../pages/alumni/AlumniOnboarding";
import TracerStudyForm from "../pages/alumni/TracerStudyForm";

// Employer pages
import EmployerDashboard from "../pages/employer/EmployerDashboard";

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

export default function AppRoutes() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<RoleRedirect />} />
          <Route path="*" element={<RoleRedirect />} />

          {/* Admin routes */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard"    element={<DashboardView />} />
            <Route path="employment"   element={<EmploymentView />} />
            <Route path="appointments" element={<AppointmentsView />} />
            <Route path="accounts"     element={<AccountsView />} />
            <Route path="announcements"element={<AnnouncementsView />} />
            <Route path="partnerships" element={<PartnershipsView />} />
            <Route path="aiassistant"  element={<AiAssistantView />} />
            <Route path="about"        element={<AboutView />} />
          </Route>

          {/* Coordinator routes */}
          <Route
            path="/coordinator"
            element={
              <ProtectedRoute allowedRoles={["coordinator"]}>
                <CoordinatorLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard"    element={<CoordinatorHome />} />
            <Route path="events"       element={<EventManagement />} />
            <Route path="participation"element={<EventParticipation />} />
            <Route path="employment"   element={<CoordinatorEmploymentView />} />
            <Route path="contacts"     element={<AlumniContacts />} />
            <Route path="about"        element={<CoordinatorAboutView />} />
          </Route>

          {/* Alumni routes */}
          <Route
            path="/alumni"
            element={
              <ProtectedRoute allowedRoles={["alumni"]} skipOnboarding skipTracerStudy>
                <AlumniLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route
              path="dashboard"
              element={
                <ProtectedRoute allowedRoles={["alumni"]}>
                  <AlumniDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="onboarding"
              element={
                <ProtectedRoute allowedRoles={["alumni"]} skipOnboarding skipTracerStudy>
                  <AlumniOnboarding />
                </ProtectedRoute>
              }
            />
            <Route
              path="tracer-study"
              element={
                <ProtectedRoute allowedRoles={["alumni"]} skipTracerStudy>
                  <TracerStudyForm />
                </ProtectedRoute>
              }
            />
          </Route>

          {/* Employer routes */}
          <Route
            path="/employer"
            element={
              <ProtectedRoute allowedRoles={["employer"]}>
                <EmployerLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<EmployerDashboard />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
