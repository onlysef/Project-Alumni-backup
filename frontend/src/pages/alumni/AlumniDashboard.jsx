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
import { JobCard } from "../../components/alumni/JobPostingCard.jsx";

const HOME_ICONS = {
  viewSuggested: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2370001d' stroke-width='2.1' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 12s3.4-5 9-5 9 5 9 5-3.4 5-9 5-9-5-9-5z'/%3E%3Ccircle cx='12' cy='12' r='2.4'/%3E%3C/svg%3E",
};

function SocialActionIcon({ type }) {
  if (type === "like") return <svg className="social-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10v10H4V10h3Zm2 10h7.5a2 2 0 0 0 1.94-1.52l1.17-4.7A2 2 0 0 0 17.67 11H14l.55-3.3A2.2 2.2 0 0 0 12.38 5L9 10v10Z" /></svg>;
  if (type === "comment") return <svg className="social-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-7.8 7.5 9.3 9.3 0 0 1-3.65-.76L4 20l1.3-4A7.1 7.1 0 0 1 4.5 12 7.5 7.5 0 0 1 12.3 4.5 7.5 7.5 0 0 1 20 11.5Z" /></svg>;
  return <svg className="social-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m13 5 7 7-7 7v-4.4c-4.6 0-7.4 1.4-9 4.4.45-5.7 3.5-9.4 9-9.4V5Z" /></svg>;
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

// Same "ended" definition as coordinator/EventManagement.jsx's computeStatus()
// and the backend's feedbackController.isEventEnded() — an event that has
// started but not yet reached its end (or end-of-start-day, with no
// end_datetime) is still ongoing, not "completed". Splitting on bare
// event_datetime instead used to drop a same-day event into "Recently
// Completed" — hidden from the default Events section — the moment its
// start time passed, even while it was still actively running.
function isEventOver(ev) {
  const start = new Date(ev.event_datetime);
  const end = ev.end_datetime
    ? new Date(ev.end_datetime)
    : new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59, 999);
  return new Date() > end;
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
  const [appliedUrls, setAppliedUrls] = useState([]);
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [feedbackModal, setFeedbackModal] = useState(null);
  const [responseModal, setResponseModal] = useState(null);
  const [jobPostings, setJobPostings] = useState([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [savedJobs, setSavedJobs] = useState([]);
  const savedUrls = new Set(savedJobs.map((j) => j.url));

  useEffect(() => {
    fetch(`${API}/alumni/jobs/search`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setJobPostings(d.jobs || []))
      .catch(() => {})
      .finally(() => setJobsLoading(false));
    fetch(`${API}/alumni/jobs/saved`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setSavedJobs(d.jobs || []))
      .catch(() => {});
    // Was never loaded at all — every job card on this page rendered as if
    // nothing had been applied to yet, even for jobs the alumnus already
    // applied to here or on Job Connect (which does load this correctly).
    fetch(`${API}/alumni/applications`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setAppliedUrls((d.applications || []).map((a) => a.url)))
      .catch(() => {});
  }, []);

  function toggleSaveJob(job) {
    const wasSaved = savedUrls.has(job.url);
    fetch(`${API}/alumni/jobs/saved/toggle`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(job),
    })
      .then(() => setSavedJobs((prev) => wasSaved ? prev.filter((j) => j.url !== job.url) : [{ ...job, createdAt: new Date().toISOString() }, ...prev]))
      .catch(() => {});
  }

  useEffect(() => {
    fetch(`${API}/alumni/announcements?limit=20`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setNews(d.announcements || []))
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

  function openGiveFeedback(ev) {
    setFeedbackModal({
      event: ev,
      rating: 0,
      ratings: { organization: 0, content: 0, venue: 0, satisfaction: 0 },
      comments: "",
      submitting: false,
      error: "",
    });
  }

  function patchFeedbackModal(patch) {
    setFeedbackModal((m) => (m ? { ...m, ...patch, error: "" } : m));
  }

  async function submitGivenFeedback() {
    if (!feedbackModal) return;
    if (!feedbackModal.rating) {
      setFeedbackModal((m) => (m ? { ...m, error: "Please give an overall rating." } : m));
      return;
    }
    setFeedbackModal((m) => (m ? { ...m, submitting: true, error: "" } : m));
    try {
      const res = await fetch(`${API}/alumni/events/${feedbackModal.event._id}/feedback`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          rating: feedbackModal.rating,
          ratings: feedbackModal.ratings,
          feedback: feedbackModal.comments,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedbackModal((m) => (m ? { ...m, submitting: false, error: data.message || "Could not submit feedback." } : m));
        return;
      }
      // Same event object shape getAlumniEvents already returns — flips the
      // card straight to "Submitted" without a full refetch.
      setEvents((prev) => prev.map((e) => e._id === feedbackModal.event._id ? { ...e, feedbackStatus: "submitted" } : e));
      setFeedbackModal(null);
    } catch {
      setFeedbackModal((m) => (m ? { ...m, submitting: false, error: "Network error. Please try again." } : m));
    }
  }

  async function openViewResponse(ev) {
    setResponseModal({ event: ev, loading: true, data: null });
    try {
      const res  = await fetch(`${API}/alumni/events/${ev._id}/feedback`, { headers: authHeaders() });
      const data = await res.json();
      setResponseModal((m) => (m && m.event._id === ev._id) ? { ...m, loading: false, data: res.ok ? data.feedback : null } : m);
    } catch {
      setResponseModal((m) => (m ? { ...m, loading: false, data: null } : m));
    }
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
    body: stripHtmlShort(job.description, 400) || `${job.company} - ${[job.location, job.type].filter(Boolean).join(" / ")}`,
    action: "Go to Job Connect",
    onAction: () => navigate("/alumni/dashboard?section=jobconnect"),
  });
  // The shared JobCard's "Apply now" is a real <a href={job.url}
  // target="_blank"> — the browser already opens the real Careerjet
  // posting on click, so this only needs to log it (same as Job Connect's
  // own Apply button) so it shows up in "Your Applications" too, instead of
  // a separate fake "submitted" toast that recorded nothing.
  const applyJob = (job) => {
    if (!appliedUrls.includes(job.url)) {
      setAppliedUrls(prev => [...prev, job.url]);
      fetch(`${API}/alumni/applications`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(job),
      }).catch(() => {});
    }
  };
  const openEventDetails = (ev) => setModal({
    eyebrow: "Event details",
    title: ev.title,
    body: `${ev.description}\n\nSchedule: ${fmtEventTime(ev)}\nVenue: ${ev.location || "TBA"}`,
  });

  const upcomingEvents  = events.filter((e) => !isEventOver(e)).sort((a, b) => new Date(a.event_datetime) - new Date(b.event_datetime));
  const completedEvents = events.filter((e) => isEventOver(e)).sort((a, b) => new Date(b.event_datetime) - new Date(a.event_datetime));

  return <div className="alumni-page-content announcements-page">
    {sidebarCollapsed && <div className="announcement-filter-bar" aria-label="Announcement filters">
      {["All", "News", "Events"].map(item => <button key={item} type="button" className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}
    </div>}

    {visible("News") && <section className="announcement-section"><h3>News</h3>
      {newsLoading && <p style={{ color: "#76656a", fontSize: 13 }}>Loading news…</p>}
      {!newsLoading && news.length === 0 && <p style={{ color: "#76656a", fontSize: 13 }}>No news posted yet.</p>}
      {!newsLoading && news.slice(0, filter === "News" ? news.length : 3).map((ann) => (
        <article className="announcement-card news-post" key={ann._id}>
          <header className="news-post-head">
            <span className="news-post-avatar"><img src={alumniLogo} alt="" /></span>
            <div className="news-post-byline">
              <b>TSU Alumni Association Office</b>
              <span>
                {new Date(ann.createdAt).toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "2-digit" })}
                {" · "}<span className="news-post-tag">{ann.type}</span>
              </span>
            </div>
          </header>
          <div className="news-post-text">
            <h2>{ann.title}</h2>
            <p>{ann.description}</p>
            {ann.location && <p className="announcement-location">📍 {ann.location}</p>}
          </div>
          {ann.imageUrl
            ? <div className="news-post-media"><img src={ann.imageUrl} alt="" /></div>
            : <div className="news-post-media logo-fallback"><img src={alumniLogo} alt="" /></div>}
          {(ann.likesCount > 0 || ann.commentsCount > 0 || ann.sharesCount > 0) && (
            <div className="news-post-counts">
              <span className="news-post-likes">
                {ann.likesCount > 0 && <><SocialActionIcon type="like" />{ann.likesCount}</>}
              </span>
              <span className="news-post-cs">
                {ann.commentsCount > 0 && <button type="button" onClick={() => openComments(ann)}>{ann.commentsCount} comment{ann.commentsCount === 1 ? "" : "s"}</button>}
                {ann.sharesCount > 0 && <span>{ann.sharesCount} share{ann.sharesCount === 1 ? "" : "s"}</span>}
              </span>
            </div>
          )}
          <div className="news-post-actions">
            <button className={`meta-action${ann.isLikedByMe ? " active" : ""}`} type="button" onClick={() => toggleLikeNews(ann)}><SocialActionIcon type="like" />Like</button>
            <button className="meta-action" type="button" onClick={() => openComments(ann)}><SocialActionIcon type="comment" />Comment</button>
            <button className={`meta-action${ann.isSharedByMe ? " active" : ""}`} type="button" onClick={() => shareNews(ann)}><SocialActionIcon type="share" />Share</button>
          </div>
        </article>
      ))}
    </section>}

    {visible("Job Postings") && <section className="announcement-section"><div className="section-heading"><h3>Job Postings</h3>{filter === "Job Postings" && <span>Tip: Complete your profile to get more accurate job recommendations.</span>}</div>
      {jobsLoading && <p style={{ color: "#76656a", fontSize: 13 }}>Loading job postings…</p>}
      {!jobsLoading && jobPostings.length === 0 && <p style={{ color: "#76656a", fontSize: 13 }}>No matching job postings yet — complete your Alumni Profile to get recommendations.</p>}
      {!jobsLoading && jobPostings.length > 0 && (
        // Reuses Job Connect's own card sizing (scoped under .job-connect-page)
        // so this preview looks identical to the real list, not a smaller
        // hand-tuned variant that can drift out of sync with it.
        <div className="job-connect-page">
          <div className="job-connect-list">
            {jobPostings.slice(0, filter === "Job Postings" ? jobPostings.length : 3).map((job) => (
              <JobCard key={job.url} job={job} saved={savedUrls.has(job.url)} applied={appliedUrls.includes(job.url)} onToggleSave={() => toggleSaveJob(job)} onApply={() => applyJob(job)} onViewDetails={() => openJobDetails(job)} />
            ))}
          </div>
        </div>
      )}
      {filter === "Job Postings" && !jobsLoading && jobPostings.length > 0 && (
        <button className="view-more" type="button" onClick={() => navigate("/alumni/dashboard?section=jobconnect")}>View More Job Postings</button>
      )}
    </section>}

    {visible("Events") && <section className="announcement-section"><h3>Events</h3>
      {eventsLoading && <p style={{ color: "#76656a", fontSize: 13 }}>Loading events…</p>}
      {!eventsLoading && upcomingEvents.length === 0 && <p style={{ color: "#76656a", fontSize: 13 }}>No upcoming events yet.</p>}
      {upcomingEvents.slice(0, filter === "Events" ? upcomingEvents.length : 3).map((ev, i) => (
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
            <EventFeedbackAction event={ev} onGiveFeedback={() => openGiveFeedback(ev)} onViewResponse={() => openViewResponse(ev)} />
          </article>
        ))}
      </>}
    </section>}

    {modal && <ActionModal modal={modal} onClose={() => setModal(null)} />}
    {feedbackModal && (
      <EventFeedbackFormModal
        state={feedbackModal}
        onClose={() => setFeedbackModal(null)}
        onChange={patchFeedbackModal}
        onSubmit={submitGivenFeedback}
      />
    )}
    {responseModal && (
      <EventFeedbackResponseModal state={responseModal} onClose={() => setResponseModal(null)} />
    )}
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
        <button type="button" onClick={() => navigate("/alumni/dashboard?section=employment")}>Update Alumni Profile</button>
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
      <button className="similar-view-all" type="button" onClick={() => navigate("/alumni/dashboard?section=suggested")} title="View alumni network"><img src={HOME_ICONS.viewSuggested} alt="" aria-hidden="true" /><span>Alumni Network</span></button>
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
        </section>
      </Modal>
    )}
  </div>;
}

