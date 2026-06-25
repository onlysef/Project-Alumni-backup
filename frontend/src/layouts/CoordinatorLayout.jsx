import React, { useState, useEffect, useRef, useCallback } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { CoordinatorSidebar, useSidebarCoordinator } from "../components/coordinator/CoordinatorSidebar.jsx";
import { CoordinatorTopbar } from "../components/coordinator/CoordinatorTopbar.jsx";

const PATH_TITLES = {
  "/coordinator/dashboard":    "Coordinator Dashboard",
  "/coordinator/events":       "Event Management",
  "/coordinator/participation":"Event Participation",
  "/coordinator/employment":   "Employment Details",
  "/coordinator/contacts":     "Alumni Contacts",
  "/coordinator/about":        "Alumni Association Inc.",
};

export default function CoordinatorLayout() {
  const location = useLocation();
  const { collapsed, toggleSidebar } = useSidebarCoordinator();
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);
  const [settings, setSettings] = useState(() => {
    try {
      return {
        theme: "light",
        emailAlerts: true,
        dashboardNotifications: true,
        compactTables: false,
        ...(JSON.parse(localStorage.getItem("aptmsCoordinatorSettings")) || {}),
      };
    } catch {
      return { theme: "light", emailAlerts: true, dashboardNotifications: true, compactTables: false };
    }
  });

  const showToast = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2400);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("dark-mode", settings.theme === "dark");
    document.body.classList.toggle("compact-admin", settings.compactTables);
  }, [settings.theme, settings.compactTables]);

  useEffect(() => {
    const title = PATH_TITLES[location.pathname] || "Coordinator Dashboard";
    document.title = `${title} | Tarlac State University`;
  }, [location.pathname]);

  const title = PATH_TITLES[location.pathname] || "Coordinator Dashboard";

  return (
    <div className={`app coordinator-app${collapsed ? " sidebar-collapsed" : ""}`}>
      <CoordinatorSidebar collapsed={collapsed} />
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
