import React, { useState, useEffect, useRef, useCallback } from "react";
import Icon from "../common/Icon.jsx";

const API = import.meta.env.DEV
  ? "http://localhost:5000/api"
  : "https://project-alumni-phi.vercel.app/api";

function timeAgo(date) {
  const diff = (Date.now() - new Date(date)) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min. ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr. ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function CoordinatorTopbar({ title, collapsed, onToggleSidebar, showToast, settings, setSettings }) {
  const [panel, setPanel] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const wrapRef = useRef(null);

  const fetchNotifs = useCallback(async () => {
    const token = localStorage.getItem("auth_token");
    if (!token) return;
    try {
      const res = await fetch(`${API}/coordinator/notifications`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setNotifications(data.notifications ?? []);
      setUnread(data.unread ?? 0);
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => { fetchNotifs(); }, [fetchNotifs]);

  useEffect(() => {
    if (!panel) return;
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setPanel(null);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [panel]);

  async function handleMarkAllRead() {
    const token = localStorage.getItem("auth_token");
    try {
      await fetch(`${API}/coordinator/notifications/read`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      });
      setUnread(0);
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      showToast("Notifications marked as read.");
    } catch {
      showToast("Failed to mark as read.");
    }
    setPanel(null);
  }

  const notifCount = settings?.dashboardNotifications ? unread : 0;

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
                {notifications.length === 0 ? (
                  <p className="topbar-empty">No new notifications.</p>
                ) : (
                  notifications.map((n, i) => (
                    <div className={`topbar-notif${n.is_read ? "" : " topbar-notif-unread"}`} key={n._id ?? i}>
                      <span>{n.message || n.title}</span>
                      <small>{timeAgo(n.createdAt)}</small>
                    </div>
                  ))
                )}
              </div>
              <div className="topbar-popover-foot">
                <button type="button" onClick={handleMarkAllRead}>Mark All Read</button>
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
