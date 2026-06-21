import React, { useEffect, useRef, useState, useCallback } from "react";
import { coordinatorNavItems, coordinatorViewRoutes } from "../coordinatorData.js";
import { Sidebar, useSidebar } from "../layout/Sidebar.jsx";
import { CoordinatorTopbar } from "../layout/Coordinatortopbar.jsx";
import CoordinatorHome from "./CoordinatorHome.jsx";
import EventManagement from "./EventManagement.jsx";
import EventParticipation from "./EventParticipation.jsx";
import EmploymentView from "./EmploymentView.jsx";
import AlumniContacts from "./AlumniContacts.jsx";
import AboutView from "./AboutView.jsx";

export default function CoordinatorDashboard() {
  const [view, setView] = useState(() => localStorage.getItem("coordinatorView") || "dashboard");
  const { collapsed, toggleSidebar, collapseOnMobile } = useSidebar();
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);
  const [settings, setSettings] = useState(() => {
    try {
      return {
        emailAlerts: true,
        dashboardNotifications: true,
        compactTables: false,
        ...(JSON.parse(localStorage.getItem("aptmsDashboardSettings")) || {}),
        // Coordinator has no theme toggle yet: always force light.
        theme: "light",
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
    document.title = `${coordinatorViewRoutes[view]} | Tarlac State University`;
  }, [view]);

  function selectView(nextView) {
    setView(nextView);
    localStorage.setItem("coordinatorView", nextView);
    collapseOnMobile();
  }

  return (
    <div className={`app coordinator-app${collapsed ? " sidebar-collapsed" : ""}`}>
      <Sidebar view={view} onSelect={selectView} collapsed={collapsed} items={coordinatorNavItems} />
      <main className="main">
        <CoordinatorTopbar
          title={coordinatorViewRoutes[view]}
          collapsed={collapsed}
          onToggleSidebar={toggleSidebar}
          showToast={showToast}
        />
        <CoordinatorHome active={view === "dashboard"} showToast={showToast} />
        <EventManagement active={view === "events"} showToast={showToast} />
        <EventParticipation active={view === "participation"} showToast={showToast} />
        <EmploymentView active={view === "employment"} showToast={showToast} />
        <AlumniContacts active={view === "contacts"} showToast={showToast} />
        <AboutView active={view === "about"} showToast={showToast} />
      </main>
      <div className={`toast${toast ? " show" : ""}`} role="status" aria-live="polite">
        {toast}
      </div>
    </div>
  );
}