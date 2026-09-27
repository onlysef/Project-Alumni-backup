import React, { useState, useEffect, useRef } from "react";
import { useOutletContext } from "react-router-dom";
import { Modal } from "../../components/common/Primitives.jsx";
import ActionMenu from "../../components/admin/ActionMenu.jsx";
import Icon from "../../components/common/Icon.jsx";
import { API, authHeaders } from "../../services/api.js";
import { getHolidaysForMonth, PHILIPPINES_HOLIDAYS } from "../../constants/holidays.js";

// "HH:MM" (24-h) → "8:00 AM"
function fmt24to12(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ampm = h < 12 ? "AM" : "PM";
  const h12  = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

// "YYYY-MM-DD" → "Apr 14, 2024"  (avoids UTC-shift by using local Date)
function fmtDate(d) {
  if (!d) return "";
  const [y, mo, day] = d.split("-").map(Number);
  return new Date(y, mo - 1, day).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function fmtDateTime(date, time) {
  if (!date) return "—";
  return `${fmtDate(date)} · ${fmt24to12(time)}`;
}

// Generate half-hour time slots between start and end (exclusive)
function generateTimeSlots(start = "08:00", end = "17:00") {
  const slots = [];
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const endMin = eh * 60 + em;
  let cur = sh * 60 + sm;
  while (cur < endMin) {
    const h   = Math.floor(cur / 60);
    const m   = cur % 60;
    const val = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    slots.push({ value: val, label: fmt24to12(val) });
    cur += 30;
  }
  return slots;
}

const STATUS_COLORS = {
  Available:  { color: "#276749", background: "#f0fff4" },
  Busy:       { color: "#975a16", background: "#fffaf0" },
  Unavailable:{ color: "#975a16", background: "#fffaf0" },
  "On Leave": { color: "#c53030", background: "#fff5f5" },
  Pending:    { color: "#975a16", background: "#fffaf0" },
  Approved:   { color: "#276749", background: "#f0fff4" },
  Rejected:   { color: "#c53030", background: "#fff5f5" },
  Completed:  { color: "#2b6cb0", background: "#ebf8ff" },
  Cancelled:  { color: "#718096", background: "#f7fafc" },
  Missed:     { color: "#a05a2c", background: "#fdf2e9" },
};

function displayStaffStatus(status) {
  return status === "Available" || status === "On Leave" ? status : "Unavailable";
}

function storedStaffStatus(status) {
  return status === "Available" || status === "On Leave" ? status : "Busy";
}

function statusStyle(s) {
  const c = STATUS_COLORS[s] || { color: "#2d2024", background: "#f0f0f0" };
  return {
    ...c,
    display:      "inline-flex",
    alignItems:   "center",
    alignSelf:    "center",
    borderRadius: "99px",
    padding:      "2px 10px",
    fontSize:     "11px",
    fontWeight:   600,
    fontStyle:    "normal",
    lineHeight:   1,
    whiteSpace:   "nowrap",
  };
}

const filterInputStyle = {
  padding:      "5px 10px",
  border:       "1px solid #e4cccc",
  borderRadius: 6,
  fontSize:     13,
  background:   "#fff",
  color:        "#2d2024",
  minWidth:     130,
};

const loadingText = {
  textAlign: "center",
  color:     "var(--muted, #76656a)",
  fontSize:  13,
  padding:   "1.5rem",
};

const DAYS = ["M", "T", "W", "TH", "F", "S"];

const TIME_OPTIONS = generateTimeSlots("06:00", "21:00");

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

function ConfirmDialog({ open, message, confirmLabel = "Confirm", danger = false, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <Modal open={open} onClose={onCancel}>
      <section className="tracer-modal" role="dialog" aria-modal="true" style={{ maxWidth: 380 }}>
        <div className="modal-head">
          <h3>Confirm</h3>
          <button type="button" aria-label="Close" onClick={onCancel}>×</button>
        </div>
        <div className="modal-body">
          <p style={{ margin: 0, paddingBottom: 18, fontSize: 14, lineHeight: 1.6 }}>{message}</p>
          <div className="modal-actions">
            <button type="button" onClick={onCancel}>Cancel</button>
            <button
              type="button"
              className="modal-confirm"
              onClick={onConfirm}
              style={danger ? { background: "#c53030", color: "#fff" } : undefined}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </section>
    </Modal>
  );
}

function StaffModal({ mode, item, saving, onClose, onSubmit }) {
  const isEdit = mode === "edit";
  const [adminList, setAdminList]   = useState([]);
  const [adminsLoading, setAdminsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [selectError, setSelectError] = useState("");

  useEffect(() => {
    // role=admin scopes this server-side (GET /admin/users is paginated —
    // see AccountsView.jsx — a bare unscoped call only returns the newest
    // 50 accounts of ANY role, which could easily leave an older admin
    // account out of this picker entirely). limit=500 as a generous ceiling
    // since this dropdown needs the full matching set, not one page of it.
    fetch(`${API}/admin/users?role=admin&limit=500`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((data) => {
        const list = (data.users || [])
          .filter((u) => u.status !== "suspended")
          .map((u) => ({
            id:    u._id,
            name:  `${u.firstName} ${u.lastName}`.trim(),
            email: u.email,
          }));
        setAdminList(list);
        if (isEdit && item?.email) {
          const match = list.find((a) => a.email.toLowerCase() === item.email.toLowerCase());
          if (match) setSelectedId(match.id);
        }
      })
      .catch(() => {})
      .finally(() => setAdminsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = adminList.find((a) => a.id === selectedId) || null;
  // Legacy staff rows created before this dropdown existed may not match any
  // current admin account by email — keep their original name/email visible
  // and submittable until the admin picks a real account to replace them.
  const legacyFallback = isEdit && !selected && item ? { name: item.name, email: item.email } : null;

  return (
    <Modal open onClose={onClose}>
      <section className="tracer-modal admin-entry-modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{isEdit ? "Edit Staff Member" : "Add Staff Member"}</h3>
          <button type="button" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <form
          className="admin-entry-form"
          onSubmit={(e) => {
            e.preventDefault();
            const person = selected || legacyFallback;
            if (!person) { setSelectError("Please select an admin account."); return; }
            const f = e.currentTarget.elements;
            onSubmit({
              name:   person.name,
              role:   item?.role || "Admin",
              email:  person.email,
              status: f.status.value,
            });
          }}
        >
          <div className="admin-entry-fields">
            <label>
              Admin Account
              <select
                name="admin_user"
                value={selectedId}
                onChange={(e) => { setSelectedId(e.target.value); setSelectError(""); }}
                required={!legacyFallback}
              >
                <option value="" disabled>
                  {adminsLoading ? "Loading admin accounts…" : "Select an admin account"}
                </option>
                {legacyFallback && (
                  <option value="" disabled>
                    {legacyFallback.name} ({legacyFallback.email}), currently no matching account
                  </option>
                )}
                {adminList.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} ({a.email})</option>
                ))}
              </select>
              {!adminsLoading && adminList.length === 0 && !legacyFallback && (
                <span className="field-error">No admin accounts found.</span>
              )}
              {selectError && <span className="field-error">{selectError}</span>}
            </label>
            <label>
              Status
              <select name="status" defaultValue={storedStaffStatus(item?.status || "Available")}>
                <option>Available</option>
                <option value="Busy">Unavailable</option>
                <option>On Leave</option>
              </select>
            </label>
          </div>
          <div className="modal-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" disabled={saving || (!selected && !legacyFallback)}>
              {saving ? "Saving…" : isEdit ? "Save Changes" : "Add Staff"}
            </button>
          </div>
        </form>
      </section>
    </Modal>
  );
}

function AppointmentModal({ settings, staffList, saving, onClose, onSubmit }) {
  const timeSlots = generateTimeSlots(
    settings?.start_time || "08:00",
    settings?.end_time   || "17:00"
  );
  const slots = timeSlots.length ? timeSlots : TIME_OPTIONS;

  const [alumniName, setAlumniName]       = useState("");
  const [alumniId, setAlumniId]           = useState(null);
  const [alumniError, setAlumniError]     = useState("");
  const [alumniList, setAlumniList]       = useState([]);
  const [suggestions, setSuggestions]     = useState([]);
  const [showDrop, setShowDrop]           = useState(false);
  const dropRef = useRef(null);

  useEffect(() => {
    // Same reasoning as StaffModal's admin picker above — role=alumni scopes
    // this server-side instead of relying on GET /admin/users' default
    // (now-paginated, 50-newest-of-any-role) response, which could easily
    // leave an alumnus who isn't among the most recently created accounts
    // out of this search entirely.
    fetch(`${API}/admin/users?role=alumni&limit=1000`, { headers: authHeaders() })
      .then(r => r.json())
      .then(data => {
        const list = (data.users || [])
          .filter(u => u.status !== "suspended")
          .map(u => ({
            id:    u._id,
            name:  `${u.firstName} ${u.lastName}`.trim(),
            email: u.email,
          }));
        setAlumniList(list);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!showDrop) return;
    function onDoc(e) {
      if (dropRef.current && !dropRef.current.contains(e.target)) setShowDrop(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [showDrop]);

  function handleAlumniInput(e) {
    const val = e.target.value;
    setAlumniName(val);
    setAlumniId(null);
    setAlumniError("");
    if (!val.trim()) { setSuggestions([]); setShowDrop(false); return; }
    const q = val.toLowerCase();
    const filtered = alumniList.filter(a =>
      a.name.toLowerCase().split(/\s+/).some(w => w.startsWith(q))
    );
    setSuggestions(filtered);
    setShowDrop(true);
  }

  function selectAlumni(a) {
    setAlumniName(a.name);
    setAlumniId(a.id);
    setAlumniError("");
    setSuggestions([]);
    setShowDrop(false);
  }

  return (
    <Modal open onClose={onClose}>
      <section className="tracer-modal admin-entry-modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>Add Appointment</h3>
          <button type="button" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <form
          className="admin-entry-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!alumniId) { setAlumniError("Please select an alumni from the list."); return; }
            const f = e.currentTarget.elements;
            onSubmit({
              alumni_name:      alumniName.trim(),
              alumni_id:        alumniId,
              staff_id:         f.staff_id.value,
              appointment_date: f.appointment_date.value,
              appointment_time: f.appointment_time.value,
              purpose:          f.purpose.value,
              notes:            f.notes.value.trim(),
            });
          }}
        >
          <div className="admin-entry-fields">
            <label>
              Alumni Name
              <div className="alumni-suggest-wrap" ref={dropRef}>
                <input
                  type="text"
                  name="alumni_name"
                  value={alumniName}
                  onChange={handleAlumniInput}
                  onFocus={() => { if (suggestions.length) setShowDrop(true); }}
                  onBlur={() => { if (!alumniId && alumniName.trim()) setAlumniError("Please select an alumni from the list."); }}
                  placeholder="Search alumni…"
                  autoComplete="off"
                />
                {showDrop && (
                  <div className="alumni-suggest-dropdown">
                    {suggestions.length === 0 ? (
                      <div className="alumni-suggest-empty">No alumni found</div>
                    ) : suggestions.map(a => (
                      <div
                        key={a.id}
                        className="alumni-suggest-item"
                        onMouseDown={(e) => { e.preventDefault(); selectAlumni(a); }}
                      >
                        {a.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {alumniError && <span className="field-error">{alumniError}</span>}
            </label>
            <label>
              Staff
              <select name="staff_id" required>
                {staffList.length === 0 ? (
                  <option value="">No active staff available</option>
                ) : staffList.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.name} · {s.role}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Date
              <input type="date" name="appointment_date" required />
            </label>
            <label>
              Time
              <select name="appointment_time" required>
                {slots.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
            <label>
              Purpose
              <select name="purpose" defaultValue="">
                <option value="" disabled>Select a purpose</option>
                <option value="Document Request">Document Request</option>
                <option value="Academic Inquiry">Academic Inquiry</option>
                <option value="Employment Verification">Employment Verification</option>
                <option value="Transcript of Records">Transcript of Records</option>
                <option value="Certificate of Graduation">Certificate of Graduation</option>
                <option value="Alumni ID">Alumni ID</option>
                <option value="Consultation">Consultation</option>
                <option value="Other">Other</option>
              </select>
            </label>
            <label>
              Notes
              <textarea name="notes" rows={3} style={{ resize: "vertical" }} />
            </label>
          </div>

          {settings && (
            <p style={{ fontSize: 12, color: "var(--muted, #76656a)", margin: "4px 0 8px" }}>
              Office hours: {fmt24to12(settings.start_time)} to {fmt24to12(settings.end_time)}
              &nbsp;·&nbsp;Working days: {settings.working_days.join(", ") || "none"}
            </p>
          )}

          <div className="modal-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" disabled={saving || !staffList.length || !alumniId}>
              {saving ? "Saving…" : "Add Appointment"}
            </button>
          </div>
        </form>
      </section>
    </Modal>
  );
}

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────

export default function AppointmentsView() {
  const { showToast } = useOutletContext();
  // Office settings
  const [settings,         setSettings]         = useState(null);
  const [formSettings,     setFormSettings]      = useState(null);
  const [settingsLoading,  setSettingsLoading]   = useState(true);
  const [editingSettings,  setEditingSettings]   = useState(false);
  const [settingsSaving,   setSettingsSaving]    = useState(false);

  // Staff
  const [staff,            setStaff]             = useState([]);
  const [staffLoading,     setStaffLoading]      = useState(true);
  const [staffModal,       setStaffModal]        = useState(null); // null | { mode, item }
  const [staffSaving,      setStaffSaving]       = useState(false);
  const [editingStaff,     setEditingStaff]      = useState(false);

  // Appointments
  const [appointments,     setAppointments]      = useState([]);
  const [apptLoading,      setApptLoading]       = useState(true);
  const [apptModal,        setApptModal]         = useState(false);
  const [apptSaving,       setApptSaving]        = useState(false);

  // Confirm dialog
  const [confirm,          setConfirm]           = useState(null); // { message, confirmLabel, danger, onConfirm }

  // Filters (client-side)
  const [search,           setSearch]            = useState("");
  const [statusFilter,     setStatusFilter]      = useState("All");
  const [staffFilter,      setStaffFilter]       = useState("All");
  const [dateFilter,       setDateFilter]        = useState("");

  useEffect(() => {
      fetchAll();
  }, []);

  async function fetchAll() {
    await Promise.all([fetchSettings(), fetchStaff(), fetchAppointments()]);
  }

  // ── Office settings ──────────────────────────────────────────

  async function fetchSettings() {
    setSettingsLoading(true);
    try {
      const res  = await fetch(`${API}/admin/appointments/settings`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) { showToast(data.message || "Failed to load office settings."); return; }
      const settings = data.settings || {};
      if (!settings.holidays || settings.holidays.length === 0) {
        const currentMonth = new Date().getMonth() + 1;
        const currentYear = new Date().getFullYear();
        const monthHolidays = getHolidaysForMonth(currentYear, currentMonth);
        settings.holidays = monthHolidays.map((h) => h.date);
      }
      setSettings(settings);
      setFormSettings(settings);
    } catch { showToast("Could not connect to server."); }
    finally { setSettingsLoading(false); }
  }

  async function saveSettings() {
    setSettingsSaving(true);
    try {
      const res  = await fetch(`${API}/admin/appointments/settings`, {
        method:  "PATCH",
        headers: authHeaders(),
        body:    JSON.stringify(formSettings),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.message || "Failed to save settings."); return; }
      setSettings(data.settings);
      setFormSettings(data.settings);
      setEditingSettings(false);
      showToast("Office availability saved.");
    } catch { showToast("Could not connect to server."); }
    finally { setSettingsSaving(false); }
  }

  function toggleDay(d) {
    if (!editingSettings) return;
    setFormSettings((prev) => ({
      ...prev,
      working_days: prev.working_days.includes(d)
        ? prev.working_days.filter((x) => x !== d)
        : [...prev.working_days, d],
    }));
  }

  // Specific one-off closed dates (public holidays, university-declared
  // suspensions) on top of the recurring weekly Days above — previously
  // this had no schema field or UI at all, so alumni could book on a
  // holiday since nothing ever checked for one.
  const [newHolidayDate, setNewHolidayDate] = useState("");

  function addHoliday() {
    if (!newHolidayDate) return;
    setFormSettings((prev) => {
      const existing = prev.holidays || [];
      if (existing.includes(newHolidayDate)) return prev;
      return { ...prev, holidays: [...existing, newHolidayDate] };
    });
    setNewHolidayDate("");
  }

  function removeHoliday(d) {
    if (!editingSettings) return;
    setFormSettings((prev) => ({ ...prev, holidays: (prev.holidays || []).filter((x) => x !== d) }));
  }

  function fmtHolidayDate(d) {
    const [y, m, day] = d.split("-").map(Number);
    const monthDay = `${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const name = PHILIPPINES_HOLIDAYS[monthDay];
    const date = new Date(y, m - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return name ? `${date} - ${name}` : date;
  }

  // ── Staff ────────────────────────────────────────────────────

  async function fetchStaff() {
    setStaffLoading(true);
    try {
      const res  = await fetch(`${API}/admin/appointments/staff`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) { showToast(data.message || "Failed to load staff."); return; }
      setStaff(data.staff);
    } catch { showToast("Could not connect to server."); }
    finally { setStaffLoading(false); }
  }

  async function handleStaffSubmit(formData) {
    setStaffSaving(true);
    const isEdit = staffModal?.mode === "edit";
    const url    = isEdit
      ? `${API}/admin/appointments/staff/${staffModal.item._id}`
      : `${API}/admin/appointments/staff`;
    try {
      const res  = await fetch(url, {
        method:  isEdit ? "PATCH" : "POST",
        headers: authHeaders(),
        body:    JSON.stringify(formData),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.message || "Failed to save staff member."); return; }
      if (isEdit) {
        setStaff((prev) => prev.map((s) => s._id === data.staff._id ? data.staff : s));
        showToast(`${data.staff.name} updated.`);
      } else {
        setStaff((prev) => [data.staff, ...prev]);
        showToast(`${data.staff.name} added to staff.`);
      }
      setStaffModal(null);
    } catch { showToast("Could not connect to server."); }
    finally { setStaffSaving(false); }
  }

  function confirmDeleteStaff(s) {
    setConfirm({
      message:      `Remove ${s.name} from staff? This will soft-delete the record.`,
      confirmLabel: "Remove",
      danger:       true,
      onConfirm:    async () => {
        setConfirm(null);
        try {
          const res  = await fetch(`${API}/admin/appointments/staff/${s._id}`, {
            method: "DELETE", headers: authHeaders(),
          });
          const data = await res.json();
          if (!res.ok) { showToast(data.message || "Delete failed."); return; }
          setStaff((prev) => prev.filter((x) => x._id !== s._id));
          showToast(data.message);
        } catch { showToast("Could not connect to server."); }
      },
    });
  }

  // ── Appointments ─────────────────────────────────────────────

  async function fetchAppointments() {
    setApptLoading(true);
    try {
      const res  = await fetch(`${API}/admin/appointments`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) { showToast(data.message || "Failed to load appointments."); return; }
      setAppointments(data.appointments);
    } catch { showToast("Could not connect to server."); }
    finally { setApptLoading(false); }
  }

  async function handleAddAppointment(formData) {
    setApptSaving(true);
    try {
      const res  = await fetch(`${API}/admin/appointments`, {
        method:  "POST",
        headers: authHeaders(),
        body:    JSON.stringify(formData),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.message || "Failed to create appointment."); return; }
      setAppointments((prev) => [data.appointment, ...prev]);
      setApptModal(false);
      showToast("Appointment created.");
    } catch { showToast("Could not connect to server."); }
    finally { setApptSaving(false); }
  }

  function confirmDeleteAppointment(appt) {
    setConfirm({
      message:      `Delete the appointment for ${appt.alumni_name}? This cannot be undone.`,
      confirmLabel: "Delete",
      danger:       true,
      onConfirm:    async () => {
        setConfirm(null);
        try {
          const res  = await fetch(`${API}/admin/appointments/${appt._id}`, {
            method: "DELETE", headers: authHeaders(),
          });
          const data = await res.json();
          if (!res.ok) { showToast(data.message || "Delete failed."); return; }
          setAppointments((prev) => prev.filter((a) => a._id !== appt._id));
          showToast(data.message || "Appointment deleted.");
        } catch { showToast("Could not connect to server."); }
      },
    });
  }

  function confirmStatusChange(appt, action) {
    const statusMap = { Approve: "Approved", Reject: "Rejected", Complete: "Completed", Cancel: "Cancelled" };
    const newStatus = statusMap[action];
    const isDanger  = action === "Reject" || action === "Cancel";
    setConfirm({
      message:      `${action} appointment for ${appt.alumni_name}?`,
      confirmLabel: action,
      danger:       isDanger,
      onConfirm:    async () => {
        setConfirm(null);
        try {
          const res  = await fetch(`${API}/admin/appointments/${appt._id}/status`, {
            method:  "PATCH",
            headers: authHeaders(),
            body:    JSON.stringify({ status: newStatus }),
          });
          const data = await res.json();
          if (!res.ok) { showToast(data.message || "Failed to update status."); return; }
          setAppointments((prev) => prev.map((a) => a._id === appt._id ? data.appointment : a));
          showToast(`${appt.alumni_name}'s appointment ${newStatus.toLowerCase()}.`);
        } catch { showToast("Could not connect to server."); }
      },
    });
  }

  // ── Client-side filtering ────────────────────────────────────

  const activeStaff = staff.filter((s) => s.status !== "Unavailable");

  const filtered = appointments.filter((a) => {
    const nameOk   = !search      || a.alumni_name.toLowerCase().includes(search.toLowerCase());
    const statusOk = statusFilter === "All" || a.status === statusFilter;
    const staffOk  = staffFilter  === "All" || (a.staff_id && a.staff_id._id === staffFilter);
    const dateOk   = !dateFilter  || a.appointment_date === dateFilter;
    return nameOk && statusOk && staffOk && dateOk;
  });

  const hasFilters = search || statusFilter !== "All" || staffFilter !== "All" || dateFilter;

  // ── Render ───────────────────────────────────────────────────

  return (
    <section className={`content appointments-view view active-view`}>

      {/* ── Top grid ── */}
      <div className="appointment-top-grid">

        {/* Office Availability */}
        <section className="appointment-card">
          <h3>Office Availability</h3>

          {settingsLoading ? (
            <p style={loadingText}>Loading…</p>
          ) : formSettings ? (
            <>
              <div className="office-form">
                <label>
                  <span>Office Status:</span>
                  <select
                    value={formSettings.office_status}
                    disabled={!editingSettings}
                    onChange={(e) =>
                      setFormSettings((p) => ({ ...p, office_status: e.target.value }))
                    }
                  >
                    <option>Open</option>
                    <option>Closed</option>
                  </select>
                </label>

                <label>
                  <span>Office Hours:</span>
                  <select
                    value={formSettings.start_time}
                    disabled={!editingSettings}
                    onChange={(e) =>
                      setFormSettings((p) => ({ ...p, start_time: e.target.value }))
                    }
                  >
                    {TIME_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                  <select
                    value={formSettings.end_time}
                    disabled={!editingSettings}
                    onChange={(e) =>
                      setFormSettings((p) => ({ ...p, end_time: e.target.value }))
                    }
                  >
                    {TIME_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </label>

                <label>
                  <span>Days:</span>
                  <div className="day-pills">
                    {DAYS.map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={formSettings.working_days.includes(d) ? "active" : undefined}
                        disabled={!editingSettings}
                        onClick={() => toggleDay(d)}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </label>

                <label>
                  <span>Holidays:</span>
                  <div>
                    {editingSettings && (
                      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                        <input
                          type="date"
                          value={newHolidayDate}
                          onChange={(e) => setNewHolidayDate(e.target.value)}
                          style={{ flex: 1 }}
                        />
                        <button type="button" onClick={addHoliday} disabled={!newHolidayDate}>
                          + Add
                        </button>
                      </div>
                    )}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {(formSettings.holidays || []).length === 0 ? (
                        <span style={{ fontSize: 12, color: "var(--muted, #76656a)" }}>No holidays set.</span>
                      ) : (
                        [...formSettings.holidays].sort().map((d) => (
                          <span
                            key={d}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 6,
                              background: "#f7eeee", color: "#570013", borderRadius: 999,
                              padding: "4px 10px", fontSize: 12, fontWeight: 600,
                            }}
                          >
                            {fmtHolidayDate(d)}
                            {editingSettings && (
                              <button
                                type="button"
                                aria-label={`Remove ${d}`}
                                onClick={() => removeHoliday(d)}
                                style={{
                                  background: "none", border: "none", color: "#570013",
                                  cursor: "pointer", fontWeight: 800, padding: 0, lineHeight: 1,
                                }}
                              >
                                ×
                              </button>
                            )}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                </label>
              </div>

              <div className="office-actions">
                {editingSettings && (
                  <button
                    type="button"
                    className="save-office"
                    disabled={settingsSaving}
                    onClick={saveSettings}
                  >
                    <Icon name="icon-13" />
                    {settingsSaving ? "Saving…" : "Save"}
                  </button>
                )}
                <button
                  type="button"
                  className="edit-office"
                  onClick={() => {
                    if (editingSettings) {
                      setFormSettings(settings);
                      setEditingSettings(false);
                    } else {
                      setEditingSettings(true);
                      showToast("Office availability is ready to edit.");
                    }
                  }}
                >
                  <Icon name={editingSettings ? "icon-9" : "icon-18"} />
                  {editingSettings ? "Cancel" : "Edit"}
                </button>
              </div>
            </>
          ) : (
            <p style={{ color: "var(--muted)" }}>Could not load office settings.</p>
          )}
        </section>

        {/* Staff Management */}
        <section className="appointment-card">
          <h3>Staff Management</h3>

          {staffLoading ? (
            <p style={loadingText}>Loading…</p>
          ) : (
            <>
            <div className="staff-list-head" aria-hidden="true">
              <span>Name</span>
              <span>Role</span>
              <span>Status</span>
              {editingStaff && <span>Actions</span>}
            </div>
            <div className={`staff-list${editingStaff ? " is-editing" : ""}`}>
              {staff.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--muted, #76656a)" }}>
                  No staff members found.
                </p>
              ) : staff.map((s) => (
                <div key={s._id}>
                  <strong>{s.name}</strong>
                  <span style={{ alignItems: "center", fontSize: 12, color: "var(--muted)" }}>{s.role}</span>
                  <em style={statusStyle(displayStaffStatus(s.status))}>{displayStaffStatus(s.status)}</em>
                  {editingStaff && <div className="staff-row-actions">
                    <button
                      type="button"
                      className="edit-staff"
                      onClick={() => setStaffModal({ mode: "edit", item: s })}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="delete-staff"
                      onClick={() => confirmDeleteStaff(s)}
                    >
                      ✕
                    </button>
                  </div>}
                </div>
              ))}
            </div>
            </>
          )}

          <div className="staff-actions">
            <button type="button" className="edit-office" onClick={() => setEditingStaff((value) => !value)}>
              <Icon name={editingStaff ? "icon-13" : "icon-18"} />
              {editingStaff ? "Done" : "Edit"}
            </button>
            <button
              type="button"
              className="add-button"
              onClick={() => setStaffModal({ mode: "add", item: null })}
            >
              <span className="button-symbol" aria-hidden="true">+</span>
              Add Staff
            </button>
          </div>
        </section>
      </div>

      {/* ── Appointments ── */}
      <section className="appointments-card">
        <h3>Appointments</h3>

        {/* Filter bar */}
        <div
          style={{
            display:    "flex",
            flexWrap:   "wrap",
            gap:        8,
            padding:    "0 0 14px",
            alignItems: "center",
          }}
        >
          <input
            type="search"
            placeholder="Search alumni…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={filterInputStyle}
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={filterInputStyle}
          >
            <option value="All">All Status</option>
            <option>Pending</option>
            <option>Approved</option>
            <option>Rejected</option>
            <option>Completed</option>
            <option>Cancelled</option>
            <option>Missed</option>
          </select>
          <select
            value={staffFilter}
            onChange={(e) => setStaffFilter(e.target.value)}
            style={filterInputStyle}
          >
            <option value="All">All Staff</option>
            {staff.map((s) => (
              <option key={s._id} value={s._id}>{s.name}</option>
            ))}
          </select>
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            style={filterInputStyle}
          />
          {hasFilters && (
            <button
              type="button"
              style={{ fontSize: 12, padding: "5px 12px" }}
              onClick={() => {
                setSearch("");
                setStatusFilter("All");
                setStaffFilter("All");
                setDateFilter("");
              }}
            >
              Clear Filters
            </button>
          )}
          <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted, #76656a)" }}>
            {filtered.length} appointment{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="appointments-table-wrap">
          {apptLoading ? (
            <p style={loadingText}>Loading appointments…</p>
          ) : (
            <table className="appointments-table">
              <thead>
                <tr>
                  <th>Date &amp; Time</th>
                  <th>Alumni</th>
                  <th>Staff</th>
                  <th>Purpose</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan="6" style={{ textAlign: "center", padding: "1.5rem", display: "block" }}>
                      {hasFilters ? "No appointments match the current filters." : "No appointments yet."}
                    </td>
                  </tr>
                ) : filtered.map((a) => (
                  <tr
                    key={a._id}
                    className={
                      a.status === "Approved"  ? "is-approved"  :
                      a.status === "Rejected"  ? "is-rejected"  :
                      a.status === "Missed"    ? "is-missed"    : ""
                    }
                  >
                    <td>{fmtDateTime(a.appointment_date, a.appointment_time)}</td>
                    <td>{a.alumni_name}</td>
                    <td>{a.staff_id?.name || "—"}</td>
                    <td
                      title={a.purpose}
                      style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {a.purpose || "—"}
                    </td>
                    <td>
                      <span style={statusStyle(a.status)}>{a.status}</span>
                    </td>
                    <td>
                      <div className="appt-actions desktop-row-actions">
                        {a.status === "Pending" && (
                          <>
                            <button type="button" onClick={() => confirmStatusChange(a, "Approve")}>
                              Approve
                            </button>
                            <button type="button" onClick={() => confirmStatusChange(a, "Reject")}>
                              Reject
                            </button>
                          </>
                        )}
                        {a.status === "Approved" && (
                          <>
                            <button type="button" onClick={() => confirmStatusChange(a, "Complete")}>
                              Complete
                            </button>
                            <button type="button" onClick={() => confirmStatusChange(a, "Cancel")}>
                              Cancel
                            </button>
                          </>
                        )}
                        <button type="button" onClick={() => confirmDeleteAppointment(a)}>
                          Delete
                        </button>
                      </div>
                      <div className="appointment-action-menu">
                          <ActionMenu
                            actions={a.status === "Pending"
                              ? ["approve", "reject", "delete"]
                              : a.status === "Approved"
                              ? ["complete", "cancel", "delete"]
                              : ["delete"]}
                            onSelect={(action) => action === "delete"
                              ? confirmDeleteAppointment(a)
                              : confirmStatusChange(a, action.charAt(0).toUpperCase() + action.slice(1))}
                          />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="appointments-footer">
          <button
            type="button"
            className="add-button"
            onClick={() => setApptModal(true)}
          >
            <span className="button-symbol" aria-hidden="true">+</span>
            Add Appointment
          </button>
        </div>
      </section>

      {/* ── Modals ── */}
      {staffModal && (
        <StaffModal
          mode={staffModal.mode}
          item={staffModal.item}
          saving={staffSaving}
          onClose={() => setStaffModal(null)}
          onSubmit={handleStaffSubmit}
        />
      )}

      {apptModal && (
        <AppointmentModal
          settings={settings}
          staffList={activeStaff}
          saving={apptSaving}
          onClose={() => setApptModal(false)}
          onSubmit={handleAddAppointment}
        />
      )}

      <ConfirmDialog
        open={!!confirm}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel}
        danger={confirm?.danger}
        onConfirm={confirm?.onConfirm}
        onCancel={() => setConfirm(null)}
      />
    </section>
  );
}
