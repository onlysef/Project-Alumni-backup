import React, { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import Icon from "../../components/common/Icon";
import { apiFetch } from "../../services/api.js";

function ApplicantPortrait({ avatarUrl, name }) {
  if (avatarUrl) {
    return <div className="applicant-portrait applicant-portrait-photo"><img src={avatarUrl} alt={name ? `${name}'s profile photo` : "Applicant profile photo"} /></div>;
  }
  return <div className="applicant-portrait" aria-hidden="true"><svg viewBox="0 0 88 88"><circle cx="44" cy="44" r="42" fill="#58b9e8"/><path d="M17 75c4-15 15-23 27-23s23 8 27 23c-8 7-17 11-27 11S25 82 17 75Z" fill="#27375a"/><path d="M32 50l12 10 12-10 8 8-7 25H31l-7-25 8-8Z" fill="#fff"/><path d="M32 50l12 10 12-10 5 5-8 18H35l-8-18 5-5Z" fill="#dfe6ee"/><path d="M31 28c1-12 8-19 19-17 8 2 11 9 9 20-1 9-7 19-15 19S31 39 31 28Z" fill="#f0a06a"/><path d="M29 31c-4-8 0-20 9-23 4-5 15-3 19 3 7 3 9 12 4 19l-4-9-5-5c-4 5-11 7-20 8l-3 7Z" fill="#202b45"/><path d="M36 72h16l3 13H33l3-13Z" fill="#e7af31"/></svg></div>;
}

function shortDate(value) {
  return new Date(value).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
}

// Applications carry the skills the alumnus was scored against for THIS
// specific posting (matched + missing) — that's more directly relevant to
// the employer than pulling from the alumnus's general profile.
function applicantSkills(item) {
  return (item.skills || []).map((s) => s.name);
}

export default function EmployerApplicants() {
  const { showToast } = useOutletContext() || {};
  const [applicants, setApplicants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [position, setPosition] = useState("All");
  const [status, setStatus] = useState("All");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [resumeApplicant, setResumeApplicant] = useState(null);
  const [resumeLoading, setResumeLoading] = useState(false);
  const [mailOpen, setMailOpen] = useState(false);
  const [mailDraft, setMailDraft] = useState({ subject: "", message: "" });
  const [mailSending, setMailSending] = useState(false);

  function load() {
    setLoading(true);
    setError("");
    apiFetch("/employer/applicants")
      .then((d) => setApplicants(d.applicants ?? []))
      .catch(() => setError("Could not load applicants right now."))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const positions = [...new Set(applicants.map((item) => item.title))];
  const filtered = useMemo(() => applicants.filter((item) => {
    const name = `${item.alumni_id?.firstName || ""} ${item.alumni_id?.lastName || ""}`;
    const query = search.trim().toLowerCase();
    return (position === "All" || item.title === position)
      && (status === "All" || item.employerStatus === status)
      && (!query || `${name} ${item.alumni_id?.course || ""} ${item.title} ${item.alumni_id?.email || ""}`.toLowerCase().includes(query));
  }), [applicants, position, status, search]);

  async function setEmployerStatus(item, employerStatus) {
    try {
      const { application } = await apiFetch(`/employer/applicants/${item._id}/status`, { method: "PATCH", body: { employerStatus } });
      setApplicants((current) => current.map((a) => (a._id === item._id ? { ...a, employerStatus: application.employerStatus } : a)));
      setSelected((current) => (current?._id === item._id ? { ...current, employerStatus: application.employerStatus } : current));
    } catch {
      showToast?.("Could not update this applicant's status.");
    }
  }

  function rejectApplicant(item) {
    const name = item.alumni_id ? `${item.alumni_id.firstName} ${item.alumni_id.lastName}` : "this applicant";
    if (!window.confirm(`Reject ${name}'s application for ${item.title}?`)) return;
    setEmployerStatus(item, "Rejected");
  }

  function openApplicant(item) {
    setSelected(item);
    setMailOpen(false);
    if (item.employerStatus === "New") setEmployerStatus(item, "Reviewed");
  }

  function openMail(item) {
    setMailDraft({ subject: `Regarding your application for ${item.title}`, message: "" });
    setMailOpen(true);
  }

  async function sendMail() {
    if (!mailDraft.subject.trim() || !mailDraft.message.trim()) return;
    setMailSending(true);
    try {
      await apiFetch(`/employer/applicants/${selected._id}/message`, { method: "POST", body: mailDraft });
      showToast?.(`Message sent to ${selected.alumni_id?.firstName}.`);
      setMailOpen(false);
    } catch (err) {
      showToast?.(err.message || "Could not send the message.");
    } finally {
      setMailSending(false);
    }
  }

  function openResume(item) {
    setResumeApplicant({ ...item, resume: undefined, resumeIsSaved: false });
    setResumeLoading(true);
    apiFetch(`/employer/applicants/${item._id}/resume`)
      .then((d) => setResumeApplicant((current) => (current ? { ...current, resume: d.resume, resumeIsSaved: d.isSaved } : current)))
      .catch(() => setResumeApplicant((current) => (current ? { ...current, resume: null } : current)))
      .finally(() => setResumeLoading(false));
  }

  return <div className="employer-page">
    <section className="applicant-overview">
      <div><span className="eyebrow">Talent pipeline</span><h2>Applicant list</h2><p>Review alumni applications and move promising candidates forward.</p></div>
      <div className="applicant-overview-stats">
        <div className="applicant-overview-stat"><strong>{applicants.length}</strong><span>Total applicants</span></div>
        <div className="applicant-overview-stat"><strong>{applicants.filter((item) => item.employerStatus === "New").length}</strong><span>New review</span></div>
        <div className="applicant-overview-stat"><strong>{applicants.filter((item) => item.employerStatus === "Shortlisted").length}</strong><span>Shortlisted</span></div>
      </div>
    </section>

    <section className="employer-toolbar applicants-toolbar" aria-label="Filter applicants">
      <select value={position} onChange={(event) => setPosition(event.target.value)} aria-label="Position"><option value="All">All positions</option>{positions.map((item) => <option key={item}>{item}</option>)}</select>
      <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Application status"><option value="All">All statuses</option><option>New</option><option>Reviewed</option><option>Shortlisted</option><option>Rejected</option></select>
      <label className="employer-search"><span className="sr-only">Search applicants</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search applicant, course, or position"/><span>⌕</span></label>
    </section>

    <section className="employer-panel">
      <div className="employer-panel-heading"><div><span className="eyebrow">Applicant list</span><h2>Candidates</h2></div><span>{filtered.length} result{filtered.length === 1 ? "" : "s"}</span></div>
      <div className="employer-table-wrap"><table className="employer-table applicant-table">
        <thead><tr><th>Name</th><th>Course</th><th>Application date</th><th>Position</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>
          {loading && <tr><td colSpan="6"><div className="employer-empty">Loading applicants…</div></td></tr>}
          {!loading && error && <tr><td colSpan="6"><div className="employer-empty">{error}</div></td></tr>}
          {!loading && !error && filtered.map((item) => <tr key={item._id}>
            <td><strong>{item.alumni_id?.firstName} {item.alumni_id?.lastName}</strong><small>{item.alumni_id?.email}</small></td>
            <td>{item.alumni_id?.course || "—"}</td>
            <td>{shortDate(item.appliedAt)}</td>
            <td>{item.title}</td>
            <td><span className={`employer-badge applicant-${item.employerStatus.toLowerCase()}`}>{item.employerStatus}</span></td>
            <td><div className="employer-row-actions"><button type="button" aria-label={`View ${item.alumni_id?.firstName}`} onClick={() => openApplicant(item)}><Icon name="icon-view"/></button>{item.employerStatus !== "Rejected" && <button type="button" className="appointment-cancel-btn" aria-label={`Reject ${item.alumni_id?.firstName}`} onClick={() => rejectApplicant(item)}>✕</button>}</div></td>
          </tr>)}
          {!loading && !error && !filtered.length && <tr><td colSpan="6"><div className="employer-empty">No applicants match your filters.</div></td></tr>}
        </tbody>
      </table></div>
    </section>

    {selected && <div className="employer-modal applicant-profile-layer" role="dialog" aria-modal="true" aria-labelledby="applicant-name"><button className="employer-modal-backdrop" aria-label="Close applicant profile" onClick={() => setSelected(null)}/><section className="employer-modal-card applicant-profile-card"><button className="employer-modal-close" type="button" onClick={() => setSelected(null)} aria-label="Close">×</button>
      <div className="applicant-profile-identity"><ApplicantPortrait avatarUrl={selected.alumni_id?.avatarUrl} name={`${selected.alumni_id?.firstName || ""} ${selected.alumni_id?.lastName || ""}`.trim()}/><div><h2 id="applicant-name">{selected.alumni_id?.firstName} {selected.alumni_id?.lastName}</h2><a href={`mailto:${selected.alumni_id?.email}`}>{selected.alumni_id?.email}</a><strong>{[selected.alumni_id?.college, selected.alumni_id?.course, selected.alumni_id?.graduationYear].filter(Boolean).join(" · ")}</strong></div></div>
      <div className="applicant-profile-facts">
        <section><h3>Applied for</h3><p>{selected.title}</p></section>
        <section><h3>Applied on</h3><p>{shortDate(selected.appliedAt)}</p></section>
        <section><h3>Skills for this role</h3><p>{applicantSkills(selected).length ? applicantSkills(selected).join(", ") : "Not specified"}</p></section>
      </div>
      {mailOpen ? (
        <div className="applicant-mail-compose">
          <label>Subject<input value={mailDraft.subject} onChange={(e) => setMailDraft({ ...mailDraft, subject: e.target.value })} required/></label>
          <label>Message<textarea rows="5" value={mailDraft.message} onChange={(e) => setMailDraft({ ...mailDraft, message: e.target.value })} placeholder={`Write a message to ${selected.alumni_id?.firstName}…`} required/></label>
          <div className="applicant-profile-actions">
            <button className="employer-secondary-btn" type="button" onClick={() => setMailOpen(false)}>Cancel</button>
            <button className="employer-primary-btn" type="button" onClick={sendMail} disabled={mailSending || !mailDraft.subject.trim() || !mailDraft.message.trim()}>{mailSending ? "Sending…" : "Send"}</button>
          </div>
        </div>
      ) : (
        <div className="applicant-profile-actions">
          <button className="employer-secondary-btn" type="button" onClick={() => openMail(selected)}>Send a mail</button>
          <button className="employer-secondary-btn" type="button" onClick={() => setEmployerStatus(selected, "Shortlisted")} disabled={selected.employerStatus === "Shortlisted"}>Shortlist</button>
          <button className="employer-primary-btn" type="button" onClick={() => openResume(selected)}>View resume</button>
        </div>
      )}
    </section></div>}

    {resumeApplicant && <div className="employer-modal applicant-resume-layer" role="dialog" aria-modal="true" aria-labelledby="resume-name"><button className="employer-modal-backdrop" aria-label="Close resume" onClick={() => setResumeApplicant(null)}/><section className="applicant-resume-shell"><button className="employer-modal-close" type="button" onClick={() => setResumeApplicant(null)} aria-label="Close resume">×</button>
      {resumeLoading && <div className="employer-empty">Loading resume…</div>}
      {!resumeLoading && resumeApplicant.resume === null && (
        <div className="employer-empty"><b>No resume on file</b><span>{resumeApplicant.alumni_id?.firstName} hasn't saved a resume through Job Connect yet.</span></div>
      )}
      {!resumeLoading && resumeApplicant.resume?.fileData && (
        <div className="applicant-resume-file">
          <b>{resumeApplicant.resume.fileName || "Resume file"}</b>
          <span>{resumeApplicant.alumni_id?.firstName} uploaded this file as their resume.</span>
          <a className="employer-primary-btn" href={resumeApplicant.resume.fileData} download={resumeApplicant.resume.fileName || "resume"} target="_blank" rel="noopener noreferrer">Download resume</a>
        </div>
      )}
      {!resumeLoading && resumeApplicant.resume && !resumeApplicant.resume.fileData && (<>
        {!resumeApplicant.resumeIsSaved && (
          <p className="resume-derived-note">Built from {resumeApplicant.alumni_id?.firstName}'s alumni profile — they haven't saved a formal resume through Job Connect yet.</p>
        )}
        <article className="applicant-resume-document">
          <header><h2 id="resume-name">{resumeApplicant.resume.name || `${resumeApplicant.alumni_id?.firstName} ${resumeApplicant.alumni_id?.lastName}`}</h2><p><b>Email:</b> {resumeApplicant.resume.email || resumeApplicant.alumni_id?.email}</p>{resumeApplicant.resume.phone && <p><b>Phone:</b> {resumeApplicant.resume.phone}</p>}{resumeApplicant.resume.address && <p><b>Address:</b> {resumeApplicant.resume.address}</p>}</header>
          {resumeApplicant.resume.summary && <section><h3>Summary</h3><p>{resumeApplicant.resume.summary}</p></section>}
          {resumeApplicant.resume.education && <section><h3>Education</h3><p style={{ whiteSpace: "pre-line" }}>{resumeApplicant.resume.education}</p></section>}
          {resumeApplicant.resume.experience && <section><h3>Work experience</h3><p style={{ whiteSpace: "pre-line" }}>{resumeApplicant.resume.experience}</p></section>}
          <div className="resume-two-column">
            {resumeApplicant.resume.skills && <section><h3>Skills</h3><p style={{ whiteSpace: "pre-line" }}>{resumeApplicant.resume.skills}</p></section>}
            {resumeApplicant.resume.certifications && <section><h3>Certifications</h3><p style={{ whiteSpace: "pre-line" }}>{resumeApplicant.resume.certifications}</p></section>}
          </div>
          {resumeApplicant.resume.projects && <section><h3>Projects</h3><p style={{ whiteSpace: "pre-line" }}>{resumeApplicant.resume.projects}</p></section>}
          {resumeApplicant.resume.languages && <section><h3>Languages</h3><p style={{ whiteSpace: "pre-line" }}>{resumeApplicant.resume.languages}</p></section>}
        </article>
      </>)}
    </section></div>}
  </div>;
}
