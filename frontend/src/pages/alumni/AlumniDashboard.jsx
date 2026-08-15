import React, { useState, useEffect } from "react";
import { useLocation, useNavigate, useOutletContext } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { API, authHeaders } from "../../services/api.js";
import Icon from "../../components/common/Icon.jsx";
import { Modal } from "../../components/common/Primitives.jsx";
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

function EventImage({ date, second = false, image, title }) {
  if (image) {
    return <div className="announcement-image"><img src={image} alt={title || ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>;
  }
  // No real photo uploaded for this event — a plain gradient placeholder
  // with just the date badge (no fake caption text, which used to be a
  // hardcoded "CCS ALUMNI CAREER TALK" string baked into the CSS and shown
  // for every event regardless of what it actually was).
  return <div className={`announcement-image event-image${second ? " second" : ""}`}><div className="event-people"><i /><i /><i /></div><span>{date}</span></div>;
}

function fmtEventDate(d) {
  return new Date(d).toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "2-digit" });
}

function fmtEventTime(ev) {
  const opts = { hour: "numeric", minute: "2-digit" };
  const start = new Date(ev.event_datetime).toLocaleTimeString("en-PH", opts);
  if (!ev.end_datetime) return start;
  return `${start} - ${new Date(ev.end_datetime).toLocaleTimeString("en-PH", opts)}`;
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
  const [news, setNews] = useState([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [commentsModal, setCommentsModal] = useState(null);
  const [appliedJobs, setAppliedJobs] = useState([]);
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/alumni/announcements?limit=20`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setNews((d.announcements || []).filter((a) => a.type === "News")))
      .catch(() => {})
      .finally(() => setNewsLoading(false));
  }, []);

  useEffect(() => {
    fetch(`${API}/alumni/events`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setEvents(d.events || []))
      .catch(() => {})
      .finally(() => setEventsLoading(false));
  }, []);

  async function toggleRemind(ev) {
    // Optimistic flip, same pattern as toggleLikeNews.
    setEvents((prev) => prev.map((e) => e._id === ev._id ? { ...e, isInterestedByMe: !e.isInterestedByMe, interested_count: e.interested_count + (e.isInterestedByMe ? -1 : 1) } : e));
    try {
      const res  = await fetch(`${API}/alumni/events/${ev._id}/interested`, { method: "POST", headers: authHeaders() });
      const data = await res.json();
      if (res.ok) setEvents((prev) => prev.map((e) => e._id === ev._id ? { ...e, isInterestedByMe: data.interested } : e));
    } catch { /* keep optimistic state on network failure */ }
  }

  async function toggleLikeNews(ann) {
    // Optimistic flip so the click feels instant; reconciled with the
    // server's actual counts once the request resolves.
    setNews((prev) => prev.map((a) => a._id === ann._id ? { ...a, isLikedByMe: !a.isLikedByMe, likesCount: a.likesCount + (a.isLikedByMe ? -1 : 1) } : a));
    try {
      const res  = await fetch(`${API}/alumni/announcements/${ann._id}/like`, { method: "POST", headers: authHeaders() });
      const data = await res.json();
      if (res.ok) setNews((prev) => prev.map((a) => a._id === ann._id ? { ...a, isLikedByMe: data.liked, likesCount: data.likesCount } : a));
    } catch { /* keep optimistic state on network failure */ }
  }

  async function shareNews(ann) {
    // "Share" silently incrementing a counter with no visible action felt
    // broken — use the real native share sheet where supported, or copy a
    // shareable summary to the clipboard as a fallback, so something the
    // user can actually see/use happens before the count is recorded. This
    // action itself can run every time (sharing the same post to a second
    // friend is normal) — only the count/tracking below is one-time.
    const shareText = `${ann.title}\n\n${ann.description}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: ann.title, text: shareText });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareText);
        setModal({ eyebrow: "Shared", title: "Copied to clipboard", body: "The announcement text has been copied — paste it anywhere to share it." });
      }
    } catch (err) {
      if (err?.name === "AbortError") return; // user cancelled the native share sheet — don't count it
    }

    if (ann.isSharedByMe) return; // trackShare only records a share once per user anyway
    setNews((prev) => prev.map((a) => a._id === ann._id ? { ...a, isSharedByMe: true, sharesCount: a.sharesCount + 1 } : a));
    try {
      const res  = await fetch(`${API}/alumni/announcements/${ann._id}/share`, { method: "POST", headers: authHeaders() });
      const data = await res.json();
      if (res.ok) setNews((prev) => prev.map((a) => a._id === ann._id ? { ...a, sharesCount: data.sharesCount } : a));
    } catch { /* keep optimistic state on network failure */ }
  }

  async function openComments(ann) {
    setCommentsModal({ announcement: ann, comments: [], loading: true, text: "", submitting: false });
    try {
      const res  = await fetch(`${API}/alumni/announcements/${ann._id}/comments`, { headers: authHeaders() });
      const data = await res.json();
      setCommentsModal((m) => (m && m.announcement._id === ann._id) ? { ...m, comments: data.comments || [], loading: false } : m);
    } catch {
      setCommentsModal((m) => m ? { ...m, loading: false } : m);
    }
  }

  async function submitComment() {
    if (!commentsModal?.text?.trim() || commentsModal.submitting) return;
    const annId = commentsModal.announcement._id;
    const text  = commentsModal.text.trim();
    setCommentsModal((m) => ({ ...m, submitting: true }));
    try {
      const res  = await fetch(`${API}/alumni/announcements/${annId}/comment`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) { setCommentsModal((m) => ({ ...m, submitting: false })); return; }
      setCommentsModal((m) => (m && m.announcement._id === annId) ? { ...m, comments: [...m.comments, data.comment], text: "", submitting: false } : m);
      setNews((prev) => prev.map((a) => a._id === annId ? { ...a, commentsCount: data.commentsCount } : a));
    } catch {
      setCommentsModal((m) => m ? { ...m, submitting: false } : m);
    }
  }

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
  const openEventDetails = (ev) => setModal({
    eyebrow: "Event details",
    title: ev.title,
    body: `${ev.description}\n\nSchedule: ${fmtEventTime(ev)}\nVenue: ${ev.location || "TBA"}`,
  });

  const now = new Date();
  const upcomingEvents  = events.filter((e) => new Date(e.event_datetime) >= now).sort((a, b) => new Date(a.event_datetime) - new Date(b.event_datetime));
  const completedEvents = events.filter((e) => new Date(e.event_datetime) <  now).sort((a, b) => new Date(b.event_datetime) - new Date(a.event_datetime));

  return <div className="alumni-page-content announcements-page">
    {sidebarCollapsed && <div className="announcement-filter-bar" aria-label="Announcement filters">
      {["All", "News", "Events"].map(item => <button key={item} type="button" className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}
    </div>}

    {visible("News") && <section className="announcement-section"><h3>News</h3>
      {newsLoading && <p style={{ color: "#76656a", fontSize: 13 }}>Loading news…</p>}
      {!newsLoading && news.length === 0 && <p style={{ color: "#76656a", fontSize: 13 }}>No news posted yet.</p>}
      {!newsLoading && news.slice(0, filter === "News" ? news.length : 1).map((ann) => (
        <article className="announcement-card" key={ann._id}>
          {ann.imageUrl
            ? <div className="announcement-image"><img src={ann.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>
            : <LogoImage />}
          <div className="announcement-body">
            <span className="announcement-tag">{ann.type}</span>
            <h2>{ann.title}</h2>
            <p>{ann.description}</p>
            {ann.location && <p className="announcement-location">📍 {ann.location}</p>}
            <div className="announcement-meta">
              <time>{new Date(ann.createdAt).toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "2-digit" })}</time>
              <button className={`meta-action${ann.isLikedByMe ? " active" : ""}`} type="button" onClick={() => toggleLikeNews(ann)}>Like <b>{ann.likesCount}</b></button>
              <button className="meta-action" type="button" onClick={() => openComments(ann)}>Comments <b>{ann.commentsCount}</b></button>
              <button className={`meta-action${ann.isSharedByMe ? " active" : ""}`} type="button" onClick={() => shareNews(ann)}>Share <b>{ann.sharesCount}</b></button>
            </div>
          </div>
        </article>
      ))}
    </section>}

    {visible("Job Postings") && <section className="announcement-section"><div className="section-heading"><h3>Job Postings</h3>{filter === "Job Postings" && <span>Tip: Complete your profile to get more accurate job recommendations.</span>}</div>
      <JobCard match="75%" title="Web Developer" company="Tech Solutions Inc." place="Manila / Remote" date="March 05, 2026" skills={["React.js", "REST API", "Git"]} applied={appliedJobs.includes("Web Developer")} onApply={applyJob} onDetails={openJobDetails} />
      {filter === "Job Postings" && <>
        <JobCard match="50%" title="UI / UX Designer" company="Digital Creative Studio" place="Clark, Pampanga | Full-Time" date="April 01, 2026" skills={["Figma", "Prototyping", "UX Research"]} variant="purple" applied={appliedJobs.includes("UI / UX Designer")} onApply={applyJob} onDetails={openJobDetails} />
        <button className="view-more" type="button" onClick={() => navigate("/alumni/dashboard?section=jobconnect")}>View More Job Postings</button>
      </>}
    </section>}

    {visible("Events") && <section className="announcement-section"><h3>Events</h3>
      {eventsLoading && <p style={{ color: "#76656a", fontSize: 13 }}>Loading events…</p>}
      {!eventsLoading && upcomingEvents.length === 0 && <p style={{ color: "#76656a", fontSize: 13 }}>No upcoming events yet.</p>}
      {upcomingEvents.map((ev, i) => (
        <EventCard
          key={ev._id}
          second={i % 2 === 1}
          title={ev.title}
          text={ev.description}
          time={fmtEventTime(ev)}
          place={ev.location || "TBA"}
          date={fmtEventDate(ev.event_datetime)}
          image={ev.image}
          reminded={ev.isInterestedByMe}
          onReminder={() => toggleRemind(ev)}
          onDetails={() => openEventDetails(ev)}
        />
      ))}
      {filter === "Events" && completedEvents.length > 0 && <>
        <h3 className="recent-title">Recently Completed</h3>
        {completedEvents.map((ev) => (
          <article className="completed-event" key={ev._id}>
            <EventImage date={fmtEventDate(ev.event_datetime)} image={ev.image} title={ev.title} />
            <div><b>{ev.title}</b><p>{fmtEventDate(ev.event_datetime)} · {ev.interested_count} interested</p></div>
            <span>Completed</span>
          </article>
        ))}
      </>}
    </section>}

    {modal && <ActionModal modal={modal} onClose={() => setModal(null)} />}
    {commentsModal && (
      <CommentsModal
        state={commentsModal}
        onClose={() => setCommentsModal(null)}
        onChangeText={(text) => setCommentsModal((m) => ({ ...m, text }))}
        onSubmit={submitComment}
      />
    )}
  </div>;
}

