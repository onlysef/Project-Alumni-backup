import React, { useState, useEffect, useRef, useCallback } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AdminSidebar } from "../components/admin/AdminSidebar.jsx";
import { AdminTopbar } from "../components/admin/AdminTopbar.jsx";
import { apiFetch } from "../services/api.js";

const PATH_TITLES = {
  "/admin/dashboard":        "Dashboard",
  "/admin/tracer-dashboard": "Tracer Dashboard",
  "/admin/tracer-responses": "Tracer Responses",
  "/admin/tracer-form-editor": "Edit Tracer Form",
  "/admin/employment":       "Alumni Record",
  "/admin/export-employment":"Export Alumni Record",
  "/admin/notify-alumni":    "Notify Alumni",
  "/admin/appointments":     "Appointments",
  "/admin/accounts":         "Accounts",
  "/admin/announcements":    "Announcements",
  "/admin/partnerships":     "Partnerships",
  "/admin/aiassistant":      "AI Assistant",
  "/admin/about":            "About",
  "/admin/tsu":              "Tarlac State University",
};

export default function AdminLayout() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(window.innerWidth <= 600);
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);
  const [settings, setSettings] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("aptmsDashboardSettings")) || {};
      return {
        theme: saved.theme ?? "light",
        compactTables: saved.compactTables ?? false,
        dashboardNotifications: saved.dashboardNotifications ?? true,
      };
    } catch {
      return { theme: "light", dashboardNotifications: true, compactTables: false };
    }
  });

  const showToast = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2400);
  }, []);

  // Load settings from server on mount; server takes priority over localStorage
  useEffect(() => {
    apiFetch("/auth/settings")
      .then(({ settings: s }) => {
        if (s && Object.keys(s).length > 0) {
          setSettings(prev => ({ ...prev, ...s }));
        }
      })
      .catch(() => {});
  }, []);

  // Persist settings to server whenever they change (skip initial render)
  const settingsInitialized = useRef(false);
  useEffect(() => {
    if (!settingsInitialized.current) { settingsInitialized.current = true; return; }
    apiFetch("/auth/settings", { method: "PUT", body: { settings } }).catch(() => {});
    localStorage.setItem("aptmsDashboardSettings", JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 600) setCollapsed(true);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("dark-mode", settings.theme === "dark");
    document.body.classList.toggle("compact-admin", settings.compactTables);
  }, [settings.theme, settings.compactTables]);

  useEffect(() => {
    const title = PATH_TITLES[location.pathname] || "Dashboard";
    document.title = `${title} | Tarlac State University`;
  }, [location.pathname]);

  const title = PATH_TITLES[location.pathname] || "Dashboard";

  return (
    <div className={`app admin-app${collapsed ? " sidebar-collapsed" : ""}`}>
      <AdminSidebar
        collapsed={collapsed}
        onNavigate={() => { if (window.innerWidth <= 600) setCollapsed(true); }}
      />
      {!collapsed && (
        <div
          className="sidebar-backdrop"
          onClick={() => { if (window.innerWidth <= 600) setCollapsed(true); }}
          aria-hidden="true"
        />
      )}
      <main className="main">
        <AdminTopbar
          title={title}
          collapsed={collapsed}
          onToggleSidebar={() => setCollapsed((c) => !c)}
          settings={settings}
          setSettings={setSettings}
          showToast={showToast}
        />
        <Outlet context={{ showToast, settings }} />
      </main>
      <div className={`toast${toast ? " show" : ""}`} role="status" aria-live="polite">
        {toast}
      </div>
    </div>
  );
}
