import React, { useState, useEffect, useRef, useCallback } from "react";
import { viewRoutes } from "../data.js";

import { Sidebar } from "../layout/Sidebar.jsx";
import { Topbar } from "../layout/Topbar.jsx";

import DashboardView from "./DashboardView.jsx";
import EmploymentView from "./EmploymentView.jsx";
import AppointmentsView from "./AppointmentsView.jsx";
import AIAssistantView from "./AIAssistantView.jsx";
import AccountsView from "./AccountsView.jsx";
import AnnouncementsView from "./AnnouncementsView.jsx";
import PartnershipsView from "./PartnershipsView.jsx";
import AboutView from "./AboutView.jsx";

export default function AdminDashboard() {
  const [view, setView] = useState(() => localStorage.getItem("adminView") || "dashboard");
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
    document.title = `${viewRoutes[view]} | Tarlac State University`;
  }, [view]);

  const [accountsRoleFilter, setAccountsRoleFilter] = useState("Role");
  const [openPostId, setOpenPostId] = useState(null);

  function openPost(postId) {
    if (!postId) { selectView("announcements"); return; }
    setOpenPostId(postId);
    selectView("announcements");
  }

  function selectView(v, subFilter) {
    setView(v);
    localStorage.setItem("adminView", v);
    if (v === "accounts" && subFilter) {
      setAccountsRoleFilter(subFilter);
    }
    if (window.innerWidth <= 600) setCollapsed(true);
  }

  return (
    <div className={`app${collapsed ? " sidebar-collapsed" : ""}`}>
      <Sidebar view={view} onSelect={selectView} collapsed={collapsed} />
      <main className="main">
        <Topbar
          title={viewRoutes[view]}
          collapsed={collapsed}
          onToggleSidebar={() => setCollapsed((c) => !c)}
          settings={settings}
          setSettings={setSettings}
          showToast={showToast}
        />
        <DashboardView active={view === "dashboard"} showToast={showToast} onOpenPost={openPost} />
        <EmploymentView active={view === "employment"} showToast={showToast} />
        <AppointmentsView active={view === "appointments"} showToast={showToast} />
        <AccountsView active={view === "accounts"} showToast={showToast} roleFilterFromNav={accountsRoleFilter} />
        <AnnouncementsView active={view === "announcements"} showToast={showToast} openPostId={openPostId} onPostOpened={() => setOpenPostId(null)} />
        <PartnershipsView active={view === "partnerships"} showToast={showToast} />
        <AIAssistantView active={view === "aiassistant"} showToast={showToast} />
        <AboutView active={view === "about"} showToast={showToast} />        
      </main>
      <div className={`toast${toast ? " show" : ""}`} role="status" aria-live="polite">
        {toast}
      </div>
    </div>
  );
}
