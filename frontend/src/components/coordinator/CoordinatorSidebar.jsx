import React, { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Icon from "../common/Icon.jsx";
import alumniLogo from "../../assets/images/alumni-removebg.png";
import tsuLogo from "../../assets/images/tsu-seal-2026.png";
import acLogo from "../../assets/images/ac-logo.png";
import { coordinatorNavItems } from "../../pages/coordinator/coordinatorData.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { isDrawerViewport, watchDrawerBoundary } from "../../constants/layout.js";

const VIEW_TO_PATH = {
  dashboard:    "/coordinator/dashboard",
  events:       "/coordinator/events",
  participation:"/coordinator/participation",
  "event-dashboard": "/coordinator/event-dashboard",
  employment:   "/coordinator/employment",
  "export-employment": "/coordinator/export-employment",
  "tracer-dashboard": "/coordinator/tracer-dashboard",
  "tracer-responses": "/coordinator/tracer-responses",
  "tracer-form-editor": "/coordinator/tracer-form-editor",
  "notify-alumni": "/coordinator/notify-alumni",
  contacts:     "/coordinator/contacts",
  aiassistant:  "/coordinator/aiassistant",
  about:        "/coordinator/about",
  tsu:          "/coordinator/tsu",
};

export function useSidebarCoordinator() {
  const [collapsed, setCollapsed] = useState(isDrawerViewport());

  useEffect(() => watchDrawerBoundary(setCollapsed), []);

  const toggleSidebar = useCallback(() => setCollapsed((c) => !c), []);
  const collapseOnMobile = useCallback(() => {
    if (isDrawerViewport()) setCollapsed(true);
  }, []);

  return { collapsed, setCollapsed, toggleSidebar, collapseOnMobile };
}

export function CoordinatorSidebar({ collapsed, items = coordinatorNavItems, onNavigate }) {
  const [openMenu, setOpenMenu] = useState(null);
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  function currentView() {
    const seg = location.pathname.split("/")[2] || "dashboard";
    return seg;
  }

  function handleSelect(view) {
    const path = VIEW_TO_PATH[view] || "/coordinator/dashboard";
    const alreadyOnThisView = view === currentView();
    navigate(path);
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
        {items.map((item, index) => {
          const hasChildren = Array.isArray(item.children) && item.children.length > 0;
          const isOpen = openMenu === item.view;
          const category = ({ 0: "Overview", 1: "Event management", 4: "Tracer Study", 7: "Alumni management", 11: "System" })[index];

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
                  <span>{item.view === "aiassistant" ? <img className="nav-ac-logo" src={acLogo} alt="" /> : <Icon name={item.icon} />}</span>
                  <span>{item.label}</span>
                  <span className={`nav-caret sidebar-chevron${isOpen ? " open" : ""}`} aria-hidden="true" />
                </a>
                <div className={`nav-sub${isOpen ? " open" : ""}`}>
                  {item.children.map((child) => (
                    <a
                      key={child.key}
                      className={view === child.key ? "selected" : undefined}
                      href="#"
                      tabIndex={isOpen ? 0 : -1}
                      onClick={(e) => { e.preventDefault(); handleSelect(child.key); }}
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
              <span>{item.view === "aiassistant" ? <img className="nav-ac-logo" src={acLogo} alt="" /> : <Icon name={item.icon} />}</span>
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
