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
// Caps Work History end-date <input type="month"> pickers at the current
// month — a "past" job can't end in the future.
const thisMonthStr = () => new Date().toISOString().slice(0, 7);
const toMonthInput = (date) => (date ? new Date(date).toISOString().slice(0, 7) : "");

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

// Same vocabulary the Tracer Study form's "present employment type"
// question already uses, so a Work History entry and a tracer answer never
// disagree on what to call the same kind of job.
const WORK_HISTORY_TYPES = ["Regular/Permanent", "Casual/Contractual", "Part-time", "Project-based", "Self-employed"];

const BLANK = {
  firstName: "", middleInitial: "", lastName: "",
  status: "Employed", company: "", position: "", industry: "", location: "",
  hired: "", salary: "", skills: "", experience: "", workHistory: [],
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
    workHistory: (emp.work_history || []).map((h) => ({
      title: h.title || "",
      company: h.company || "",
      employmentType: h.employment_type || "",
      start: toMonthInput(h.start_date),
      end: toMonthInput(h.end_date),
      description: h.description || "",
    })),
    contactEmail:  emp.contact_email || "",
    contactNumber: emp.contact_number || "",
    facebook:      emp.facebook || "",
    linkedin:      emp.linkedin || "",
  };
}

// Letters (incl. basic accented characters), spaces, periods, apostrophes,
// and hyphens only — covers real names ("Dela Cruz", "D'Souza", "Ma. Reyes")
// while rejecting digits/other special characters typed into a text field.
const NAME_RE = /^[A-Za-zÀ-ÖØ-öø-ÿ'.\- ]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Digits plus the punctuation an actual phone number can legitimately use
// (+63, spaces, hyphens, parentheses) — anything else (letters, symbols) is
// clearly not a phone number.
const PHONE_CHARS_RE = /^[0-9+\-\s()]+$/;
// Company/Job/Location can legitimately contain digits and a small set of
// real punctuation ("7-Eleven", "Brgy. 3, Quezon City", "R&D Engineer") but
// nothing beyond that — a first pass here only rejected a value with NO
// letters at all, which still let "asdf@#$%" or "Manager!!!" through since
// they technically contain a letter somewhere.
const WORK_TEXT_RE = /^[A-Za-z0-9À-ÖØ-öø-ÿ.,'&\-/() ]*$/;
// Skills legitimately include symbols a business-text field wouldn't
// ("C++", "C#", "UI/UX") so this stays a looser "at least one letter" check
// instead of WORK_TEXT_RE's allow-list — it only rejects an entry with NO
// letters at all ("88888888888"), never a real skill.
const HAS_LETTER_RE = /[A-Za-zÀ-ÖØ-öø-ÿ]/;

// maxLength on the inputs themselves only stops typing past the limit —
// pasting or a direct API call bypasses it, so the same caps are enforced
// here too.
const FIELD_MAX_LENGTHS = {
  firstName: 50, lastName: 50, contactEmail: 100, contactNumber: 20,
  company: 100, position: 100, location: 100, facebook: 200, linkedin: 200,
};
const FIELD_LABELS = {
  firstName: "First Name", lastName: "Last Name", contactEmail: "Contact Email", contactNumber: "Contact Number",
  company: "Company Name", position: "Job Position", location: "Work Location", facebook: "Facebook", linkedin: "LinkedIn",
};

function validateProfileForm(form) {
  for (const [field, max] of Object.entries(FIELD_MAX_LENGTHS)) {
    if (form[field].trim().length > max) {
      return `${FIELD_LABELS[field]} is too long (max ${max} characters).`;
    }
  }

  const firstName = form.firstName.trim();
  const lastName  = form.lastName.trim();
  if (!firstName || !NAME_RE.test(firstName)) return "First Name should only contain letters.";
  if (!lastName  || !NAME_RE.test(lastName))  return "Last Name should only contain letters.";

  const email = form.contactEmail.trim();
  if (!email) return "Contact Email is required.";
  if (!EMAIL_RE.test(email)) return "Please enter a valid Contact Email address.";

  const number = form.contactNumber.trim();
  if (!number) return "Contact Number is required.";
  if (!PHONE_CHARS_RE.test(number)) return "Contact Number should only contain numbers.";
  if (number.replace(/\D/g, "").length < 7) return "Please enter a valid Contact Number.";

  const company  = form.company.trim();
  const position = form.position.trim();
  const location = form.location.trim();
  if (company  && !WORK_TEXT_RE.test(company))  return "Company Name contains invalid special characters.";
  if (position && !WORK_TEXT_RE.test(position)) return "Job Position contains invalid special characters.";
  if (location && !WORK_TEXT_RE.test(location)) return "Work Location contains invalid special characters.";

  const skills = form.skills.split(",").map((s) => s.trim()).filter(Boolean);
  if (skills.some((s) => !HAS_LETTER_RE.test(s))) return "Skills should not be just symbols or numbers.";
  if (skills.some((s) => s.length > 50)) return "A skill is too long (max 50 characters).";

  const facebook = form.facebook.trim();
  if (facebook && !/facebook\.com|fb\.com/i.test(facebook)) return "Please enter a valid Facebook profile link.";

  const linkedin = form.linkedin.trim();
  if (linkedin && !/linkedin\.com/i.test(linkedin)) return "Please enter a valid LinkedIn profile link.";

  for (const entry of form.workHistory || []) {
    const err = validateWorkHistoryEntry(entry);
    if (err) return err;
  }

  return null;
}

// Shared by the "Add work experience" button (immediate feedback on just
// that entry) and validateProfileForm above (defense-in-depth on Save, same
// as every other field here) — mirrors updateMyEmployment's own work_history
// checks on the backend.
function validateWorkHistoryEntry(entry) {
  const title = entry.title.trim();
  const company = entry.company.trim();
  if (!title) return "Job Title is required for a work history entry.";
  if (title.length > 100) return "Work history job title is too long (max 100 characters).";
  if (company.length > 100) return "Work history company name is too long (max 100 characters).";
  if (!WORK_TEXT_RE.test(title)) return "Work history job title contains invalid special characters.";
  if (company && !WORK_TEXT_RE.test(company)) return "Work history company name contains invalid special characters.";
  if (entry.description.length > 600) return "Work history description is too long (max 600 characters).";
  if (entry.start && entry.end && entry.end < entry.start) return "Work history end date cannot be before its start date.";
  if (entry.end && entry.end > thisMonthStr()) return "Work history end date can't be in the future — it's a past position.";
  return null;
}

function mapFormToEmployment(form) {
  return {
    // Not actually AlumniEmployment fields — updateMyEmployment also accepts
    // these two (optional) so the whole profile page can save in one request
    // instead of a second round-trip just for a name fix.
    firstName:     form.firstName?.trim(),
    middleInitial: form.middleInitial?.trim(),
    lastName:      form.lastName?.trim(),
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
    work_history: (form.workHistory || []).map((h) => ({
      title: h.title.trim(),
      company: h.company.trim(),
      employment_type: h.employmentType,
      start_date: h.start ? `${h.start}-01` : null,
      end_date: h.end ? `${h.end}-01` : null,
      description: h.description.trim(),
    })),
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
        // firstName/lastName aren't part of AlumniEmployment — they come from
        // the account itself (AuthContext), same source displayName below
        // already reads from.
        const mapped = { ...mapEmploymentToForm(d.employment), firstName: user?.firstName || "", middleInitial: user?.middleInitial || "", lastName: user?.lastName || "" };
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const validationError = validateProfileForm(form);
    if (validationError) { setSaveError(validationError); return; }
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
      const mapped = {
        ...mapEmploymentToForm(data.employment),
        firstName: data.user?.firstName ?? form.firstName,
        middleInitial: data.user?.middleInitial ?? form.middleInitial,
        lastName: data.user?.lastName ?? form.lastName,
      };
      setForm(mapped);
      setSaved(mapped);
      // Patches AuthContext's own cached copy so the corrected name shows up
      // immediately everywhere else it's read from (topbar, AC greeting,
      // etc.) instead of only after the next full sign-in.
      if (data.user?.firstName) {
        updateUser?.({ firstName: data.user.firstName, middleInitial: data.user.middleInitial, lastName: data.user.lastName });
      }
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
        <ProfileRow icon={<WorkHistoryIcon />} label="Work History">
          {(profile.workHistory || []).length
            ? <div className="work-history-list">{profile.workHistory.map((h, i) => <WorkHistoryCard key={i} entry={h} />)}</div>
            : <strong>Not yet updated</strong>}
        </ProfileRow>
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
        <div className="employment-block"><h3>Name</h3><div className="employment-fields two-columns">
          <Field label="First Name"><input value={form.firstName} onChange={e => update("firstName", e.target.value)} maxLength={50} required /></Field>
          <Field label="Middle Initial">
            <input
              value={form.middleInitial}
              maxLength={1}
              placeholder="e.g. A"
              // A single letter only — the "." is added automatically
              // wherever this is displayed, so typing one here would just be
              // a second, redundant period stacking on top of that.
              onChange={e => update("middleInitial", e.target.value.replace(/[^A-Za-z]/g, "").slice(0, 1).toUpperCase())}
            />
          </Field>
          <Field label="Last Name"><input value={form.lastName} onChange={e => update("lastName", e.target.value)} maxLength={50} required /></Field>
        </div></div>
        <div className="employment-block"><h3>Contact Information</h3><div className="employment-fields two-columns">
          <Field label="Contact Email"><input type="email" value={form.contactEmail} onChange={e => update("contactEmail", e.target.value)} placeholder="you@example.com" maxLength={100} required /></Field>
          <Field label="Contact Number"><input type="tel" inputMode="tel" value={form.contactNumber} onChange={e => update("contactNumber", e.target.value)} placeholder="09XX XXX XXXX" maxLength={20} required /></Field>
          <Field label="Facebook"><input type="text" value={form.facebook} onChange={e => update("facebook", e.target.value)} placeholder="facebook.com/yourname" maxLength={200} /></Field>
          <Field label="LinkedIn"><input type="text" value={form.linkedin} onChange={e => update("linkedin", e.target.value)} placeholder="linkedin.com/in/yourname" maxLength={200} /></Field>
        </div><p className="employment-field-hint">Shown on your profile and to the alumni office. Your login email ({user?.email || "—"}) stays private.</p></div>
        <div className="employment-block"><h3>Work Information</h3><div className="employment-fields">
          <Field label="Employment Status"><select value={form.status} onChange={e => update("status", e.target.value)}><option>Employed</option><option>Self-employed</option><option>Unemployed</option></select></Field>
          <Field label="Company Name"><input value={form.company} onChange={e => update("company", e.target.value)} maxLength={100} /></Field>
          <Field label="Job Position"><input value={form.position} onChange={e => update("position", e.target.value)} maxLength={100} /></Field>
          <Field label="Industry">
            <select value={form.industry} onChange={e => update("industry", e.target.value)}>
              <option value="">Select an industry</option>
              {form.industry && !INDUSTRIES.includes(form.industry) && <option value={form.industry}>{form.industry}</option>}
              {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </Field>
          <Field label="Work Location"><input value={form.location} onChange={e => update("location", e.target.value)} maxLength={100} /></Field>
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
        <div className="employment-block"><h3>Work History</h3>
          <p className="employment-field-hint">Past jobs — shown on your Alumni Profile and included in your Resume's Professional Experience, alongside your current job above.</p>
          <WorkHistoryEditor value={form.workHistory} onChange={(value) => update("workHistory", value)} />
        </div>
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
function WorkHistoryIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M3 13h18" /></svg>; }

function formatMonthLabel(monthStr) {
  if (!monthStr) return "";
  const [y, m] = monthStr.split("-").map(Number);
  if (!y || !m) return "";
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
function formatMonthRange(start, end) {
  const s = formatMonthLabel(start);
  const e = formatMonthLabel(end);
  return s && e ? `${s} - ${e}` : (s || e || "");
}

function WorkHistoryCard({ entry, onRemove }) {
  return <div className="work-history-entry-card">
    <div className="work-history-entry-body">
      <strong>{entry.title}{entry.company ? ` - ${entry.company}` : ""}</strong>
      <span className="work-history-entry-meta">{[entry.employmentType, formatMonthRange(entry.start, entry.end)].filter(Boolean).join(" · ")}</span>
      {entry.description && <p className="work-history-entry-desc">{entry.description}</p>}
    </div>
    {onRemove && <button type="button" className="work-history-remove-btn" onClick={onRemove} aria-label={`Remove ${entry.title}`}>×</button>}
  </div>;
}

const BLANK_WORK_HISTORY_ENTRY = { title: "", company: "", employmentType: "", start: "", end: "", description: "" };

// Add-only repeater (same simplicity as SkillsEditor's chip list — add and
// remove, no in-place editing of an already-added entry) for past jobs.
// Entries are appended to `value` and immediately handed to the parent's
// `update()`, so they ride along with the rest of the form's
// localStorage/save flow without any extra wiring here.
function WorkHistoryEditor({ value, onChange }) {
  const [draft, setDraft] = useState(BLANK_WORK_HISTORY_ENTRY);
  const [draftError, setDraftError] = useState("");

  function addEntry() {
    const err = validateWorkHistoryEntry(draft);
    if (err) { setDraftError(err); return; }
    onChange([...value, { ...draft, title: draft.title.trim(), company: draft.company.trim(), description: draft.description.trim() }]);
    setDraft(BLANK_WORK_HISTORY_ENTRY);
    setDraftError("");
  }
  function removeEntry(index) {
    onChange(value.filter((_, i) => i !== index));
  }

  return <div className="work-history-editor">
    {value.length > 0 && <div className="work-history-list">
      {value.map((entry, i) => <WorkHistoryCard key={i} entry={entry} onRemove={() => removeEntry(i)} />)}
    </div>}

    <div className="work-history-add-form">
      <div className="employment-fields two-columns">
        <Field label="Job Title"><input value={draft.title} onChange={e => { setDraft(d => ({ ...d, title: e.target.value })); setDraftError(""); }} maxLength={100} placeholder="e.g. Web Developer" /></Field>
        <Field label="Company"><input value={draft.company} onChange={e => { setDraft(d => ({ ...d, company: e.target.value })); setDraftError(""); }} maxLength={100} placeholder="e.g. IBM Philippines" /></Field>
        <Field label="Employment Type">
          <select value={draft.employmentType} onChange={e => setDraft(d => ({ ...d, employmentType: e.target.value }))}>
            <option value="">Select a type</option>
            {WORK_HISTORY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Start Date"><input type="month" value={draft.start} max={thisMonthStr()} onChange={e => { setDraft(d => ({ ...d, start: e.target.value })); setDraftError(""); }} /></Field>
        <Field label="End Date"><input type="month" value={draft.end} max={thisMonthStr()} onChange={e => { setDraft(d => ({ ...d, end: e.target.value })); setDraftError(""); }} /></Field>
      </div>
      <Field label="Description" full>
        <textarea
          value={draft.description}
          onChange={e => { setDraft(d => ({ ...d, description: e.target.value })); setDraftError(""); }}
          maxLength={600}
          placeholder={"What you did or accomplished in this role — one point per line."}
        />
      </Field>
      {draftError && <p className="employment-save-error">{draftError}</p>}
      <button type="button" className="secondary-employment-btn" onClick={addEntry}>+ Add Work Experience</button>
    </div>
  </div>;
}
