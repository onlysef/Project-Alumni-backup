import React, { useState, useEffect } from "react";
import { useAuth } from "../auth/AuthContext";

const API = "http://localhost:5000/api";

function authHeaders() {
  const token = localStorage.getItem("auth_token");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

export default function EmployerDashboard() {
  const { user, logout } = useAuth();
  const [jobs, setJobs]               = useState([]);
  const [partnerships, setPartnerships] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [formOpen, setFormOpen]       = useState(false);
  const [toast, setToast]             = useState("");

  useEffect(() => {
    Promise.all([fetchJobs(), fetchPartnerships()]).finally(() => setLoading(false));
  }, []);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  async function fetchJobs() {
    try {
      const res  = await fetch(`${API}/employer/jobs`, { headers: authHeaders() });
      const data = await res.json();
      if (res.ok) setJobs(data.jobs);
    } catch { /* ignore */ }
  }

  async function fetchPartnerships() {
    try {
      const res  = await fetch(`${API}/employer/partnerships`, { headers: authHeaders() });
      const data = await res.json();
      if (res.ok) setPartnerships(data.partnerships);
    } catch { /* ignore */ }
  }

  async function handlePostJob(formData) {
    try {
      const res  = await fetch(`${API}/employer/jobs`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.message || "Failed to post job."); return; }
      setJobs((prev) => [data.job, ...prev]);
      setFormOpen(false);
      showToast("Job posted successfully.");
    } catch { showToast("Could not connect to server."); }
  }

  async function handleClose(jobId) {
    try {
      const res = await fetch(`${API}/employer/jobs/${jobId}/close`, {
        method: "PATCH", headers: authHeaders(),
      });
      if (!res.ok) { showToast("Failed to close job."); return; }
      setJobs((prev) => prev.map((j) => j._id === jobId ? { ...j, status: "closed" } : j));
      showToast("Job closed.");
    } catch { showToast("Could not connect to server."); }
  }

  async function handleDelete(jobId) {
    try {
      const res = await fetch(`${API}/employer/jobs/${jobId}`, {
        method: "DELETE", headers: authHeaders(),
      });
      if (!res.ok) { showToast("Failed to delete job."); return; }
      setJobs((prev) => prev.filter((j) => j._id !== jobId));
      showToast("Job deleted.");
    } catch { showToast("Could not connect to server."); }
  }

  const openCount   = jobs.filter((j) => j.status === "open").length;
  const closedCount = jobs.filter((j) => j.status === "closed").length;

  return (
    <div className="employer-dashboard">
      {toast && <div className="employer-toast">{toast}</div>}

      <header className="employer-header">
        <div>
          <h1>Employer Portal</h1>
          <p>Welcome, <strong>{user?.firstName} {user?.lastName}</strong></p>
        </div>
        <button className="employer-logout" onClick={logout}>Logout</button>
      </header>

      <div className="employer-kpis">
        <div className="employer-kpi">
          <strong>{openCount}</strong>
          <span>Open Jobs</span>
        </div>
        <div className="employer-kpi">
          <strong>{closedCount}</strong>
          <span>Closed Jobs</span>
        </div>
        <div className="employer-kpi">
          <strong>{partnerships.length}</strong>
          <span>Partner Organizations</span>
        </div>
      </div>

      <div className="employer-section">
        <div className="employer-section-head">
          <h2>Job Postings</h2>
          <button className="employer-post-btn" onClick={() => setFormOpen(true)}>
            + Post a Job
          </button>
        </div>

        {formOpen && (
          <PostJobForm
            partnerships={partnerships}
            onSubmit={handlePostJob}
            onCancel={() => setFormOpen(false)}
          />
        )}

        {loading ? (
          <p>Loading...</p>
        ) : jobs.length === 0 ? (
          <p className="employer-empty">No jobs posted yet. Click "Post a Job" to get started.</p>
        ) : (
          <div className="employer-job-list">
            {jobs.map((j) => (
              <div key={j._id} className={`employer-job-card ${j.status === "closed" ? "is-closed" : ""}`}>
                <div className="employer-job-info">
                  <strong>{j.title}</strong>
                  <span className="employer-job-meta">
                    {j.partnershipId?.name} &middot; {j.jobType} &middot; {j.location || "Remote"}
                  </span>
                  {j.description && <p className="employer-job-desc">{j.description}</p>}
                </div>
                <div className="employer-job-actions">
                  <span className={`employer-badge ${j.status === "open" ? "badge-open" : "badge-closed"}`}>
                    {j.status === "open" ? "Open" : "Closed"}
                  </span>
                  {j.status === "open" && (
                    <button onClick={() => handleClose(j._id)}>Close</button>
                  )}
                  <button onClick={() => handleDelete(j._id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PostJobForm({ partnerships, onSubmit, onCancel }) {
  const [form, setForm] = useState({
    title: "", description: "", partnershipId: partnerships[0]?._id || "",
    jobType: "Full-time", location: "",
  });

  function set(key, val) { setForm((f) => ({ ...f, [key]: val })); }

  return (
    <form
      className="employer-post-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!form.partnershipId) return;
        onSubmit(form);
      }}
    >
      <h3>New Job Posting</h3>
      <label>Job Title
        <input
          type="text" required value={form.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="e.g. Software Engineer Intern"
        />
      </label>
      <label>Partner Organization
        <select value={form.partnershipId} onChange={(e) => set("partnershipId", e.target.value)} required>
          <option value="">Select a partner...</option>
          {partnerships.map((p) => (
            <option key={p._id} value={p._id}>{p.name} ({p.type})</option>
          ))}
        </select>
      </label>
      <label>Job Type
        <select value={form.jobType} onChange={(e) => set("jobType", e.target.value)}>
          <option>Full-time</option>
          <option>Part-time</option>
          <option>Internship</option>
          <option>Contract</option>
        </select>
      </label>
      <label>Location
        <input
          type="text" value={form.location}
          onChange={(e) => set("location", e.target.value)}
          placeholder="e.g. Makati, Metro Manila or Remote"
        />
      </label>
      <label>Description
        <textarea
          rows={3} value={form.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="Brief description of the role..."
        />
      </label>
      <div className="employer-form-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit">Post Job</button>
      </div>
    </form>
  );
}
