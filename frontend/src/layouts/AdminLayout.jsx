import React, { useState, useEffect, useRef, useCallback } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AdminSidebar } from "../components/admin/AdminSidebar.jsx";
import { AdminTopbar } from "../components/admin/AdminTopbar.jsx";

const PATH_TITLES = {
  "/admin/dashboard":    "Dashboard",
  "/admin/employment":   "Alumni Employment",
  "/admin/appointments": "Appointments",
  "/admin/accounts":     "Accounts",
  "/admin/announcements":"Announcements",
  "/admin/partnerships": "Partnerships",
  "/admin/aiassistant":  "AI Assistant",
  "/admin/about":        "About",
};

export default function AdminLayout() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(window.innerWidth <= 600);
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);
  const [settings, setSettings] = useState(() => {
    try {
      return {
        theme: "light",
        emailAlerts: true,
        dashboardNotifications: true,
        compactTables: false,
        ...(JSON.parse(localStorage.getItem("aptmsDashboardSettings")) || {}),
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
    <div className={`app${collapsed ? " sidebar-collapsed" : ""}`}>
      <AdminSidebar collapsed={collapsed} />
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
