import React, { useState } from "react";

const EMPLOYMENT_ICONS = {
  edit: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z'/%3E%3Cpath d='M14 8l3 3'/%3E%3C/svg%3E",
  save: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 3h12l2 2v16H5z'/%3E%3Cpath d='M8 3v6h8V3'/%3E%3Cpath d='M8 21v-7h8v7'/%3E%3C/svg%3E",
  cancel: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2365585c' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='9'/%3E%3Cpath d='M9 9l6 6'/%3E%3Cpath d='M15 9l-6 6'/%3E%3C/svg%3E",
};

const initial = {
  status: "Employed",
  company: "Agritech Solutions",
  position: "Software Engineer",
  industry: "Information Technology",
  location: "Tarlac City",
  hired: "2024-06-10",
  salary: "PHP 35,000 - PHP 45,000",
  skills: "Python, Java, PHP and C++",
  education: "BS Information Technology",
  experience: "2 years",
};

export default function AlumniEmploymentDetails() {
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [editing, setEditing] = useState(true);
  const update = (key, value) => setForm(prev => ({ ...prev, [key]: value }));
  const submit = (event) => { event.preventDefault(); setSaved(form); setEditing(false); };

  return <div className="alumni-page-content employment-details-page">
    <div className="employment-grid">
      <section className="employment-form-card">
        <div className="employment-card-head"><div><span>Employment record</span><h2>Employment Details</h2></div><span className={`status-pill ${saved.status.toLowerCase()}`}>{saved.status}</span></div>
        <form onSubmit={submit}>
          <div className="employment-block"><h3>Work Information</h3><div className="employment-fields">
            <Field label="Employment Status"><select disabled={!editing} value={form.status} onChange={e => update("status", e.target.value)}><option>Employed</option><option>Self-employed</option><option>Unemployed</option></select></Field>
            <Field label="Company Name"><input disabled={!editing} value={form.company} onChange={e => update("company", e.target.value)} /></Field>
            <Field label="Job Position"><input disabled={!editing} value={form.position} onChange={e => update("position", e.target.value)} /></Field>
            <Field label="Industry"><input disabled={!editing} value={form.industry} onChange={e => update("industry", e.target.value)} /></Field>
            <Field label="Work Location"><input disabled={!editing} value={form.location} onChange={e => update("location", e.target.value)} /></Field>
          </div></div>
          <div className="employment-block"><h3>Compensation</h3><div className="employment-fields two-columns"><Field label="Date Hired"><input disabled={!editing} type="date" value={form.hired} onChange={e => update("hired", e.target.value)} /></Field><Field label="Monthly Salary"><input disabled={!editing} value={form.salary} onChange={e => update("salary", e.target.value)} /></Field></div></div>
          <div className="employment-block"><h3>Qualifications</h3><div className="employment-fields"><Field label="Skills"><input disabled={!editing} value={form.skills} onChange={e => update("skills", e.target.value)} /></Field><Field label="Education"><input disabled={!editing} value={form.education} onChange={e => update("education", e.target.value)} /></Field><Field label="Experience"><input disabled={!editing} value={form.experience} onChange={e => update("experience", e.target.value)} /></Field></div></div>
          <div className="employment-actions">{editing ? <><button type="button" className="secondary-employment-btn" onClick={() => { setForm(saved); setEditing(false); }}><img src={EMPLOYMENT_ICONS.cancel} alt="" aria-hidden="true" />Cancel</button><button className="primary-employment-btn" type="submit"><img src={EMPLOYMENT_ICONS.save} alt="" aria-hidden="true" />Save Changes</button></> : <button type="button" className="primary-employment-btn" onClick={() => setEditing(true)}><img src={EMPLOYMENT_ICONS.edit} alt="" aria-hidden="true" />Edit Details</button>}</div>
        </form>
      </section>

      <aside className="profile-summary-card">
        <span className="profile-card-label">Current Profile</span>
        <div className="profile-avatar">JC</div>
        <h2>Juan Dela Cruz</h2>
        <p className="profile-course">CCS - BSIT 2023-2024</p>
        <p className="profile-email">jdelacruz@gmail.com</p>
        <div className="profile-divider" />
        <ProfileRow icon={<RoleIcon />} label="Current role" value={`${saved.position} - ${saved.company}`} />
        <ProfileRow icon={<SkillsIcon />} label="Skills" value={saved.skills} />
        <ProfileRow icon={<ExperienceIcon />} label="Experience" value={saved.experience} />
        <ProfileRow icon={<HistoryIcon />} label="Job history" value="Junior Developer" />
      </aside>
    </div>
  </div>;
}

function Field({ label, children }) { return <label className="employment-field"><span>{label}</span>{children}</label>; }
function ProfileRow({ icon, label, value }) { return <div className="profile-row"><i>{icon}</i><div><span>{label}</span><strong>{value}</strong></div></div>; }
function RoleIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="7" width="16" height="12" rx="2" /><path d="M9 7V5h6v2" /><path d="M4 12h16" /></svg>; }
function SkillsIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 9-4 3 4 3" /><path d="m16 9 4 3-4 3" /><path d="m14 5-4 14" /></svg>; }
function ExperienceIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 8v5l3 2" /></svg>; }
function HistoryIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h14" /><path d="M6 12h14" /><path d="M6 18h14" /><circle cx="3.5" cy="6" r=".8" /><circle cx="3.5" cy="12" r=".8" /><circle cx="3.5" cy="18" r=".8" /></svg>; }
