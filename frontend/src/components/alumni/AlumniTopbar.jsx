import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../common/Icon.jsx";
import { Modal } from "../common/Primitives.jsx";
import { DashboardSettingsForm } from "../admin/AdminTopbar.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { API, authHeaders } from "../../services/api.js";
import { getNotificationTarget } from "../../services/notificationNavigation.js";

function fmtNotifTime(d) {
  const diffMin = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Date(d).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

export function AlumniTopbar({ title, collapsed, onToggleSidebar, settings, setSettings, showToast = () => {}, restricted = false }) {
  const navigate = useNavigate();
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
  }

  async function markAllRead() {
    try {
      const response = await fetch(`${API}/alumni/notifications/read`, { method: "PATCH", headers: authHeaders() });
      if (!response.ok) throw new Error("Unable to update notifications");
      setUnread(0);
      setNotifications((current) => current.map((item) => ({ ...item, is_read: true })));
      showToast("Notifications marked as read.");
    } catch {
      showToast("Could not mark notifications as read.");
    }
  }

  useEffect(() => {
    if (!panel) return undefined;

    const closeOnOutside = (event) => {
      if (event.target instanceof Element && event.target.closest(".topbar-modal")) return;
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

  const badge = settings?.dashboardNotifications ? unread : 0;

  function openNotification(notification) {
    setPanel(null);
    navigate(getNotificationTarget("alumni", notification));
  }

  return (
    <>
    <header className="topbar alumni-topbar">
      <div className="title-wrap"><button className="hamburger" type="button" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={onToggleSidebar}><Icon name="icon-8" /></button><h2>{title}</h2></div>
      <div className="top-actions alumni-actions" ref={actionsRef}>
        <button className="icon-btn has-badge" data-count={badge > 9 ? "9+" : badge} aria-label="Notifications" disabled={restricted} onClick={openNotifications}><Icon name="icon-9" /></button>
        <button className="icon-btn" aria-label="Settings" disabled={restricted} onClick={() => setPanel(panel === "settings" ? null : "settings")}><Icon name="icon-10" /></button>
        <button
          className="alumni-avatar"
          aria-label="Account settings"
          disabled={restricted}
          onClick={() => setPanel(panel === "account" ? null : "account")}
        >
          {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials}
        </button>
        {panel === "account" && (
          <div className={`alumni-top-panel${panel === "account" ? " account-panel" : ""}`}>
            {panel === "account" && <AccountSettingsPanel onClose={() => setPanel(null)} />}
          </div>
        )}
      </div>
    </header>
    <Modal open={panel === "notifications"} onClose={() => setPanel(null)} className="topbar-popover notifications-popover">
      <section className="tracer-modal topbar-modal" role="dialog" aria-modal="true">
        <div className="modal-head"><h3>Notifications</h3><button type="button" aria-label="Close notifications" onClick={() => setPanel(null)}>×</button></div>
        <div className="notification-list">
          {notifications.length === 0 ? <p style={{ padding: "20px", textAlign: "center", color: "#999", fontSize: "13px" }}>No notifications yet.</p> : notifications.map((n, i) => (
            <article key={n._id ?? i} className={`notification-item notification-link${n.is_read ? "" : " is-unread"}`} role="button" tabIndex={0} onClick={() => openNotification(n)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openNotification(n); } }}><strong>{n.title || "Notification"}</strong><span>{n.message || n.body}</span><time>{fmtNotifTime(n.createdAt)}</time></article>
          ))}
        </div>
        <div className="modal-actions topbar-modal-actions"><button type="button" disabled={!unread} onClick={markAllRead}>Mark All Read</button></div>
      </section>
    </Modal>
    <Modal open={panel === "settings"} onClose={() => setPanel(null)} className="topbar-popover settings-popover">
      <DashboardSettingsForm settings={settings} onSave={(next) => { setSettings(next); setPanel(null); showToast("Settings saved."); }} onChangeTheme={(theme) => document.body.classList.toggle("dark-mode", theme === "dark")} onClose={() => { document.body.classList.toggle("dark-mode", settings?.theme === "dark"); setPanel(null); }} showToast={showToast} notificationDescription="Show badges for new alumni notifications." showChangePassword={false} />
    </Modal>
    </>
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

function AccountSettingsPanel({ onClose }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [employment, setEmployment] = useState(null);
  const [securityOpen, setSecurityOpen] = useState(false);
  const initials = `${(user?.firstName || "?")[0] || ""}${(user?.lastName || "")[0] || ""}`.toUpperCase();
  const previewMode = import.meta.env.DEV && import.meta.env.VITE_DEV_AUTH_BYPASS === "true";

  useEffect(() => {
    try {
      const cached = JSON.parse(localStorage.getItem("alumniEmploymentProfile"));
      if (cached) setEmployment(cached);
    } catch {}
    const syncEmployment = (event) => setEmployment(event.detail || null);
    window.addEventListener("alumni-employment-updated", syncEmployment);
    fetch(`${API}/alumni/employment`, { headers: authHeaders() })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load profile details.");
        return response.json();
      })
      .then((data) => setEmployment(data.employment || null))
      .catch(() => {
        if (previewMode && !localStorage.getItem("alumniEmploymentProfile")) {
          setEmployment({
            employment_status: "Employed",
            job_title: "Software Engineer",
            company_name: "Agritech Solutions",
            work_location: "Tarlac City",
            skills: "Python, Java, PHP",
          });
        }
      });
    return () => window.removeEventListener("alumni-employment-updated", syncEmployment);
  }, [previewMode]);

  const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Alumni";
  const course = user?.course || (previewMode ? "BSIT" : "Course not yet updated");
  const graduationYear = user?.graduationYear || (previewMode ? 2024 : null);
  const currentRole = employment?.job_title || "Role not yet updated";
  const company = employment?.company_name && employment.company_name !== "N/A" ? employment.company_name : "Company not yet updated";
  const location = employment?.work_location || "Location not yet updated";
  const skills = employment?.skills || "Skills not yet updated";
  // Same 7-field checklist the backend's computeProfileCompleteness scores,
  // so this bar and the Career Recommendations ring always show one number.
  const completeFields = [
    employment?.employment_status && employment.employment_status !== "Not Yet Updated",
    employment?.company_name && employment.company_name !== "N/A",
    employment?.job_title,
    employment?.industry,
    employment?.work_location,
    employment?.skills,
    employment?.experience,
  ];
  const completeness = Math.round((completeFields.filter(Boolean).length / completeFields.length) * 100);

  function openFullProfile() {
    navigate("/alumni/dashboard?section=employment&edit=1");
    onClose?.();
  }

  return <div className="account-profile-panel">
    <div className="account-profile-cover">
      <span>My Alumni Profile</span>
      <small>{employment?.employment_status || "TSU Alumni"}</small>
    </div>

    <div className="account-profile-identity">
      <div className="account-profile-avatar-wrap">
        <div className="account-settings-avatar account-profile-avatar">{user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials}</div>
      </div>
      <div>
        <h3>{displayName}</h3>
        <p>{currentRole}</p>
        <span>{course}{graduationYear ? ` · Class of ${graduationYear}` : ""}</span>
      </div>
    </div>

    <div className="account-profile-completeness">
      <div><span>Profile completion</span><strong>{completeness}%</strong></div>
      <i><span style={{ width: `${completeness}%` }} /></i>
    </div>

    <div className="account-profile-actions">
      <button type="button" onClick={openFullProfile}>Edit Profile</button>
    </div>

    <div className="account-profile-facts">
      <ProfileFact icon={<WorkIcon />} label="Current workplace" value={company} />
      <ProfileFact icon={<PinIcon />} label="Location" value={location} />
      <ProfileFact icon={<SkillIcon />} label="Skills" value={skills} wide />
      <ProfileFact icon={<MailIcon />} label="Email" value={user?.email || "Email not available"} wide />
    </div>

    <button type="button" className={`account-security-toggle${securityOpen ? " open" : ""}`} aria-expanded={securityOpen} onClick={() => setSecurityOpen((current) => !current)}>
      <span><LockIcon /><span><strong>Security</strong><small>Change your account password</small></span></span>
      <b>{securityOpen ? "−" : "+"}</b>
    </button>
    {securityOpen && <AccountSecurityForm />}
  </div>;
}

function AccountSecurityForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    event.stopPropagation();
    setMessage("");
    setError("");
    if (newPassword.length < 8) { setError("New password must be at least 8 characters."); return; }
    if (newPassword !== confirmPassword) { setError("Passwords do not match."); return; }
    setSaving(true);
    try {
      const response = await fetch(`${API}/alumni/password`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Failed to update password.");
      // The backend invalidates every other session on the account by
      // bumping its token version, and issues this session a fresh token
      // carrying the new version — without storing it, the very next
      // authenticated request from this tab would fail with "invalid token".
      if (data.token) localStorage.setItem("auth_token", data.token);
      setMessage("Password updated.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (submitError) {
      setError(submitError.message || "Could not connect to server.");
    } finally {
      setSaving(false);
    }
  }

  return <form onSubmit={submit} className="account-settings-password-form account-security-form">
    {error && <div className="account-settings-error">{error}</div>}
    {message && <div className="account-settings-success">{message}</div>}
    <label><span>Current Password</span><input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
    <label><span>New Password</span><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="At least 8 characters" required /></label>
    <label><span>Confirm New Password</span><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>
    <button type="submit" className="primary-card-btn" disabled={saving}>{saving ? "Saving…" : "Update Password"}</button>
  </form>;
}

function ProfileFact({ icon, label, value, wide = false }) {
  return <div className={wide ? "wide" : ""}><i>{icon}</i><span><small>{label}</small><strong>{value}</strong></span></div>;
}

function WorkIcon() { return <svg viewBox="0 0 24 24"><rect x="4" y="7" width="16" height="12" rx="2"/><path d="M9 7V5h6v2M4 12h16"/></svg>; }
function PinIcon() { return <svg viewBox="0 0 24 24"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>; }
function SkillIcon() { return <svg viewBox="0 0 24 24"><path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"/></svg>; }
function MailIcon() { return <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg>; }
function LockIcon() { return <svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>; }
