import React, { useState, useEffect, useRef, useCallback } from "react";
import { viewRoutes } from "./data.js";

import { Sidebar } from "./layout/Sidebar.jsx";
import { Topbar } from "./layout/Topbar.jsx";

import DashboardView from "./pages/DashboardView.jsx";
import EmploymentView from "./pages/EmploymentView.jsx";
import AppointmentsView from "./pages/AppointmentsView.jsx";
import AccountsView from "./pages/AccountsView.jsx";
import AnnouncementsView from "./pages/AnnouncementsView.jsx";
import PartnershipsView from "./pages/PartnershipsView.jsx";

export default function App() {
  // ---- global ----
  const [view, setView] = useState("dashboard");
  const [collapsed, setCollapsed] = useState(
    window.innerWidth <= 1180
  );
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
      if (window.innerWidth <= 1024) {
        setCollapsed(true);
      }
    };

    handleResize();

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle("dark-mode", settings.theme === "dark");
    document.body.classList.toggle("compact-admin", settings.compactTables);
  }, [settings.theme, settings.compactTables]);

  useEffect(() => {
    document.title = `${viewRoutes[view]} | Tarlac State University`;
  }, [view]);

  function selectView(v) {
    setView(v);
    showToast(`${viewRoutes[v]} selected`);
  }

  return (
    <div className={`app${collapsed ? " sidebar-collapsed" : ""}`}>
      <Sidebar view={view} onSelect={selectView} />
      <main className="main">
        <Topbar
          title={viewRoutes[view]}
          collapsed={collapsed}
          onToggleSidebar={() => setCollapsed((c) => !c)}
          settings={settings}
          setSettings={setSettings}
          showToast={showToast}
        />

        <DashboardView active={view === "dashboard"} showToast={showToast} />
        <EmploymentView active={view === "employment"} showToast={showToast} />
        <AppointmentsView active={view === "appointments"} showToast={showToast} />
        <AccountsView active={view === "accounts"} showToast={showToast} />
        <AnnouncementsView active={view === "announcements"} showToast={showToast} />
        <PartnershipsView active={view === "partnerships"} showToast={showToast} />
      </main>

      <div className={`toast${toast ? " show" : ""}`} role="status" aria-live="polite">
        {toast}
      </div>
    </div>
  );
}
