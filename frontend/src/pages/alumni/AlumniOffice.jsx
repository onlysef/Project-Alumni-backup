import React, { useEffect, useState } from "react";
import { API, authHeaders } from "../../services/api.js";

const OFFICE_EMAIL = "alumniportal.tsu@gmail.com";

const PURPOSE_OPTIONS = [
  "Document Request", "Academic Inquiry", "Employment Verification",
  "Transcript of Records", "Certificate of Graduation", "Alumni ID",
  "Consultation", "Other",
];

function fmt24to12(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function generateTimeSlots(start = "08:00", end = "17:00") {
  const slots = [];
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const endMin = eh * 60 + em;
  let cur = sh * 60 + sm;
  while (cur < endMin) {
    const h = Math.floor(cur / 60);
    const m = cur % 60;
    const val = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    slots.push({ value: val, label: fmt24to12(val) });
    cur += 30;
  }
  return slots;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Aligned with the backend's JS_DAY_TO_LABEL (Date.getDay(): 0=Sun..6=Sat)
const JS_DAY_TO_LABEL = [null, "M", "T", "W", "TH", "F", "S"];

// Only the next `count` dates that are actually working days and not a
// marked holiday — nothing else is selectable. `office_status: Closed` only
// takes today off the list (an unplanned same-day closure) — it doesn't
// block booking a future date the office will actually be open for; a
// planned future closure belongs in the holidays list instead.
function generateValidDates(workingDays, holidays = [], officeClosedToday = false, count = 14) {
  const dates = [];
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  for (let i = 0; dates.length < count && i < 90; i++) {
    const cur = new Date(base);
    cur.setDate(base.getDate() + i);
    const label = JS_DAY_TO_LABEL[cur.getDay()];
    if (label && workingDays.includes(label)) {
      const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
      if (holidays.includes(iso)) continue;
      if (i === 0 && officeClosedToday) continue;
      dates.push({
        value: iso,
        label: cur.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
      });
    }
  }
  return dates;
}

const OFFICE_SERVICES = [
  {
    key: "records",
    iconKey: "records",
    title: "Alumni Records",
    text: "Update your contact, employment, and personal information.",
    requirements: [
      "One valid government-issued ID",
      "Your alumni or student number",
      "The details to be updated (address, contact number, email, employer, job title)",
      "Supporting document for a name change (e.g. marriage certificate)",
    ],
    process: [
      "Book an appointment or visit the Alumni Office during office hours.",
      "Present your valid ID and alumni/student number for verification.",
      "Fill out the records update form with your current information.",
      "Staff encodes the changes and issues a confirmation.",
      "Updates reflect on your alumni profile within 3–5 working days.",
    ],
  },
  {
    key: "documents",
    iconKey: "docs",
    title: "Document Requests",
    text: "Request certifications and alumni-related documents.",
    requirements: [
      "One valid government-issued ID",
      "Your alumni or student number",
      "Authorization letter and a copy of the owner's ID if requesting for someone else",
      "Payment for certification and documentary stamp fees",
    ],
    process: [
      "Send an inquiry or book an appointment, stating the document you need.",
      "Present your valid ID for verification at the office.",
      "Fill out the document request form and settle the fees.",
      "Receive a claim stub with the release date (usually 3–5 working days).",
      "Return on the release date to claim the document, or request email/courier release where available.",
    ],
  },
  {
    key: "membership",
    iconKey: "membership",
    title: "Membership Support",
    text: "Get help with alumni ID and association membership.",
    requirements: [
      "One valid government-issued ID",
      "Your alumni or student number",
      "Two recent 1x1 or 2x2 ID photos (for a new or replacement alumni ID)",
      "Proof of payment for membership dues or the ID replacement fee",
    ],
    process: [
      "Visit the Alumni Office or book an appointment for membership assistance.",
      "Verify your identity and confirm your graduation details.",
      "Complete the membership or alumni ID application form.",
      "Pay the membership dues or ID replacement fee at the cashier.",
      "Claim your alumni ID or membership confirmation on the given release date.",
    ],
  },
  {
    key: "career",
    iconKey: "career",
    title: "Career Assistance",
    text: "Access job referrals, mentoring, and career resources.",
    requirements: [
      "An updated résumé or curriculum vitae",
      "Your alumni or student number",
      "An active email address and contact number",
      "Portfolio or credentials relevant to your field (optional)",
    ],
    process: [
      "Send an inquiry or book an appointment for career assistance.",
      "Share your résumé and the support you need (referral, mentoring, resources).",
      "The office matches you with job leads, partner employers, or a mentor.",
      "Attend the scheduled mentoring session or job-matching endorsement.",
      "Receive follow-up updates on referrals and openings by email.",
    ],
  },
];

const OFFICE_ICONS = {
  location: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2370001d' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11z'/%3E%3Ccircle cx='12' cy='10' r='2.6'/%3E%3Cpath d='M9 22h6'/%3E%3C/svg%3E",
  clock: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2370001d' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='9'/%3E%3Cpath d='M12 7v5l3 2'/%3E%3C/svg%3E",
  phone: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2370001d' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8 9.6a16 16 0 0 0 6.4 6.4l1.2-1.2a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2z'/%3E%3C/svg%3E",
  mail: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2370001d' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='5' width='18' height='14' rx='2'/%3E%3Cpath d='m3 7 9 6 9-6'/%3E%3C/svg%3E",
  records: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2370001d' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/%3E%3Cpath d='M14 2v6h6'/%3E%3Cpath d='M8 13h8'/%3E%3Cpath d='M8 17h5'/%3E%3C/svg%3E",
  docs: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2370001d' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-2'/%3E%3Cpath d='M12 2H6a2 2 0 0 0-2 2v12h10V4a2 2 0 0 0-2-2z'/%3E%3Cpath d='M8 7h4'/%3E%3Cpath d='M8 11h4'/%3E%3C/svg%3E",
  membership: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2370001d' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='5' width='18' height='14' rx='2'/%3E%3Ccircle cx='9' cy='12' r='2'/%3E%3Cpath d='M13 10h5'/%3E%3Cpath d='M13 14h4'/%3E%3C/svg%3E",
  career: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2370001d' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='7' width='18' height='13' rx='2'/%3E%3Cpath d='M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'/%3E%3Cpath d='M3 12h18'/%3E%3Cpath d='M12 12v2'/%3E%3C/svg%3E",
};

// Mon–Sun display order paired with the backend's day codes (Sunday has none —
// the office day picker has no Sunday option, so it's always "Closed").
const DAY_DEFS = [
  ["Monday", "M"], ["Tuesday", "T"], ["Wednesday", "W"],
  ["Thursday", "TH"], ["Friday", "F"], ["Saturday", "S"], ["Sunday", null],
];

function buildHours(settings) {
  const workingDays = settings?.working_days || [];
  const range = settings ? `${fmt24to12(settings.start_time)} - ${fmt24to12(settings.end_time)}` : "";
  return DAY_DEFS.map(([name, code]) => [name, code && workingDays.includes(code) ? range : "Closed"]);
}

function computeOfficeStatus(settings) {
  if (!settings) return { open: false, text: "Loading…" };
  if (settings.office_status === "Closed") return { open: false, text: "Currently closed" };
  const now = new Date();
  const label = JS_DAY_TO_LABEL[now.getDay()];
  const minutes = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = (settings.start_time || "08:00").split(":").map(Number);
  const [eh, em] = (settings.end_time || "17:00").split(":").map(Number);
  const open = !!label && (settings.working_days || []).includes(label) && minutes >= sh * 60 + sm && minutes < eh * 60 + em;
  return { open, text: open ? "Open now" : "Currently closed" };
}

export default function AlumniOffice() {
  const [settings, setSettings] = useState(null);
  const [openService, setOpenService] = useState(null);

  useEffect(() => {
    fetch(`${API}/alumni/appointments/settings`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setSettings(d.settings || null))
      .catch(() => {});
  }, []);

  const status = computeOfficeStatus(settings);
  const hours = buildHours(settings);

  return <div className="alumni-page-content alumni-office-page">
    <section className="office-hero"><div><span>TSU Alumni Association</span><h1>How can the Alumni Office help?</h1><p>Visit or contact the office for alumni records, document requests, membership concerns, and career support.</p></div><div className={`office-status ${status.open ? "open" : "closed"}`}><i />{status.text}</div></section>

    <div className="office-layout"><section className="office-hours-card"><div className="office-section-head"><div className="office-head-icon"><img src={OFFICE_ICONS.clock} alt="" aria-hidden="true" /></div><div><span>Plan your visit</span><h2>Office Hours</h2></div></div><div className="hours-list">{hours.map(([day, time]) => <div className={time === "Closed" ? "closed-day" : ""} key={day}><strong>{day}</strong><span>{time}</span></div>)}</div><p className="hours-note">Closed on public holidays and university-declared suspension days.</p><div className="office-hours-book"><AppointmentForm settings={settings} /></div></section>

      <div className="office-side"><section className="office-contact-card"><h2>Contact & Location</h2><div className="contact-row"><img className="contact-icon" src={OFFICE_ICONS.location} alt="" aria-hidden="true" /><div><span>Visit us</span><strong>Alumni Center, Lucinda Campus<br />Tarlac State University</strong></div></div><div className="contact-row"><img className="contact-icon" src={OFFICE_ICONS.phone} alt="" aria-hidden="true" /><div><span>Call us</span><strong>(045) 606-8123 local 205</strong></div></div><div className="contact-row"><img className="contact-icon" src={OFFICE_ICONS.mail} alt="" aria-hidden="true" /><div><span>Email us</span><strong>{OFFICE_EMAIL}</strong></div></div><InquiryForm /></section><section className="visit-reminder"><b>Before you visit</b><p>Bring one valid ID and your alumni or student number for faster verification.</p></section></div>
    </div>

    <section className="office-services"><div className="office-services-head"><span>Available assistance</span><h2>Alumni Office Services</h2><p className="office-services-hint">Tap a service to see what to bring and how the process works.</p></div><div className="service-grid">{OFFICE_SERVICES.map((s) => <Service key={s.key} service={s} icon={OFFICE_ICONS[s.iconKey]} open={openService === s.key} onToggle={() => setOpenService(openService === s.key ? null : s.key)} />)}</div>{OFFICE_SERVICES.filter((s) => s.key === openService).map((s) => <ServiceDetail key={s.key} service={s} />)}</section>
  </div>;
}

function Service({ service, icon, open, onToggle }) {
  return <button type="button" className={`office-service${open ? " is-open" : ""}`} aria-expanded={open} onClick={onToggle}>
    <i><img src={icon} alt="" aria-hidden="true" /></i>
    <div><h3>{service.title}</h3><p>{service.text}</p></div>
    <span className="office-service-caret" aria-hidden="true" />
  </button>;
}

function ServiceDetail({ service }) {
  return <div className="service-detail">
    <div className="service-detail-col">
      <h4>What to bring</h4>
      <ul>{service.requirements.map((r, i) => <li key={i}>{r}</li>)}</ul>
    </div>
    <div className="service-detail-col">
      <h4>How the process works</h4>
      <ol>{service.process.map((p, i) => <li key={i}>{p}</li>)}</ol>
    </div>
  </div>;
}

function InquiryForm() {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState(null); // { ok, text }

  async function submit(e) {
    e.preventDefault();
    setSending(true);
    setStatus(null);
    try {
      const res = await fetch(`${API}/alumni/inquiry`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ subject, message }),
      });
      const data = await res.json();
      if (!res.ok) { setStatus({ ok: false, text: data.message || "Could not send your inquiry." }); return; }
      setStatus({ ok: true, text: data.message || "Sent!" });
      setSubject("");
      setMessage("");
    } catch {
      setStatus({ ok: false, text: "Could not connect to server." });
    } finally {
      setSending(false);
    }
  }

  if (!open) {
    return <button type="button" onClick={() => { setOpen(true); setStatus(null); }}>Send an Inquiry</button>;
  }

  return (
    <form className="office-inquiry-form" onSubmit={submit}>
      <label>
        <span>Subject</span>
        <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={120} placeholder="What is this about?" />
      </label>
      <label>
        <span>Message</span>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} required rows={4} maxLength={2000} placeholder="Tell us more..." />
      </label>
      {status && <div className={status.ok ? "office-inquiry-success" : "office-inquiry-error"}>{status.text}</div>}
      <div className="office-inquiry-actions">
        <button type="button" className="office-inquiry-cancel" onClick={() => setOpen(false)} disabled={sending}>Cancel</button>
        <button type="submit" disabled={sending}>{sending ? "Sending…" : "Send"}</button>
      </div>
    </form>
  );
}

