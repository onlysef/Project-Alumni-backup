import React, { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext.jsx";
import { API, authHeaders } from "../../services/api.js";

const EMPLOYMENT_ICONS = {
  edit: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z'/%3E%3Cpath d='M14 8l3 3'/%3E%3C/svg%3E",
  save: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 3h12l2 2v16H5z'/%3E%3Cpath d='M8 3v6h8V3'/%3E%3Cpath d='M8 21v-7h8v7'/%3E%3C/svg%3E",
  cancel: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2365585c' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='9'/%3E%3Cpath d='M9 9l6 6'/%3E%3Cpath d='M15 9l-6 6'/%3E%3C/svg%3E",
};

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
};

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
  };
}

function mapFormToEmployment(form) {
  return {
    employment_status: form.status,
    company_name: form.company,
    job_title: form.position,
    industry: form.industry,
    work_location: form.location,
    date_employed: form.hired || undefined,
    salary_range: form.salary,
    skills: form.skills,
    experience: form.experience,
  };
}

export default function AlumniEmploymentDetails() {
  const { user, token } = useAuth();
  const [form, setForm] = useState(BLANK);
  const [saved, setSaved] = useState(BLANK);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [education, setEducation] = useState(null);

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    fetch(`${API}/alumni/employment`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        const mapped = mapEmploymentToForm(d.employment);
        setForm(mapped);
        setSaved(mapped);
        // A brand-new record (nothing saved yet) starts in edit mode so
        // there's something to fill in right away, instead of showing a
        // form full of disabled, empty fields with no obvious next step.
        setEditing(!d.employment);
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

  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`${API}/alumni/employment`, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(mapFormToEmployment(form)),
      });
      const data = await res.json();
      if (!res.ok) return;
      const mapped = mapEmploymentToForm(data.employment);
      setForm(mapped);
      setSaved(mapped);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  const displayName = user?.firstName ? `${user.firstName} ${user.lastName || ""}`.trim() : "Alumni";
  const initials = `${(user?.firstName || "?")[0] || ""}${(user?.lastName || "")[0] || ""}`.toUpperCase();
  const courseLine = [user?.college, user?.course].filter(Boolean).join(" - ") + (user?.graduationYear ? ` ${user.graduationYear}` : "");

  if (loading) return <div className="alumni-page-content employment-details-page"><p style={{ color: "#76656a" }}>Loading…</p></div>;

  return <div className="alumni-page-content employment-details-page">
    <div className="employment-grid">
      <section className="employment-form-card">
        <div className="employment-card-head"><div><span>Employment record</span><h2>Employment Details</h2></div><span className={`status-pill ${saved.status.toLowerCase()}`}>{saved.status}</span></div>
        <form onSubmit={submit}>
          <div className="employment-block"><h3>Work Information</h3><div className="employment-fields">
            <Field label="Employment Status"><select disabled={!editing} value={form.status} onChange={e => update("status", e.target.value)}><option>Employed</option><option>Self-employed</option><option>Unemployed</option></select></Field>
            <Field label="Company Name"><input disabled={!editing} value={form.company} onChange={e => update("company", e.target.value)} /></Field>
            <Field label="Job Position"><input disabled={!editing} value={form.position} onChange={e => update("position", e.target.value)} /></Field>
            <Field label="Industry">
              <select disabled={!editing} value={form.industry} onChange={e => update("industry", e.target.value)}>
                <option value="">Select an industry</option>
                {form.industry && !INDUSTRIES.includes(form.industry) && <option value={form.industry}>{form.industry}</option>}
                {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </Field>
            <Field label="Work Location"><input disabled={!editing} value={form.location} onChange={e => update("location", e.target.value)} /></Field>
          </div></div>
          <div className="employment-block"><h3>Compensation</h3><div className="employment-fields two-columns"><Field label="Date Hired"><input disabled={!editing} type="date" value={form.hired} onChange={e => update("hired", e.target.value)} /></Field><Field label="Monthly Salary">
              <select disabled={!editing} value={form.salary} onChange={e => update("salary", e.target.value)}>
                <option value="">Select a range</option>
                {/* Keeps a legacy free-text value (saved before this became
                    a dropdown) selectable instead of silently blanking it. */}
                {form.salary && !SALARY_RANGES.includes(form.salary) && <option value={form.salary}>{form.salary}</option>}
                {SALARY_RANGES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field></div></div>
          <div className="employment-block"><h3>Qualifications</h3><div className="employment-fields">
            <Field label="Skills">
              {editing ? (
                <input placeholder="e.g. Python, Java, PHP" value={form.skills} onChange={e => update("skills", e.target.value)} />
              ) : (
                <div className="skills-chip-list">
                  {form.skills
                    ? form.skills.split(",").map(s => s.trim()).filter(Boolean).map(skill => <span key={skill} className="skill-chip">{skill}</span>)
                    : <span className="skills-empty">Not yet updated</span>}
                </div>
              )}
            </Field>
            <Field label="Experience">
              <select disabled={!editing} value={form.experience} onChange={e => update("experience", e.target.value)}>
                <option value="">Select experience level</option>
                {form.experience && !EXPERIENCE_LEVELS.includes(form.experience) && <option value={form.experience}>{form.experience}</option>}
                {EXPERIENCE_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </Field>
          </div></div>
          <div className="employment-actions">{editing ? <><button type="button" className="secondary-employment-btn" onClick={() => { setForm(saved); setEditing(false); }}><img src={EMPLOYMENT_ICONS.cancel} alt="" aria-hidden="true" />Cancel</button><button className="primary-employment-btn" type="submit" disabled={saving}><img src={EMPLOYMENT_ICONS.save} alt="" aria-hidden="true" />{saving ? "Saving…" : "Save Changes"}</button></> : <button type="button" className="primary-employment-btn" onClick={() => setEditing(true)}><img src={EMPLOYMENT_ICONS.edit} alt="" aria-hidden="true" />Edit Details</button>}</div>
        </form>
      </section>

      <aside className="profile-summary-card">
        <span className="profile-card-label">Current Profile</span>
        <div className="profile-avatar">{user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials}</div>
        <h2>{displayName}</h2>
        <p className="profile-course">{courseLine}</p>
        <p className="profile-email">{user?.email || ""}</p>
        <div className="profile-divider" />
        <ProfileRow icon={<RoleIcon />} label="Current role" value={saved.position ? `${saved.position}${saved.company ? ` - ${saved.company}` : ""}` : "Not yet updated"} />
        <ProfileRow icon={<SkillsIcon />} label="Skills" value={saved.skills || "Not yet updated"} />
        <ProfileRow icon={<ExperienceIcon />} label="Experience" value={saved.experience || "Not yet updated"} />
        <ProfileRow icon={<HistoryIcon />} label="Education" value={education || "Not yet updated"} />
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
