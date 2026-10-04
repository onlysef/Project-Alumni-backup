import React, { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Icon from "../common/Icon.jsx";
import { Modal } from "../common/Primitives.jsx";
import { DashboardSettingsForm, AvatarButton, AccountPanel } from "../admin/AdminTopbar.jsx";
import { API, authHeaders } from "../../services/api.js";
import { getNotificationTarget } from "../../services/notificationNavigation.js";
import { isDrawerViewport } from "../../constants/layout.js";

function timeAgo(date) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return `${Math.floor(seconds / 604800)}wk ago`;
}

export default function EmployerTopbar({
  title,
  collapsed,
  onToggleSidebar,
  settings,
  setSettings,
  showToast,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [panel, setPanel] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);

  const fetchNotifications = useCallback(async () => {
    try {
      const response = await fetch(`${API}/employer/notifications`, { headers: authHeaders() });
      if (!response.ok) return;
      const data = await response.json();
      setNotifications(data.notifications ?? []);
      setUnread(data.unread ?? 0);
    } catch {}
  }, []);

  useEffect(() => {
    fetchNotifications();
    const poll = window.setInterval(fetchNotifications, 60_000);
    return () => window.clearInterval(poll);
  }, [fetchNotifications]);

  useEffect(() => {
    if (panel === "notifications") fetchNotifications();
  }, [panel, fetchNotifications]);

  const closeSettings = useCallback(() => {
    document.body.classList.toggle("dark-mode", settings.theme === "dark");
    document.body.classList.toggle("compact-employer", settings.compactTables ?? false);
    setPanel(null);
  }, [settings.theme, settings.compactTables]);

  useEffect(() => {
    if (!panel) return undefined;

    function closeOnOutsidePointer(event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      // The cropper is its own portal; don't treat clicks inside it as outside the panel.
      if (target.closest(".topbar-modal") || target.closest(".top-actions") || target.closest(".avatar-cropper-modal")) return;
      if (panel === "settings") closeSettings();
      else setPanel(null);
    }

    function closeOnEscape(event) {
      if (event.key !== "Escape") return;
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
    if (panel === "settings") closeSettings();
    else setPanel(null);
  // Closing an open panel is the only route-change behavior needed here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  async function markAllRead() {
    try {
      const response = await fetch(`${API}/employer/notifications/read`, {
        method: "PATCH",
        headers: authHeaders(),
      });
      if (!response.ok) throw new Error("Unable to update notifications");
      setUnread(0);
      setNotifications((current) => current.map((item) => ({ ...item, is_read: true })));
      showToast("Notifications marked as read.");
    } catch {
      showToast("Could not mark notifications as read.");
    }
  }

  function togglePanel(nextPanel) {
    if (isDrawerViewport() && !collapsed) onToggleSidebar();
    setPanel((current) => current === nextPanel ? null : nextPanel);
  }

  const badge = settings.dashboardNotifications ? unread : 0;

  function openNotification(notification) {
    setPanel(null);
    navigate(getNotificationTarget("employer", notification));
  }

  return (
    <>
      <header className="topbar employer-shared-topbar">
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
            data-count={badge}
            onClick={() => togglePanel("notifications")}
          >
            <span><Icon name="icon-9" /></span>
          </button>
          <button
            className="icon-btn"
            type="button"
            aria-label="Settings"
            onClick={() => togglePanel("settings")}
          >
            <span><Icon name="icon-10" /></span>
          </button>
          <AvatarButton active={panel === "account"} onClick={() => togglePanel("account")} />
        </div>
      </header>

      <Modal open={panel === "notifications"} onClose={() => setPanel(null)} className="topbar-popover notifications-popover">
        <section className="tracer-modal topbar-modal" role="dialog" aria-modal="true" aria-labelledby="employer-notifications-title">
          <div className="modal-head">
            <h3 id="employer-notifications-title">Notifications</h3>
            <button type="button" aria-label="Close notifications" onClick={() => setPanel(null)}>×</button>
          </div>
          <div className="notification-list">
            {notifications.length === 0 ? (
              <p className="employer-notification-empty">No notifications yet.</p>
            ) : notifications.map((notification, index) => (
              <article
                key={notification._id ?? index}
                className={`notification-item notification-link${notification.is_read ? "" : " is-unread"}`}
                role="button"
                tabIndex={0}
                onClick={() => openNotification(notification)}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openNotification(notification); } }}
              >
                <strong>{notification.title || "Notification"}</strong>
                <span>{notification.message || notification.body}</span>
                <time>{timeAgo(notification.createdAt)}</time>
              </article>
            ))}
          </div>
          <div className="modal-actions topbar-modal-actions">
            <button type="button" disabled={notifications.length === 0 || unread === 0} onClick={markAllRead}>Mark All Read</button>
          </div>
        </section>
      </Modal>

      <Modal open={panel === "settings"} onClose={closeSettings} className="topbar-popover settings-popover">
        <DashboardSettingsForm
          settings={settings}
          onSave={(nextSettings) => {
            setSettings(nextSettings);
            setPanel(null);
            showToast("Settings saved.");
          }}
          onChangeTheme={(theme) => document.body.classList.toggle("dark-mode", theme === "dark")}
          onClose={closeSettings}
          showToast={showToast}
          notificationDescription="Show badges for new applicants and appointment updates."
          showChangePassword={false}
        />
      </Modal>

      <Modal open={panel === "account"} onClose={() => setPanel(null)} className="topbar-popover account-popover">
        <AccountPanel onClose={() => setPanel(null)} showToast={showToast} />
      </Modal>
    </>
  );
}
