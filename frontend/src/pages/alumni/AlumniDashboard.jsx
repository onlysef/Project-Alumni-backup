import React, { useState } from "react";
import { useLocation, useNavigate, useOutletContext } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import alumniLogo from "../../assets/images/alumni-removebg.png";
import AlumniEmploymentDetails from "./AlumniEmploymentDetails.jsx";
import SuggestedAlumni from "./SuggestedAlumni.jsx";
import AlumniOffice from "./AlumniOffice.jsx";
import CareerRecommendation from "./CareerRecommendation.jsx";
import JobConnect from "./JobConnect.jsx";

const HOME_ICONS = {
  viewSuggested: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2370001d' stroke-width='2.1' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 12s3.4-5 9-5 9 5 9 5-3.4 5-9 5-9-5-9-5z'/%3E%3Ccircle cx='12' cy='12' r='2.4'/%3E%3C/svg%3E",
};

function LogoImage({ variant = "blue" }) {
  return <div className={`announcement-image logo-image ${variant}`}><img src={alumniLogo} alt="Company logo" /></div>;
}

function EventImage({ date, second = false }) {
  return <div className={`announcement-image event-image${second ? " second" : ""}`}><div className="event-people"><i /><i /><i /></div><span>{date}</span></div>;
}

export default function AlumniDashboard() {
  const { section = "home", sidebarCollapsed = false } = useOutletContext() || {};
  const location = useLocation();
  const navigate = useNavigate();
  const filter = section === "jobconnect" ? "Job Postings" : (new URLSearchParams(location.search).get("filter") || "All");

  if (section === "home") return <AlumniHome navigate={navigate} />;
  if (section === "employment") return <AlumniEmploymentDetails />;
  if (section === "suggested") return <SuggestedAlumni />;
  if (section === "office") return <AlumniOffice />;
  if (section === "career") return <CareerRecommendation />;
  if (section === "jobconnect") return <JobConnect />;
  if (section !== "announcements") return <div className="alumni-page-content"><div className="alumni-placeholder"><h2>Alumni Portal</h2><p>This section is ready for its page content.</p></div></div>;

  return <AnnouncementsPage filter={filter} sidebarCollapsed={sidebarCollapsed} navigate={navigate} />;
}