function stripHtmlShort(value, max = 160) {
  const text = String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
}


function EventCard({ title, text, time, place, date, second, image, reminded = false, onReminder, onDetails }) {
  return <article className="announcement-card event-card"><EventImage date={date} second={second} image={image} title={title} /><div className="announcement-body"><button className={`card-bell${reminded ? " active" : ""}`} type="button" onClick={onReminder} aria-label={reminded ? "Remove reminder" : "Set reminder"}>{reminded ? "On" : "Remind"}</button><h2>{title}</h2><p>{text}</p><div className="event-detail">Time: <b>{time}</b></div><div className="event-detail">Location: <b>{place}</b></div><div className="event-detail">Feedback: <b>Not Available</b></div><button className="primary-card-btn next-btn" type="button" onClick={onDetails}><span>View Details</span><Icon name="icon-arrow-right" /></button></div></article>;
}

// Drives the status pill + action button on a "Recently Completed" event
// card — entirely from what the backend already resolved (ev.attended,
// ev.feedbackStatus). Never independently re-derives "has this ended" or
// "did they attend" on the frontend — the backend is the actual gate.
function EventFeedbackAction({ event, onGiveFeedback, onViewResponse }) {
  if (event.feedbackStatus === "submitted") {
    return <div className="completed-event-feedback">
      <span className="feedback-status-pill fb-submitted">Feedback: Submitted</span>
      <button type="button" className="details-btn" onClick={onViewResponse}>View Response</button>
    </div>;
  }
  if (event.feedbackStatus === "available") {
    return <div className="completed-event-feedback">
      <span className="feedback-status-pill fb-available">Feedback: Available</span>
      <button type="button" className="primary-card-btn" onClick={onGiveFeedback}>Give Feedback</button>
    </div>;
  }
  return <div className="completed-event-feedback">
    <span className="feedback-status-pill fb-unavailable">Feedback: Not Available</span>
    <small>{event.attended
      ? "Feedback will open once this event has fully ended."
      : "Feedback is only available to alumni who attended this event."}</small>
  </div>;
}

