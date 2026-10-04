import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Icon from "../common/Icon.jsx";
import alumniLogo from "../../assets/images/alumni-removebg.png";
import tsuLogo from "../../assets/images/tsu-seal-2026.png";
import acLogo from "../../assets/images/ac-logo.png";
import { navGroups } from "../../data.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { isDrawerViewport } from "../../constants/layout.js";

const VIEW_TO_PATH = {
  dashboard:    "/admin/dashboard",
  "tracer-dashboard": "/admin/tracer-dashboard",
  "tracer-responses": "/admin/tracer-responses",
  "tracer-form-editor": "/admin/tracer-form-editor",
  employment:   "/admin/employment",
  "export-employment": "/admin/export-employment",
  "notify-alumni": "/admin/notify-alumni",
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
    if (alreadyOnThisView && view === "aiassistant") {
      const container = document.querySelector(".ac-thread");
      if (container) container.scrollTop = container.scrollHeight;
    }
    if (isDrawerViewport()) {
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
            <span className="tsu-lockup"><img src={tsuLogo} alt="" /><span>Tarlac State<br />University</span></span>
          </button>
          <div
            className={`alumni-brand ${view === "about" ? "active" : ""}`}
            onClick={() => handleSelect("about")}
          >
            <img src={alumniLogo} alt="Alumni" className="alumni-logo" />
            <p>Alumni Association,<br /> Inc.</p>
          </div>
        </div>
      </div>
      <nav className="nav" aria-label="Main navigation">
        {navGroups.map((group) => (
          <div className="nav-group-section" key={group.group}>
            <div className="nav-section-label">{group.group}</div>
            {group.items.map((item) => {
              const hasChildren = Array.isArray(item.children) && item.children.length > 0;
              const isOpen = openMenu === item.view;

              if (hasChildren) {
                return (
                  <div key={item.view} className="nav-group">
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
                      <span>{item.view === "aiassistant" ? <img className="nav-ac-logo" src={acLogo} alt="" /> : <Icon name={item.icon} />}</span>
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
                );
              }

              return (
                <a
                  key={item.view}
                  className={view === item.view ? "active" : undefined}
                  href="#"
                  onClick={(e) => { e.preventDefault(); setOpenMenu(null); handleSelect(item.view); }}
                >
                  <span>{item.view === "aiassistant" ? <img className="nav-ac-logo" src={acLogo} alt="" /> : <Icon name={item.icon} />}</span>
                  <span>{item.label}</span>
                </a>
              );
            })}
          </div>
        ))}
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
