import React, { useMemo, useState } from "react";
import Icon from "../../components/common/Icon";

const candidates = [
  { name: "Juan Dela Cruz", position: "Web Developer" },
  { name: "Maria Suarez", position: "UI / UX Designer" },
  { name: "Angela Reyes", position: "Web Developer" },
  { name: "Paolo Santos", position: "IT Support Specialist" },
];

const initialAppointments = [
  { id: 1, applicant: "Juan Dela Cruz", position: "Web Developer", date: "2026-04-20", time: "13:00", mode: "Face-to-face", location: "TSU Alumni Office", status: "Upcoming" },
  { id: 2, applicant: "Maria Suarez", position: "UI / UX Designer", date: "2026-04-10", time: "10:00", mode: "Online", location: "Google Meet", status: "Completed" },
];

const emptyForm = { applicant: "", position: "", date: "", time: "", mode: "Face-to-face", location: "" };

function displayDate(value) {
  const [year, month, day] = value.split("-");
  return `${month}-${day}-${year}`;
}

function displayTime(value) {
  const [hour, minute] = value.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "pm" : "am"}`;
}

export default function EmployerAppointments() {
  const [appointments, setAppointments] = useState(initialAppointments);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [positionFilter, setPositionFilter] = useState("All");
  const [sent, setSent] = useState(false);

  const filtered = useMemo(() => appointments.filter((item) => {
    const query = search.trim().toLowerCase();
    return (!query || `${item.applicant} ${item.position} ${item.location}`.toLowerCase().includes(query))
      && (!dateFilter || item.date === dateFilter)
      && (statusFilter === "All" || item.status === statusFilter)
      && (positionFilter === "All" || item.position === positionFilter);
  }), [appointments, search, dateFilter, statusFilter, positionFilter]);

  function selectApplicant(name) {
    const candidate = candidates.find((item) => item.name === name);
    setForm((current) => ({ ...current, applicant: name, position: candidate?.position || "" }));
  }

  function submit(event) {
    event.preventDefault();
    if (editingId) {
      setAppointments((current) => current.map((item) => item.id === editingId ? { ...item, ...form } : item));
    } else {
      setAppointments((current) => [...current, { id: Date.now(), ...form, status: "Upcoming" }]);
    }
    setForm(emptyForm); setEditingId(null); setSent(true);
    window.setTimeout(() => setSent(false), 2400);
  }

  function edit(item) {
    setForm({ applicant: item.applicant, position: item.position, date: item.date, time: item.time, mode: item.mode, location: item.location });
    setEditingId(item.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
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
        <div className="employer-form-grid"><label>Applicant<select value={form.applicant} onChange={(event) => selectApplicant(event.target.value)} required><option value="">Select applicant</option>{candidates.map((item) => <option key={item.name}>{item.name}</option>)}</select></label><label>Position<input value={form.position} readOnly placeholder="Filled from applicant"/></label></div>
        <div className="appointment-form-row"><label>Date<input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} required/></label><label>Time<input type="time" value={form.time} onChange={(event) => setForm({ ...form, time: event.target.value })} required/></label><label>Mode<select value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value })}><option>Face-to-face</option><option>Online</option></select></label><label>Location / link<input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder={form.mode === "Online" ? "Meeting link" : "Office or room"} required/></label></div>
        <div className="appointment-form-actions">{editingId && <button className="employer-secondary-btn" type="button" onClick={() => { setEditingId(null); setForm(emptyForm); }}>Cancel edit</button>}<button className="employer-primary-btn" type="submit">{editingId ? "Save changes" : "Send invitation"} <span>➤</span></button></div>
      </form>
      {sent && <div className="employer-toast">Appointment invitation saved.</div>}
    </section>

    <section className="employer-panel appointment-list-panel"><div className="employer-panel-heading"><div><span className="eyebrow">Interview calendar</span><h2>Appointments</h2></div><span>{filtered.length} scheduled</span></div><div className="employer-table-wrap"><table className="employer-table appointment-table"><thead><tr><th>Applicant</th><th>Position</th><th>Date</th><th>Time</th><th>Mode</th><th>Status</th><th>Action</th></tr></thead><tbody>
      {filtered.map((item) => <tr key={item.id}><td><strong>{item.applicant}</strong><small>{item.location}</small></td><td>{item.position}</td><td>{displayDate(item.date)}</td><td>{displayTime(item.time)}</td><td>{item.mode}</td><td><span className={`employer-badge appointment-${item.status.toLowerCase()}`}>{item.status}</span></td><td><div className="employer-row-actions"><button type="button" aria-label={`Edit appointment for ${item.applicant}`} onClick={() => edit(item)}><Icon name="icon-edit"/></button><button type="button" aria-label={`Delete appointment for ${item.applicant}`} onClick={() => setAppointments((current) => current.filter((row) => row.id !== item.id))}><Icon name="icon-delete"/></button></div></td></tr>)}
      {!filtered.length && <tr><td colSpan="7"><div className="employer-empty">No appointments match your filters.</div></td></tr>}
    </tbody></table></div></section>
  </div>;
}
