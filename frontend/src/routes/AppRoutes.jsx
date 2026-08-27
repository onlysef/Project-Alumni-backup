import React, { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "../context/AuthContext";
import ProtectedRoute from "./ProtectedRoute";

import AdminLayout from "../layouts/AdminLayout";
import CoordinatorLayout from "../layouts/CoordinatorLayout";
import AlumniLayout from "../layouts/AlumniLayout";
import EmployerLayout from "../layouts/EmployerLayout";

// Admin pages
const DashboardView           = lazy(() => import("../pages/admin/DashboardView"));
const EmploymentView          = lazy(() => import("../pages/admin/EmploymentView"));
const AppointmentsView        = lazy(() => import("../pages/admin/AppointmentsView"));
const AccountsView            = lazy(() => import("../pages/admin/AccountsView"));
const AnnouncementsView       = lazy(() => import("../pages/admin/AnnouncementsView"));
const PartnershipsView        = lazy(() => import("../pages/admin/PartnershipsView"));
const AiAssistantView         = lazy(() => import("../pages/admin/AiAssistantView"));
const AboutView               = lazy(() => import("../pages/admin/AboutView"));
const TsuLandingView          = lazy(() => import("../pages/shared/TsuLandingView"));
const AlumniSignUpView        = lazy(() => import("../pages/shared/AlumniSignUpView"));

// Coordinator pages
const CoordinatorHome         = lazy(() => import("../pages/coordinator/CoordinatorHome"));
const EventManagement         = lazy(() => import("../pages/coordinator/EventManagement"));
const EventParticipation      = lazy(() => import("../pages/coordinator/EventParticipation"));
const CoordinatorEmploymentView = lazy(() => import("../pages/coordinator/CoordinatorEmploymentView"));
const AlumniContacts          = lazy(() => import("../pages/coordinator/AlumniContacts"));
const CoordinatorAiAssistantView = lazy(() => import("../pages/admin/AiAssistantView"));
const CoordinatorAboutView    = lazy(() => import("../pages/admin/AboutView"));

// Alumni pages
const AlumniDashboard         = lazy(() => import("../pages/alumni/AlumniDashboard"));
const AlumniOnboarding        = lazy(() => import("../pages/alumni/AlumniOnboarding"));
const TracerStudyForm         = lazy(() => import("../pages/alumni/TracerStudyForm"));

// Employer pages
const EmployerDashboard       = lazy(() => import("../pages/employer/EmployerDashboard"));
const EmployerApplicants      = lazy(() => import("../pages/employer/EmployerApplicants"));
const EmployerAppointments    = lazy(() => import("../pages/employer/EmployerAppointments"));

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
        <Suspense fallback={<div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", color: "#76656a", fontSize: 14 }}>Loading…</div>}>
        <Routes>
          <Route path="/" element={<RoleRedirect />} />
          {/* Public — alumni self-registration, no auth required. Placed
              before the catch-all "*" below so it isn't swallowed by
              RoleRedirect. */}
          <Route path="/signup" element={<AlumniSignUpView />} />
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
            <Route path="tsu"          element={<TsuLandingView />} />
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
            <Route path="aiassistant"  element={<CoordinatorAiAssistantView />} />
            <Route path="about"        element={<CoordinatorAboutView />} />
            <Route path="tsu"          element={<TsuLandingView />} />
          </Route>

          {/* Alumni routes */}
          <Route
            path="/alumni"
            element={<AlumniLayout />}
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
            <Route path="applicants" element={<EmployerApplicants />} />
            <Route path="appointments" element={<EmployerAppointments />} />
          </Route>
        </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
