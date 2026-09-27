import React, { useEffect, useMemo, useRef, useState } from "react";
import { API, authHeaders, apiFetch } from "../../services/api.js";
import { Modal } from "../../components/common/Primitives.jsx";
import { useAuth } from "../../context/AuthContext";

const AVATAR_COLORS = ["", "blue", "pink", "green", "purple", "orange", "rose", "navy"];
const PAGE_SIZE = 60;
const DEV_PREVIEW = import.meta.env.DEV && import.meta.env.VITE_DEV_AUTH_BYPASS === "true";

const PREVIEW_SUGGESTIONS = [
  { _id: "preview-ana", name: "Ana Reyes", email: "ana.reyes@example.com", role: "Frontend Developer", company: "Northstar Digital", course: "BSIT", year: 2024, industry: "Information Technology", location: "Tarlac City", skills: "React, JavaScript, Figma", matchScore: 94, matchReason: "Same course, overlapping skills" },
  { _id: "preview-paolo", name: "Paolo Santos", email: "paolo.santos@example.com", role: "Systems Analyst", company: "Clark Dataworks", course: "BSIS", year: 2023, industry: "Information Technology", location: "Pampanga", skills: "SQL, Business Analysis, Power BI", matchScore: 86, matchReason: "Same industry, nearby batch" },
  { _id: "preview-mika", name: "Mika Torres", email: "mika.torres@example.com", role: "UI / UX Designer", company: "Studio Habi", course: "BSIT", year: 2022, industry: "Information Technology", location: "Metro Manila", skills: "Figma, UI/UX, Prototyping", matchScore: 82, matchReason: "Same course, career path match" },
  { _id: "preview-carlo", name: "Carlo Mendoza", role: "Network Engineer", company: "Luzon Networks", course: "BSIT", year: 2021, industry: "Information Technology", location: "Tarlac City", skills: "Cisco, Linux, Network Security", matchScore: 78, matchReason: "Same course" },
  { _id: "preview-liza", name: "Liza Ramos", role: "Data Analyst", company: "Central Luzon Analytics", course: "BSCS", year: 2022, industry: "Information Technology", location: "Tarlac City", skills: "SQL, Python, Tableau", matchScore: 75, matchReason: "Overlapping skills" },
  { _id: "preview-juan", name: "Juan Dela Cruz", role: "Software Engineer", company: "Agritech Solutions", course: "BSIT", year: 2024, industry: "Information Technology", location: "Quezon City", skills: "Python, Java, PHP", matchScore: 72, matchReason: "Same course, same batch" },
];

