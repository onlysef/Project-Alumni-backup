import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Icon from "../common/Icon.jsx";
import alumniLogo from "../../assets/images/alumni-removebg.png";
import tsuLogo from "../../assets/images/tsu_logo-removebg.png";
import toptsuLogo from "../../assets/images/tsu-top-header.webp";
import { navItems } from "../../data.js";
import { useAuth } from "../../context/AuthContext.jsx";

const VIEW_TO_PATH = {
  dashboard:    "/admin/dashboard",
  employment:   "/admin/employment",
  appointments: "/admin/appointments",
  accounts:     "/admin/accounts",
  announcements:"/admin/announcements",
  partnerships: "/admin/partnerships",
  aiassistant:  "/admin/aiassistant",
  about:        "/admin/about",
  tsu:          "/admin/tsu",
};

export function AdminSidebar({ collapsed, onNavigate }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [openMenu, setOpenMenu] = useState(null);

  function currentView() {
    const seg = location.pathname.split("/")[2] || "dashboard";
    return seg;
  }

  function handleSelect(view, subFilter) {
    const path = VIEW_TO_PATH[view] || "/admin/dashboard";
    const alreadyOnThisView = !subFilter && view === currentView();
    if (view === "accounts" && subFilter) {
      navigate(`${path}?role=${encodeURIComponent(subFilter)}`);
    } else {
      navigate(path);
    }
    // Clicking a sidebar item while already on that page is a no-op for
    // React Router (same path -> no remount, so the target page's own
    // mount effects never re-fire). For AI Assistant specifically, that
    // meant clicking it again while scrolled up mid-conversation left you
    // stranded there instead of jumping back to the latest message — handle
    // that case directly since there's no route change to hook into.
    if (alreadyOnThisView && view === "aiassistant") {
      // .ac-thread (not .content) is the actual scrollable element — see
      // the comment on scrollToBottom in AiAssistantView.jsx for why.
      const container = document.querySelector(".ac-thread");
      if (container) container.scrollTop = container.scrollHeight;
    }
    if (window.innerWidth <= 600) {
      setOpenMenu(null);
      onNavigate?.();
    }
  }

  const view = currentView();

  return (
    <aside className="sidebar">
      <div className="brand">
        <button
          type="button"
          className="tsu-brand-link"
          onClick={() => handleSelect("tsu")}
          aria-label="Open Tarlac State University profile"
        >
          <img src={tsuLogo} alt="TSU" className="sidebar-logo" />
        </button>
        <div className="brand-text">
          <button
            type="button"
            className="tsu-top-brand-link"
            onClick={() => handleSelect("tsu")}
            aria-label="Open Tarlac State University profile"
          >
            <img src={toptsuLogo} alt="TSU" className="toptsu-logo" />
          </button>
          <div
            className={`alumni-brand ${view === "about" ? "active" : ""}`}
            onClick={() => handleSelect("about")}
          >
            <img src={alumniLogo} alt="Alumni" className="alumni-logo" />
            <p>Alumni Association<br /> Inc.</p>
          </div>
        </div>
      </div>
      <nav className="nav" aria-label="Main navigation">
        {navItems.map((item, index) => {
          const hasChildren = Array.isArray(item.children) && item.children.length > 0;
          const isOpen = openMenu === item.view;
          const category = ({ 0: "Overview", 1: "Alumni management", 4: "Engagement", 6: "Tools" })[index];

          if (hasChildren) {
            return (
              <React.Fragment key={item.view}>
              {category && <div className="nav-category" aria-hidden="true">{category}</div>}
              <div className="nav-group">
                <a
                  className={view === item.view ? "active" : undefined}
                  href="#"
                  aria-expanded={isOpen}
                  onClick={(e) => {
                    e.preventDefault();
                    handleSelect(item.view);
                    if (!collapsed) setOpenMenu(isOpen ? null : item.view);
                  }}
                >
                  <span><Icon name={item.icon} /></span>
                  <span className="nav-item-label">{item.label}</span>
                  <span className={`nav-caret sidebar-chevron${isOpen ? " open" : ""}`} aria-hidden="true" />
                </a>
                <div className={`nav-sub${isOpen ? " open" : ""}`}>
                  {item.children.map((child) => (
                    <a
                      key={child.key}
                      className={new URLSearchParams(location.search).get("role") === child.key ? "selected" : undefined}
                      href="#"
                      tabIndex={isOpen ? 0 : -1}
                      onClick={(e) => { e.preventDefault(); handleSelect(item.view, child.key); }}
                    >
                      <span>{child.label}</span>
                    </a>
                  ))}
                </div>
              </div>
              </React.Fragment>
            );
          }

          return (
            <React.Fragment key={item.view}>
            {category && <div className="nav-category" aria-hidden="true">{category}</div>}
            <a
              key={item.view}
              className={view === item.view ? "active" : undefined}
              href="#"
              onClick={(e) => { e.preventDefault(); setOpenMenu(null); handleSelect(item.view); }}
            >
              <span><Icon name={item.icon} /></span>
              <span>{item.label}</span>
            </a>
            </React.Fragment>
          );
        })}
      </nav>
      <div className="sidebar-footer">
        <button className="sidebar-logout" type="button" onClick={logout} aria-label="Logout">
          <span><Icon name="icon-7" /></span>
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
}
