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
};

export function AdminSidebar({ collapsed }) {
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
    if (view === "accounts" && subFilter) {
      navigate(`${path}?role=${encodeURIComponent(subFilter)}`);
    } else {
      navigate(path);
    }
    if (window.innerWidth <= 600) setOpenMenu(null);
  }

  const view = currentView();

  return (
    <aside className="sidebar">
      <div className="brand">
        <img src={tsuLogo} alt="TSU" className="sidebar-logo" />
        <div className="brand-text">
          <img src={toptsuLogo} alt="TSU" className="toptsu-logo" />
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
        {navItems.map((item) => {
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
                  <span><Icon name={item.icon} /></span>
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    {item.label}
                    <span className={`nav-caret${isOpen ? " open" : ""}`}>▾</span>
                  </span>
                </a>
                <div className={`nav-sub${isOpen ? " open" : ""}`}>
                  {item.children.map((child) => (
                    <a
                      key={child.key}
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
              <span><Icon name={item.icon} /></span>
              <span>{item.label}</span>
            </a>
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
