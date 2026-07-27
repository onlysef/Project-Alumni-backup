import React from "react";

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

const hours = [
  ["Monday", "8:00 AM - 5:00 PM"], ["Tuesday", "8:00 AM - 5:00 PM"],
  ["Wednesday", "8:00 AM - 5:00 PM"], ["Thursday", "8:00 AM - 5:00 PM"],
  ["Friday", "8:00 AM - 5:00 PM"], ["Saturday", "Closed"], ["Sunday", "Closed"],
];

function officeStatus() {
  const now = new Date();
  const day = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const open = day >= 1 && day <= 5 && minutes >= 480 && minutes < 1020;
  return { open, text: open ? "Open now" : "Currently closed" };
}

export default function AlumniOffice() {
  const status = officeStatus();
  return <div className="alumni-page-content alumni-office-page">
    <section className="office-hero"><div><span>TSU Alumni Association</span><h1>How can the Alumni Office help?</h1><p>Visit or contact the office for alumni records, document requests, membership concerns, and career support.</p></div><div className={`office-status ${status.open ? "open" : "closed"}`}><i />{status.text}</div></section>

    <div className="office-layout"><section className="office-hours-card"><div className="office-section-head"><div className="office-head-icon"><img src={OFFICE_ICONS.clock} alt="" aria-hidden="true" /></div><div><span>Plan your visit</span><h2>Office Hours</h2></div></div><div className="hours-list">{hours.map(([day, time]) => <div className={time === "Closed" ? "closed-day" : ""} key={day}><strong>{day}</strong><span>{time}</span></div>)}</div><p className="hours-note">Closed on public holidays and university-declared suspension days.</p></section>

      <div className="office-side"><section className="office-contact-card"><h2>Contact & Location</h2><div className="contact-row"><img className="contact-icon" src={OFFICE_ICONS.location} alt="" aria-hidden="true" /><div><span>Visit us</span><strong>Alumni Center, Lucinda Campus<br />Tarlac State University</strong></div></div><div className="contact-row"><img className="contact-icon" src={OFFICE_ICONS.phone} alt="" aria-hidden="true" /><div><span>Call us</span><strong>(045) 606-8123 local 205</strong></div></div><div className="contact-row"><img className="contact-icon" src={OFFICE_ICONS.mail} alt="" aria-hidden="true" /><div><span>Email us</span><strong>alumni@tsu.edu.ph</strong></div></div><button type="button">Send an Inquiry</button></section><section className="visit-reminder"><b>Before you visit</b><p>Bring one valid ID and your alumni or student number for faster verification.</p></section></div>
    </div>

    <section className="office-services"><div className="office-services-head"><span>Available assistance</span><h2>Alumni Office Services</h2></div><div className="service-grid"><Service icon={OFFICE_ICONS.records} title="Alumni Records" text="Update your contact, employment, and personal information." /><Service icon={OFFICE_ICONS.docs} title="Document Requests" text="Request certifications and alumni-related documents." /><Service icon={OFFICE_ICONS.membership} title="Membership Support" text="Get help with alumni ID and association membership." /><Service icon={OFFICE_ICONS.career} title="Career Assistance" text="Access job referrals, mentoring, and career resources." /></div></section>
  </div>;
}

function Service({ icon, title, text }) { return <article className="office-service"><i><img src={icon} alt="" aria-hidden="true" /></i><div><h3>{title}</h3><p>{text}</p></div></article>; }
