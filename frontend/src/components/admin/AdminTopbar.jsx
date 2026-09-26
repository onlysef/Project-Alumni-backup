import React, { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Icon from "../common/Icon.jsx";
import { Modal } from "../common/Primitives.jsx";
import toptsuLogo from "../../assets/images/tsu-top-header.webp";
import { API, authHeaders } from "../../services/api.js";
import { getNotificationTarget } from "../../services/notificationNavigation.js";
import { isDrawerViewport } from "../../constants/layout.js";
import { useAuth } from "../../context/AuthContext.jsx";
import AvatarCropper from "../common/AvatarCropper.jsx";

const LAST_READ_KEY = "adminNotifReadAt";
const READ_ITEMS_KEY = "adminNotifReadItems";

function notificationKey(notification) {
  return [
    notification.type || "notification",
    notification.resource_id || "none",
    notification.createdAt || "unknown",
  ].join(":");
}

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60)      return `${diff}s ago`;
  if (diff < 3600)    return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400)   return `${Math.floor(diff / 3600)} hr ago`;
  if (diff < 604800)  return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)}wk ago`;
  return `${Math.floor(diff / 2592000)} mo ago`;
}


export function AdminTopbar({ title, collapsed, onToggleSidebar, settings, setSettings, showToast }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [panel, setPanel] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [lastReadAt, setLastReadAt] = useState(() => {
    const stored = localStorage.getItem(LAST_READ_KEY);
    return stored ? new Date(stored) : new Date(0);
  });
  const [readItems, setReadItems] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(READ_ITEMS_KEY)) || []); }
    catch { return new Set(); }
  });
  const pollRef = useRef(null);

  const closeSettings = useCallback(() => {
    document.body.classList.toggle("dark-mode", settings.theme === "dark");
    document.body.classList.toggle("compact-admin", settings.compactTables ?? false);
    setPanel(null);
  }, [settings.theme, settings.compactTables]);

  useEffect(() => {
    if (!panel) return;
    function closeOnOutsidePointer(e) {
      const target = e.target;
      if (!(target instanceof Element)) return;
      // .avatar-cropper-modal — AccountPanel can open AvatarCropper as ITS
      // OWN nested Modal (a second, separate portal into document.body, not
      // a descendant of .topbar-modal in the DOM). Without this, clicking
      // anything inside the cropper — including "Save Photo" — registered as
      // "outside" the account panel on this capture-phase listener and
      // closed (unmounted) the whole panel before the click's own bubble-
      // phase onClick ever ran, making Save look like it silently did nothing.
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

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch(`${API}/admin/notifications`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications || []);
    } catch {}
  }, []);

  useEffect(() => {
    fetchNotifications();
    pollRef.current = setInterval(fetchNotifications, 60_000);
    return () => clearInterval(pollRef.current);
  }, [fetchNotifications]);

  useEffect(() => {
    if (panel === "notifications") fetchNotifications();
  }, [panel, fetchNotifications]);

  const isUnread = (notification) =>
    new Date(notification.createdAt) > lastReadAt
    && !readItems.has(notificationKey(notification));
  const unread = notifications.filter(isUnread).length;
  const badge = settings.dashboardNotifications ? unread : 0;

  function markAllRead() {
    const now = new Date();
    setLastReadAt(now);
    localStorage.setItem(LAST_READ_KEY, now.toISOString());
    setReadItems(new Set());
    localStorage.removeItem(READ_ITEMS_KEY);
    showToast("Notifications marked as read.");
  }

  function markOneRead(notification) {
    const key = notificationKey(notification);
    setReadItems((current) => {
      if (current.has(key)) return current;
      const next = new Set(current);
      next.add(key);
      localStorage.setItem(READ_ITEMS_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  function openNotification(notification) {
    markOneRead(notification);
    setPanel(null);
    const target = getNotificationTarget("admin", notification);
    if (["like", "comment", "share", "announcement"].includes(notification.type) && notification.resource_id) {
      navigate("/admin/announcements", { state: { postId: notification.resource_id } });
      return;
    }
    navigate(target);
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
            onClick={() => {
              if (isDrawerViewport() && !collapsed) onToggleSidebar();
              setPanel(panel === "notifications" ? null : "notifications");
            }}
          >
            <span><Icon name="icon-9" /></span>
          </button>
          <button
            className="icon-btn"
            aria-label="Settings"
            onClick={() => {
              if (isDrawerViewport() && !collapsed) onToggleSidebar();
              setPanel(panel === "settings" ? null : "settings");
            }}
          >
            <span><Icon name="icon-10" /></span>
          </button>
          <AvatarButton
            active={panel === "account"}
            onClick={() => {
              if (isDrawerViewport() && !collapsed) onToggleSidebar();
              setPanel(panel === "account" ? null : "account");
            }}
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
                No notifications yet.
              </p>
            ) : (
              notifications.map((n, i) => (
                <article key={n._id ?? notificationKey(n) ?? i} className={`notification-item notification-link${isUnread(n) ? " is-unread" : ""}`} role="button" tabIndex={0} onClick={() => openNotification(n)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openNotification(n); } }}>
                  <strong>{n.title}</strong>
                  <span>{n.body}</span>
                  <time>{timeAgo(n.createdAt)}</time>
                </article>
              ))
            )}
          </div>
          <div className="modal-actions topbar-modal-actions">
            <button type="button" onClick={markAllRead}>Mark All Read</button>
          </div>
        </section>
      </Modal>

      <Modal open={panel === "settings"} onClose={closeSettings} className="topbar-popover settings-popover">
        <DashboardSettingsForm
          settings={settings}
          onSave={(s) => {
            setSettings(s);
            setPanel(null);
            showToast("Settings saved.");
          }}
          onChangeTheme={(theme) => {
            document.body.classList.toggle("dark-mode", theme === "dark");
          }}
          onClose={closeSettings}
          showToast={showToast}
          showChangePassword={false}
        />
      </Modal>

      <Modal open={panel === "account"} onClose={() => setPanel(null)} className="topbar-popover account-popover">
        <AccountPanel onClose={() => setPanel(null)} showToast={showToast} />
      </Modal>
    </>
  );
}

// Avatar button next to the notifications/settings icons — previously only
// Alumni had this (see AlumniTopbar.jsx's own "alumni-avatar" button); added
// here for Admin, and imported into Coordinator/Employer's own topbars, so
// every role gets the same at-a-glance "who am I logged in as" affordance
// instead of just the two bare icon buttons.
export function AvatarButton({ onClick, active }) {
  const { user } = useAuth();
  const initials = `${(user?.firstName || "?")[0] || ""}${(user?.lastName || "")[0] || ""}`.toUpperCase();
  return (
    <button
      type="button"
      className={`alumni-avatar${active ? " active" : ""}`}
      aria-label="Account"
      onClick={onClick}
    >
      {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials}
    </button>
  );
}

// Lightweight, role-agnostic account panel — Alumni's own AccountSettingsPanel
// (AlumniTopbar.jsx) is built entirely around employment-profile data
// (completeness bar, job/company/skills facts) that has no equivalent for
// Admin/Coordinator/Employer, so this is a separate, simpler component
// rather than a reuse: just who's logged in and how to reach them.
export function AccountPanel({ onClose, showToast }) {
  const { user, updateUser } = useAuth();
  const initials = `${(user?.firstName || "?")[0] || ""}${(user?.lastName || "")[0] || ""}`.toUpperCase();
  const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Account";
  const roleLabel = user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : "";

  const avatarInputRef = useRef(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState("");
  const [cropSrc, setCropSrc] = useState("");

  // Same type/size checks and AvatarCropper flow as the alumni's own
  // "Upload Photo" (AlumniEmploymentDetails.jsx) — just posted to
  // /auth/avatar (shared across every role) instead of /alumni/avatar.
  function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)) {
      setAvatarMsg("Use a PNG, JPEG, GIF, or WEBP image.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setAvatarMsg("Image must be smaller than 2MB.");
      return;
    }
    setAvatarMsg("");
    const reader = new FileReader();
    reader.onload = (ev) => setCropSrc(ev.target.result);
    reader.readAsDataURL(file);
  }

  async function uploadAvatar(avatarUrl) {
    setAvatarBusy(true);
    setAvatarMsg("");
    try {
      const res = await fetch(`${API}/auth/avatar`, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Could not update photo.");
      updateUser?.({ avatarUrl: data.avatarUrl });
      setAvatarMsg("Photo updated.");
      setCropSrc("");
      showToast?.("Photo updated.");
    } catch (err) {
      // avatarMsg alone isn't enough here — it renders inside
      // .account-profile-panel, which sits BEHIND the still-open
      // AvatarCropper modal on failure (cropSrc is only cleared on
      // success), so a failed upload looked like "Save Photo" silently did
      // nothing. showToast renders above everything, so the failure is
      // actually visible regardless of which modal is on top.
      const msg = err.message || "Could not update photo.";
      setAvatarMsg(msg);
      showToast?.(msg);
    } finally {
      setAvatarBusy(false);
    }
  }

  const avatarInput = (
    <input
      ref={avatarInputRef}
      type="file"
      accept="image/png,image/jpeg,image/gif,image/webp"
      hidden
      onChange={handleAvatarChange}
    />
  );

  // Cropping replaces this panel's own content instead of opening AvatarCropper
  // as a second, separately-portaled modal on top of this already-open one —
  // two same-z-index full-viewport portals stacked unreliably on some mobile
  // browsers, burying the crop stage and Save/Cancel buttons behind this
  // panel. Swapping content within the one modal that's already open sidesteps
  // that entirely instead of trying to out-z-index it.
  if (cropSrc) {
    return (
      <section className="tracer-modal topbar-modal account-panel-modal is-cropping" role="dialog" aria-modal="true">
        <AvatarCropper inline src={cropSrc} busy={avatarBusy} onCancel={() => setCropSrc("")} onSave={uploadAvatar} />
        {avatarInput}
      </section>
    );
  }

  return (
    <section className="tracer-modal topbar-modal account-panel-modal" role="dialog" aria-modal="true">
      <div className="modal-head">
        <h3>Account</h3>
        <button type="button" aria-label="Close" onClick={onClose}>×</button>
      </div>
      <div className="account-profile-panel">
        {/* .account-profile-identity below carries a -34px top margin (see
            alumni-mod.css) that's meant to pull the avatar up to overlap the
            BOTTOM of a cover banner like this one — without one here, that
            same negative margin would instead pull the avatar up into the
            modal-head title bar above. */}
        <div className="account-profile-cover">
          <span>My Account</span>
        </div>
        <div className="account-profile-identity">
          <div className="account-profile-avatar-wrap">
            <div className="account-settings-avatar account-profile-avatar">
              {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials}
            </div>
          </div>
          <div>
            <h3>{displayName}</h3>
            <p>{roleLabel}{user?.college ? ` · ${user.college}` : ""}</p>
            <span>{user?.email || "Email not available"}</span>
          </div>
        </div>
        <div className="account-profile-actions">
          <button type="button" disabled={avatarBusy} onClick={() => avatarInputRef.current?.click()}>
            {avatarBusy ? "Uploading…" : "Upload Photo"}
          </button>
          {avatarInput}
        </div>
        {avatarMsg && <p className="account-panel-avatar-msg">{avatarMsg}</p>}
        <div className="account-panel-password">
          <ChangePasswordSection showToast={showToast} />
        </div>
      </div>
    </section>
  );
}

export function DashboardSettingsForm({
  settings,
  onSave,
  onChangeTheme,
  onClose,
  showToast,
  notificationDescription = "Show badges for pending reviews and new posts.",
  showChangePassword = true,
}) {
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
          <span><strong>Dashboard notifications</strong><small>{notificationDescription}</small></span>
          <input
            type="checkbox"
            checked={local.dashboardNotifications}
            onChange={(e) => setLocal((p) => ({ ...p, dashboardNotifications: e.target.checked }))}
          />
        </label>
        {showChangePassword && <ChangePasswordSection showToast={showToast} />}
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
      if (data.token) localStorage.setItem("auth_token", data.token);
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
