import React, { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "../../context/AuthContext.jsx";
import { API, authHeaders } from "../../services/api.js";
import { Modal } from "../../components/common/Primitives.jsx";
import AvatarCropper from "../../components/common/AvatarCropper.jsx";
import SkillsEditor from "../../components/common/SkillsEditor.jsx";
import { classifySkill } from "../../utils/skillClassification.js";

const EMPLOYMENT_ICONS = {
  edit: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z'/%3E%3Cpath d='M14 8l3 3'/%3E%3C/svg%3E",
  save: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 3h12l2 2v16H5z'/%3E%3Cpath d='M8 3v6h8V3'/%3E%3Cpath d='M8 21v-7h8v7'/%3E%3C/svg%3E",
  cancel: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2365585c' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='9'/%3E%3Cpath d='M9 9l6 6'/%3E%3Cpath d='M15 9l-6 6'/%3E%3C/svg%3E",
};

// Caps the "Date Hired" picker at today — a hire date can't be in the future.
const todayStr = () => new Date().toISOString().slice(0, 10);

const SALARY_RANGES = [
  "Below PHP 15,000",
  "PHP 15,000 - PHP 25,000",
  "PHP 25,000 - PHP 35,000",
  "PHP 35,000 - PHP 45,000",
  "PHP 45,000 - PHP 60,000",
  "Above PHP 60,000",
  "Prefer not to say",
];

// Bracket-style choices so this data is directly matchable by whatever
// career-recommendation logic reads it later — free text ("2-ish years",
// "a few years") can't reliably be compared against a job's requirements.
const EXPERIENCE_LEVELS = [
  "No experience yet",
  "Less than 1 year",
  "1-2 years",
  "3-5 years",
  "5-10 years",
  "10+ years",
];

// Same list the Tracer Study form's industry question already uses, so an
// alumnus answering either one gets the same fixed set of choices.
const INDUSTRIES = [
  "Information Technology",
  "Education",
  "Virtual Assistance and Remote Services",
  "Customer Service and Support",
  "Engineering and Construction",
  "Marketing",
  "Healthcare",
  "Manufacturing",
  "Finance and Banking",
  "Human Resources",
  "Government and Public Administration",
  "Non-Profit/NGO",
  "Other",
];

const BLANK = {
  status: "Employed", company: "", position: "", industry: "", location: "",
  hired: "", salary: "", skills: "", experience: "",
  contactEmail: "", contactNumber: "", facebook: "", linkedin: "",
};
const EMPLOYMENT_PROFILE_KEY = "alumniEmploymentProfile";

// AlumniEmployment defaults company_name to 'N/A' and employment_status to
// 'Not Yet Updated' rather than leaving them blank — those aren't real
// answers, so they're mapped back to empty here instead of literally
// showing "N/A" in a text input the alumnus never actually filled in.
function mapEmploymentToForm(emp) {
  if (!emp) return BLANK;
  return {
    status:     ["Employed", "Self-employed", "Unemployed"].includes(emp.employment_status) ? emp.employment_status : "Employed",
    company:    emp.company_name && emp.company_name !== "N/A" ? emp.company_name : "",
    position:   emp.job_title || "",
    industry:   emp.industry || "",
    location:   emp.work_location || "",
    hired:      emp.date_employed ? new Date(emp.date_employed).toISOString().slice(0, 10) : "",
    salary:     emp.salary_range || "",
    skills:     emp.skills || "",
    experience: emp.experience || "",
    contactEmail:  emp.contact_email || "",
    contactNumber: emp.contact_number || "",
    facebook:      emp.facebook || "",
    linkedin:      emp.linkedin || "",
  };
}

function mapFormToEmployment(form) {
  return {
    employment_status: form.status,
    company_name: form.company,
    job_title: form.position,
    industry: form.industry,
    work_location: form.location,
    // null (not undefined) when cleared — JSON.stringify drops
    // undefined-valued keys entirely, which the backend can't tell apart
    // from this field never having been mentioned at all, so clearing an
    // already-set date silently failed to persist.
    date_employed: form.hired || null,
    salary_range: form.salary,
    skills: form.skills,
    experience: form.experience,
    contact_email: form.contactEmail,
    contact_number: form.contactNumber,
    facebook: form.facebook,
    linkedin: form.linkedin,
  };
}

export default function AlumniEmploymentDetails() {
  const { user, token, updateUser } = useAuth();
  const [form, setForm] = useState(BLANK);
  const [saved, setSaved] = useState(BLANK);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [education, setEducation] = useState(null);
  const avatarInputRef = useRef(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState("");
  const [cropSrc, setCropSrc] = useState("");

  function handleAvatarChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
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
    reader.onload = (loadEvent) => setCropSrc(loadEvent.target.result);
    reader.readAsDataURL(file);
  }

  const uploadAvatar = useCallback(async (avatarUrl) => {
    setAvatarBusy(true);
    setAvatarMsg("");
    try {
      const res = await fetch(`${API}/alumni/avatar`, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Could not update photo.");
      updateUser?.({ avatarUrl: data.avatarUrl });
      setAvatarMsg("Photo updated.");
      setCropSrc("");
    } catch (error) {
      setAvatarMsg(error.name === "TypeError" ? "Could not reach the server. Try again." : (error.message || "Could not update photo."));
    } finally {
      setAvatarBusy(false);
    }
  }, [updateUser]);

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    fetch(`${API}/alumni/employment`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        const mapped = mapEmploymentToForm(d.employment);
        setForm(mapped);
        setSaved(mapped);
        // The profile opens in preview mode unless the caller asked to edit
        // straight away (the topbar "Edit Profile" shortcut passes ?edit=1) —
        // otherwise editing is an explicit action so the page doesn't look
        // like an unfinished form before the alumnus chooses Edit Profile.
        setEditing(new URLSearchParams(window.location.search).get("edit") === "1");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  // Education is already collected by the Tracer Study form (Further
  // Education Yes/No + type) — shown here read-only rather than re-asking
  // for it in a second place that could drift out of sync with that answer.
  useEffect(() => {
    if (!token) return;
    fetch(`${API}/alumni/tracer-study`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        if (!d.submitted || !d.data) { setEducation("Not yet updated"); return; }
        // Graduating as a TSU alumnus already means a bachelor's degree was
        // completed — "No further studies" on its own read as if nothing
        // had been finished at all, when there's always at least that.
        setEducation(d.data.furtherEducation === "Yes" ? (d.data.furtherEducationType || "Yes") : "Bachelor's Degree");
      })
      .catch(() => setEducation("Not yet updated"));
  }, [token]);

  const update = (key, value) => setForm((prev) => {
    const next = { ...prev, [key]: value };
    localStorage.setItem(EMPLOYMENT_PROFILE_KEY, JSON.stringify(mapFormToEmployment(next)));
    window.dispatchEvent(new CustomEvent("alumni-employment-updated", { detail: mapFormToEmployment(next) }));
    return next;
  });

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch(`${API}/alumni/employment`, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(mapFormToEmployment(form)),
      });
      const data = await res.json();
      if (!res.ok) { setSaveError(data.message || "Could not save your profile."); return; }
      const mapped = mapEmploymentToForm(data.employment);
      setForm(mapped);
      setSaved(mapped);
      localStorage.setItem(EMPLOYMENT_PROFILE_KEY, JSON.stringify(data.employment));
      window.dispatchEvent(new CustomEvent("alumni-employment-updated", { detail: data.employment }));
      setEditing(false);
    } catch {
      setSaveError("Could not reach the server. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const displayName = user?.firstName ? `${user.firstName} ${user.lastName || ""}`.trim() : "Alumni";
  const initials = `${(user?.firstName || "?")[0] || ""}${(user?.lastName || "")[0] || ""}`.toUpperCase();
  const course = [user?.college, user?.course].filter(Boolean).join(" - ");
  const courseLine = [course, user?.graduationYear && `Class of ${user.graduationYear}`].filter(Boolean).join(" · ");
  // Reflect edits in the Current Profile card as they are entered. Once edit
  // mode ends, the card falls back to the values confirmed by the server.
  const profile = editing ? form : saved;
  const skillList = (profile.skills || "").split(",").map((s) => s.trim()).filter(Boolean);
  const skillGroups = [
    ["Technical / Domain Skills", skillList.filter((s) => classifySkill(s) === "hard")],
    ["Soft Skills", skillList.filter((s) => classifySkill(s) === "soft")],
    ["Other", skillList.filter((s) => classifySkill(s) === "other")],
  ].filter(([, items]) => items.length);

  if (loading) return <div className="alumni-page-content employment-details-page"><p style={{ color: "#76656a" }}>Loading…</p></div>;

  if (!editing) {
    return <div className="alumni-page-content employment-details-page">
      <aside className="profile-summary-card profile-summary-card--solo">
        <span className="profile-card-label">Current Profile</span>
        <div className="profile-avatar">{user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials}</div>
        <h2>{displayName}</h2>
        {courseLine && <p className="profile-course">{courseLine}</p>}
        {user?.email && <p className="profile-email">{user.email}</p>}
        <span className={`status-pill ${saved.status.toLowerCase()}`}>{saved.status}</span>
        <div className="profile-divider" />
        <ProfileRow icon={<RoleIcon />} label="Current role" value={profile.position ? `${profile.position}${profile.company ? ` - ${profile.company}` : ""}` : "Not yet updated"} />
        <ProfileRow icon={<IndustryIcon />} label="Industry" value={profile.industry || "Not yet updated"} />
        <ProfileRow icon={<LocationIcon />} label="Work location" value={profile.location || "Not yet updated"} />
        <ProfileRow icon={<SkillsIcon />} label="Skills">
          {skillGroups.length
            ? skillGroups.map(([groupLabel, items]) => (
              <div key={groupLabel} className="profile-chip-group">
                <span className="profile-chip-group-label">{groupLabel}</span>
                <div className="profile-chip-list">{items.map((skill) => <span key={skill} className="profile-chip">{skill}</span>)}</div>
              </div>
            ))
            : <strong>Not yet updated</strong>}
        </ProfileRow>
        <ProfileRow icon={<ExperienceIcon />} label="Experience" value={profile.experience || "Not yet updated"} />
        <ProfileRow icon={<HistoryIcon />} label="Education" value={education || "Not yet updated"} />
        <ProfileRow icon={<MailIcon />} label="Contact email" value={profile.contactEmail || "Not yet updated"} />
        <ProfileRow icon={<PhoneIcon />} label="Contact number" value={profile.contactNumber || "Not yet updated"} />
        <ProfileRow icon={<LinkIcon />} label="Facebook" value={profile.facebook || "Not yet updated"} />
        <ProfileRow icon={<LinkIcon />} label="LinkedIn" value={profile.linkedin || "Not yet updated"} />
        <button type="button" className="profile-edit-trigger" onClick={() => setEditing(true)}>Edit Profile</button>
      </aside>
    </div>;
  }

  return <div className="alumni-page-content employment-details-page">
    <section className="employment-form-card employment-form-card--solo">
      <div className="employment-card-head"><h2>Alumni Profile</h2><span className={`status-pill ${form.status.toLowerCase()}`}>{form.status}</span></div>
      <form className="profile-edit-form" onSubmit={submit}>
        <div className="employment-block employment-avatar-block">
          <div className="employment-avatar">{user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials}</div>
          <div className="employment-avatar-info">
            <h3>{displayName}</h3>
            <p>Profile photo · PNG, JPEG, GIF, or WEBP · up to 2MB.</p>
            <button type="button" className="secondary-employment-btn" disabled={avatarBusy} onClick={() => avatarInputRef.current?.click()}>{avatarBusy ? "Uploading…" : "Upload Photo"}</button>
            <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={handleAvatarChange} />
            {avatarMsg && <p className="employment-avatar-msg">{avatarMsg}</p>}
          </div>
        </div>
        <div className="employment-block"><h3>Contact Information</h3><div className="employment-fields two-columns">
          <Field label="Contact Email"><input type="email" value={form.contactEmail} onChange={e => update("contactEmail", e.target.value)} placeholder="you@example.com" /></Field>
          <Field label="Contact Number"><input type="tel" inputMode="tel" value={form.contactNumber} onChange={e => update("contactNumber", e.target.value)} placeholder="09XX XXX XXXX" maxLength={30} /></Field>
          <Field label="Facebook"><input type="text" value={form.facebook} onChange={e => update("facebook", e.target.value)} placeholder="facebook.com/yourname" /></Field>
          <Field label="LinkedIn"><input type="text" value={form.linkedin} onChange={e => update("linkedin", e.target.value)} placeholder="linkedin.com/in/yourname" /></Field>
        </div><p className="employment-field-hint">Shown on your profile and to the alumni office. Your login email ({user?.email || "—"}) stays private.</p></div>
        <div className="employment-block"><h3>Work Information</h3><div className="employment-fields">
          <Field label="Employment Status"><select value={form.status} onChange={e => update("status", e.target.value)}><option>Employed</option><option>Self-employed</option><option>Unemployed</option></select></Field>
          <Field label="Company Name"><input value={form.company} onChange={e => update("company", e.target.value)} /></Field>
          <Field label="Job Position"><input value={form.position} onChange={e => update("position", e.target.value)} /></Field>
          <Field label="Industry">
            <select value={form.industry} onChange={e => update("industry", e.target.value)}>
              <option value="">Select an industry</option>
              {form.industry && !INDUSTRIES.includes(form.industry) && <option value={form.industry}>{form.industry}</option>}
              {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </Field>
          <Field label="Work Location"><input value={form.location} onChange={e => update("location", e.target.value)} /></Field>
        </div></div>
        <div className="employment-block"><h3>Compensation</h3><div className="employment-fields two-columns"><Field label="Date Hired"><input type="date" value={form.hired} max={todayStr()} onChange={e => update("hired", e.target.value)} /></Field><Field label="Monthly Salary">
            <select value={form.salary} onChange={e => update("salary", e.target.value)}>
              <option value="">Select a range</option>
              {/* Keeps a legacy free-text value (saved before this became
                  a dropdown) selectable instead of silently blanking it. */}
              {form.salary && !SALARY_RANGES.includes(form.salary) && <option value={form.salary}>{form.salary}</option>}
              {SALARY_RANGES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field></div></div>
        <div className="employment-block"><h3>Qualifications</h3><div className="employment-fields">
          <Field label="Skills" full>
            <SkillsEditor value={form.skills} onChange={(value) => update("skills", value)} />
          </Field>
          <Field label="Experience">
            <select value={form.experience} onChange={e => update("experience", e.target.value)}>
              <option value="">Select experience level</option>
              {form.experience && !EXPERIENCE_LEVELS.includes(form.experience) && <option value={form.experience}>{form.experience}</option>}
              {EXPERIENCE_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </Field>
        </div></div>
        {saveError && <p className="employment-save-error">{saveError}</p>}
        <div className="employment-actions">
          <button type="button" className="secondary-employment-btn" onClick={() => { setForm(saved); setSaveError(""); const restored = mapFormToEmployment(saved); localStorage.setItem(EMPLOYMENT_PROFILE_KEY, JSON.stringify(restored)); window.dispatchEvent(new CustomEvent("alumni-employment-updated", { detail: restored })); setEditing(false); }}><img src={EMPLOYMENT_ICONS.cancel} alt="" aria-hidden="true" />Cancel</button>
          <button className="primary-employment-btn" type="submit" disabled={saving}><img src={EMPLOYMENT_ICONS.save} alt="" aria-hidden="true" />{saving ? "Saving…" : "Save Profile"}</button>
        </div>
      </form>
    </section>
    {cropSrc && <AvatarCropper src={cropSrc} busy={avatarBusy} onCancel={() => setCropSrc("")} onSave={uploadAvatar} />}
  </div>;
}

function Field({ label, full, children }) { return <label className={`employment-field${full ? " employment-field-full" : ""}`}><span>{label}</span>{children}</label>; }
function ProfileRow({ icon, label, value, children }) { return <div className="profile-row"><i>{icon}</i><div><span>{label}</span>{children ?? <strong>{value}</strong>}</div></div>; }
function RoleIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="7" width="16" height="12" rx="2" /><path d="M9 7V5h6v2" /><path d="M4 12h16" /></svg>; }
function IndustryIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20h18" /><path d="M4 20V9l6 4V9l6 4V9l4 2v9" /></svg>; }
function LocationIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11z" /><circle cx="12" cy="10" r="2.6" /></svg>; }
function MailIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>; }
function PhoneIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8 9.6a16 16 0 0 0 6.4 6.4l1.2-1.2a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2z" /></svg>; }
function SkillsIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 9-4 3 4 3" /><path d="m16 9 4 3-4 3" /><path d="m14 5-4 14" /></svg>; }
function ExperienceIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 8v5l3 2" /></svg>; }
function HistoryIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h14" /><path d="M6 12h14" /><path d="M6 18h14" /><circle cx="3.5" cy="6" r=".8" /><circle cx="3.5" cy="12" r=".8" /><circle cx="3.5" cy="18" r=".8" /></svg>; }
function LinkIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 15 15 9" /><path d="M11 6l1.5-1.5a3.5 3.5 0 0 1 5 5L16 11" /><path d="M13 18l-1.5 1.5a3.5 3.5 0 0 1-5-5L8 13" /></svg>; }
