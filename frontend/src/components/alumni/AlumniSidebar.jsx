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
  ["employment", "Employment Details", "alumni-employment"],
  ["office", "Alumni Office", "alumni-office"],
  ["suggested", "Suggested Alumni", "alumni-suggested"],
  ["career", "Career Recommendation", "alumni-career"],
  ["jobconnect", "Job Connect", "alumni-job-connect"],
];

export function AlumniSidebar({ collapsed, onNavigate, restricted = false, restrictedLabel = "Account Setup" }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();
  const params = new URLSearchParams(location.search);
  const active = params.get("section") || "home";
  const currentFilter = params.get("filter") || "All";
  const [announcementsOpen, setAnnouncementsOpen] = useState(true);
  // The brand/logo buttons above sit outside the `<nav>` that's withheld
  // below when restricted, so without this guard they still fired a
  // navigation — one the route guard immediately bounced back from, which
  // just looked like the click did nothing rather than visibly doing nothing.
  const select = (section) => {
    if (restricted) return;
    navigate(section === "home" ? "/alumni/dashboard" : `/alumni/dashboard?section=${section}`);
    onNavigate?.();
  };
  const selectFilter = (filter) => { navigate(filter === "All" ? "/alumni/dashboard?section=announcements" : `/alumni/dashboard?section=announcements&filter=${encodeURIComponent(filter)}`); onNavigate?.(); };

  return (
    <aside className="sidebar">
      <div className="brand">
        <button
          type="button"
          className="tsu-brand-link"
          onClick={() => select("home")}
          aria-label="Open Tarlac State University profile"
        >
          <img src={tsuLogo} alt="TSU" className="sidebar-logo" />
        </button>
        <div className="brand-text">
          <button
            type="button"
            className="tsu-top-brand-link"
            onClick={() => select("home")}
            aria-label="Open Tarlac State University profile"
          >
            <img src={toptsuLogo} alt="Tarlac State University" className="toptsu-logo" />
          </button>
          <div className={`alumni-brand ${active === "office" ? "active" : ""}`} onClick={() => select("office")}>
            <img src={alumniLogo} alt="Alumni" className="alumni-logo" />
            <p>Alumni Association<br /> Inc.</p>
          </div>
        </div>
      </div>
      {/* An alumni who hasn't finished onboarding/the tracer study yet
          shouldn't see the rest of the portal's sections as available —
          the real nav list is swapped for a single non-interactive status
          item instead of every other section's link, so nothing else reads
          as available during that restricted state. Brand header and
          Logout above/below still render normally. */}
      {restricted ? (
        <nav className="nav" aria-label="Alumni navigation">
          <a href="#" className="active" onClick={(e) => e.preventDefault()}>
            <span><Icon name={restrictedLabel === "Tracer Study" ? "alumni-tracer" : "alumni-setup"} /></span><span>{restrictedLabel}</span>
          </a>
        </nav>
      ) : (
        <nav className="nav" aria-label="Alumni navigation">
          {ITEMS.map(([key, label, icon]) => key === "announcements" ? <div className="alumni-nav-group" key={key}>
            <a href="#" className={active === key ? "active" : undefined} onClick={(e) => { e.preventDefault(); collapsed ? select("announcements") : setAnnouncementsOpen(v => !v); }}>
              <span><Icon name={icon} /></span><span>{label}</span>{!collapsed && <b className={announcementsOpen ? "open" : ""} aria-hidden="true" />}
            </a>
            {!collapsed && announcementsOpen && <div className="alumni-nav-sub">{["All", "News", "Events"].map(item => <a key={item} href="#" className={currentFilter === item ? "selected" : ""} onClick={(e) => { e.preventDefault(); selectFilter(item); }}>{item}</a>)}</div>}
          </div> : <a key={key} href="#" className={active === key ? "active" : undefined} onClick={(e) => { e.preventDefault(); select(key); }}><span><Icon name={icon} /></span><span>{label}</span></a>)}
        </nav>
      )}
      <div className="sidebar-footer"><button className="sidebar-logout" type="button" onClick={logout}><span><Icon name="icon-7" /></span><span>Logout</span></button></div>
    </aside>
  );
}
