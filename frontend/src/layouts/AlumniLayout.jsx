import React, { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AlumniSidebar } from "../components/alumni/AlumniSidebar.jsx";
import { AlumniTopbar } from "../components/alumni/AlumniTopbar.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { apiFetch } from "../services/api.js";
import { isDrawerViewport, watchDrawerBoundary } from "../constants/layout.js";

const TITLES = { home: "Home", announcements: "Announcements", employment: "Alumni Profile", office: "Alumni Office", suggested: "Alumni Network", career: "Career Recommendation", jobconnect: "Job Connect" };

export default function AlumniLayout() {
  const location = useLocation();
  const { firstLogin, tracerStudyCompleted, needsTracerUpdate } = useAuth();
  const [collapsed, setCollapsed] = useState(isDrawerViewport());
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);
  const [settings, setSettings] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("alumniDashboardSettings")) || {};
      return { theme: saved.theme ?? "light", dashboardNotifications: saved.dashboardNotifications ?? true };
    } catch {
      return { theme: "light", dashboardNotifications: true };
    }
  });
  const showToast = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2400);
  }, []);
  const section = new URLSearchParams(location.search).get("section") || "home";
  const page = location.pathname.split("/")[2];
  const title = page === "tsu" ? "Tarlac State University" : page === "about" ? "Alumni Association" : (TITLES[section] || "Home");

  useEffect(() => {
    apiFetch("/auth/settings")
      .then(({ settings: s }) => {
        if (s && Object.keys(s).length > 0) setSettings((prev) => ({ ...prev, ...s }));
      })
      .catch(() => {});
  }, []);

  const settingsInitialized = useRef(false);
  useEffect(() => {
    if (!settingsInitialized.current) { settingsInitialized.current = true; return; }
    apiFetch("/auth/settings", { method: "PUT", body: { settings } }).catch(() => {});
    localStorage.setItem("alumniDashboardSettings", JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    document.body.classList.toggle("dark-mode", settings.theme === "dark");
  }, [settings.theme]);

  const restrictedStep = firstLogin ? "Account Setup"
    : !tracerStudyCompleted ? "Tracer Study"
    : needsTracerUpdate ? "Update Employment Details"
    : null;
  const restricted = !!restrictedStep;

  useEffect(() => { document.title = `${title} | Tarlac State University`; }, [title]);
  useEffect(() => watchDrawerBoundary(setCollapsed), []);

  return (
    <div className={`app alumni-app${collapsed ? " sidebar-collapsed" : ""}`}>
      <AlumniSidebar collapsed={collapsed} restricted={restricted} restrictedLabel={restrictedStep} onNavigate={() => isDrawerViewport() && setCollapsed(true)} />
      {!collapsed && <div className="sidebar-backdrop" onClick={() => setCollapsed(true)} aria-hidden="true" />}
      <main className="main">
        <AlumniTopbar title={restrictedStep || title} collapsed={collapsed} onToggleSidebar={() => setCollapsed(v => !v)} settings={settings} setSettings={setSettings} showToast={showToast} restricted={restricted} />
        <Outlet context={{ section, sidebarCollapsed: collapsed, settings, setSettings, showToast }} />
      </main>
      <div className={`toast${toast ? " show" : ""}`} role="status" aria-live="polite">{toast}</div>
    </div>
  );
}