function StarRating({ label, value, onChange, size = "md", readOnly = false }) {
  return <div className={`star-rating star-rating-${size}`}>
    {label && <span className="star-rating-label">{label}</span>}
    <div className="star-rating-stars" role={readOnly ? undefined : "radiogroup"} aria-label={label || "Rating"}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={`star${n <= (value || 0) ? " filled" : ""}`}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
          aria-pressed={n === value}
          disabled={readOnly}
          onClick={() => !readOnly && onChange(n)}
        >★</button>
      ))}
    </div>
  </div>;
}

function EventFeedbackFormModal({ state, onClose, onChange, onSubmit }) {
  const { event, rating, ratings, comments, submitting, error } = state;
  return <div className="alumni-action-overlay" role="dialog" aria-modal="true" aria-label={`Give feedback for ${event.title}`}>
    <div className="alumni-action-modal event-feedback-modal">
      <div><span>Event feedback</span><h2>{event.title}</h2></div>
      <div className="event-feedback-fields">
        <StarRating label="Overall rating" value={rating} onChange={(v) => onChange({ rating: v })} />
        <div className="event-feedback-subratings">
          <StarRating label="Organization" size="sm" value={ratings.organization} onChange={(v) => onChange({ ratings: { ...ratings, organization: v } })} />
          <StarRating label="Content / program" size="sm" value={ratings.content} onChange={(v) => onChange({ ratings: { ...ratings, content: v } })} />
          <StarRating label="Venue" size="sm" value={ratings.venue} onChange={(v) => onChange({ ratings: { ...ratings, venue: v } })} />
          <StarRating label="Satisfaction" size="sm" value={ratings.satisfaction} onChange={(v) => onChange({ ratings: { ...ratings, satisfaction: v } })} />
        </div>
        <label className="event-feedback-comments">
          <span>Comments</span>
          <textarea rows="4" value={comments} onChange={(e) => onChange({ comments: e.target.value })} placeholder="What stood out, good or bad?" />
        </label>
      </div>
      {error && <p className="event-feedback-error">{error}</p>}
      <div className="alumni-action-modal-buttons">
        <button type="button" className="details-btn" onClick={onClose} disabled={submitting}>Cancel</button>
        <button type="button" className="primary-card-btn" onClick={onSubmit} disabled={submitting}>{submitting ? "Submitting…" : "Submit Feedback"}</button>
      </div>
    </div>
  </div>;
}