function AlumniHome({ navigate }) {
  const { user, token } = useAuth();
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.name || "Alumnus";
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [selectedAlumnus, setSelectedAlumnus] = useState(null);

  useEffect(() => {
    if (!token) { setSummaryLoading(false); return; }
    function fetchSummary() {
      fetch(`${API}/alumni/home-summary`, { headers: authHeaders() })
        .then(async (r) => {
          const data = await r.json();
          if (!r.ok) throw new Error(data.message || "Failed to load.");
          setSummary(data);
        })
        .catch((err) => console.error("AlumniHome: could not load home summary", err))
        .finally(() => setSummaryLoading(false));
    }
    // This only ran once on mount before — an alumnus who stays on the Home
    // page while an admin posts a new announcement (or they update their own
    // employment record from elsewhere) never saw the quick-stat cards or
    // profile ring change until a full page reload. Poll for the same reason
    // the topbar notifications and tracer form config already do.
    fetchSummary();
    const interval = setInterval(fetchSummary, 30000);
    return () => clearInterval(interval);
  }, [token]);

  const quickCards = [
    { label: "Latest announcements", value: summaryLoading ? "…" : String(summary?.announcementsCount ?? 0), text: "News, jobs, and campus events", action: "View updates", to: "/alumni/dashboard?section=announcements" },
    { label: "Recommended jobs", value: summaryLoading ? "…" : String(summary?.recommendedJobsCount ?? 0), text: "Matched to your current profile", action: "Browse jobs", to: "/alumni/dashboard?section=jobconnect" },
    { label: "Network matches", value: summaryLoading ? "…" : String(summary?.networkMatchesCount ?? 0), text: "Alumni with similar tracks", action: "Find alumni", to: "/alumni/dashboard?section=suggested" },
  ];
  const profileCompleteness = summary?.profileCompleteness ?? 0;
  const similarAlumni = summary?.similarAlumni || [];

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
          {(summary?.recentUpdates || []).map((u, i) => (
            <button key={i} type="button" onClick={() => navigate(`/alumni/dashboard?section=${u.section}`)}>
              <b>{u.title}</b><span>{u.subtitle ? `${u.kind} · ${u.subtitle}` : u.kind}</span>
            </button>
          ))}
          {!summaryLoading && !(summary?.recentUpdates || []).length && (
            <p style={{ margin: 0, color: "#76656a", fontSize: 13 }}>Nothing needs your attention right now.</p>
          )}
        </div>
      </article>

      <aside className="alumni-home-panel home-profile">
        <div className="profile-ring" style={{ "--pct": profileCompleteness }}><strong>{summaryLoading ? "…" : `${profileCompleteness}%`}</strong></div>
        <h2>{profileCompleteness >= 70 ? "Your profile looks strong" : "Your profile needs an update"}</h2>
        <p>Add your latest role, skills, and certifications to improve job and alumni recommendations.</p>
        <button type="button" onClick={() => navigate("/alumni/dashboard?section=employment")}>Update Employment Details</button>
      </aside>
    </section>

    <section className="alumni-similar-paths">
      <div className="home-panel-head"><span>Career and course matches</span><h2>Alumni with similar paths</h2></div>
      <div className="similar-path-grid">
        {similarAlumni.length === 0 && !summaryLoading && (
          <p style={{ margin: 0, color: "#76656a", fontSize: 13 }}>No other alumni from your course yet.</p>
        )}
        {similarAlumni.map(person => <article
          className="similar-path-card"
          key={person._id || person.name}
          role="button"
          tabIndex={0}
          onClick={() => setSelectedAlumnus(person)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedAlumnus(person); } }}
        >
          <div className="similar-avatar">{person.avatarUrl ? <img src={person.avatarUrl} alt="" /> : person.initials}</div>
          <div><h3>{person.name}</h3><strong>{person.role}</strong><p>{person.match}</p><small>{person.reason}</small></div>
          <span>{person.score} {person.category}</span>
        </article>)}
      </div>
      <button className="similar-view-all" type="button" onClick={() => navigate("/alumni/dashboard?section=suggested")} title="View suggested alumni"><img src={HOME_ICONS.viewSuggested} alt="" aria-hidden="true" /><span>Suggested Alumni</span></button>
    </section>

    {selectedAlumnus && (
      <Modal open onClose={() => setSelectedAlumnus(null)}>
        <section className="tracer-modal coord-alumni-profile" role="dialog" aria-modal="true" aria-label="Alumni profile">
          <div className="modal-head">
            <h3>Alumni Profile</h3>
            <button type="button" aria-label="Close profile" onClick={() => setSelectedAlumnus(null)}>×</button>
          </div>
          <div className="coord-profile-summary">
            <div className="similar-avatar" aria-hidden="true">
              {selectedAlumnus.avatarUrl ? <img src={selectedAlumnus.avatarUrl} alt="" /> : selectedAlumnus.initials}
            </div>
            <div>
              <strong>{selectedAlumnus.name}</strong>
              <span>{selectedAlumnus.role}</span>
            </div>
          </div>
          <dl className="coord-profile-details">
            <div><dt>Company</dt><dd>{selectedAlumnus.company}</dd></div>
            <div><dt>Course</dt><dd>{selectedAlumnus.course || "—"}</dd></div>
            <div><dt>Graduation Year</dt><dd>{selectedAlumnus.year || "—"}</dd></div>
            {selectedAlumnus.industry && <div><dt>Industry</dt><dd>{selectedAlumnus.industry}</dd></div>}
            {selectedAlumnus.location && <div><dt>Location</dt><dd>{selectedAlumnus.location}</dd></div>}
            {selectedAlumnus.skills && <div><dt>Skills</dt><dd>{selectedAlumnus.skills}</dd></div>}
          </dl>
          <div className="modal-actions coord-profile-actions">
            <button type="button" onClick={() => setSelectedAlumnus(null)}>Close</button>
          </div>
        </section>
      </Modal>
    )}
  </div>;
}

