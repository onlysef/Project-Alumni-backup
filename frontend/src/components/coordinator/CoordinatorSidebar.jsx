import React, { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Icon from "../common/Icon.jsx";
import alumniLogo from "../../assets/images/alumni-removebg.png";
import tsuLogo from "../../assets/images/tsu_logo-removebg.png";
import toptsuLogo from "../../assets/images/tsu-top-header.webp";
import { coordinatorNavItems } from "../../pages/coordinator/coordinatorData.js";
import { useAuth } from "../../context/AuthContext.jsx";

const MOBILE_BREAKPOINT = 600;

const VIEW_TO_PATH = {
  dashboard:    "/coordinator/dashboard",
  events:       "/coordinator/events",
  participation:"/coordinator/participation",
  employment:   "/coordinator/employment",
  contacts:     "/coordinator/contacts",
  aiassistant:  "/coordinator/aiassistant",
  about:        "/coordinator/about",
  tsu:          "/coordinator/tsu",
};

export function useSidebarCoordinator() {
  const [collapsed, setCollapsed] = useState(window.innerWidth <= MOBILE_BREAKPOINT);

  useEffect(() => {
    let wasMobile = window.innerWidth <= MOBILE_BREAKPOINT;
    const handleResize = () => {
      const isMobile = window.innerWidth <= MOBILE_BREAKPOINT;
      if (isMobile !== wasMobile) {
        setCollapsed(isMobile);
        wasMobile = isMobile;
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const toggleSidebar = useCallback(() => setCollapsed((c) => !c), []);
  const collapseOnMobile = useCallback(() => {
    if (window.innerWidth <= MOBILE_BREAKPOINT) setCollapsed(true);
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
    if (window.innerWidth <= MOBILE_BREAKPOINT) {
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
        {items.map((item) => {
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