function colorFor(name = "") {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function initials(name = "") {
  return name.split(" ").filter(Boolean).map((word) => word[0]).join("").slice(0, 2).toUpperCase();
}

function readSavedProfiles(savedKey) {
  try {
    const value = JSON.parse(localStorage.getItem(savedKey));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export default function SuggestedAlumni() {
  const { user } = useAuth();
  const savedKey = `savedAlumniSuggestions_${user?.id || "anon"}`;
  const [activeView, setActiveView] = useState("suggestions");
  const [course, setCourse] = useState("All");
  const [year, setYear] = useState("All");
  const [industry, setIndustry] = useState("All");
  const [location, setLocation] = useState("All");
  const [sort, setSort] = useState("Best match");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [alumni, setAlumni] = useState([]);
  const [savedProfiles, setSavedProfiles] = useState(() => readSavedProfiles(savedKey));
  const [dismissedIds, setDismissedIds] = useState(() => new Set());
  const [total, setTotal] = useState(0);
  const [filterOptions, setFilterOptions] = useState({ courses: [], years: [], industries: [], locations: [] });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [notice, setNotice] = useState("");
  const debounceRef = useRef(null);
  const noticeTimer = useRef(null);

  useEffect(() => () => {
    window.clearTimeout(debounceRef.current);
    window.clearTimeout(noticeTimer.current);
  }, []);

  function showNotice(message) {
    setNotice(message);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 2500);
  }

  function handleSearchChange(event) {
    const value = event.target.value;
    setSearch(value);
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => setAppliedSearch(value), 350);
  }

  useEffect(() => setLimit(PAGE_SIZE), [course, year, industry, location, appliedSearch]);

  useEffect(() => {
    let active = true;
    if (limit === PAGE_SIZE) setLoading(true);
    else setLoadingMore(true);
    setError("");

    const params = new URLSearchParams();
    if (course !== "All") params.set("course", course);
    if (year !== "All") params.set("year", year);
    if (industry !== "All") params.set("industry", industry);
    if (location !== "All") params.set("location", location);
    if (appliedSearch) params.set("search", appliedSearch);
    params.set("limit", limit);

    fetch(`${API}/alumni/suggested?${params.toString()}`, { headers: authHeaders() })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load suggestions.");
        return response.json();
      })
      .then((data) => {
        if (!active) return;
        setAlumni(data.alumni || []);
        setTotal(data.total || 0);
        setFilterOptions(data.filters || { courses: [], years: [] });
      })
      .catch(() => {
        if (!active) return;
        if (DEV_PREVIEW) {
          let suggestions = PREVIEW_SUGGESTIONS;
          if (course !== "All") suggestions = suggestions.filter((person) => person.course === course);
          if (year !== "All") suggestions = suggestions.filter((person) => String(person.year) === String(year));
          if (industry !== "All") suggestions = suggestions.filter((person) => person.industry === industry);
          if (location !== "All") suggestions = suggestions.filter((person) => person.location === location);
          if (appliedSearch) {
            const query = appliedSearch.toLowerCase();
            suggestions = suggestions.filter((person) => `${person.name} ${person.role} ${person.company}`.toLowerCase().includes(query));
          }
          setAlumni(suggestions);
          setTotal(suggestions.length);
          setFilterOptions({
            courses: ["BSCS", "BSIS", "BSIT"],
            years: [2024, 2023, 2022, 2021],
            industries: [...new Set(PREVIEW_SUGGESTIONS.map((p) => p.industry).filter(Boolean))],
            locations: [...new Set(PREVIEW_SUGGESTIONS.map((p) => p.location).filter(Boolean))],
          });
        } else {
          setError("Could not load alumni right now.");
        }
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
        setLoadingMore(false);
      });

    return () => { active = false; };
  }, [course, year, industry, location, appliedSearch, limit]);

  const visibleSuggestions = useMemo(() => {
    const profiles = alumni.filter((person) => !dismissedIds.has(person._id));
    return [...profiles].sort((first, second) => {
      if (sort === "Name") return first.name.localeCompare(second.name);
      if (sort === "Newest batch") return Number(second.year || 0) - Number(first.year || 0);
      return Number(second.matchScore || 0) - Number(first.matchScore || 0);
    });
  }, [alumni, dismissedIds, sort]);

  const displayedSaved = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return savedProfiles;
    return savedProfiles.filter((person) => `${person.name} ${person.role} ${person.company}`.toLowerCase().includes(query));
  }, [savedProfiles, search]);

  const savedIds = useMemo(() => new Set(savedProfiles.map((person) => person._id)), [savedProfiles]);
  const topMatch = useMemo(
    () => visibleSuggestions.reduce((max, person) => Math.max(max, Number(person.matchScore || 0)), 0),
    [visibleSuggestions]
  );

  function toggleSaved(person) {
    setSavedProfiles((current) => {
      const exists = current.some((item) => item._id === person._id);
      const next = exists ? current.filter((item) => item._id !== person._id) : [{ ...person }, ...current];
      localStorage.setItem(savedKey, JSON.stringify(next));
      showNotice(exists ? `${person.name} removed from saved profiles.` : `${person.name} saved for later.`);
      return next;
    });
  }

  function dismiss(person) {
    setDismissedIds((current) => {
      const next = new Set(current);
      next.add(person._id);
      return next;
    });
    if (selected?._id === person._id) setSelected(null);
    showNotice(`${person.name} hidden from suggestions.`);
  }

  return <div className="alumni-page-content suggested-page network-page">
    <section className="network-hero">
      <div>
        <span>Explore the TSU alumni community</span>
        <h1>Alumni Network</h1>
        <p>Browse professional profiles matched by course, batch, industry, and shared skills.</p>
      </div>
      <div className="network-summary" aria-label="Alumni suggestion summary">
        <div><strong>{visibleSuggestions.length}</strong><span>Profiles</span></div>
        <div><strong>{savedProfiles.length}</strong><span>Saved</span></div>
        <div><strong>{topMatch ? `${topMatch}%` : "—"}</strong><span>Top match</span></div>
      </div>
    </section>

    <nav className="network-tabs alumni-discovery-tabs" aria-label="Alumni discovery views">
      <button type="button" className={activeView === "suggestions" ? "active" : ""} onClick={() => setActiveView("suggestions")}>Suggestions<span>{visibleSuggestions.length}</span></button>
      <button type="button" className={activeView === "saved" ? "active" : ""} onClick={() => setActiveView("saved")}>Saved profiles<span>{savedProfiles.length}</span></button>
    </nav>

    <section className="directory-toolbar" aria-label="Filter alumni suggestions">
      <div className="directory-filters">
        <span>{activeView === "saved" ? "Saved alumni" : "Filter by"}</span>
        {activeView === "suggestions" && <>
          <label className="directory-filter-field">
            <span>Course</span>
            <select value={course} onChange={(event) => setCourse(event.target.value)}>
              <option>All</option>
              {filterOptions.courses.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="directory-filter-field">
            <span>Batch</span>
            <select value={year} onChange={(event) => setYear(event.target.value)}>
              <option>All</option>
              {filterOptions.years.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="directory-filter-field">
            <span>Industry</span>
            <select value={industry} onChange={(event) => setIndustry(event.target.value)}>
              <option>All</option>
              {filterOptions.industries.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="directory-filter-field">
            <span>Location</span>
            <select value={location} onChange={(event) => setLocation(event.target.value)}>
              <option>All</option>
              {filterOptions.locations.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="directory-filter-field">
            <span>Sort by</span>
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              <option>Best match</option>
              <option>Newest batch</option>
              <option>Name</option>
            </select>
          </label>
        </>}
      </div>
      <label className="directory-search">
        <span aria-hidden="true">⌕</span>
        <input aria-label="Search alumni" value={search} onChange={handleSearchChange} placeholder="Search alumni, role, or company" />
      </label>
    </section>

    {activeView === "suggestions" && <>
      <NetworkHeading eyebrow="Personalized profiles" title="Suggested for you" count={loading ? "…" : `${visibleSuggestions.length} of ${total}`} />
      {error && <NetworkEmpty title={error} />}
      {!error && loading && <NetworkEmpty title="Finding alumni matches…" />}
      {!error && !loading && (visibleSuggestions.length
        ? <div className="alumni-directory-grid interactive-directory-grid">
            {visibleSuggestions.map((person) => <ProfileCard key={person._id} person={person} saved={savedIds.has(person._id)} onDismiss={() => dismiss(person)} onSave={() => toggleSaved(person)} onView={() => setSelected(person)} />)}
          </div>
        : <NetworkEmpty title="No profiles found" message="Try changing the filters or search terms." />)}
      {!error && !loading && alumni.length < total && <div className="directory-load-more"><button type="button" disabled={loadingMore} onClick={() => setLimit((current) => current + PAGE_SIZE)}>{loadingMore ? "Loading…" : "Load More"}</button></div>}
    </>}

    {activeView === "saved" && <>
      <NetworkHeading eyebrow="Your shortlist" title="Saved alumni profiles" count={`${displayedSaved.length} saved`} />
      {displayedSaved.length
        ? <div className="alumni-directory-grid interactive-directory-grid">
            {displayedSaved.map((person) => <SavedProfileCard key={person._id} person={person} onRemove={() => toggleSaved(person)} onView={() => setSelected(person)} />)}
          </div>
        : <NetworkEmpty title="No saved profiles" message="Save an alumni profile to quickly find it again here." />}
    </>}

    {selected && <ProfileModal person={selected} saved={savedIds.has(selected._id)} onSave={() => toggleSaved(selected)} onClose={() => setSelected(null)} />}
    {notice && <div className="network-toast show" role="status" aria-live="polite">{notice}</div>}
  </div>;
}

function NetworkHeading({ eyebrow, title, count }) {
  return <div className="directory-heading network-heading"><div><span>{eyebrow}</span><h2>{title}</h2></div><strong>{count}</strong></div>;
}

function NetworkEmpty({ title, message }) {
  return <div className="directory-empty network-empty"><b>{title}</b>{message && <span>{message}</span>}</div>;
}

function Avatar({ person, large = false }) {
  return <div className={`directory-avatar ${colorFor(person.name)}${large ? " large" : ""}`}>{person.avatarUrl ? <img src={person.avatarUrl} alt="" /> : initials(person.name)}</div>;
}

function PersonInfo({ person, showMatch = true }) {
  return <div className="person-info">
    <h3>{person.name}</h3>
    <strong>{person.role}</strong>
    <p>{person.company}</p>
    <span>{person.course || "Course not updated"}{person.year ? ` · Class of ${person.year}` : ""}</span>
    {showMatch && person.matchScore && <span className="person-match">{person.matchScore}% match · {person.matchReason}</span>}
  </div>;
}

// The whole card opens the profile; Save and Hide sit as icon buttons in the
// top-right corner and stop the click from bubbling to the card.
function cardKeyActivate(handler) {
  return (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); handler(); }
  };
}

function ProfileCard({ person, saved, onDismiss, onSave, onView }) {
  return <article className="alumni-person-card interactive-person-card discovery-person-card card-clickable" role="button" tabIndex={0} onClick={onView} onKeyDown={cardKeyActivate(onView)} aria-label={`View ${person.name}'s profile`}>
    <div className="person-card-corner">
      <button className={`card-corner-btn${saved ? " is-saved" : ""}`} type="button" aria-label={saved ? `Remove ${person.name} from saved` : `Save ${person.name}`} aria-pressed={saved} onClick={(e) => { e.stopPropagation(); onSave(); }}>{saved ? "★" : "☆"}</button>
      <button className="card-corner-btn dismiss-suggestion" type="button" aria-label={`Hide ${person.name}`} onClick={(e) => { e.stopPropagation(); onDismiss(); }}>×</button>
    </div>
    <Avatar person={person} />
    <PersonInfo person={person} />
  </article>;
}

function SavedProfileCard({ person, onRemove, onView }) {
  return <article className="alumni-person-card interactive-person-card saved-person-card card-clickable" role="button" tabIndex={0} onClick={onView} onKeyDown={cardKeyActivate(onView)} aria-label={`View ${person.name}'s profile`}>
    <div className="person-card-corner">
      <button className="card-corner-btn is-saved" type="button" aria-label={`Remove ${person.name} from saved`} aria-pressed="true" onClick={(e) => { e.stopPropagation(); onRemove(); }}>★</button>
    </div>
    <Avatar person={person} />
    <PersonInfo person={person} />
  </article>;
}

// Alumni type these in freely (e.g. "facebook.com/name" with no scheme), so
// normalize before using as an href or the link silently resolves relative
// to the current page instead of opening the external profile.
function externalHref(value) {
  if (!value) return "";
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function ProfileModal({ person, saved, onSave, onClose }) {
  const [mailOpen, setMailOpen] = useState(false);
  const [mailDraft, setMailDraft] = useState({ subject: `Hello ${person.name}`, message: "" });
  const [mailSending, setMailSending] = useState(false);
  const [mailError, setMailError] = useState("");
  const [mailSent, setMailSent] = useState(false);

  async function sendMail() {
    if (!mailDraft.subject.trim() || !mailDraft.message.trim()) return;
    setMailSending(true);
    setMailError("");
    try {
      await apiFetch(`/alumni/network/${person._id}/message`, { method: "POST", body: mailDraft });
      setMailSent(true);
      setMailOpen(false);
    } catch (err) {
      setMailError(err.message || "Could not send the message.");
    } finally {
      setMailSending(false);
    }
  }

  return <Modal open onClose={onClose}>
    <section className="tracer-modal coord-alumni-profile network-profile-modal" role="dialog" aria-modal="true" aria-label={`${person.name} profile`}>
      <div className="modal-head"><h3>Alumni Profile</h3><button type="button" aria-label="Close profile" onClick={onClose}>×</button></div>
      <div className="coord-profile-summary network-profile-summary">
        <Avatar person={person} large />
        <div><strong>{person.name}</strong><span>{person.role}</span><small>{person.company}</small></div>
      </div>
      {person.matchScore && <div className="profile-match-banner"><strong>{person.matchScore}% match</strong><span>{person.matchReason}</span></div>}
      <dl className="coord-profile-details">
        <div><dt>Course</dt><dd>{person.course || "—"}</dd></div>
        <div><dt>Graduation Year</dt><dd>{person.year || "—"}</dd></div>
        <div><dt>Industry</dt><dd>{person.industry || "—"}</dd></div>
        <div><dt>Location</dt><dd>{person.location || "—"}</dd></div>
        <div className="profile-detail-wide"><dt>Email</dt><dd>{person.email ? <a href={`mailto:${person.email}`}>{person.email}</a> : "Not available"}</dd></div>
        <div className="profile-detail-wide"><dt>Skills</dt><dd>{person.skills || "Not yet updated"}</dd></div>
      </dl>

      {mailOpen ? (
        <div className="network-mail-compose">
          <label>Subject<input value={mailDraft.subject} onChange={(e) => setMailDraft({ ...mailDraft, subject: e.target.value })} required /></label>
          <label>Message<textarea rows={5} value={mailDraft.message} onChange={(e) => setMailDraft({ ...mailDraft, message: e.target.value })} placeholder={`Write a message to ${person.name}…`} required /></label>
          {mailError && <p className="network-mail-error">{mailError}</p>}
          <div className="modal-actions coord-profile-actions network-profile-actions">
            <button type="button" onClick={() => { setMailOpen(false); setMailError(""); }}>Cancel</button>
            <button className="modal-confirm" type="button" onClick={sendMail} disabled={mailSending || !mailDraft.subject.trim() || !mailDraft.message.trim()}>{mailSending ? "Sending…" : "Send"}</button>
          </div>
        </div>
      ) : (
        <div className="modal-actions coord-profile-actions network-profile-actions">
          <button className={saved ? "" : "modal-confirm"} type="button" onClick={onSave}><StarIcon filled={saved} />{saved ? "Remove saved" : "Save profile"}</button>
          {person.facebook && <a className="network-social-button network-facebook-button" href={externalHref(person.facebook)} target="_blank" rel="noopener noreferrer"><FacebookIcon />Facebook</a>}
          {person.linkedin && <a className="network-social-button network-linkedin-button" href={externalHref(person.linkedin)} target="_blank" rel="noopener noreferrer"><LinkedInIcon />LinkedIn</a>}
          {person.email && <button className="modal-confirm network-email-button" type="button" onClick={() => setMailOpen(true)}><MailIcon />{mailSent ? "Send another email" : "Send an email"}</button>}
        </div>
      )}
      {mailSent && !mailOpen && <p className="network-mail-sent">Message sent to {person.name}.</p>}
    </section>
  </Modal>;
}

function StarIcon({ filled }) {
  return <svg className="btn-icon" viewBox="0 0 24 24" aria-hidden="true" style={{ fill: filled ? "currentColor" : "none" }}><path d="m12 3 2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6L5.3 9.4l6-.9z" /></svg>;
}

function MailIcon() {
  return <svg className="btn-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>;
}

function FacebookIcon() {
  return <svg className="btn-icon" viewBox="0 0 24 24" aria-hidden="true" style={{ fill: "currentColor", stroke: "none" }}><path d="M14 8.5h2.2V5.6c-.38-.05-1.68-.16-3.2-.16-3.17 0-5.34 1.99-5.34 5.65v2.75H4.4V17h3.26v9h3.7v-9h3.13l.5-3.16h-3.63v-2.35c0-.91.25-1.54 1.64-1.54Z" /></svg>;
}

function LinkedInIcon() {
  return <svg className="btn-icon" viewBox="0 0 24 24" aria-hidden="true" style={{ fill: "currentColor", stroke: "none" }}><path d="M6.94 8.5a1.94 1.94 0 1 0 0-3.88 1.94 1.94 0 0 0 0 3.88ZM5.1 10.2h3.68V19H5.1v-8.8Zm5.86 0h3.53v1.2h.05c.49-.93 1.7-1.9 3.5-1.9 3.74 0 4.43 2.46 4.43 5.66V19h-3.68v-4.06c0-.97-.02-2.22-1.35-2.22-1.36 0-1.57 1.06-1.57 2.15V19h-3.68v-8.8Z" /></svg>;
}
