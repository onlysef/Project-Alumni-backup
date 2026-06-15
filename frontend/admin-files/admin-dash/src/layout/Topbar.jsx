import React, { useState, useEffect, useRef, useCallback } from "react";
import Icon from "../Icon.jsx";
import { Modal } from "../Primitives.jsx";
import toptsuLogo from "../logo/tsu-top-header.webp";
import { API } from "../shared.js";

const LAST_READ_KEY = "adminNotifReadAt";

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60)      return `${diff}s ago`;
  if (diff < 3600)    return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400)   return `${Math.floor(diff / 3600)} hr ago`;
  if (diff < 604800)  return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)}wk ago`;
  return `${Math.floor(diff / 2592000)} mo ago`;
}

function authHeaders() {
  const token = localStorage.getItem("auth_token");
  return { Authorization: `Bearer ${token}` };
}

export function Topbar({ title, collapsed, onToggleSidebar, settings, setSettings, showToast }) {
  const [panel, setPanel] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [lastReadAt, setLastReadAt] = useState(() => {
    const stored = localStorage.getItem(LAST_READ_KEY);
    return stored ? new Date(stored) : new Date(0);
  });
  const pollRef = useRef(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch(`${API}/admin/notifications`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications || []);
    } catch {
      // silently fail — no connection shouldn't break the UI
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    pollRef.current = setInterval(fetchNotifications, 60_000);
    return () => clearInterval(pollRef.current);
  }, [fetchNotifications]);

  // Re-fetch every time the notifications panel is opened
  useEffect(() => {
    if (panel === "notifications") fetchNotifications();
  }, [panel, fetchNotifications]);

  const unread = notifications.filter((n) => new Date(n.createdAt) > lastReadAt).length;
  const badge = settings.dashboardNotifications ? unread : 0;

  function markAllRead() {
    const now = new Date();
    setLastReadAt(now);
    localStorage.setItem(LAST_READ_KEY, now.toISOString());
    showToast("Notifications marked as read.");
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
            aria-label="Notifications"
            data-count={badge}
            onClick={() => setPanel(panel === "notifications" ? null : "notifications")}
          >
            <span><Icon name="icon-9" /></span>
          </button>
          <button
            className="icon-btn"
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
                No notifications yet.
              </p>
            ) : (
              notifications.map((n, i) => (
                <article key={i} className={`notification-item${new Date(n.createdAt) > lastReadAt ? " is-unread" : ""}`}>
                  <strong>{n.title}</strong>
                  <span>{n.body}</span>
                  <time>{timeAgo(n.createdAt)}</time>
                </article>
              ))
            )}
          </div>
          <div className="modal-actions topbar-modal-actions">
            <button type="button" onClick={markAllRead}>Mark All Read</button>
            <button type="button" onClick={() => setPanel(null)}>Close</button>
          </div>
        </section>
      </Modal>

      <Modal open={panel === "settings"} onClose={() => setPanel(null)} className="topbar-popover settings-popover">
        <SettingsForm
          settings={settings}
          onSave={(s) => {
            setSettings(s);
            localStorage.setItem("aptmsDashboardSettings", JSON.stringify(s));
            setPanel(null);
            showToast("Settings saved.");
          }}
          onChangeTheme={(theme) => {
            const s = { ...settings, theme };
            setSettings(s);
            localStorage.setItem("aptmsDashboardSettings", JSON.stringify(s));
            showToast(`${theme === "dark" ? "Dark" : "Light"} mode applied.`);
          }}
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
          <span><strong>Email alerts</strong><small>Send account and tracer updates to admin email.</small></span>
          <input
            type="checkbox"
            checked={local.emailAlerts}
            onChange={(e) => setLocal((p) => ({ ...p, emailAlerts: e.target.checked }))}
          />
        </label>
        <label className="setting-row">
          <span><strong>Dashboard notifications</strong><small>Show badges for pending reviews and new posts.</small></span>
          <input
            type="checkbox"
            checked={local.dashboardNotifications}
            onChange={(e) => setLocal((p) => ({ ...p, dashboardNotifications: e.target.checked }))}
          />
        </label>
        <label className="setting-row">
          <span><strong>Compact tables</strong><small>Reduce spacing for admin tables.</small></span>
          <input
            type="checkbox"
            checked={local.compactTables}
            onChange={(e) => setLocal((p) => ({ ...p, compactTables: e.target.checked }))}
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
