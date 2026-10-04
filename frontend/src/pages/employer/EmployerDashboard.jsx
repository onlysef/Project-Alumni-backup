import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { Link, useOutletContext } from "react-router-dom";
import Icon from "../../components/common/Icon";
import { apiFetch } from "../../services/api.js";
import { isJunkText } from "../../utils/textQuality.js";

const JUNK_FIELD_RULES = {
  title:               { requireWord: true,  minLength: 3, blockAtSymbol: true },
  jobDescription:      { requireWord: true,  minLength: 15, requireMultiWord: true },
  keyResponsibilities: { requireWord: true,  requireMultiWord: true },
  qualifications:      { requireWord: true,  requireMultiWord: true },
  preferredSkills:     { requireWord: true,  requireMultiWord: true },
  location:            { requireWord: true,  blockAtSymbol: true, blockLongDigitRun: true },
  salaryRange:         { requireWord: false, requireDigitOrPhrase: true },
};
const JUNK_FIELD_MESSAGES = {
  title: "That doesn't look like a real job title.",
  jobDescription: "The job description looks like random text. Please write an actual description of the role.",
  keyResponsibilities: "Key responsibilities looks like random text. Please list the actual duties for this role.",
  qualifications: "Qualifications & requirements looks like random text. Please list the actual qualifications needed.",
  preferredSkills: "Preferred skills looks like random text. Please list actual skills.",
  location: "That doesn't look like a real location.",
  salaryRange: "That doesn't look like a real salary range.",
};
// Matches the form's visual top-to-bottom order, used to pick which field to
// scroll into view when more than one has an error.
const FIELD_ORDER = ["title", "location", "salaryRange", "jobDescription", "keyResponsibilities", "qualifications", "preferredSkills"];

// Returns every invalid field at once (not just the first) so each one can
// show its own message under its own box instead of one generic banner the
// employer has to match back to whichever field it's actually about.
function validateJobForm(form) {
  const errors = {};
  if (!form.title.trim()) errors.title = "Job title is required.";
  else if (isJunkText(form.title, JUNK_FIELD_RULES.title)) errors.title = JUNK_FIELD_MESSAGES.title;

  if (!form.jobDescription.trim()) errors.jobDescription = "A job description is required.";
  else if (isJunkText(form.jobDescription, JUNK_FIELD_RULES.jobDescription)) errors.jobDescription = JUNK_FIELD_MESSAGES.jobDescription;

  ["keyResponsibilities", "qualifications", "preferredSkills", "location", "salaryRange"].forEach((f) => {
    if (form[f] && isJunkText(form[f], JUNK_FIELD_RULES[f])) errors[f] = JUNK_FIELD_MESSAGES[f];
  });
  return errors;
}

const emptyForm = {
  title: "", jobType: "Full-time", location: "", salaryRange: "",
  jobDescription: "", keyResponsibilities: "", qualifications: "", preferredSkills: "",
};

function prettyDate(value) {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "2-digit", year: "numeric" }).format(new Date(value));
}

function statusLabel(status) {
  return status === "open" ? "Active" : "Closed";
}

function ArrowIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

function CloseCircleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <line x1="9" y1="9" x2="15" y2="15" />
      <line x1="15" y1="9" x2="9" y2="15" />
    </svg>
  );
}

let cachedEmployerData = null;

