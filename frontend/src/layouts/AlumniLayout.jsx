import React, { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AlumniSidebar } from "../components/alumni/AlumniSidebar.jsx";
import { AlumniTopbar } from "../components/alumni/AlumniTopbar.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { apiFetch } from "../services/api.js";

const TITLES = { home: "Home", announcements: "Announcements", employment: "Alumni Profile", office: "Alumni Office", suggested: "Alumni Network", career: "Career Recommendation", jobconnect: "Job Connect" };

export default function AlumniLayout() {
  const location = useLocation();
  const { firstLogin, tracerStudyCompleted } = useAuth();
  const [collapsed, setCollapsed] = useState(window.innerWidth <= 600);
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

  // Server settings win over whatever was cached locally, same as the
  // admin/coordinator dashboards.
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

  // An alumni who hasn't set their password yet or hasn't completed the
  // tracer study yet must finish that step before the rest of the portal is
  // reachable — the sidebar/topbar shell still renders (same background,
  // branding, and Logout button as the rest of the app), but the sidebar's
  // nav list is withheld so no other section reads as available. These are
  // two distinct steps (password setup happens first, then the tracer
  // study), so the label shown has to reflect whichever one is actually
  // still pending rather than always saying "Account Setup".
  const restrictedStep = firstLogin ? "Account Setup" : !tracerStudyCompleted ? "Tracer Study" : null;
  const restricted = !!restrictedStep;

  useEffect(() => { document.title = `${title} | Tarlac State University`; }, [title]);
  useEffect(() => {
    const handleResize = () => setCollapsed(window.innerWidth <= 600);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className={`app alumni-app${collapsed ? " sidebar-collapsed" : ""}`}>
      <AlumniSidebar collapsed={collapsed} restricted={restricted} restrictedLabel={restrictedStep} onNavigate={() => window.innerWidth <= 600 && setCollapsed(true)} />
      {!collapsed && <div className="sidebar-backdrop" onClick={() => setCollapsed(true)} aria-hidden="true" />}
      <main className="main">
        <AlumniTopbar title={restrictedStep || title} collapsed={collapsed} onToggleSidebar={() => setCollapsed(v => !v)} settings={settings} setSettings={setSettings} showToast={showToast} restricted={restricted} />
        <Outlet context={{ section, sidebarCollapsed: collapsed, settings, setSettings, showToast }} />
      </main>
      <div className={`toast${toast ? " show" : ""}`} role="status" aria-live="polite">{toast}</div>
    </div>
  );
}
