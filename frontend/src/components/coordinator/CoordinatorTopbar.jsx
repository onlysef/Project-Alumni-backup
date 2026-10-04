import React, { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Icon from "../common/Icon.jsx";
import { Modal } from "../common/Primitives.jsx";
import { API } from "../../services/api.js";
import { getNotificationTarget } from "../../services/notificationNavigation.js";
import { AvatarButton, AccountPanel } from "../admin/AdminTopbar.jsx";

function timeAgo(date) {
  const diff = (Date.now() - new Date(date)) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min. ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr. ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function CoordinatorTopbar({ title, collapsed, onToggleSidebar, showToast, settings, setSettings }) {
  const location = useLocation();
  const navigate = useNavigate();
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

  useEffect(() => {
    fetchNotifs();
    const poll = window.setInterval(fetchNotifs, 60_000);
    return () => window.clearInterval(poll);
  }, [fetchNotifs]);

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

  function openNotification(notification) {
    setPanel(null);
    navigate(getNotificationTarget("coordinator", notification));
  }

  function previewTheme(theme) {
    document.body.classList.toggle("dark-mode", theme === "dark");
  }

  const closeSettings = useCallback(() => {
    document.body.classList.toggle("dark-mode", settings.theme === "dark");
    setPanel(null);
  }, [settings.theme]);

  useEffect(() => {
    if (!panel) return;
    function closeOnOutsidePointer(e) {
      const target = e.target;
      if (!(target instanceof Element)) return;
      // The cropper is its own portal; don't treat clicks inside it as outside the panel.
      if (target.closest(".topbar-modal") || target.closest(".top-actions") || target.closest(".avatar-cropper-modal")) return;
      if (panel === "settings") closeSettings();
      else setPanel(null);
    }
    function closeOnEscape(e) {
      if (e.key !== "Escape") return;
      if (panel === "settings") closeSettings();
      else setPanel(null);
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [panel, closeSettings]);

  useEffect(() => {
    closeSettings();
  }, [location.pathname, closeSettings]);

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
          <AvatarButton
            active={panel === "account"}
            onClick={() => setPanel(panel === "account" ? null : "account")}
          />
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
                <article key={n._id ?? i} className={`notification-item notification-link${n.is_read ? "" : " is-unread"}`} role="button" tabIndex={0} onClick={() => openNotification(n)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openNotification(n); } }}>
                  <strong>{n.title || "Notification"}</strong>
                  <span>{n.message || n.body}</span>
                  <time>{timeAgo(n.createdAt)}</time>
                </article>
              ))
            )}
          </div>
          <div className="modal-actions topbar-modal-actions">
            <button type="button" onClick={handleMarkAllRead}>Mark All Read</button>
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
        />
      </Modal>

      <Modal open={panel === "account"} onClose={() => setPanel(null)} className="topbar-popover account-popover">
        <AccountPanel onClose={() => setPanel(null)} showToast={showToast} />
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
          <span><strong>Dashboard notifications</strong><small>Show badges for pending reviews and new posts.</small></span>
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

