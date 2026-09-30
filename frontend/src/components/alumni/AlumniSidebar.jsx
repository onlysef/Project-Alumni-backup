import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Icon from "../common/Icon.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import alumniLogo from "../../assets/images/alumni-removebg.png";
import tsuLogo from "../../assets/images/tsu_logo-removebg.png";
import toptsuLogo from "../../assets/images/tsu-top-header.webp";

const ITEMS = [
  ["home", "Home", "alumni-home"],
  ["announcements", "Announcements", "alumni-announcements"],
  ["employment", "Alumni Profile", "alumni-employment"],
  ["office", "Alumni Office", "alumni-office"],
  ["suggested", "Alumni Network", "alumni-suggested"],
  ["career", "Career Recommendation", "alumni-career"],
  ["jobconnect", "Job Connect", "alumni-job-connect"],
  // Its own route (not a ?section= view), so it's navigated to directly below.
  ["tracer-study", "Tracer Study", "alumni-tracer"],
];

const NAV_SECTIONS = [
  { label: "Overview", items: ITEMS.slice(0, 1) },
  { label: "Community", items: [ITEMS[1], ITEMS[3], ITEMS[4]] },
  { label: "Professional Growth", items: [ITEMS[2], ITEMS[5], ITEMS[6], ITEMS[7]] },
];

export function AlumniSidebar({ collapsed, onNavigate, restricted = false, restrictedLabel = "Account Setup" }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();
  const params = new URLSearchParams(location.search);
  const active = params.get("section") || "home";
  const currentFilter = params.get("filter") || "All";
  const [announcementsOpen, setAnnouncementsOpen] = useState(true);
  const select = (section) => {
    if (restricted) return;
    navigate(section === "home" ? "/alumni/dashboard" : `/alumni/dashboard?section=${section}`);
    onNavigate?.();
  };
  const openInstitutionPage = (page) => {
    if (restricted) return;
    navigate(`/alumni/${page}`);
    onNavigate?.();
  };
  const openTracerStudy = () => {
    if (restricted) return;
    navigate("/alumni/tracer-study");
    onNavigate?.();
  };
  const selectFilter = (filter) => { navigate(filter === "All" ? "/alumni/dashboard?section=announcements" : `/alumni/dashboard?section=announcements&filter=${encodeURIComponent(filter)}`); onNavigate?.(); };

  return (
    <aside className="sidebar">
      <div className="brand">
        <button
          type="button"
          className="tsu-brand-link"
          onClick={() => openInstitutionPage("tsu")}
          aria-label="Open Tarlac State University profile"
        >
          <img src={tsuLogo} alt="TSU" className="sidebar-logo" />
        </button>
        <div className="brand-text">
          <button
            type="button"
            className="tsu-top-brand-link"
            onClick={() => openInstitutionPage("tsu")}
            aria-label="Open Tarlac State University profile"
          >
            <img src={toptsuLogo} alt="Tarlac State University" className="toptsu-logo" />
          </button>
          <div className="alumni-brand" onClick={() => openInstitutionPage("about")}>
            <img src={alumniLogo} alt="Alumni" className="alumni-logo" />
            <p>Alumni Association<br /> Inc.</p>
          </div>
        </div>
      </div>
      {restricted ? (
        <nav className="nav" aria-label="Alumni navigation">
          <a href="#" className="active" onClick={(e) => e.preventDefault()}>
            <span><Icon name={restrictedLabel === "Update Employment Details" ? "alumni-employment" : restrictedLabel === "Tracer Study" ? "alumni-tracer" : "alumni-setup"} /></span><span>{restrictedLabel}</span>
          </a>
        </nav>
      ) : (
        <nav className="nav" aria-label="Alumni navigation">
          {NAV_SECTIONS.map(({ label: sectionLabel, items }) => <React.Fragment key={sectionLabel}>
            <div className="nav-category" aria-hidden="true">{sectionLabel}</div>
            {items.map(([key, label, icon]) => key === "announcements" ? <div className="alumni-nav-group" key={key}>
            <a href="#" className={active === key ? "active" : undefined} onClick={(e) => { e.preventDefault(); collapsed ? select("announcements") : setAnnouncementsOpen(v => !v); }}>
              <span><Icon name={icon} /></span><span>{label}</span>{!collapsed && <b className={announcementsOpen ? "open" : ""} aria-hidden="true" />}
            </a>
            {!collapsed && announcementsOpen && <div className="alumni-nav-sub">{["All", "News", "Events"].map(item => <a key={item} href="#" className={currentFilter === item ? "selected" : ""} onClick={(e) => { e.preventDefault(); selectFilter(item); }}>{item}</a>)}</div>}
          </div> : key === "tracer-study" ? <a key={key} href="#" className={location.pathname.startsWith("/alumni/tracer-study") ? "active" : undefined} onClick={(e) => { e.preventDefault(); openTracerStudy(); }}><span><Icon name={icon} /></span><span>{label}</span></a>
          : <a key={key} href="#" className={active === key ? "active" : undefined} onClick={(e) => { e.preventDefault(); select(key); }}><span><Icon name={icon} /></span><span>{label}</span></a>)}
          </React.Fragment>)}
        </nav>
      )}
      <div className="sidebar-footer"><button className="sidebar-logout" type="button" onClick={logout}><span><Icon name="icon-7" /></span><span>Logout</span></button></div>
    </aside>
  );
}