function AnnouncementsPage({ filter, sidebarCollapsed, navigate }) {
  const [modal, setModal] = useState(null);
  const [likedNews, setLikedNews] = useState(false);
  const [sharedNews, setSharedNews] = useState(false);
  const [appliedJobs, setAppliedJobs] = useState([]);
  const [eventReminders, setEventReminders] = useState([]);

  const visible = (type) => filter === "All" || filter === type;
  const setFilter = (item) => navigate(item === "All" ? "/alumni/dashboard?section=announcements" : `/alumni/dashboard?section=announcements&filter=${encodeURIComponent(item)}`);
  const openJobDetails = (job) => setModal({
    eyebrow: "Job details",
    title: job.title,
    body: `${job.company} - ${job.place}. ${job.title === "Web Developer" ? "This role focuses on responsive web applications, API integration, and Git-based collaboration." : "This role focuses on digital product design, prototyping, and user research."}`,
    action: "Go to Job Connect",
    onAction: () => navigate("/alumni/dashboard?section=jobconnect"),
  });
  const applyJob = (job) => {
    setAppliedJobs(prev => prev.includes(job.title) ? prev : [...prev, job.title]);
    setModal({ eyebrow: job.title, title: "Application submitted", body: `Your application for ${job.title} at ${job.company} has been recorded.` });
  };
  const openEventDetails = (event) => setModal({ eyebrow: "Event details", title: event.title, body: `${event.text} Schedule: ${event.time}. Venue: ${event.place}.` });
  const toggleReminder = (title) => setEventReminders(prev => prev.includes(title) ? prev.filter(item => item !== title) : [...prev, title]);

  return <div className="alumni-page-content announcements-page">
    {sidebarCollapsed && <div className="announcement-filter-bar" aria-label="Announcement filters">
      {["All", "News", "Events"].map(item => <button key={item} type="button" className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}
    </div>}

    {visible("News") && <section className="announcement-section"><h3>News</h3>
      <article className="announcement-card">
        <LogoImage />
        <div className="announcement-body">
          <span className="announcement-tag">University Update!</span>
          <h2>Partnerships with Tech Solution Inc. Opens New Opportunities for Alumni</h2>
          <p>The university announces new partnerships with tech companies to support alumni employment opportunities.</p>
          <div className="announcement-meta">
            <time>May 08, 2026</time>
            <button className={`meta-action${likedNews ? " active" : ""}`} type="button" onClick={() => setLikedNews(v => !v)}>Like <b>{likedNews ? 101 : 100}</b></button>
            <button className="meta-action" type="button" onClick={() => setModal({ eyebrow: "University Update", title: "Comments", body: "45 alumni have joined the discussion for this announcement." })}>Comments <b>45</b></button>
            <button className={`meta-action${sharedNews ? " active" : ""}`} type="button" onClick={() => setSharedNews(v => !v)}>Share <b>{sharedNews ? 13 : 12}</b></button>
          </div>
        </div>
      </article>
      {filter === "News" && <div className="news-thread">
        <article className="announcement-card">
          <div className="announcement-image guidance-image"><span>CAREER NOW</span><div>CV</div></div>
          <div className="announcement-body">
            <span className="announcement-tag">Career Services</span>
            <h2>New Career Guidance Resources Now Available</h2>
            <p>Explore new career modules, resume tips, and interview preparation materials on the alumni portal.</p>
            <div className="announcement-meta"><time>May 08, 2026</time><button className="meta-action" type="button">Like <b>100</b></button><button className="meta-action" type="button">Comments <b>45</b></button><button className="meta-action" type="button">Share <b>12</b></button></div>
          </div>
        </article>
        <div className="comments"><div className="comment-row"><i>A</i><p><b>Alu M. Ni</b><br />Nice!!</p></div><div className="comment-row"><i>A</i><button className="comment-input" type="button" onClick={() => setModal({ eyebrow: "Comment", title: "Write a comment", body: "Comment composer is ready for this announcement." })}>Write a comment... <b>Send</b></button></div></div>
      </div>}
    </section>}

    {visible("Job Postings") && <section className="announcement-section"><div className="section-heading"><h3>Job Postings</h3>{filter === "Job Postings" && <span>Tip: Complete your profile to get more accurate job recommendations.</span>}</div>
      <JobCard match="75%" title="Web Developer" company="Tech Solutions Inc." place="Manila / Remote" date="March 05, 2026" skills={["React.js", "REST API", "Git"]} applied={appliedJobs.includes("Web Developer")} onApply={applyJob} onDetails={openJobDetails} />
      {filter === "Job Postings" && <>
        <JobCard match="50%" title="UI / UX Designer" company="Digital Creative Studio" place="Clark, Pampanga | Full-Time" date="April 01, 2026" skills={["Figma", "Prototyping", "UX Research"]} variant="purple" applied={appliedJobs.includes("UI / UX Designer")} onApply={applyJob} onDetails={openJobDetails} />
        <button className="view-more" type="button" onClick={() => navigate("/alumni/dashboard?section=jobconnect")}>View More Job Postings</button>
      </>}
    </section>}

    {visible("Events") && <section className="announcement-section"><h3>Events</h3>
      <EventCard title="CCS Alumni Career Talk and Networking 2026" text="Join us for a career talk and networking event featuring CCS alumni sharing industry insights and experiences." time="9:00 am - 3:00 pm" place="CCS Building, AVR" date="May 15, 2026" reminded={eventReminders.includes("CCS Alumni Career Talk and Networking 2026")} onReminder={toggleReminder} onDetails={openEventDetails} />
      {filter === "Events" && <>
        <EventCard second title="Mock Job Interview Day" text="Practice your interview skills with HR Professionals and Alumni Mentors." time="10:00 am - 4:00 pm" place="TSU Lucinda, Alumni Center" date="June 5, 2026" reminded={eventReminders.includes("Mock Job Interview Day")} onReminder={toggleReminder} onDetails={openEventDetails} />
        <h3 className="recent-title">Recently Completed</h3>
        <article className="completed-event"><EventImage date="April 10, 2026" /><div><b>TSU Alumni Job Fair 2026</b><p>April 10, 2026 | 180 Participants</p></div><span>Completed</span></article>
      </>}
    </section>}

    {modal && <ActionModal modal={modal} onClose={() => setModal(null)} />}
  </div>;
}

function AlumniHome({ navigate }) {
  const { user } = useAuth();
  const name = user?.name || user?.fullName || "Juan";
  const quickCards = [
    { label: "Latest announcements", value: "3", text: "News, jobs, and campus events", action: "View updates", to: "/alumni/dashboard?section=announcements" },
    { label: "Recommended jobs", value: "2", text: "Matched to your current profile", action: "Browse jobs", to: "/alumni/dashboard?section=jobconnect" },
    { label: "Network matches", value: "8", text: "Alumni with similar tracks", action: "Find alumni", to: "/alumni/dashboard?section=suggested" },
  ];

  return <div className="alumni-page-content alumni-home-page">
    <section className="alumni-welcome">
      <div className="alumni-welcome-copy">
        <span>Welcome to the Alumni Portal</span>
        <h1>Hi, {name}</h1>
        <p>Your TSU alumni space brings together announcements, job matches, events, alumni connections, and profile updates so you can keep moving without hunting through separate pages.</p>
        <div className="alumni-welcome-actions">
          <button type="button" onClick={() => navigate("/alumni/dashboard?section=announcements")}>See What's New</button>
          <button type="button" onClick={() => navigate("/alumni/dashboard?section=jobconnect")}>Find Opportunities</button>
        </div>
      </div>
      <div className="alumni-welcome-badge" aria-hidden="true">
        <img src={alumniLogo} alt="" />
        <strong>TSU Alumni Association Inc.</strong>
        <span>Connected - Updated - Career-ready</span>
      </div>
    </section>

    <section className="alumni-home-hero">
      <div><span>Alumni Portal</span><h1>Your dashboard today</h1><p>Track opportunities, campus updates, career matches, and alumni connections in one place.</p></div>
      <button type="button" onClick={() => navigate("/alumni/dashboard?section=announcements")}>View Announcements</button>
    </section>

    <section className="alumni-home-grid">
      {quickCards.map(card => <article className="alumni-home-card" key={card.label}>
        <span>{card.label}</span><strong>{card.value}</strong><p>{card.text}</p><button type="button" onClick={() => navigate(card.to)}>{card.action}</button>
      </article>)}
    </section>

    <section className="alumni-home-layout">
      <article className="alumni-home-panel home-updates">
        <div className="home-panel-head"><span>Today</span><h2>What needs your attention</h2></div>
        <div className="home-update-list">
          <button type="button" onClick={() => navigate("/alumni/dashboard?section=announcements&filter=News")}><b>University partnership update</b><span>New tech opportunities for alumni</span></button>
          <button type="button" onClick={() => navigate("/alumni/dashboard?section=announcements&filter=Events")}><b>CCS Alumni Career Talk</b><span>May 15, 2026 - CCS Building AVR</span></button>
          <button type="button" onClick={() => navigate("/alumni/dashboard?section=jobconnect")}><b>Web Developer match</b><span>75% match - Tech Solutions Inc.</span></button>
        </div>
      </article>

      <aside className="alumni-home-panel home-profile">
        <div className="profile-ring"><strong>92%</strong></div>
        <h2>Your profile looks strong</h2>
        <p>Add your latest role, skills, and certifications to improve job and alumni recommendations.</p>
        <button type="button" onClick={() => navigate("/alumni/dashboard?section=employment")}>Update Employment Details</button>
      </aside>
    </section>

    <section className="alumni-similar-paths">
      <div className="home-panel-head"><span>Career and course matches</span><h2>Alumni with similar paths</h2></div>
      <div className="similar-path-grid">
        {[
          { name: "Joshua Reyes", initials: "JR", role: "Software Engineer", match: "BSCS - React.js - API Development", score: "84%", category: "Course match", reason: "Same course and shared software skills" },
          { name: "Carlo Mendoza", initials: "CM", role: "Web Developer", match: "BSIT - JavaScript - Remote Work", score: "78%", category: "Career match", reason: "Related web development track" },
          { name: "Patricia Lim", initials: "PL", role: "Data Analyst", match: "BSCS - Python - Reporting", score: "72%", category: "Skill match", reason: "Shared programming and analytics skills" },
        ].map(person => <article className="similar-path-card" key={person.name}>
          <div className="similar-avatar">{person.initials}</div>
          <div><h3>{person.name}</h3><strong>{person.role}</strong><p>{person.match}</p><small>{person.reason}</small></div>
          <span>{person.score} {person.category}</span>
        </article>)}
      </div>
      <button className="similar-view-all" type="button" onClick={() => navigate("/alumni/dashboard?section=suggested")} title="View suggested alumni"><img src={HOME_ICONS.viewSuggested} alt="" aria-hidden="true" /><span>Suggested Alumni</span></button>
    </section>
  </div>;
}

function JobCard({ match, title, company, place, date, skills, variant = "blue", applied = false, onApply, onDetails }) {
  const job = { title, company, place, date, skills };
  return <article className="job-match-card"><div className="match-ribbon">{match}<small>Match</small></div><LogoImage variant={variant} /><div className="job-main"><span className="posted">Posted: {date}</span><h2>{title}</h2><div className="company">{company}<br />{place}</div><p>{title === "Web Developer" ? "We are looking for a Web Developer skilled in building responsive and dynamic web applications." : "Create user-centered designs and improve digital experiences."}</p><div className="job-actions"><button className={`primary-card-btn${applied ? " applied" : ""}`} type="button" onClick={() => onApply(job)}>{applied ? "Applied" : "Apply now"}</button><button className="details-btn" type="button" onClick={() => onDetails(job)}>See details {"->"}</button></div></div><aside className="skill-gap"><b>Skill Gap</b><div>{skills.map(s => <span key={s}>{s}</span>)}</div><small>These skills are highly requested by the employer based on your current profile.</small></aside></article>;
}

function EventCard({ title, text, time, place, date, second, reminded = false, onReminder, onDetails }) {
  const event = { title, text, time, place, date };
  return <article className="announcement-card event-card"><EventImage date={date} second={second} /><div className="announcement-body"><button className={`card-bell${reminded ? " active" : ""}`} type="button" onClick={() => onReminder(title)} aria-label={reminded ? "Remove reminder" : "Set reminder"}>{reminded ? "On" : "Remind"}</button><h2>{title}</h2><p>{text}</p><div className="event-detail">Time: <b>{time}</b></div><div className="event-detail">Location: <b>{place}</b></div><button className="primary-card-btn next-btn" type="button" onClick={() => onDetails(event)}>View Details {"->"}</button></div></article>;
}

function ActionModal({ modal, onClose }) {
  return <div className="alumni-action-overlay" role="dialog" aria-modal="true" aria-label={modal.title}>
    <div className="alumni-action-modal">
      <div><span>{modal.eyebrow}</span><h2>{modal.title}</h2><p>{modal.body}</p></div>
      <div className="alumni-action-modal-buttons">
        <button type="button" className="details-btn" onClick={onClose}>Close</button>
        {modal.action && <button type="button" className="primary-card-btn" onClick={() => { modal.onAction?.(); onClose(); }}>{modal.action}</button>}
      </div>
    </div>
  </div>;
}
