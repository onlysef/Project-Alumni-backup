import React from "react";
import Icon from "../Icon.jsx";
import tsuLogo from "../logo/tsu_logo-removebg.png";
import alumniLogo from "../logo/alumni-removebg.png";
import toptsuLogo from "../logo/tsu-top-header.webp";
import { navItems } from "../data.js";
import { useAuth } from "../auth/AuthContext.jsx";

export function Sidebar({ view, onSelect }) {
  const { logout } = useAuth();
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
        {navItems.map((item) => (
          <a
            key={item.view}
            className={view === item.view ? "active" : undefined}
            href="#"
            onClick={(e) => {
              e.preventDefault();
              onSelect(item.view);
            }}
          >
            <span><Icon name={item.icon} /></span>
            <span>{item.label}</span>
          </a>
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