function EventFeedbackResponseModal({ state, onClose }) {
  const { event, loading, data } = state;
  return <div className="alumni-action-overlay" role="dialog" aria-modal="true" aria-label={`Your feedback for ${event.title}`}>
    <div className="alumni-action-modal event-feedback-modal">
      <div><span>Your feedback</span><h2>{event.title}</h2></div>
      {loading && <p style={{ color: "#76656a", fontSize: 13 }}>Loading…</p>}
      {!loading && !data && <p style={{ color: "#76656a", fontSize: 13 }}>Could not load your response.</p>}
      {!loading && data && <div className="event-feedback-readonly">
        <StarRating label="Overall rating" value={data.rating} readOnly onChange={() => {}} />
        <div className="event-feedback-subratings">
          {data.ratings?.organization ? <StarRating label="Organization" size="sm" value={data.ratings.organization} readOnly onChange={() => {}} /> : null}
          {data.ratings?.content ? <StarRating label="Content / program" size="sm" value={data.ratings.content} readOnly onChange={() => {}} /> : null}
          {data.ratings?.venue ? <StarRating label="Venue" size="sm" value={data.ratings.venue} readOnly onChange={() => {}} /> : null}
          {data.ratings?.satisfaction ? <StarRating label="Satisfaction" size="sm" value={data.ratings.satisfaction} readOnly onChange={() => {}} /> : null}
        </div>
        {data.feedback && <div className="event-feedback-comments-readonly"><span>Your comments</span><p>{data.feedback}</p></div>}
        <p className="event-feedback-submitted-at">Submitted {new Date(data.createdAt).toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "2-digit" })}</p>
      </div>}
      <div className="alumni-action-modal-buttons">
        <button type="button" className="details-btn" onClick={onClose}>Close</button>
      </div>
    </div>
  </div>;
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

const COMMENT_EMOJIS = ["😀", "😂", "😍", "👍", "❤️", "🎉"];

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
      <div className="alumni-comment-composer">
        <div className="alumni-comment-emojis" aria-label="Add emoji">
          {COMMENT_EMOJIS.map((emoji) => (
            <button type="button" key={emoji} aria-label={`Add ${emoji}`} onClick={() => onChangeText(text + emoji)}>
              {emoji}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={text}
          onChange={(e) => onChangeText(e.target.value)}
          placeholder="Write a comment…"
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
