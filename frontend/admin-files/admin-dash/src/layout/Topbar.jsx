import React, { useState, useEffect } from "react";
import Icon from "../Icon.jsx";
import { Modal } from "../Primitives.jsx";
import toptsuLogo from "../logo/tsu-top-header.webp";

const notificationsSeed = [
  { title: "New alumni registration", body: "Danica Macapagal is waiting for account approval.", time: "5 min ago", unread: true },
  { title: "Tracer survey submitted", body: "Juan Dela Cruz updated employment information.", time: "18 min ago", unread: true },
  { title: "Partnership request", body: "Scholarship Program needs review.", time: "1 hr ago", unread: true },
  { title: "Announcement posted", body: "Career Development Webinar was published.", time: "Yesterday", unread: false },
];

export function Topbar({ title, collapsed, onToggleSidebar, settings, setSettings, showToast }) {
  const [panel, setPanel] = useState(null); // 'notifications' | 'settings' | 'profile'
  const [notifications, setNotifications] = useState(notificationsSeed);
  const [profile, setProfile] = useState({
    name: "Admin User",
    email: "admin@tsu.edu.ph",
    role: "System Administrator",
  });

  const unread = notifications.filter((n) => n.unread).length;
  const badge = settings.dashboardNotifications ? unread : 0;
  const initial = profile.name.charAt(0).toUpperCase();

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
          <button
            className="avatar"
            type="button"
            aria-label="Admin profile"
            onClick={() => setPanel(panel === "profile" ? null : "profile")}
          >
            {initial}
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
            {notifications.map((n, i) => (
              <article key={i} className={`notification-item${n.unread ? " is-unread" : ""}`}>
                <strong>{n.title}</strong>
                <span>{n.body}</span>
                <time>{n.time}</time>
              </article>
            ))}
          </div>
          <div className="modal-actions topbar-modal-actions">
            <button
              type="button"
              onClick={() => {
                setNotifications((prev) => prev.map((n) => ({ ...n, unread: false })));
                showToast("Notifications marked as read.");
              }}
            >
              Mark All Read
            </button>
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

      <Modal open={panel === "profile"} onClose={() => setPanel(null)} className="topbar-popover profile-popover">
        <section className="tracer-modal topbar-modal" role="dialog" aria-modal="true">
          <div className="modal-head">
            <h3>Admin Profile</h3>
            <button type="button" aria-label="Close profile" onClick={() => setPanel(null)}>×</button>
          </div>
          <form
            className="profile-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = e.currentTarget.elements;
              setProfile({
                name: f.name.value.trim() || "Admin User",
                email: f.email.value,
                role: f.role.value,
              });
              setPanel(null);
              showToast("Admin profile updated.");
            }}
          >
            <div className="profile-summary">
              <div className="profile-avatar-preview">{initial}</div>
              <div>
                <strong>{profile.name}</strong>
                <span>{profile.role}</span>
              </div>
            </div>
            <label>Name<input type="text" name="name" defaultValue={profile.name} required /></label>
            <label>Email<input type="email" name="email" defaultValue={profile.email} required /></label>
            <label>
              Role
              <select name="role" defaultValue={profile.role}>
                <option>System Administrator</option>
                <option>Staff Administrator</option>
                <option>Records Manager</option>
              </select>
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setPanel(null)}>Cancel</button>
              <button type="submit">Save Profile</button>
            </div>
          </form>
        </section>
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
