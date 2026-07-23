import React, { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AlumniSidebar } from "../components/alumni/AlumniSidebar.jsx";
import { AlumniTopbar } from "../components/alumni/AlumniTopbar.jsx";

const TITLES = { home: "Home", announcements: "Announcements", employment: "Employment Details", office: "Alumni Office", suggested: "Suggested Alumni", career: "Career Recommendation", jobconnect: "Job Connect" };

export default function AlumniLayout() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(window.innerWidth <= 600);
  const section = new URLSearchParams(location.search).get("section") || "home";
  const title = TITLES[section] || "Home";

  useEffect(() => { document.title = `${title} | Tarlac State University`; }, [title]);
  useEffect(() => {
    const handleResize = () => setCollapsed(window.innerWidth <= 600);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className={`app alumni-app${collapsed ? " sidebar-collapsed" : ""}`}>
      <AlumniSidebar collapsed={collapsed} onNavigate={() => window.innerWidth <= 600 && setCollapsed(true)} />
      {!collapsed && <div className="sidebar-backdrop" onClick={() => setCollapsed(true)} aria-hidden="true" />}
      <main className="main">
        <AlumniTopbar title={title} collapsed={collapsed} onToggleSidebar={() => setCollapsed(v => !v)} />
        <Outlet context={{ section, sidebarCollapsed: collapsed }} />
      </main>
    </div>
  );
}
