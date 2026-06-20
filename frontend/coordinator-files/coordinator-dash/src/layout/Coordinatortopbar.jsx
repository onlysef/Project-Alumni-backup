import React from "react";
import Icon from "../SimpleIcon.jsx";

export function CoordinatorTopbar({ title, collapsed, onToggleSidebar, showToast }) {
  return (
    <header className="topbar">
      <div className="title-wrap">
        <button
          className="hamburger"
          type="button"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={onToggleSidebar}
        >
          <Icon name="icon-8" />
        </button>
        <h2>{title}</h2>
      </div>
      <div className="top-actions">
        <span className="divider" />
        <button className="icon-btn" type="button" aria-label="Notifications" onClick={() => showToast("No new notifications.")}>
          <Icon name="icon-9" />
        </button>
        <button className="icon-btn" type="button" aria-label="Settings" onClick={() => showToast("Design preview mode.")}>
          <Icon name="icon-10" />
        </button>
      </div>
    </header>
  );
}