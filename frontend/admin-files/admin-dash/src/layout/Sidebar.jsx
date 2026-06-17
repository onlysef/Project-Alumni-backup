import React, { useState } from "react";
import Icon from "../Icon.jsx";
import alumniLogo from "../logo/alumni-removebg.png";
import tsuLogo from "../logo/tsu_logo-removebg.png";
import toptsuLogo from "../logo/tsu-top-header.webp";
import { navItems } from "../data.js";
import { useAuth } from "../auth/AuthContext.jsx";

export function Sidebar({ view, onSelect, collapsed }) {
  const { logout } = useAuth();
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

          <div className="alumni-brand">
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
        {navItems.map((item) => {
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
        <button className="sidebar-logout" type="button" onClick={logout} aria-label="Logout">
          <span><Icon name="icon-7" /></span>
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
}