export default function EmployerDashboard() {
  const { showToast } = useOutletContext() || {};
  const [jobs, setJobs] = useState(cachedEmployerData?.jobs ?? []);
  const [partnerships, setPartnerships] = useState(cachedEmployerData?.partnerships ?? []);
  const [linkedPartnership, setLinkedPartnership] = useState(cachedEmployerData?.linkedPartnership ?? null);
  const [applicants, setApplicants] = useState(cachedEmployerData?.applicants ?? []);
  const [interviews, setInterviews] = useState(cachedEmployerData?.interviews ?? []);
  const [loading, setLoading] = useState(!cachedEmployerData);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("All");
  const [date, setDate] = useState("All");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const modalCardRef = useRef(null);
  const fieldRefs = useRef({});

  // The modal body scrolls independently (long forms + short viewports), so
  // an error on a field the employer has scrolled past (e.g. Preferred
  // skills, or Job title after scrolling down to fix something lower) can
  // render off-screen — scroll the offending field itself into view rather
  // than just flashing a message somewhere it might not be visible.
  function reportFormError(message) {
    setFormError(message);
    modalCardRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  function scrollToField(name) {
    fieldRefs.current[name]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function load(showSpinner = true) {
    if (showSpinner) setLoading(true);
    setError("");
    Promise.all([
      apiFetch("/employer/jobs"),
      apiFetch("/employer/partnerships"),
      apiFetch("/employer/applicants"),
      apiFetch("/employer/interviews"),
    ])
      .then(([jobsData, partnershipsData, applicantsData, interviewsData]) => {
        const next = {
          jobs: jobsData.jobs ?? [],
          partnerships: partnershipsData.partnerships ?? [],
          linkedPartnership: partnershipsData.linkedPartnership ?? null,
          applicants: applicantsData.applicants ?? [],
          interviews: interviewsData.interviews ?? [],
        };
        cachedEmployerData = next;
        setJobs(next.jobs);
        setPartnerships(next.partnerships);
        setLinkedPartnership(next.linkedPartnership);
        setApplicants(next.applicants);
        setInterviews(next.interviews);
      })
      .catch(() => setError("Could not load your job posts right now."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load(!cachedEmployerData);
    const interval = setInterval(() => load(false), 30000);
    return () => clearInterval(interval);
  }, []);

  const filtered = useMemo(() => jobs.filter((job) => {
    const statusMatch = status === "All" || statusLabel(job.status) === status;
    const dateMatch = date === "All" || job.createdAt?.startsWith(date);
    const query = search.trim().toLowerCase();
    return statusMatch && dateMatch && (!query || `${job.title} ${job.location} ${job.jobType}`.toLowerCase().includes(query));
  }), [jobs, status, date, search]);

  const activeCount = jobs.filter((job) => job.status === "open").length;
  const closedCount = jobs.filter((job) => job.status === "closed").length;

  const applicantCountByJob = useMemo(() => {
    const counts = {};
    applicants.forEach((a) => { if (a.job_id) counts[a.job_id] = (counts[a.job_id] || 0) + 1; });
    return counts;
  }, [applicants]);

  const newApplicantCount = applicants.filter((a) => a.employerStatus === "New").length;
  const upcomingInterviewCount = interviews.filter((i) => i.status === "Upcoming").length;
  const nextStepsCopy = useMemo(() => {
    const parts = [];
    if (newApplicantCount) parts.push(`${newApplicantCount} new candidate${newApplicantCount === 1 ? "" : "s"} waiting for review`);
    if (upcomingInterviewCount) parts.push(`${upcomingInterviewCount} interview${upcomingInterviewCount === 1 ? "" : "s"} coming up`);
    return parts.length ? `${parts.join(" · ")}.` : "You're all caught up — no pending candidates or interviews.";
  }, [newApplicantCount, upcomingInterviewCount]);

  function openCreate() {
    setForm(emptyForm);
    setFormError("");
    setFieldErrors({});
    setModal({ type: "form", job: null });
  }

  function openEdit(job) {
    setForm({
      title: job.title,
      jobType: job.jobType,
      location: job.location || "",
      salaryRange: job.salaryRange || "",
      jobDescription: job.jobDescription || "",
      keyResponsibilities: job.keyResponsibilities || "",
      qualifications: job.qualifications || "",
      preferredSkills: job.preferredSkills || "",
    });
    setFormError("");
    setFieldErrors({});
    setModal({ type: "form", job });
  }

  function updateField(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  }

  async function saveJob(event) {
    event.preventDefault();
    const errors = validateJobForm(form);
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      scrollToField(FIELD_ORDER.find((f) => errors[f]));
      return;
    }
    setFieldErrors({});
    setFormError("");
    setSaving(true);
    try {
      if (modal?.job) {
        const { job } = await apiFetch(`/employer/jobs/${modal.job._id}`, { method: "PATCH", body: form });
        setJobs((current) => current.map((j) => (j._id === job._id ? job : j)));
        showToast?.("Job post updated.");
      } else {
        const { job } = await apiFetch("/employer/jobs", { method: "POST", body: form });
        setJobs((current) => [job, ...current]);
        showToast?.("Job post published.");
      }
      setModal(null);
    } catch (err) {
      reportFormError(err.message || "Could not save this job post.");
    } finally {
      setSaving(false);
    }
  }

  async function closeJobPost(job) {
    try {
      const { job: updated } = await apiFetch(`/employer/jobs/${job._id}/close`, { method: "PATCH" });
      setJobs((current) => current.map((j) => (j._id === updated._id ? updated : j)));
      showToast?.("Job post closed.");
      setModal(null);
    } catch {
      showToast?.("Could not close this job post.");
    }
  }

  async function removeJob(id) {
    try {
      await apiFetch(`/employer/jobs/${id}`, { method: "DELETE" });
      setJobs((current) => current.filter((job) => job._id !== id));
      showToast?.("Job post deleted.");
      setModal(null);
    } catch (err) {
      showToast?.(err.message || "Could not delete this job post.");
    }
  }

  return (
    <div className="employer-page employer-jobs-page">
      <section className="employer-stats" aria-label="Job post overview">
        <article><span>Active job posts</span><strong>{activeCount}</strong><small>Currently accepting applicants</small></article>
        <article><span>Closed job posts</span><strong>{closedCount}</strong><small>No longer accepting applicants</small></article>
        <article><span>Total job posts</span><strong>{jobs.length}</strong><small>Posted by your company</small></article>
      </section>

      <section className="employer-toolbar" aria-label="Filter job posts">
        <strong>Filter job posts</strong>
        <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Job status"><option>All</option><option>Active</option><option>Closed</option></select>
        <select value={date} onChange={(event) => setDate(event.target.value)} aria-label="Post year"><option value="All">All dates</option><option value="2026">2026</option><option value="2025">2025</option></select>
        <label className="employer-search"><span className="sr-only">Search jobs</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title, location, or type"/><span>⌕</span></label>
      </section>

      <section className="employer-panel">
        <div className="employer-panel-heading"><div><span className="eyebrow">Job posts</span><h2>Manage opportunities</h2></div><span>{filtered.length} result{filtered.length === 1 ? "" : "s"}</span></div>
        <div className="employer-table-wrap">
          <table className="employer-table">
            <thead><tr><th>Job title</th><th>Status</th><th>Post date</th><th>Applicants</th><th aria-label="Actions"/></tr></thead>
            <tbody>
              {loading && <tr><td colSpan="5"><div className="employer-empty">Loading job posts…</div></td></tr>}
              {!loading && error && <tr><td colSpan="5"><div className="employer-empty">{error}</div></td></tr>}
              {!loading && !error && filtered.map((job) => <tr key={job._id}>
                <td data-label="Job title"><button className="employer-title-link" type="button" onClick={() => setModal({ type: "view", job })}>{job.title}</button><small>{job.jobType} · {job.location || "—"}</small></td>
                <td data-label="Status"><span className={`employer-badge ${statusLabel(job.status).toLowerCase()}`}>{statusLabel(job.status)}</span></td>
                <td data-label="Post date">{prettyDate(job.createdAt)}</td>
                <td data-label="Applicants">{applicantCountByJob[job._id] || 0}</td>
                <td data-label="Actions"><div className="employer-row-actions"><button type="button" aria-label={`View ${job.title}`} onClick={() => setModal({ type: "view", job })}><Icon name="icon-view"/></button><button type="button" aria-label={`Edit ${job.title}`} onClick={() => openEdit(job)}><Icon name="icon-edit"/></button>{job.status === "open" && <button type="button" aria-label={`Close ${job.title}`} title="Close posting" onClick={() => setModal({ type: "close", job })}><CloseCircleIcon/></button>}<button type="button" aria-label={`Delete ${job.title}`} onClick={() => setModal({ type: "delete", job })}><Icon name="icon-delete"/></button></div></td>
              </tr>)}
              {!loading && !error && !filtered.length && <tr><td colSpan="5"><div className="employer-empty">No job posts match your filters.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <button className="employer-primary-btn create-job-btn" type="button" onClick={openCreate} disabled={loading || !partnerships.length}><span>＋</span> Create post</button>
      {!loading && !partnerships.length && (
        <p className="employer-inline-notice">
          {linkedPartnership?.status === "Archived"
            ? `Your partner company, ${linkedPartnership.name}, has been archived, so posting is turned off. Contact the admin office to get it reactivated.`
            : "Your account isn't linked to a partner company yet, so posting is turned off. Contact the admin office to get this set up."}
        </p>
      )}

      <section className="employer-dashboard-lower" aria-label="Hiring overview">
        <article className="employer-insight-card employer-quick-card">
          <div><span className="eyebrow">Next steps</span><h2>Keep hiring moving</h2><p>{nextStepsCopy}</p></div>
          <div>
            <Link to="/employer/applicants">Review applicants{newApplicantCount ? ` (${newApplicantCount})` : ""} <ArrowIcon/></Link>
            <Link to="/employer/appointments">Schedule interview{upcomingInterviewCount ? ` (${upcomingInterviewCount} upcoming)` : ""} <ArrowIcon/></Link>
          </div>
        </article>
      </section>

      {/* Portaled to <body>; the page's entrance transform would break position: fixed. */}
      {modal && ReactDOM.createPortal(
        <div className="employer-modal" role="dialog" aria-modal="true" aria-labelledby="employer-modal-title">
        <button className="employer-modal-backdrop" aria-label="Close dialog" onClick={() => setModal(null)}/>
        <section className="employer-modal-card" ref={modalCardRef}>
          <button className="employer-modal-close" type="button" onClick={() => setModal(null)} aria-label="Close">×</button>
          {modal.type === "form" && <form onSubmit={saveJob}>
            <span className="eyebrow">Job post</span><h2 id="employer-modal-title">{modal.job ? "Edit opportunity" : "Create an opportunity"}</h2>
            {formError && <p className="field-error">{formError}</p>}
            <label ref={(el) => (fieldRefs.current.title = el)}>Job title<input autoFocus value={form.title} onChange={(e) => updateField("title", e.target.value)} placeholder="e.g. Web Developer"/>{fieldErrors.title && <span className="field-error">{fieldErrors.title}</span>}</label>
            <div className="employer-form-grid">
              <label>Employment type<select value={form.jobType} onChange={(e) => updateField("jobType", e.target.value)}><option>Full-time</option><option>Part-time</option><option>Internship</option><option>Contract</option></select></label>
              <label ref={(el) => (fieldRefs.current.location = el)}>Location<input value={form.location} onChange={(e) => updateField("location", e.target.value)} placeholder="City, hybrid, or remote"/>{fieldErrors.location && <span className="field-error">{fieldErrors.location}</span>}</label>
            </div>
            {/* Editing: use the job's own linked company; archived partnerships are excluded from the list. */}
            <label>Posting as<input value={modal.job?.partnershipId?.name || partnerships[0]?.name || ""} readOnly disabled/></label>
            <label ref={(el) => (fieldRefs.current.salaryRange = el)}>Salary range<input value={form.salaryRange} onChange={(e) => updateField("salaryRange", e.target.value)} placeholder="e.g. ₱25,000 - ₱35,000 /month"/>{fieldErrors.salaryRange && <span className="field-error">{fieldErrors.salaryRange}</span>}</label>
            <label ref={(el) => (fieldRefs.current.jobDescription = el)}>Job description<textarea rows="4" value={form.jobDescription} onChange={(e) => updateField("jobDescription", e.target.value)} placeholder="Describe the role"/>{fieldErrors.jobDescription && <span className="field-error">{fieldErrors.jobDescription}</span>}</label>
            <label ref={(el) => (fieldRefs.current.keyResponsibilities = el)}>Key responsibilities<textarea rows="4" value={form.keyResponsibilities} onChange={(e) => updateField("keyResponsibilities", e.target.value)} placeholder="List the day-to-day duties"/>{fieldErrors.keyResponsibilities && <span className="field-error">{fieldErrors.keyResponsibilities}</span>}</label>
            <label ref={(el) => (fieldRefs.current.qualifications = el)}>Qualifications &amp; requirements<textarea rows="4" value={form.qualifications} onChange={(e) => updateField("qualifications", e.target.value)} placeholder="Education, experience, certifications"/>{fieldErrors.qualifications && <span className="field-error">{fieldErrors.qualifications}</span>}</label>
            <label ref={(el) => (fieldRefs.current.preferredSkills = el)}>Preferred skills (plus)<textarea rows="3" value={form.preferredSkills} onChange={(e) => updateField("preferredSkills", e.target.value)} placeholder="Nice-to-have skills"/>{fieldErrors.preferredSkills && <span className="field-error">{fieldErrors.preferredSkills}</span>}</label>
            <div className="employer-modal-actions"><button type="button" className="employer-secondary-btn" onClick={() => setModal(null)}>Cancel</button><button className="employer-primary-btn" type="submit" disabled={saving}>{saving ? "Saving…" : modal.job ? "Save changes" : "Publish post"}</button></div>
          </form>}
          {modal.type === "view" && <div>
            <span className="eyebrow">Job details</span><h2 id="employer-modal-title">{modal.job.title}</h2>
            <div className="employer-detail-grid">
              <div><span>Status</span><strong>{statusLabel(modal.job.status)}</strong></div>
              <div><span>Partnership</span><strong>{modal.job.partnershipId?.name || "—"}</strong></div>
              <div><span>Type</span><strong>{modal.job.jobType}</strong></div>
              <div><span>Location</span><strong>{modal.job.location || "—"}</strong></div>
              <div><span>Salary range</span><strong>{modal.job.salaryRange || "—"}</strong></div>
            </div>
            <p className="employer-detail-copy">{modal.job.jobDescription || "No description provided."}</p>
            {modal.job.keyResponsibilities && <><h3>Key Responsibilities</h3><p className="employer-detail-copy">{modal.job.keyResponsibilities}</p></>}
            {modal.job.qualifications && <><h3>Qualifications &amp; Requirements</h3><p className="employer-detail-copy">{modal.job.qualifications}</p></>}
            {modal.job.preferredSkills && <><h3>Preferred Skills (Plus)</h3><p className="employer-detail-copy">{modal.job.preferredSkills}</p></>}
            <div className="employer-modal-actions">{modal.job.status === "open" && <button className="employer-secondary-btn" type="button" onClick={() => setModal({ type: "close", job: modal.job })}>Close posting</button>}<button className="employer-secondary-btn" type="button" onClick={() => setModal(null)}>Cancel</button><button className="employer-primary-btn" type="button" onClick={() => openEdit(modal.job)}>Edit post</button></div>
          </div>}
          {modal.type === "close" && <div><span className="eyebrow">Close job post</span><h2 id="employer-modal-title">Close "{modal.job.title}"?</h2><p className="employer-detail-copy">New applicants won't be able to apply. This can't be undone, so make sure you're done hiring for this role.</p><div className="employer-modal-actions"><button className="employer-secondary-btn" type="button" onClick={() => setModal(null)}>Cancel</button><button className="employer-danger-btn" type="button" onClick={() => closeJobPost(modal.job)}>Close posting</button></div></div>}
          {modal.type === "delete" && <div><span className="eyebrow">Delete job post</span><h2 id="employer-modal-title">Remove "{modal.job.title}"?</h2><p className="employer-detail-copy">This permanently removes the post. This action cannot be undone.</p><div className="employer-modal-actions"><button className="employer-secondary-btn" type="button" onClick={() => setModal(null)}>Cancel</button><button className="employer-danger-btn" type="button" onClick={() => removeJob(modal.job._id)}>Delete post</button></div></div>}
        </section>
      </div>,
        document.body
      )}
    </div>
  );
}
