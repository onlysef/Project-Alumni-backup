import React, { useState, useEffect, useRef } from "react";
import Icon from "../SimpleIcon.jsx";

const SAMPLE_NOTIFICATIONS = [
  { id: 1, text: "Danica Macapagal submitted event feedback", time: "5 min ago" },
  { id: 2, text: "New alumni registered: Juan D.L.C.", time: "1 hr ago" },
  { id: 3, text: "Event 'Job Fair 2026' reached 135 interested", time: "3 hr ago" },
];

export function CoordinatorTopbar({ title, collapsed, onToggleSidebar, showToast, settings, setSettings }) {
  const [panel, setPanel] = useState(null); // "notifications" | "settings" | null
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!panel) return;
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setPanel(null);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [panel]);

  const notifCount = settings?.dashboardNotifications ? SAMPLE_NOTIFICATIONS.length : 0;

  function applyTheme(theme) {
    const next = { ...settings, theme };
    setSettings(next);
    localStorage.setItem("aptmsCoordinatorSettings", JSON.stringify(next));
    showToast(`${theme === "dark" ? "Dark" : "Light"} mode applied.`);
  }

  function toggleSetting(key) {
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next);
    localStorage.setItem("aptmsCoordinatorSettings", JSON.stringify(next));
  }

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

      <div className="top-actions" ref={wrapRef}>
        <span className="divider" />

        {/* Notifications */}
        <div className="topbar-menu">
          <button
            className="icon-btn"
            type="button"
            aria-label="Notifications"
            onClick={() => setPanel(panel === "notifications" ? null : "notifications")}
          >
            <Icon name="icon-9" />
            {notifCount > 0 && <span className="topbar-badge">{notifCount}</span>}
          </button>
          {panel === "notifications" && (
            <div className="topbar-popover">
              <div className="topbar-popover-head">
                <h3>Notifications</h3>
                <button type="button" aria-label="Close" onClick={() => setPanel(null)}>&times;</button>
              </div>
              <div className="topbar-notif-list">
                {notifCount === 0 ? (
                  <p className="topbar-empty">No new notifications.</p>
                ) : (
                  SAMPLE_NOTIFICATIONS.map((n) => (
                    <div className="topbar-notif" key={n.id}>
                      <span>{n.text}</span>
                      <small>{n.time}</small>
                    </div>
                  ))
                )}
              </div>
              <div className="topbar-popover-foot">
                <button type="button" onClick={() => { showToast("Notifications marked as read."); setPanel(null); }}>Mark All Read</button>
              </div>
            </div>
          )}
        </div>

        {/* Settings */}
        <div className="topbar-menu">
          <button
            className="icon-btn"
            type="button"
            aria-label="Settings"
            onClick={() => setPanel(panel === "settings" ? null : "settings")}
          >
            <Icon name="icon-10" />
          </button>
          {panel === "settings" && (
            <div className="topbar-popover">
              <div className="topbar-popover-head">
                <h3>Settings</h3>
                <button type="button" aria-label="Close" onClick={() => setPanel(null)}>&times;</button>
              </div>
              <div className="topbar-settings">
                <div className="setting-row">
                  <div>
                    <strong>Theme</strong>
                    <small>Switch between light and dark mode.</small>
                  </div>
                  <div className="theme-options">
                    {["light", "dark"].map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={`theme-chip${settings?.theme === t ? " active" : ""}`}
                        onClick={() => applyTheme(t)}
                      >
                        {t === "light" ? "Light" : "Dark"}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="setting-row">
                  <div>
                    <strong>Dashboard Notifications</strong>
                    <small>Show the notification badge.</small>
                  </div>
                  <input type="checkbox" checked={!!settings?.dashboardNotifications} onChange={() => toggleSetting("dashboardNotifications")} />
                </label>
                <label className="setting-row">
                  <div>
                    <strong>Compact Tables</strong>
                    <small>Reduce row spacing in tables.</small>
                  </div>
                  <input type="checkbox" checked={!!settings?.compactTables} onChange={() => toggleSetting("compactTables")} />
                </label>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}