function AppointmentForm({ settings }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [staffList, setStaffList] = useState([]);
  const [staffId, setStaffId] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [purpose, setPurpose] = useState("");
  const [otherPurpose, setOtherPurpose] = useState("");
  const [bookedTimes, setBookedTimes] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState(null);
  const [dateError, setDateError] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch(`${API}/alumni/appointments/staff`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setStaffList(d.staff || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  // "Closed" only takes today off the bookable list (see generateValidDates)
  // — it no longer disables the whole form, since a same-day closure
  // shouldn't stop booking a future date the office will be open for.
  const officeClosedToday = settings?.office_status === "Closed";
  const validDates = generateValidDates(settings?.working_days || [], settings?.holidays || [], officeClosedToday);
  const noDatesAvailable = !loading && validDates.length === 0;
  const validDateSet = new Set(validDates.map((d) => d.value));
  const minDate = validDates[0]?.value || "";
  const maxDate = validDates[validDates.length - 1]?.value || "";
  const openDayNames = DAY_DEFS
    .filter(([, code]) => code && (settings?.working_days || []).includes(code))
    .map(([name]) => name)
    .join(", ");

  function handleDatePick(value) {
    if (!value) { setDate(""); setDateError(""); return; }
    if (!validDateSet.has(value)) {
      setDate("");
      setDateError(openDayNames ? `The office is open on ${openDayNames}. Please pick one of those days.` : "The office is closed on that day.");
      return;
    }
    setDateError("");
    setDate(value);
  }

  // The staff/date pair a picked date+staff belongs to changed — the old
  // time selection may no longer be valid, and no server call to keep it in sync.
  useEffect(() => { setTime(""); }, [staffId, date]);

  useEffect(() => {
    if (!staffId || !date) { setBookedTimes([]); return; }
    let active = true;
    setSlotsLoading(true);
    fetch(`${API}/alumni/appointments/booked-slots?staff_id=${staffId}&date=${date}`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => { if (active) setBookedTimes(d.times || []); })
      .catch(() => { if (active) setBookedTimes([]); })
      .finally(() => { if (active) setSlotsLoading(false); });
    return () => { active = false; };
  }, [staffId, date]);

  const isToday = date === todayISO();
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  const openSlots = generateTimeSlots(settings?.start_time || "08:00", settings?.end_time || "17:00").filter((t) => {
    if (bookedTimes.includes(t.value)) return false;
    if (isToday) {
      const [h, m] = t.value.split(":").map(Number);
      if (h * 60 + m <= nowMinutes) return false;
    }
    return true;
  });

  async function submit(e) {
    e.preventDefault();
    setStatus(null);
    if (!staffId) { setStatus({ ok: false, text: "Please select a staff member." }); return; }
    if (!date) { setStatus({ ok: false, text: "Please select a date." }); return; }
    if (!time) { setStatus({ ok: false, text: "Please select a time." }); return; }
    if (!purpose) { setStatus({ ok: false, text: "Please select a purpose." }); return; }
    const finalPurpose = purpose === "Other" ? otherPurpose.trim() : purpose;
    if (purpose === "Other" && !finalPurpose) { setStatus({ ok: false, text: "Please describe your purpose." }); return; }
    setSending(true);
    try {
      const res = await fetch(`${API}/alumni/appointments`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ staff_id: staffId, appointment_date: date, appointment_time: time, purpose: finalPurpose }),
      });
      const data = await res.json();
      if (!res.ok) { setStatus({ ok: false, text: data.message || "Could not book this appointment." }); return; }
      setStatus({ ok: true, text: data.message || "Booked!" });
      setStaffId(""); setDate(""); setTime(""); setPurpose(""); setOtherPurpose(""); setDateError("");
    } catch {
      setStatus({ ok: false, text: "Could not connect to server." });
    } finally {
      setSending(false);
    }
  }

  if (!open) {
    return <button type="button" className="office-inquiry-cancel" onClick={() => { setOpen(true); setStatus(null); }}>Book an Appointment</button>;
  }

  return (
    <form className="office-inquiry-form" onSubmit={submit}>
      {loading ? (
        <p className="account-settings-hint">Loading office availability…</p>
      ) : (
        <>
          {officeClosedToday && (
            <div className="office-inquiry-error">
              The office is closed today, so today isn't bookable, but you can still book any other available day below.
            </div>
          )}
          {staffList.length === 0 ? (
            <p className="office-inquiry-error">No staff are currently accepting appointments. Please try again later or send an inquiry instead.</p>
          ) : (
            <label>
              <span>Staff</span>
              <select value={staffId} onChange={(e) => setStaffId(e.target.value)} required>
                <option value="" disabled>Select a staff member</option>
                {staffList.map((s) => <option key={s._id} value={s._id}>{s.name} ({s.role})</option>)}
              </select>
            </label>
          )}
          {noDatesAvailable ? (
            <p className="office-inquiry-error">No upcoming office days are available right now. Please try again later.</p>
          ) : (
            <label>
              <span>Date</span>
              <input type="date" value={date} min={minDate} max={maxDate} onChange={(e) => handleDatePick(e.target.value)} required />
              {dateError
                ? <span className="office-field-note is-error">{dateError}</span>
                : openDayNames && <span className="office-field-note">Open on {openDayNames}.</span>}
            </label>
          )}
          <label>
            <span>Time</span>
            {!date || !staffId ? (
              <p className="time-slot-hint">Pick a staff member and date first.</p>
            ) : slotsLoading ? (
              <p className="time-slot-hint">Loading available times…</p>
            ) : openSlots.length === 0 ? (
              <p className="time-slot-hint">No open times for this date. Try another day.</p>
            ) : (
              <div className="time-slot-grid">
                {openSlots.map((t) => (
                  <button
                    type="button"
                    key={t.value}
                    className={`time-slot${time === t.value ? " is-selected" : ""}`}
                    onClick={() => setTime(t.value)}
                  >{t.label}</button>
                ))}
              </div>
            )}
          </label>
          <label>
            <span>Purpose</span>
            <select value={purpose} onChange={(e) => setPurpose(e.target.value)} required>
              <option value="" disabled>Select a purpose</option>
              {PURPOSE_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          {purpose === "Other" && (
            <label>
              <span>Please specify</span>
              <input type="text" value={otherPurpose} onChange={(e) => setOtherPurpose(e.target.value)} maxLength={120} placeholder="Describe your purpose" required />
            </label>
          )}
          {settings && (
            <p className="account-settings-hint">
              Office hours: {fmt24to12(settings.start_time)} – {fmt24to12(settings.end_time)}
              &nbsp;·&nbsp;Working days: {(settings.working_days || []).join(", ") || "none"}
            </p>
          )}
        </>
      )}
      {status && <div className={status.ok ? "office-inquiry-success" : "office-inquiry-error"}>{status.text}</div>}
      <div className="office-inquiry-actions">
        <button type="button" className="office-inquiry-cancel" onClick={() => setOpen(false)} disabled={sending}>Cancel</button>
        <button type="submit" disabled={sending || loading || staffList.length === 0 || noDatesAvailable}>{sending ? "Booking…" : "Book"}</button>
      </div>
    </form>
  );
}
