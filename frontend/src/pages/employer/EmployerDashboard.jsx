import React, { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import Icon from "../../components/common/Icon";
import { apiFetch } from "../../services/api.js";

const emptyForm = { title: "", jobType: "Full-time", location: "", description: "" };

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

let cachedEmployerData = null;

export default function EmployerDashboard() {
  const { showToast } = useOutletContext() || {};
  const [jobs, setJobs] = useState(cachedEmployerData?.jobs ?? []);
  const [partnerships, setPartnerships] = useState(cachedEmployerData?.partnerships ?? []);
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
          applicants: applicantsData.applicants ?? [],
          interviews: interviewsData.interviews ?? [],
        };
        cachedEmployerData = next;
        setJobs(next.jobs);
        setPartnerships(next.partnerships);
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
    setModal({ type: "form", job: null });
  }

  function openEdit(job) {
    setForm({
      title: job.title,
      jobType: job.jobType,
      location: job.location || "",
      description: job.description || "",
    });
    setModal({ type: "form", job });
  }

  async function saveJob(event) {
    event.preventDefault();
    if (!form.title.trim()) return;
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
      showToast?.(err.message || "Could not save this job post.");
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
                <td data-label="Actions"><div className="employer-row-actions"><button type="button" aria-label={`View ${job.title}`} onClick={() => setModal({ type: "view", job })}><Icon name="icon-view"/></button><button type="button" aria-label={`Edit ${job.title}`} onClick={() => openEdit(job)}><Icon name="icon-edit"/></button><button type="button" aria-label={`Delete ${job.title}`} onClick={() => setModal({ type: "delete", job })}><Icon name="icon-delete"/></button></div></td>
              </tr>)}
              {!loading && !error && !filtered.length && <tr><td colSpan="5"><div className="employer-empty">No job posts match your filters.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <button className="employer-primary-btn create-job-btn" type="button" onClick={openCreate} disabled={loading || !partnerships.length} title={!loading && !partnerships.length ? "No active partnership on file yet — contact the admin office." : undefined}><span>＋</span> Create post</button>

      <section className="employer-dashboard-lower" aria-label="Hiring overview">
        <article className="employer-insight-card employer-quick-card">
          <div><span className="eyebrow">Next steps</span><h2>Keep hiring moving</h2><p>{nextStepsCopy}</p></div>
          <div>
            <Link to="/employer/applicants">Review applicants{newApplicantCount ? ` (${newApplicantCount})` : ""} <ArrowIcon/></Link>
            <Link to="/employer/appointments">Schedule interview{upcomingInterviewCount ? ` (${upcomingInterviewCount} upcoming)` : ""} <ArrowIcon/></Link>
          </div>
        </article>
      </section>

      {modal && <div className="employer-modal" role="dialog" aria-modal="true" aria-labelledby="employer-modal-title">
        <button className="employer-modal-backdrop" aria-label="Close dialog" onClick={() => setModal(null)}/>
        <section className="employer-modal-card">
          <button className="employer-modal-close" type="button" onClick={() => setModal(null)} aria-label="Close">×</button>
          {modal.type === "form" && <form onSubmit={saveJob}>
            <span className="eyebrow">Job post</span><h2 id="employer-modal-title">{modal.job ? "Edit opportunity" : "Create an opportunity"}</h2>
            <label>Job title<input autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Web Developer" required/></label>
            <div className="employer-form-grid">
              <label>Employment type<select value={form.jobType} onChange={(e) => setForm({ ...form, jobType: e.target.value })}><option>Full-time</option><option>Part-time</option><option>Internship</option><option>Contract</option></select></label>
              <label>Location<input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="City, hybrid, or remote"/></label>
            </div>
            <label>Posting as<input value={partnerships[0]?.name || ""} readOnly disabled/></label>
            <label>Description<textarea rows="4" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Describe the role and responsibilities"/></label>
            <div className="employer-modal-actions"><button type="button" className="employer-secondary-btn" onClick={() => setModal(null)}>Cancel</button><button className="employer-primary-btn" type="submit" disabled={saving}>{saving ? "Saving…" : modal.job ? "Save changes" : "Publish post"}</button></div>
          </form>}
          {modal.type === "view" && <div><span className="eyebrow">Job details</span><h2 id="employer-modal-title">{modal.job.title}</h2><div className="employer-detail-grid"><div><span>Status</span><strong>{statusLabel(modal.job.status)}</strong></div><div><span>Partnership</span><strong>{modal.job.partnershipId?.name || "—"}</strong></div><div><span>Type</span><strong>{modal.job.jobType}</strong></div><div><span>Location</span><strong>{modal.job.location || "—"}</strong></div></div><p className="employer-detail-copy">{modal.job.description || "No description provided."}</p><div className="employer-modal-actions">{modal.job.status === "open" && <button className="employer-secondary-btn" type="button" onClick={() => closeJobPost(modal.job)}>Close posting</button>}<button className="employer-secondary-btn" type="button" onClick={() => setModal(null)}>Close</button><button className="employer-primary-btn" type="button" onClick={() => openEdit(modal.job)}>Edit post</button></div></div>}
          {modal.type === "delete" && <div><span className="eyebrow">Delete job post</span><h2 id="employer-modal-title">Remove "{modal.job.title}"?</h2><p className="employer-detail-copy">This permanently removes the post. This action cannot be undone.</p><div className="employer-modal-actions"><button className="employer-secondary-btn" type="button" onClick={() => setModal(null)}>Cancel</button><button className="employer-danger-btn" type="button" onClick={() => removeJob(modal.job._id)}>Delete post</button></div></div>}
        </section>
      </div>}
    </div>
  );
}
