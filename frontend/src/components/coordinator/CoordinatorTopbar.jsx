import React, { useState, useEffect, useRef, useCallback } from "react";
import Icon from "../common/Icon.jsx";
import { Modal } from "../common/Primitives.jsx";
import { API, authHeaders } from "../../services/api.js";

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

  function previewTheme(theme) {
    document.body.classList.toggle("dark-mode", theme === "dark");
  }

  function closeSettings() {
    document.body.classList.toggle("dark-mode", settings.theme === "dark");
    document.body.classList.toggle("compact-admin", settings.compactTables ?? false);
    setPanel(null);
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

      <Modal open={panel === "settings"} onClose={closeSettings} className="topbar-popover settings-popover">
        <SettingsForm
          settings={settings}
          onSave={(s) => {
            setSettings(s);
            setPanel(null);
            showToast("Settings saved.");
          }}
          onChangeTheme={previewTheme}
          onClose={closeSettings}
          showToast={showToast}
        />
      </Modal>
    </>
  );
}

function SettingsForm({ settings, onSave, onChangeTheme, onClose, showToast }) {
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
          <div className="theme-options">
            {["light", "dark"].map((t) => (
              <button
                key={t}
                type="button"
                className={`theme-chip${local.theme === t ? " active" : ""}`}
                onClick={() => {
                  setLocal((p) => ({ ...p, theme: t }));
                  onChangeTheme(t);
                }}
              >
                {t === "light" ? "Light" : "Dark"}
              </button>
            ))}
          </div>
        </div>
        <label className="setting-row">
          <span><strong>Email alerts</strong><small>Send account and tracer updates to admin email.</small></span>
          <input
            type="checkbox"
            checked={!!local.emailAlerts}
            onChange={(e) => setLocal((p) => ({ ...p, emailAlerts: e.target.checked }))}
          />
        </label>
        <label className="setting-row">
          <span><strong>Dashboard notifications</strong><small>Show badges for pending reviews and new posts.</small></span>
          <input
            type="checkbox"
            checked={!!local.dashboardNotifications}
            onChange={(e) => setLocal((p) => ({ ...p, dashboardNotifications: e.target.checked }))}
          />
        </label>
        <ChangePasswordSection showToast={showToast} />
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit">Save Settings</button>
        </div>
      </form>
    </section>
  );
}

function EyeIcon({ visible }) {
  return visible ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

function ChangePasswordSection({ showToast }) {
  const [open, setOpen]               = useState(false);
  const [current, setCurrent]         = useState("");
  const [newPw, setNewPw]             = useState("");
  const [confirm, setConfirm]         = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew]         = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError]             = useState("");
  const [saving, setSaving]           = useState(false);

  function reset() {
    setCurrent(""); setNewPw(""); setConfirm("");
    setShowCurrent(false); setShowNew(false); setShowConfirm(false);
    setError("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!current || !newPw || !confirm) { setError("All fields are required."); return; }
    if (newPw.length < 8)              { setError("New password must be at least 8 characters."); return; }
    if (newPw !== confirm)             { setError("Passwords do not match."); return; }
    setSaving(true);
    try {
      const res  = await fetch(`${API}/auth/change-password`, {
        method:  "POST",
        headers: authHeaders(),
        body:    JSON.stringify({ currentPassword: current, newPassword: newPw }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || "Failed to change password."); return; }
      reset();
      setOpen(false);
      showToast("Password changed successfully.");
    } catch {
      setError("Could not connect to server.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="setting-row pw-change-row">
      <div className="pw-change-header">
        <span>
          <strong>Change Password</strong>
          <small>Update your account password.</small>
        </span>
        <button
          type="button"
          className="pw-change-toggle"
          onClick={() => { setOpen((o) => !o); reset(); }}
        >
          {open ? "Cancel" : "Change Password"}
        </button>
      </div>
      {open && (
        <div className="pw-change-form">
          {[
            { label: "Current Password", value: current, set: setCurrent, show: showCurrent, toggle: () => setShowCurrent(v => !v) },
            { label: "New Password",     value: newPw,   set: setNewPw,   show: showNew,     toggle: () => setShowNew(v => !v) },
            { label: "Confirm Password", value: confirm, set: setConfirm, show: showConfirm,  toggle: () => setShowConfirm(v => !v) },
          ].map(({ label, value, set, show, toggle }) => (
            <div key={label} className="pw-field-wrap">
              <label className="pw-field-label">{label}</label>
              <div className="pw-input-wrap">
                <input
                  type={show ? "text" : "password"}
                  value={value}
                  onChange={(e) => { set(e.target.value); setError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSubmit(e); } }}
                  placeholder={label}
                  autoComplete="new-password"
                />
                <button type="button" className="pw-eye" onClick={toggle} tabIndex={-1}>
                  <EyeIcon visible={show} />
                </button>
              </div>
            </div>
          ))}
          {error && <span className="field-error pw-error">{error}</span>}
          <button
            type="button"
            className="pw-submit"
            disabled={saving}
            onClick={handleSubmit}
          >
            {saving ? "Saving…" : "Update Password"}
          </button>
        </div>
      )}
    </div>
  );
}