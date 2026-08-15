import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../../components/common/Icon";

const seedJobs = [
  { id: 1, title: "Web Developer", status: "Active", date: "2026-03-06", applicants: 12, fresh: 2, type: "Full-time", location: "Tarlac City", description: "Build and maintain responsive web applications for our growing team." },
  { id: 2, title: "UI / UX Designer", status: "Active", date: "2026-04-16", applicants: 10, fresh: 0, type: "Full-time", location: "Hybrid", description: "Create accessible, user-centered experiences across our digital products." },
  { id: 3, title: "IT Support Specialist", status: "Closed", date: "2026-02-18", applicants: 18, fresh: 0, type: "Contract", location: "Tarlac City", description: "Support internal teams, devices, and office systems." },
];

const emptyForm = { title: "", type: "Full-time", location: "", description: "" };

function prettyDate(value) {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "2-digit", year: "numeric" }).format(new Date(`${value}T00:00:00`));
}

export default function EmployerDashboard() {
  const [jobs, setJobs] = useState(seedJobs);
  const [status, setStatus] = useState("All");
  const [date, setDate] = useState("All");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const filtered = useMemo(() => jobs.filter((job) => {
    const statusMatch = status === "All" || job.status === status;
    const dateMatch = date === "All" || job.date.startsWith(date);
    const query = search.trim().toLowerCase();
    return statusMatch && dateMatch && (!query || `${job.title} ${job.location} ${job.type}`.toLowerCase().includes(query));
  }), [jobs, status, date, search]);

  const activeCount = jobs.filter((job) => job.status === "Active").length;
  const applicantCount = jobs.reduce((sum, job) => sum + job.applicants, 0);
  const newCount = jobs.reduce((sum, job) => sum + job.fresh, 0);

  function openCreate() {
    setForm(emptyForm);
    setModal({ type: "form", job: null });
  }

  function openEdit(job) {
    setForm({ title: job.title, type: job.type, location: job.location, description: job.description });
    setModal({ type: "form", job });
  }

  function saveJob(event) {
    event.preventDefault();
    if (!form.title.trim()) return;
    if (modal?.job) {
      setJobs((current) => current.map((job) => job.id === modal.job.id ? { ...job, ...form } : job));
    } else {
      setJobs((current) => [{ id: Date.now(), ...form, status: "Active", date: new Date().toISOString().slice(0, 10), applicants: 0, fresh: 0 }, ...current]);
    }
    setModal(null);
  }

  function removeJob(id) {
    setJobs((current) => current.filter((job) => job.id !== id));
    setModal(null);
  }

  return (
    <div className="employer-page employer-jobs-page">
      <section className="employer-stats" aria-label="Job post overview">
        <article><span>Active job posts</span><strong>{activeCount}</strong><small>Currently accepting applicants</small></article>
        <article><span>Total applicants</span><strong>{applicantCount}</strong><small>Across all job posts</small></article>
        <article><span>New applicants</span><strong>{newCount}</strong><small>Waiting for your review</small></article>
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
              {filtered.map((job) => <tr key={job.id}>
                <td><button className="employer-title-link" type="button" onClick={() => setModal({ type: "view", job })}>{job.title}</button><small>{job.type} · {job.location}</small></td>
                <td><span className={`employer-badge ${job.status.toLowerCase()}`}>{job.status}</span></td>
                <td>{prettyDate(job.date)}</td>
                <td><strong>{job.applicants}</strong>{job.fresh > 0 && <span className="new-applicant-pill">{job.fresh} new</span>}</td>
                <td><div className="employer-row-actions"><button type="button" aria-label={`View ${job.title}`} onClick={() => setModal({ type: "view", job })}><Icon name="icon-view"/></button><button type="button" aria-label={`Edit ${job.title}`} onClick={() => openEdit(job)}><Icon name="icon-edit"/></button><button type="button" aria-label={`Delete ${job.title}`} onClick={() => setModal({ type: "delete", job })}><Icon name="icon-delete"/></button></div></td>
              </tr>)}
              {!filtered.length && <tr><td colSpan="5"><div className="employer-empty">No job posts match your filters.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <button className="employer-primary-btn create-job-btn" type="button" onClick={openCreate}><span>＋</span> Create post</button>

      <section className="employer-dashboard-lower" aria-label="Hiring overview">
        <article className="employer-insight-card">
          <div className="employer-insight-heading"><div><span className="eyebrow">Hiring pipeline</span><h2>Applicant progress</h2></div><strong>{applicantCount}</strong></div>
          <div className="employer-pipeline-bar" aria-label={`${newCount} new applicants out of ${applicantCount}`}><span style={{ width: `${applicantCount ? Math.max(10, (newCount / applicantCount) * 100) : 0}%` }}/></div>
          <div className="employer-pipeline-legend"><span><i className="is-new"/>New review <b>{newCount}</b></span><span><i className="is-active"/>Active posts <b>{activeCount}</b></span><span><i className="is-total"/>All applicants <b>{applicantCount}</b></span></div>
        </article>
        <article className="employer-insight-card employer-quick-card">
          <div><span className="eyebrow">Next steps</span><h2>Keep hiring moving</h2><p>Review new candidates or arrange the next interview.</p></div>
          <div><Link to="/employer/applicants">Review applicants <span>→</span></Link><Link to="/employer/appointments">Schedule interview <span>→</span></Link></div>
        </article>
      </section>

      {modal && <div className="employer-modal" role="dialog" aria-modal="true" aria-labelledby="employer-modal-title">
        <button className="employer-modal-backdrop" aria-label="Close dialog" onClick={() => setModal(null)}/>
        <section className="employer-modal-card">
          <button className="employer-modal-close" type="button" onClick={() => setModal(null)} aria-label="Close">×</button>
          {modal.type === "form" && <form onSubmit={saveJob}>
            <span className="eyebrow">Job post</span><h2 id="employer-modal-title">{modal.job ? "Edit opportunity" : "Create an opportunity"}</h2>
            <label>Job title<input autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Web Developer" required/></label>
            <div className="employer-form-grid"><label>Employment type<select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option>Full-time</option><option>Part-time</option><option>Internship</option><option>Contract</option></select></label><label>Location<input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="City, hybrid, or remote"/></label></div>
            <label>Description<textarea rows="4" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Describe the role and responsibilities"/></label>
            <div className="employer-modal-actions"><button type="button" className="employer-secondary-btn" onClick={() => setModal(null)}>Cancel</button><button className="employer-primary-btn" type="submit">{modal.job ? "Save changes" : "Publish post"}</button></div>
          </form>}
          {modal.type === "view" && <div><span className="eyebrow">Job details</span><h2 id="employer-modal-title">{modal.job.title}</h2><div className="employer-detail-grid"><div><span>Status</span><strong>{modal.job.status}</strong></div><div><span>Applicants</span><strong>{modal.job.applicants}</strong></div><div><span>Type</span><strong>{modal.job.type}</strong></div><div><span>Location</span><strong>{modal.job.location}</strong></div></div><p className="employer-detail-copy">{modal.job.description}</p><div className="employer-modal-actions"><button className="employer-secondary-btn" type="button" onClick={() => setModal(null)}>Close</button><button className="employer-primary-btn" type="button" onClick={() => openEdit(modal.job)}>Edit post</button></div></div>}
          {modal.type === "delete" && <div><span className="eyebrow">Delete job post</span><h2 id="employer-modal-title">Remove “{modal.job.title}”?</h2><p className="employer-detail-copy">This removes the post from this preview. This action cannot be undone.</p><div className="employer-modal-actions"><button className="employer-secondary-btn" type="button" onClick={() => setModal(null)}>Cancel</button><button className="employer-danger-btn" type="button" onClick={() => removeJob(modal.job.id)}>Delete post</button></div></div>}
        </section>
      </div>}
    </div>
  );
}
