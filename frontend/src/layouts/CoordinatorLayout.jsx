import React, { useState, useEffect, useRef, useCallback } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { CoordinatorSidebar, useSidebarCoordinator } from "../components/coordinator/CoordinatorSidebar.jsx";
import { CoordinatorTopbar } from "../components/coordinator/CoordinatorTopbar.jsx";
import { apiFetch } from "../services/api.js";

const PATH_TITLES = {
  "/coordinator/dashboard":    "Coordinator Dashboard",
  "/coordinator/events":       "Event Management",
  "/coordinator/participation":"Event Participation",
  "/coordinator/event-dashboard": "Event Dashboard",
  "/coordinator/employment":   "Alumni Record",
  "/coordinator/export-employment": "Export Alumni Record",
  "/coordinator/tracer-dashboard": "Tracer Dashboard",
  "/coordinator/tracer-responses": "Tracer Responses",
  "/coordinator/tracer-form-editor": "Edit Tracer Form",
  "/coordinator/notify-alumni": "Notify Alumni",
  "/coordinator/contacts":     "Alumni Contacts",
  "/coordinator/aiassistant":  "AI Assistant",
  "/coordinator/about":        "Alumni Association, Inc.",
  "/coordinator/tsu":          "Tarlac State University",
};

export default function CoordinatorLayout() {
  const location = useLocation();
  const { collapsed, toggleSidebar, collapseOnMobile } = useSidebarCoordinator();
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);
  const [settings, setSettings] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("aptmsCoordinatorSettings")) || {};
      return {
        theme: saved.theme ?? "light",
        dashboardNotifications: saved.dashboardNotifications ?? true,
      };
    } catch {
      return { theme: "light", dashboardNotifications: true };
    }
  });

  const showToast = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2400);
  }, []);

  useEffect(() => {
    apiFetch("/auth/settings")
      .then(({ settings: s }) => {
        if (s && Object.keys(s).length > 0) {
          setSettings(prev => ({ ...prev, ...s }));
        }
      })
      .catch(() => {});
  }, []);

  const settingsInitialized = useRef(false);
  useEffect(() => {
    if (!settingsInitialized.current) { settingsInitialized.current = true; return; }
    apiFetch("/auth/settings", { method: "PUT", body: { settings } }).catch(() => {});
    localStorage.setItem("aptmsCoordinatorSettings", JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    document.body.classList.toggle("dark-mode", settings.theme === "dark");
  }, [settings.theme]);

  useEffect(() => {
    const title = PATH_TITLES[location.pathname] || "Coordinator Dashboard";
    document.title = `${title} | Tarlac State University`;
  }, [location.pathname]);

  const title = PATH_TITLES[location.pathname] || "Coordinator Dashboard";

  return (
    <div className={`app coordinator-app${collapsed ? " sidebar-collapsed" : ""}`}>
      <CoordinatorSidebar collapsed={collapsed} onNavigate={collapseOnMobile} />
      {!collapsed && (
        <div
          className="sidebar-backdrop"
          onClick={collapseOnMobile}
          aria-hidden="true"
        />
      )}
      <main className="main">
        <CoordinatorTopbar
          title={title}
          collapsed={collapsed}
          onToggleSidebar={toggleSidebar}
          showToast={showToast}
          settings={settings}
          setSettings={setSettings}
        />
        <Outlet context={{ showToast, settings }} />
      </main>
      <div className={`toast${toast ? " show" : ""}`} role="status" aria-live="polite">
        {toast}
      </div>
    </div>
  );
}