function JobCard({ match, title, company, place, date, skills, variant = "blue", applied = false, onApply, onDetails }) {
  const job = { title, company, place, date, skills };
  return <article className="job-match-card"><div className="match-ribbon">{match}<small>Match</small></div><LogoImage variant={variant} /><div className="job-main"><span className="posted">Posted: {date}</span><h2>{title}</h2><div className="company">{company}<br />{place}</div><p>{title === "Web Developer" ? "We are looking for a Web Developer skilled in building responsive and dynamic web applications." : "Create user-centered designs and improve digital experiences."}</p><div className="job-actions"><button className={`primary-card-btn${applied ? " applied" : ""}`} type="button" onClick={() => onApply(job)}>{applied ? "Applied" : "Apply now"}</button><button className="details-btn" type="button" onClick={() => onDetails(job)}>See details {"->"}</button></div></div><aside className="skill-gap"><b>Skill Gap</b><div>{skills.map(s => <span key={s}>{s}</span>)}</div><small>These skills are highly requested by the employer based on your current profile.</small></aside></article>;
}

function EventCard({ title, text, time, place, date, second, image, reminded = false, onReminder, onDetails }) {
  return <article className="announcement-card event-card"><EventImage date={date} second={second} image={image} title={title} /><div className="announcement-body"><button className={`card-bell${reminded ? " active" : ""}`} type="button" onClick={onReminder} aria-label={reminded ? "Remove reminder" : "Set reminder"}>{reminded ? "On" : "Remind"}</button><h2>{title}</h2><p>{text}</p><div className="event-detail">Time: <b>{time}</b></div><div className="event-detail">Location: <b>{place}</b></div><button className="primary-card-btn next-btn" type="button" onClick={onDetails}><span>View Details</span><Icon name="icon-arrow-right" /></button></div></article>;
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

function CommentsModal({ state, onClose, onChangeText, onSubmit }) {
  const { announcement, comments, loading, text, submitting } = state;
  return <div className="alumni-action-overlay" role="dialog" aria-modal="true" aria-label="Comments">
    <div className="alumni-action-modal" style={{ display: "flex", flexDirection: "column", maxHeight: "78vh" }}>
      <div><span>Comments</span><h2 style={{ marginBottom: 0 }}>{announcement.title}</h2></div>
      <div style={{ flex: 1, overflowY: "auto", margin: "12px 0", minHeight: 60 }}>
        {loading && <p style={{ color: "#76656a", fontSize: 13 }}>Loading…</p>}
        {!loading && comments.length === 0 && <p style={{ color: "#76656a", fontSize: 13 }}>No comments yet. Be the first!</p>}
        {comments.map((c, i) => (
          <div className="comment-row" key={c._id || i}>
            <i>{(c.userName || "?")[0]}</i>
            <p><b>{c.userName}</b><br />{c.text}</p>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="text"
          value={text}
          onChange={(e) => onChangeText(e.target.value)}
          placeholder="Write a comment…"
          style={{ flex: 1, padding: "8px 14px", border: "1px solid #ccc", borderRadius: 20, fontSize: 13, outline: "none" }}
          onKeyDown={(e) => { if (e.key === "Enter") onSubmit(); }}
        />
        <button type="button" className="primary-card-btn" disabled={submitting || !text.trim()} onClick={onSubmit}>Send</button>
      </div>
      <div className="alumni-action-modal-buttons">
        <button type="button" className="details-btn" onClick={onClose}>Close</button>
      </div>
    </div>
  </div>;
}
