import React, { useEffect, useMemo, useRef, useState } from "react";
import { API, authHeaders } from "../../services/api.js";
import { Modal } from "../../components/common/Primitives.jsx";
import { useAuth } from "../../context/AuthContext";

const AVATAR_COLORS = ["", "blue", "pink", "green", "purple", "orange", "rose", "navy"];
const PAGE_SIZE = 60;
const DEV_PREVIEW = import.meta.env.DEV && import.meta.env.VITE_DEV_AUTH_BYPASS === "true";

const PREVIEW_SUGGESTIONS = [
  { _id: "preview-ana", name: "Ana Reyes", role: "Frontend Developer", company: "Northstar Digital", course: "BSIT", year: 2024, industry: "Information Technology", location: "Tarlac City", skills: "React, JavaScript, Figma", matchScore: 94, matchReason: "Same course, overlapping skills" },
  { _id: "preview-paolo", name: "Paolo Santos", role: "Systems Analyst", company: "Clark Dataworks", course: "BSIS", year: 2023, industry: "Information Technology", location: "Pampanga", skills: "SQL, Business Analysis, Power BI", matchScore: 86, matchReason: "Same industry, nearby batch" },
  { _id: "preview-mika", name: "Mika Torres", role: "UI / UX Designer", company: "Studio Habi", course: "BSIT", year: 2022, industry: "Information Technology", location: "Metro Manila", skills: "Figma, UI/UX, Prototyping", matchScore: 82, matchReason: "Same course, career path match" },
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
  const [sort, setSort] = useState("Best match");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [alumni, setAlumni] = useState([]);
  const [savedProfiles, setSavedProfiles] = useState(() => readSavedProfiles(savedKey));
  const [dismissedIds, setDismissedIds] = useState(() => new Set());
  const [total, setTotal] = useState(0);
  const [filterOptions, setFilterOptions] = useState({ courses: [], years: [] });
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

  useEffect(() => setLimit(PAGE_SIZE), [course, year, appliedSearch]);

  useEffect(() => {
    let active = true;
    if (limit === PAGE_SIZE) setLoading(true);
    else setLoadingMore(true);
    setError("");

    const params = new URLSearchParams();
    if (course !== "All") params.set("course", course);
    if (year !== "All") params.set("year", year);
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
          if (appliedSearch) {
            const query = appliedSearch.toLowerCase();
            suggestions = suggestions.filter((person) => `${person.name} ${person.role} ${person.company}`.toLowerCase().includes(query));
          }
          setAlumni(suggestions);
          setTotal(suggestions.length);
          setFilterOptions({ courses: ["BSCS", "BSIS", "BSIT"], years: [2024, 2023, 2022, 2021] });
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
  }, [course, year, appliedSearch, limit]);

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
        <h1>Alumni You May Know</h1>
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
          <select aria-label="Course" value={course} onChange={(event) => setCourse(event.target.value)}>
            <option>All</option>
            {filterOptions.courses.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select aria-label="Graduation year" value={year} onChange={(event) => setYear(event.target.value)}>
            <option>All</option>
            {filterOptions.years.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select aria-label="Sort alumni" value={sort} onChange={(event) => setSort(event.target.value)}>
            <option>Best match</option>
            <option>Newest batch</option>
            <option>Name</option>
          </select>
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
    <div className={`network-toast${notice ? " show" : ""}`} role="status" aria-live="polite">{notice}</div>
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

function ProfileCard({ person, saved, onDismiss, onSave, onView }) {
  return <article className="alumni-person-card interactive-person-card discovery-person-card">
    <button className="dismiss-suggestion" type="button" aria-label={`Hide ${person.name}`} onClick={onDismiss}>×</button>
    <Avatar person={person} />
    <PersonInfo person={person} />
    <div className="person-card-actions">
      <button className="network-primary" type="button" onClick={onView}>View profile</button>
      <button className={`network-secondary${saved ? " is-saved" : ""}`} type="button" onClick={onSave}>{saved ? "✓ Saved" : "☆ Save"}</button>
    </div>
  </article>;
}

function SavedProfileCard({ person, onRemove, onView }) {
  return <article className="alumni-person-card interactive-person-card saved-person-card">
    <Avatar person={person} />
    <PersonInfo person={person} />
    <div className="person-card-actions">
      <button className="network-primary" type="button" onClick={onView}>View profile</button>
      <button className="network-secondary is-saved" type="button" onClick={onRemove}>Remove saved</button>
    </div>
  </article>;
}

function ProfileModal({ person, saved, onSave, onClose }) {
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
        <div className="profile-detail-wide"><dt>Skills</dt><dd>{person.skills || "Not yet updated"}</dd></div>
      </dl>
      <div className="modal-actions coord-profile-actions network-profile-actions">
        <button className={saved ? "" : "modal-confirm"} type="button" onClick={onSave}>{saved ? "Remove saved" : "☆ Save profile"}</button>
        <button type="button" onClick={onClose}>Close</button>
      </div>
    </section>
  </Modal>;
}
