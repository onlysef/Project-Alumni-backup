import React, { useState } from "react";
import { nextId } from "../shared.js";
import Icon from "../Icon.jsx";
import { Dropdown, Modal } from "../Primitives.jsx";
import { adminMenuChoices } from "../data.js";

const staffSeed = [
  { name: "Jose Mari Chan", role: "Alumni Staff", status: "Available" },
  { name: "Jasterine Ibacca", role: "Alumni Coordinator", status: "On Leave" },
  { name: "Larsen Dignos", role: "Alumni Coordinator", status: "On Leave" },
  { name: "Andrea Bautista", role: "Secretary", status: "Available" },
];

const appointmentsSeed = [
  { dt: "April 14 - 1:00 pm", name: "Danica Macapagal", staff: "Andrea Bautista", status: "Pending" },
  { dt: "April 15 - 8:00 am", name: "Francisco Felicia", staff: "Jasterine Ibacca", status: "Pending" },
  { dt: "April 16 - 10:00 am", name: "Christy Dungon", staff: "Jose Mari Chan", status: "Pending" },
  { dt: "April 16 - 2:00 pm", name: "Christy Dungon", staff: "Larsen Dignos", status: "Pending" },
];

export default function AppointmentsView({ active, showToast }) {
  const [days, setDays] = useState({ M: true, T: false, W: true, TH: false, F: true, S: false });
  const [staff, setStaff] = useState(staffSeed.map((s) => ({ ...s, id: nextId() })));
  const [staffEditing, setStaffEditing] = useState(false);
  const [appointments, setAppointments] = useState(appointmentsSeed.map((a) => ({ ...a, id: nextId() })));
  const [apptEditing, setApptEditing] = useState(false);
  const [entry, setEntry] = useState(null); // {mode}

  const staffNames = staff.map((s) => s.name);

  function toggleDay(d) {
    setDays((prev) => ({ ...prev, [d]: !prev[d] }));
  }

  function setApptStatus(id, status) {
    setAppointments((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status, decision: status.toLowerCase() } : a))
    );
    const a = appointments.find((x) => x.id === id);
    showToast(`${a.name} appointment ${status.toLowerCase()}.`);
  }

  return (
    <section className={`content appointments-view view${active ? " active-view" : ""}`}>
      <div className="appointment-top-grid">
        <section className="appointment-card">
          <h3>Office Availability</h3>
          <div className="office-form">
            <label><span>Office Status:</span><select><option>Open</option><option>Closed</option></select></label>
            <label>
              <span>Office Hours:</span>
              <select><option>8:00 AM</option><option>9:00 AM</option></select>
              <select><option>5:00 PM</option><option>6:00 PM</option></select>
            </label>
            <label>
              <span>Days:</span>
              <div className="day-pills">
                {["M", "T", "W", "TH", "F", "S"].map((d) => (
                  <button key={d} type="button" className={days[d] ? "active" : undefined} onClick={() => toggleDay(d)}>
                    {d}
                  </button>
                ))}
              </div>
            </label>
          </div>
          <div className="office-actions">
            <button
              type="button"
              className="save-office"
              onClick={() => {
                const sel = Object.keys(days).filter((d) => days[d]).join(", ");
                showToast(`Office availability saved for ${sel || "no selected days"}.`);
              }}
            >
              Save
            </button>
            <button type="button" className="edit-office" onClick={() => showToast("Office availability is ready to edit.")}>
              Edit
            </button>
          </div>
        </section>

        <section className="appointment-card">
          <h3>Staff Management</h3>
          <div className={`staff-list${staffEditing ? " is-editing" : ""}`}>
            {staff.map((s) => (
              <div key={s.id}>
                <strong>{s.name}</strong>
                <span>{s.role}</span>
                <em>{s.status}</em>
                {staffEditing && (
                  <button
                    type="button"
                    className="delete-staff"
                    onClick={() => {
                      setStaff((prev) => prev.filter((x) => x.id !== s.id));
                      showToast(`${s.name} removed from staff.`);
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="staff-actions">
            <button
              type="button"
              className="edit-staff"
              aria-label="Edit staff"
              onClick={() => {
                setStaffEditing((e) => {
                  showToast(!e ? "Staff edit mode enabled." : "Staff edit mode closed.");
                  return !e;
                });
              }}
            >
              ✎
            </button>
            <button type="button" className="add-button" onClick={() => setEntry({ mode: "staff" })}>Add</button>
          </div>
        </section>
      </div>

      <section className={`appointments-card${apptEditing ? " is-editing" : ""}`}>
        <h3>Appointments</h3>
        <div className="appointments-table-wrap">
          <table className="appointments-table">
            <thead>
              <tr><th>Date &amp; Time</th><th>Name</th><th>Staff</th><th>Status</th><th>Action</th></tr>
            </thead>
            <tbody>
              {appointments.map((a) => (
                <tr key={a.id} className={a.decision === "approved" ? "is-approved" : a.decision === "rejected" ? "is-rejected" : ""}>
                  <td contentEditable={apptEditing} suppressContentEditableWarning>{a.dt}</td>
                  <td contentEditable={apptEditing} suppressContentEditableWarning>{a.name}</td>
                  <td>
                    {apptEditing ? (
                      <select
                        className="staff-select"
                        defaultValue={a.staff}
                        onChange={(e) =>
                          setAppointments((prev) => prev.map((x) => (x.id === a.id ? { ...x, staff: e.target.value } : x)))
                        }
                      >
                        {staffNames.map((n) => <option key={n}>{n}</option>)}
                      </select>
                    ) : (
                      a.staff
                    )}
                  </td>
                  <td contentEditable={apptEditing} suppressContentEditableWarning>{a.status}</td>
                  <td>
                    <button type="button" onClick={() => setApptStatus(a.id, "Approved")}>Approve</button>
                    <button type="button" onClick={() => setApptStatus(a.id, "Rejected")}>Reject</button>
                    {apptEditing && (
                      <button
                        type="button"
                        className="delete-appointment"
                        onClick={() => {
                          setAppointments((prev) => prev.filter((x) => x.id !== a.id));
                          showToast(`${a.name} appointment deleted.`);
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="appointments-footer">
          <button
            type="button"
            className="edit-office"
            onClick={() => {
              setApptEditing(true);
              showToast("Appointment rows are editable.");
            }}
          >
            Edit
          </button>
          <button
            type="button"
            className="save-office"
            onClick={() => {
              setApptEditing(false);
              showToast("Appointments saved.");
            }}
          >
            Save
          </button>
          <button type="button" className="add-button" onClick={() => setEntry({ mode: "appointment" })}>Add</button>
        </div>
      </section>

      <QuickEntryModal
        entry={entry}
        onClose={() => setEntry(null)}
        onSubmit={(data) => {
          if (entry.mode === "staff") {
            setStaff((prev) => [...prev, { id: nextId(), name: data.name, role: data.detail, status: data.status }]);
            showToast(`${data.name} added to staff.`);
          } else {
            setAppointments((prev) => [
              ...prev,
              { id: nextId(), dt: "New Schedule", name: data.name, staff: data.detail, status: data.status },
            ]);
            showToast(`${data.name} appointment added.`);
          }
          setEntry(null);
        }}
      />
    </section>
  );
}

function QuickEntryModal({ entry, onClose, onSubmit }) {
  return (
    <Modal open={!!entry} onClose={onClose}>
      <section className="tracer-modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{entry?.mode === "appointment" ? "Add Appointment" : "Add Staff"}</h3>
          <button type="button" aria-label="Close entry form" onClick={onClose}>×</button>
        </div>
        <form
          className="quick-entry-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = e.currentTarget.elements;
            onSubmit({ name: f.name.value, detail: f.detail.value, status: f.status.value });
          }}
        >
          <label>Name<input type="text" name="name" required /></label>
          <label>
            {entry?.mode === "appointment" ? "Staff" : "Role"}
            <input type="text" name="detail" required />
          </label>
          <label>
            Status
            <select name="status">
              <option>Available</option><option>On Leave</option><option>Pending</option>
            </select>
          </label>
          <div className="modal-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit">Save</button>
          </div>
        </form>
      </section>
    </Modal>
  );
}


