import React, { useEffect, useRef, useState } from "react";
import Icon from "../common/Icon.jsx";
import { useAuth } from "../../context/AuthContext.jsx";

export function AlumniTopbar({ title, collapsed, onToggleSidebar }) {
  const [panel, setPanel] = useState(null);
  const actionsRef = useRef(null);
  const { user, logout } = useAuth();
  const name = user?.name || user?.fullName || "Alumni User";

  useEffect(() => {
    if (!panel) return undefined;

    const closeOnOutside = (event) => {
      if (actionsRef.current && !actionsRef.current.contains(event.target)) {
        setPanel(null);
      }
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setPanel(null);
    };

    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [panel]);

  return (
    <header className="topbar alumni-topbar">
      <div className="title-wrap"><button className="hamburger" type="button" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={onToggleSidebar}><Icon name="icon-8" /></button><h2>{title}</h2></div>
      <div className="top-actions alumni-actions" ref={actionsRef}>
        <button className="icon-btn has-badge" data-count="0" aria-label="Notifications" onClick={() => setPanel(panel === "notifications" ? null : "notifications")}><Icon name="icon-9" /></button>
        <button className="icon-btn" aria-label="Settings" onClick={() => setPanel(panel === "settings" ? null : "settings")}><Icon name="icon-10" /></button>
        <button className="alumni-avatar" aria-label="Profile" onClick={() => setPanel(panel === "profile" ? null : "profile")}>{name.charAt(0).toUpperCase()}</button>
        {panel && <div className="alumni-top-panel">
          {panel === "notifications" && <><strong>Notifications</strong><p>You have no new notifications.</p></>}
          {panel === "settings" && <><strong>Settings</strong><p>Account preferences and security.</p></>}
          {panel === "profile" && <><strong>{name}</strong><p>Alumni account</p><button type="button" onClick={logout}>Log out</button></>}
        </div>}
      </div>
    </header>
  );
}
