import React, { useState } from "react";
import Icon from "../SimpleIcon.jsx";
import { initialRecords, downloadCsv } from "./coordinatorShared.jsx";

export default function EventParticipation({ active, showToast }) {
  const [records, setRecords] = useState(initialRecords);
  const [form, setForm] = useState({ event: "CCS Alumni Career Talk 2026", name: "", idNo: "", course: "BSIT", timeIn: "1:00 PM", status: "Present" });
  const feedbackCount = records.filter((record) => record.feedback).length;

  function recordAttendance(e) {
    e.preventDefault();
    if (!form.name.trim()) {
      showToast("Enter the alumni name first.");
      return;
    }
    setRecords((prev) => [
      ...prev,
      { id: Date.now(), name: form.name, course: form.course, timeIn: form.timeIn, feedback: false },
    ]);
    setForm((prev) => ({ ...prev, name: "", idNo: "" }));
    showToast("Attendance recorded.");
  }

  return (
    <section className={`content coordinator-content view${active ? " active-view" : ""}`}>
      <div className="coord-participation-grid">
        <form className="coord-attendance-card" onSubmit={recordAttendance}>
          <h3>Attendance Log</h3>
          <label>Event:<select value={form.event} onChange={(e) => setForm((p) => ({ ...p, event: e.target.value }))}><option>CCS Alumni Career Talk 2026</option><option>Alumni Meetup and Industry Forum</option></select></label>
          <label>Name:<input placeholder="Search/select alumni" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} /></label>
          <div className="coord-form-row">
            <label>ID No.<input value={form.idNo} onChange={(e) => setForm((p) => ({ ...p, idNo: e.target.value }))} placeholder="2021-123456" /></label>
            <label>Course:<select value={form.course} onChange={(e) => setForm((p) => ({ ...p, course: e.target.value }))}><option>BSIT</option><option>BSCS</option><option>BSIS</option></select></label>
          </div>
          <div className="coord-form-row">
            <label>Time In:<input value={form.timeIn} onChange={(e) => setForm((p) => ({ ...p, timeIn: e.target.value }))} /></label>
            <label>Status:<select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}><option>Present</option><option>Late</option><option>Excused</option></select></label>
          </div>
          <button type="submit">Record Attendance</button>
        </form>

        <aside className="coord-current-status">
          <div className="coord-status-grid">
            <strong>{records.length}<span>Attendees</span></strong>
            <strong>{feedbackCount}<span>Feedbacks</span></strong>
            <strong>100<span>Capacity</span></strong>
            <strong>{Math.round((records.length / 100) * 100)}%<span>Rate</span></strong>
          </div>
          <p>Top Course Attending: BSIT<br />Lowest Participation: BSCS</p>
        </aside>
      </div>

      <section className="coord-records-card">
        <h3>Event Records</h3>
        <div className="coord-record-toolbar">
          <select><option>CCS Alumni Career Talk (May 15, 2026)</option></select>
        </div>
        <table>
          <thead><tr><th>Name</th><th>Course</th><th>Time In</th><th>Feedback</th></tr></thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.id}>
                <td>{record.name}</td>
                <td>{record.course}</td>
                <td>{record.timeIn}</td>
                <td>{record.feedback ? "Yes" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="coord-record-actions">
          <button type="button" onClick={() => {
            downloadCsv("event-attendance.csv", [["Name", "Course", "Time In", "Feedback"], ...records.map((r) => [r.name, r.course, r.timeIn, r.feedback ? "Yes" : "No"])]);
            showToast("Attendance exported.");
          }}>Export Attendance</button>
          <button type="button">View Event</button>
        </div>
      </section>
    </section>
  );
}