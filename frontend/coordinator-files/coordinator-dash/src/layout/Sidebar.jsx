import React, { useState, useEffect, useCallback } from "react";
import Icon from "../SimpleIcon.jsx";
import alumniLogo from "../logo/alumni-removebg.png";
import tsuLogo from "../logo/tsu_logo-removebg.png";
import toptsuLogo from "../logo/tsu-top-header.webp";
import { coordinatorNavItems } from "../coordinatorData.js";

const MOBILE_BREAKPOINT = 600;

// Sidebar collapse/expand behavior:
// - starts collapsed on small screens
// - auto-collapses when shrinking past the breakpoint, auto-expands when growing past it
// - exposes a manual toggle (for the hamburger) and collapse-on-navigation
export function useSidebar() {
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

export function Sidebar({ view, onSelect, collapsed, items = coordinatorNavItems }) {
  const [openMenu, setOpenMenu] = useState(null);

  return (
    <aside className="sidebar">
      <div className="brand">
        <img
          src={tsuLogo}
          alt="TSU"
          className="sidebar-logo"
        />

        <div className="brand-text">
          <img
              src={toptsuLogo}
              alt="TSU"
              className="toptsu-logo"
          />

          <div
            className={`alumni-brand ${view === "about" ? "active" : ""}`}
            onClick={() => onSelect("about")}
          >
            <img
              src={alumniLogo}
              alt="Alumni"
              className="alumni-logo"
            />
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
                <a className={view === item.view ? "active" : undefined} href="#" aria-expanded={isOpen} onClick={(e) => { e.preventDefault(); onSelect(item.view); if (!collapsed) { setOpenMenu(isOpen ? null : item.view); } }}>
                  <span><Icon name={item.icon} /></span>
                  <span>{item.label}</span>
                  <span className={`nav-caret${isOpen ? " open" : ""}`}>▾</span>
                </a>
                <div className={`nav-sub${isOpen ? " open" : ""}`}>
                  {item.children.map((child) => (
                    <a key={child.key} href="#" tabIndex={isOpen ? 0 : -1} onClick={(e) => { e.preventDefault(); onSelect(item.view, child.key); }}>
                      <span>{child.label}</span>
                    </a>
                  ))}
                </div>
              </div>
            );
          }

          return (
            <a key={item.view} className={view === item.view ? "active" : undefined} href="#" onClick={(e) => { e.preventDefault(); setOpenMenu(null); onSelect(item.view); }}>
              <span><Icon name={item.icon} /></span>
              <span>{item.label}</span>
            </a>
          );
        })}
      </nav>
      <div className="sidebar-footer">
        <button className="sidebar-logout" type="button" onClick={() => onSelect("dashboard")} aria-label="Back to dashboard">
          <span><Icon name="icon-7" /></span>
          <span>Dashboard</span>
        </button>
      </div>
    </aside>
  );
}