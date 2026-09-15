import React, { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import Icon from "../../components/common/Icon";
import { apiFetch } from "../../services/api.js";

const emptyForm = { applicationId: "", position: "", date: "", time: "", mode: "Face-to-face", location: "" };

function displayDate(value) {
  const [year, month, day] = value.split("-");
  return `${month}-${day}-${year}`;
}

function displayTime(value) {
  const [hour, minute] = value.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "pm" : "am"}`;
}

export default function EmployerAppointments() {
  const { showToast } = useOutletContext() || {};
  const [applicants, setApplicants] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [positionFilter, setPositionFilter] = useState("All");
  const [sent, setSent] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([apiFetch("/employer/applicants"), apiFetch("/employer/interviews")])
      .then(([a, i]) => {
        setApplicants(a.applicants || []);
        setAppointments(i.interviews || []);
      })
      .catch(() => showToast?.("Could not load the appointments page."))
      .finally(() => setLoading(false));
  }

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => appointments.filter((item) => {
    const query = search.trim().toLowerCase();
    return (!query || `${item.alumni_name} ${item.position} ${item.location}`.toLowerCase().includes(query))
      && (!dateFilter || item.date === dateFilter)
      && (statusFilter === "All" || item.status === statusFilter)
      && (positionFilter === "All" || item.position === positionFilter);
  }), [appointments, search, dateFilter, statusFilter, positionFilter]);

  const schedulableApplicants = useMemo(() => applicants.filter((item) => item.employerStatus !== "Rejected"), [applicants]);

  function selectApplicant(applicationId) {
    const candidate = applicants.find((item) => item._id === applicationId);
    setForm((current) => ({ ...current, applicationId, position: candidate?.title || "" }));
  }

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    try {
      if (editingId) {
        const { interview } = await apiFetch(`/employer/interviews/${editingId}`, {
          method: "PATCH",
          body: { date: form.date, time: form.time, mode: form.mode, location: form.location },
        });
        setAppointments((current) => current.map((item) => item._id === editingId ? interview : item));
      } else {
        const { interview } = await apiFetch("/employer/interviews", {
          method: "POST",
          body: { application_id: form.applicationId, date: form.date, time: form.time, mode: form.mode, location: form.location },
        });
        setAppointments((current) => [interview, ...current]);
      }
      setForm(emptyForm); setEditingId(null); setSent(true);
      window.setTimeout(() => setSent(false), 2400);
    } catch (err) {
      showToast?.(err.message || "Could not save this appointment.");
    } finally {
      setSubmitting(false);
    }
  }

  function edit(item) {
    setForm({ applicationId: item.application_id, position: item.position, date: item.date, time: item.time, mode: item.mode, location: item.location });
    setEditingId(item._id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function cancelAppointment(item) {
    if (!window.confirm(`Cancel the interview with ${item.alumni_name}?`)) return;
    try {
      const { interview } = await apiFetch(`/employer/interviews/${item._id}/cancel`, { method: "PATCH" });
      setAppointments((current) => current.map((row) => row._id === item._id ? interview : row));
    } catch (err) {
      showToast?.(err.message || "Could not cancel this appointment.");
    }
  }

  async function removeAppointment(item) {
    if (!window.confirm(`Delete the interview with ${item.alumni_name}? This can't be undone.`)) return;
    try {
      await apiFetch(`/employer/interviews/${item._id}`, { method: "DELETE" });
      setAppointments((current) => current.filter((row) => row._id !== item._id));
      if (editingId === item._id) cancelEdit();
    } catch (err) {
      showToast?.(err.message || "Could not delete this appointment.");
    }
  }

  const positions = [...new Set(appointments.map((item) => item.position))];

  return <div className="employer-page appointments-page">
    <section className="employer-toolbar appointments-toolbar" aria-label="Filter appointments">
      <label className="employer-search"><span className="sr-only">Search appointments</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search applicant or position"/><span>⌕</span></label>
      <label className="compact-date-filter"><span>Date</span><input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}/></label>
      <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Appointment status"><option value="All">All statuses</option><option>Upcoming</option><option>Completed</option><option>Cancelled</option></select>
      <select value={positionFilter} onChange={(event) => setPositionFilter(event.target.value)} aria-label="Position"><option value="All">All positions</option>{positions.map((item) => <option key={item}>{item}</option>)}</select>
    </section>

    <section className="appointment-composer">
      <div><span className="eyebrow">Interview scheduler</span><h2>{editingId ? "Update appointment" : "Schedule an appointment"}</h2><p>Choose a candidate and send interview details.</p></div>
      <form onSubmit={submit}>
        <div className="employer-form-grid">
          <label>Applicant
            <select value={form.applicationId} onChange={(event) => selectApplicant(event.target.value)} required disabled={!!editingId}>
              <option value="">{schedulableApplicants.length ? "Select applicant" : "No applicants yet"}</option>
              {schedulableApplicants.map((item) => <option key={item._id} value={item._id}>{item.alumni_id ? `${item.alumni_id.firstName} ${item.alumni_id.lastName}` : "Unknown"} — {item.title}</option>)}
            </select>
          </label>
          <label>Position<input value={form.position} readOnly placeholder="Filled from applicant"/></label>
        </div>
        <div className="appointment-form-row">
          <label>Date<input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} required/></label>
          <label>Time<input type="time" value={form.time} onChange={(event) => setForm({ ...form, time: event.target.value })} required/></label>
          <label>Mode<select value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value })}><option>Face-to-face</option><option>Online</option></select></label>
          <label>Location / link<input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder={form.mode === "Online" ? "Meeting link" : "Office or room"} required/></label>
        </div>
        <div className="appointment-form-actions">
          {editingId && <button className="employer-secondary-btn" type="button" onClick={cancelEdit}>Cancel edit</button>}
          <button className="employer-primary-btn" type="submit" disabled={submitting}>{editingId ? "Save changes" : "Send invitation"} <span>➤</span></button>
        </div>
      </form>
      {sent && <div className="employer-toast">{editingId ? "Appointment updated." : "Invitation sent to the applicant's email."}</div>}
    </section>

    <section className="employer-panel appointment-list-panel">
      <div className="employer-panel-heading"><div><span className="eyebrow">Interview calendar</span><h2>Appointments</h2></div><span>{filtered.length} scheduled</span></div>
      <div className="employer-table-wrap"><table className="employer-table appointment-table"><thead><tr><th>Applicant</th><th>Position</th><th>Date</th><th>Time</th><th>Mode</th><th>Status</th><th>Action</th></tr></thead><tbody>
        {loading && <tr><td colSpan="7"><div className="employer-empty">Loading appointments…</div></td></tr>}
        {!loading && filtered.map((item) => <tr key={item._id}>
          <td data-label="Applicant"><strong>{item.alumni_name}</strong><small>{item.location}</small></td>
          <td data-label="Position">{item.position}</td>
          <td data-label="Date">{displayDate(item.date)}</td>
          <td data-label="Time">{displayTime(item.time)}</td>
          <td data-label="Mode">{item.mode}</td>
          <td data-label="Status"><span className={`employer-badge appointment-${item.status.toLowerCase()}`}>{item.status}</span></td>
          <td data-label="Action"><div className="employer-row-actions">
            {item.status === "Upcoming" && <button type="button" aria-label={`Edit appointment for ${item.alumni_name}`} onClick={() => edit(item)}><Icon name="icon-edit"/></button>}
            {item.status === "Upcoming" && <button type="button" className="appointment-cancel-btn" aria-label={`Cancel appointment for ${item.alumni_name}`} onClick={() => cancelAppointment(item)}>✕</button>}
            <button type="button" aria-label={`Delete appointment for ${item.alumni_name}`} onClick={() => removeAppointment(item)}><Icon name="icon-delete"/></button>
          </div></td>
        </tr>)}
        {!loading && !filtered.length && <tr><td colSpan="7"><div className="employer-empty">No appointments match your filters.</div></td></tr>}
      </tbody></table></div>
    </section>
  </div>;
}
