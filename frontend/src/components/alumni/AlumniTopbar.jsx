import React, { useEffect, useRef, useState } from "react";
import Icon from "../common/Icon.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { API, authHeaders } from "../../services/api.js";

function fmtNotifTime(d) {
  const diffMin = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Date(d).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

export function AlumniTopbar({ title, collapsed, onToggleSidebar }) {
  const [panel, setPanel] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const actionsRef = useRef(null);
  const { user } = useAuth();
  const initials = `${(user?.firstName || "?")[0] || ""}${(user?.lastName || "")[0] || ""}`.toUpperCase();

  useEffect(() => {
    function fetchNotifications() {
      fetch(`${API}/alumni/notifications`, { headers: authHeaders() })
        .then((r) => r.json())
        .then((d) => { setNotifications(d.notifications || []); setUnread(d.unread || 0); })
        .catch(() => {});
    }
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, []);

  function openNotifications() {
    const opening = panel !== "notifications";
    setPanel(opening ? "notifications" : null);
    if (opening && unread > 0) {
      setUnread(0);
      fetch(`${API}/alumni/notifications/read`, { method: "PATCH", headers: authHeaders() }).catch(() => {});
    }
  }

  useEffect(() => {
    if (!panel) return undefined;

    const closeOnOutside = (event) => {
      if (actionsRef.current && !actionsRef.current.contains(event.target)) {
        setPanel(null);
      }
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setPanel(null);
    };

    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [panel]);

  return (
    <header className="topbar alumni-topbar">
      <div className="title-wrap"><button className="hamburger" type="button" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={onToggleSidebar}><Icon name="icon-8" /></button><h2>{title}</h2></div>
      <div className="top-actions alumni-actions" ref={actionsRef}>
        <button className="icon-btn has-badge" data-count={unread > 9 ? "9+" : unread} aria-label="Notifications" onClick={openNotifications}><Icon name="icon-9" /></button>
        <button className="icon-btn" aria-label="Settings" onClick={() => setPanel(panel === "settings" ? null : "settings")}><Icon name="icon-10" /></button>
        <button
          className="alumni-avatar"
          aria-label="Account settings"
          onClick={() => setPanel(panel === "account" ? null : "account")}
        >
          {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials}
        </button>
        {panel && (
          <div className={`alumni-top-panel${panel === "account" ? " account-panel" : ""}`}>
            {panel === "notifications" && (
              <>
                <strong>Notifications</strong>
                {notifications.length === 0 && <p>You have no new notifications.</p>}
                {notifications.length > 0 && (
                  <ul className="alumni-notif-list">
                    {notifications.map((n) => (
                      <li key={n._id} className={n.is_read ? "" : "unread"}>
                        <b>{n.title}</b>
                        <span>{n.message}</span>
                        <time>{fmtNotifTime(n.createdAt)}</time>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            {panel === "settings" && (
              <>
                <strong>Settings</strong>
                <p>Account preferences and security.</p>
                {/* "Account Settings" and "Log out" used to live here,
                    duplicating the Account Settings panel (avatar click)
                    and the sidebar's own Logout button — this now holds
                    an actual account-security preference instead. */}
                <TwoFactorToggle />
              </>
            )}
            {panel === "account" && <AccountSettingsPanel />}
          </div>
        )}
      </div>
    </header>
  );
}

function TwoFactorToggle() {
  const { user, updateUser } = useAuth();
  const saved = !!user?.isTwoFactorEnabled;
  // Checking the box only changes this local draft — nothing is sent to the
  // server until Save is clicked, so an accidental click doesn't instantly
  // flip a security setting.
  const [checked, setChecked] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMsg, setSavedMsg] = useState("");
  const dirty = checked !== saved;

  async function save() {
    setSaving(true);
    setError("");
    setSavedMsg("");
    try {
      const res = await fetch(`${API}/auth/${checked ? "enable" : "disable"}-2fa`, {
        method: "POST",
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || "Could not update this setting."); return; }
      updateUser({ isTwoFactorEnabled: checked });
      setSavedMsg("Saved.");
    } catch {
      setError("Could not connect to server.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="two-factor-toggle">
      <label>
        <input type="checkbox" checked={checked} disabled={saving} onChange={(e) => { setChecked(e.target.checked); setSavedMsg(""); }} />
        <span>
          <strong>Two-Factor Authentication</strong>
          <small>Get a one-time code by email each time you log in.</small>
        </span>
      </label>
      {dirty && (
        <button type="button" className="two-factor-save-btn" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </button>
      )}
      {error && <div className="account-settings-error">{error}</div>}
      {savedMsg && <div className="account-settings-success">{savedMsg}</div>}
    </div>
  );
}

function AccountSettingsPanel() {
  const { user, updateUser } = useAuth();
  const initials = `${(user?.firstName || "?")[0] || ""}${(user?.lastName || "")[0] || ""}`.toUpperCase();

  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState("");
  const fileInputRef = useRef(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState("");
  const [pwError, setPwError] = useState("");

  function handlePhotoChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const avatarUrl = ev.target.result;
      setAvatarSaving(true);
      setAvatarMsg("");
      try {
        const res = await fetch(`${API}/alumni/avatar`, {
          method: "PUT",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ avatarUrl }),
        });
        const data = await res.json();
        if (res.ok) {
          updateUser({ avatarUrl: data.avatarUrl });
          setAvatarMsg("Photo updated.");
        } else {
          setAvatarMsg(data.message || "Could not update photo.");
        }
      } catch {
        setAvatarMsg("Could not connect to server.");
      } finally {
        setAvatarSaving(false);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  async function submitPassword(e) {
    e.preventDefault();
    e.stopPropagation();
    setPwMsg("");
    setPwError("");
    if (newPassword.length < 8) { setPwError("New password must be at least 8 characters."); return; }
    if (newPassword !== confirmPassword) { setPwError("Passwords do not match."); return; }
    setPwSaving(true);
    try {
      const res = await fetch(`${API}/alumni/password`, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) { setPwError(data.message || "Failed to update password."); return; }
      setPwMsg("Password updated.");
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
    } catch {
      setPwError("Could not connect to server.");
    } finally {
      setPwSaving(false);
    }
  }

  return (
    <>
      <strong>Account Settings</strong>
      <div className="account-settings-avatar-row" style={{ marginTop: 10 }}>
        <div className="account-settings-avatar">{user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials}</div>
        <div>
          <strong>{user?.firstName} {user?.lastName}</strong>
          <p>{user?.email}</p>
          <button type="button" disabled={avatarSaving} onClick={() => fileInputRef.current?.click()}>
            {avatarSaving ? "Uploading…" : "Change Photo"}
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handlePhotoChange} />
          {avatarMsg && <span className="account-settings-hint">{avatarMsg}</span>}
        </div>
      </div>

      <div className="account-settings-divider" />

      <form onSubmit={submitPassword} className="account-settings-password-form">
        <h3>Change Password</h3>
        {pwError && <div className="account-settings-error">{pwError}</div>}
        {pwMsg && <div className="account-settings-success">{pwMsg}</div>}
        <label>
          <span>Current Password</span>
          <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
        </label>
        <label>
          <span>New Password</span>
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 8 characters" required />
        </label>
        <label>
          <span>Confirm New Password</span>
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
        </label>
        <button type="submit" className="primary-card-btn" disabled={pwSaving}>{pwSaving ? "Saving…" : "Update Password"}</button>
      </form>
    </>
  );
}
