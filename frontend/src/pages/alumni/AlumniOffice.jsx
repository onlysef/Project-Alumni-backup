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

// Only the next `count` dates that are actually working days — nothing else is selectable.
function generateValidDates(workingDays, count = 14) {
  const dates = [];
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  for (let i = 0; dates.length < count && i < 90; i++) {
    const cur = new Date(base);
    cur.setDate(base.getDate() + i);
    const label = JS_DAY_TO_LABEL[cur.getDay()];
    if (label && workingDays.includes(label)) {
      const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
      dates.push({
        value: iso,
        label: cur.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
      });
    }
  }
  return dates;
}

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

    <section className="office-services"><div className="office-services-head"><span>Available assistance</span><h2>Alumni Office Services</h2></div><div className="service-grid"><Service icon={OFFICE_ICONS.records} title="Alumni Records" text="Update your contact, employment, and personal information." /><Service icon={OFFICE_ICONS.docs} title="Document Requests" text="Request certifications and alumni-related documents." /><Service icon={OFFICE_ICONS.membership} title="Membership Support" text="Get help with alumni ID and association membership." /><Service icon={OFFICE_ICONS.career} title="Career Assistance" text="Access job referrals, mentoring, and career resources." /></div></section>
  </div>;
}

function Service({ icon, title, text }) { return <article className="office-service"><i><img src={icon} alt="" aria-hidden="true" /></i><div><h3>{title}</h3><p>{text}</p></div></article>; }

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
  const [bookedTimes, setBookedTimes] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch(`${API}/alumni/appointments/staff`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setStaffList(d.staff || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  const officeClosed = settings?.office_status === "Closed";
  const validDates = generateValidDates(settings?.working_days || []);

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
    setSending(true);
    try {
      const res = await fetch(`${API}/alumni/appointments`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ staff_id: staffId, appointment_date: date, appointment_time: time, purpose }),
      });
      const data = await res.json();
      if (!res.ok) { setStatus({ ok: false, text: data.message || "Could not book this appointment." }); return; }
      setStatus({ ok: true, text: data.message || "Booked!" });
      setStaffId(""); setDate(""); setTime(""); setPurpose("");
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
          {officeClosed && <div className="office-inquiry-error">The office is currently closed. Appointments cannot be booked right now.</div>}
          {staffList.length === 0 ? (
            <p className="office-inquiry-error">No staff are currently accepting appointments. Please try again later or send an inquiry instead.</p>
          ) : (
            <label>
              <span>Staff</span>
              <select value={staffId} onChange={(e) => setStaffId(e.target.value)} required disabled={officeClosed}>
                <option value="" disabled>Select a staff member</option>
                {staffList.map((s) => <option key={s._id} value={s._id}>{s.name} ({s.role})</option>)}
              </select>
            </label>
          )}
          {validDates.length === 0 ? (
            <p className="office-inquiry-error">No upcoming office days are configured. Please try again later.</p>
          ) : (
            <label>
              <span>Date</span>
              <select value={date} onChange={(e) => setDate(e.target.value)} required disabled={officeClosed}>
                <option value="" disabled>Select a date</option>
                {validDates.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </label>
          )}
          <label>
            <span>Time</span>
            <select value={time} onChange={(e) => setTime(e.target.value)} required disabled={officeClosed || !date || !staffId}>
              <option value="" disabled>
                {!date || !staffId ? "Pick a staff member and date first" : slotsLoading ? "Loading…" : openSlots.length === 0 ? "No open times for this date" : "Select a time"}
              </option>
              {openSlots.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <label>
            <span>Purpose</span>
            <select value={purpose} onChange={(e) => setPurpose(e.target.value)} required disabled={officeClosed}>
              <option value="" disabled>Select a purpose</option>
              {PURPOSE_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
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
        <button type="submit" disabled={sending || loading || officeClosed || staffList.length === 0 || validDates.length === 0}>{sending ? "Booking…" : "Book"}</button>
      </div>
    </form>
  );
}
