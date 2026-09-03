import React, { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import Icon from "../components/common/Icon.jsx";
import EmployerTopbar from "../components/employer/EmployerTopbar.jsx";
import alumniLogo from "../assets/images/alumni-removebg.png";
import tsuLogo from "../assets/images/tsu_logo-removebg.png";
import toptsuLogo from "../assets/images/tsu-top-header.webp";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../services/api.js";
import "../assets/css/employer-module.css";

const navItems = [
  { to: "/employer/dashboard", label: "Employer", icon: "icon-12" },
  { to: "/employer/applicants", label: "Applicants", icon: "icon-11" },
  { to: "/employer/appointments", label: "Appointments", icon: "icon-3" },
];

const pageTitles = {
  "/employer/dashboard": "Employer",
  "/employer/applicants": "Applicants",
  "/employer/appointments": "Appointments",
};

export default function EmployerLayout() {
  const [collapsed, setCollapsed] = useState(window.innerWidth <= 600);
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);
  const [settings, setSettings] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("employerDashboardSettings")) || {};
      return {
        theme: saved.theme ?? "light",
        compactTables: saved.compactTables ?? false,
        dashboardNotifications: saved.dashboardNotifications ?? true,
      };
    } catch {
      return { theme: "light", compactTables: false, dashboardNotifications: true };
    }
  });
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const title = pageTitles[pathname] || "Employer Portal";

  const showToast = useCallback((message) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2400);
  }, []);

  useEffect(() => {
    apiFetch("/auth/settings")
      .then(({ settings: saved }) => {
        if (saved && Object.keys(saved).length > 0) {
          setSettings((current) => ({ ...current, ...saved }));
        }
      })
      .catch(() => {});
  }, []);

  const settingsInitialized = useRef(false);
  useEffect(() => {
    if (!settingsInitialized.current) {
      settingsInitialized.current = true;
      return;
    }
    localStorage.setItem("employerDashboardSettings", JSON.stringify(settings));
    apiFetch("/auth/settings", { method: "PUT", body: { settings } }).catch(() => {});
  }, [settings]);

  useEffect(() => {
    document.body.classList.toggle("dark-mode", settings.theme === "dark");
    document.body.classList.toggle("compact-employer", settings.compactTables);
  }, [settings.theme, settings.compactTables]);

  useEffect(() => {
    document.title = `${title} | Tarlac State University`;
  }, [title]);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  useEffect(() => {
    const handleResize = () => { if (window.innerWidth <= 600) setCollapsed(true); };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  function closeOnMobile() {
    if (window.innerWidth <= 600) setCollapsed(true);
  }

  return (
    <div className={`app employer-app${collapsed ? " sidebar-collapsed" : ""}`}>
      <aside className="sidebar employer-shared-sidebar">
        <div className="brand">
          <button type="button" className="tsu-brand-link" onClick={() => navigate("/employer/dashboard")} aria-label="Open Employer dashboard">
            <img src={tsuLogo} alt="TSU" className="sidebar-logo" />
          </button>
          <div className="brand-text">
            <button type="button" className="tsu-top-brand-link" onClick={() => navigate("/employer/dashboard")} aria-label="Open Employer dashboard">
              <img src={toptsuLogo} alt="Tarlac State University" className="toptsu-logo" />
            </button>
            <div className="alumni-brand">
              <img src={alumniLogo} alt="Alumni" className="alumni-logo" />
              <p>Alumni Association<br/> Inc.</p>
            </div>
          </div>
        </div>

        <nav className="nav" aria-label="Main navigation">
          {navItems.map((item, index) => <React.Fragment key={item.to}>
            <div className="nav-category" aria-hidden="true">{["Overview", "Talent", "Scheduling"][index]}</div>
            <NavLink to={item.to} onClick={closeOnMobile} className={({ isActive }) => isActive ? "active" : undefined}>
            <span><Icon name={item.icon}/></span><span>{item.label}</span>
            </NavLink>
          </React.Fragment>)}
        </nav>

        <div className="sidebar-footer"><button className="sidebar-logout" type="button" onClick={logout} aria-label="Logout"><span><Icon name="icon-7"/></span><span>Logout</span></button></div>
      </aside>

      {!collapsed && <div className="sidebar-backdrop" onClick={closeOnMobile} aria-hidden="true"/>}

      <main className="main employer-main">
        <EmployerTopbar
          title={title}
          collapsed={collapsed}
          onToggleSidebar={() => setCollapsed((current) => !current)}
          settings={settings}
          setSettings={setSettings}
          showToast={showToast}
        />
        <div className="employer-content"><Outlet context={{ showToast, settings }}/></div>
      </main>
      <div className={`toast${toast ? " show" : ""}`} role="status" aria-live="polite">{toast}</div>
    </div>
  );
}
