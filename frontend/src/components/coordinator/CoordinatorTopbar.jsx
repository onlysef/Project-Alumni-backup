import React, { useState, useEffect, useRef, useCallback } from "react";
import Icon from "../common/Icon.jsx";
import { API } from "../../services/api.js";

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

  // Re-fetch every time the notifications panel is opened
  useEffect(() => {
    if (panel === "notifications") fetchNotifs();
  }, [panel, fetchNotifs]);

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
  }

  const notifCount = settings?.dashboardNotifications ? unread : 0;

  function applyTheme(theme) {
    const next = { ...settings, theme };
    setSettings(next);
    localStorage.setItem("aptmsCoordinatorSettings", JSON.stringify(next));
    showToast(`${theme === "dark" ? "Dark" : "Light"} mode applied.`);
  }

  return (
    <>
      <header className="topbar">
        <div className="title-wrap">
          <button
            className="hamburger"
            type="button"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={String(!collapsed)}
            onClick={onToggleSidebar}
          >
            <span><Icon name="icon-8" /></span>
          </button>
          <h2>{title}</h2>
        </div>
        <div className="top-actions">
          <span className="divider" />
          <button
            className="icon-btn has-badge"
            type="button"
            aria-label="Notifications"
            data-count={notifCount}
            onClick={() => setPanel(panel === "notifications" ? null : "notifications")}
          >
            <span><Icon name="icon-9" /></span>
          </button>
          <button
            className="icon-btn"
            type="button"
            aria-label="Settings"
            onClick={() => setPanel(panel === "settings" ? null : "settings")}
          >
            <span><Icon name="icon-10" /></span>
          </button>
        </div>
      </header>

      <Modal open={panel === "notifications"} onClose={() => setPanel(null)} className="topbar-popover notifications-popover">
        <section className="tracer-modal topbar-modal" role="dialog" aria-modal="true">
          <div className="modal-head">
            <h3>Notifications</h3>
            <button type="button" aria-label="Close notifications" onClick={() => setPanel(null)}>×</button>
          </div>
          <div className="notification-list">
            {notifications.length === 0 ? (
              <p style={{ padding: "20px", textAlign: "center", color: "#999", fontSize: "13px" }}>
                No new notifications.
              </p>
            ) : (
              notifications.map((n, i) => (
                <article key={n._id ?? i} className={`notification-item${n.is_read ? "" : " is-unread"}`}>
                  <strong>{n.title || "Notification"}</strong>
                  <span>{n.message || n.body}</span>
                  <time>{timeAgo(n.createdAt)}</time>
                </article>
              ))
            )}
          </div>
          <div className="modal-actions topbar-modal-actions">
            <button type="button" onClick={handleMarkAllRead}>Mark All Read</button>
            <button type="button" onClick={() => setPanel(null)}>Close</button>
          </div>
        </section>
      </Modal>

      <Modal open={panel === "settings"} onClose={() => setPanel(null)} className="topbar-popover settings-popover">
        <SettingsForm
          settings={settings}
          onSave={(s) => {
            setSettings(s);
            localStorage.setItem("aptmsCoordinatorSettings", JSON.stringify(s));
            setPanel(null);
            showToast("Settings saved.");
          }}
          onChangeTheme={applyTheme}
          onClose={() => setPanel(null)}
        />
      </Modal>
    </>
  );
}

function SettingsForm({ settings, onSave, onChangeTheme, onClose }) {
  const [local, setLocal] = useState(settings);
  useEffect(() => setLocal(settings), [settings]);
  return (
    <section className="tracer-modal topbar-modal" role="dialog" aria-modal="true">
      <div className="modal-head">
        <h3>Settings</h3>
        <button type="button" aria-label="Close settings" onClick={onClose}>×</button>
      </div>
      <form
        className="settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(local);
        }}
      >
        <div className="setting-row theme-setting">
          <span>
            <strong>Theme</strong>
            <small>Switch the dashboard between light and dark mode.</small>
          </span>
          <div className="theme-options" role="radiogroup" aria-label="Theme">
            {["light", "dark"].map((t) => (
              <label key={t}>
                <input
                  type="radio"
                  name="theme"
                  value={t}
                  checked={local.theme === t}
                  onChange={() => {
                    setLocal((p) => ({ ...p, theme: t }));
                    onChangeTheme(t);
                  }}
                />
                <span>{t === "light" ? "Light" : "Dark"}</span>
              </label>
            ))}
          </div>
        </div>
        <label className="setting-row">
          <span><strong>Dashboard Notifications</strong><small>Show the notification badge.</small></span>
          <input
            type="checkbox"
            checked={!!local.dashboardNotifications}
            onChange={(e) => setLocal((p) => ({ ...p, dashboardNotifications: e.target.checked }))}
          />
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit">Save Settings</button>
        </div>
      </form>
    </section>
  );
}