import React, { useEffect, useRef, useState } from "react";
import { API, authHeaders } from "../../services/api.js";
import { Modal } from "../../components/common/Primitives.jsx";

const AVATAR_COLORS = ["", "blue", "pink", "green", "purple", "orange", "rose", "navy"];

function colorFor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function initials(name = "") {
  return name.split(" ").filter(Boolean).map((word) => word[0]).join("").slice(0, 2).toUpperCase();
}

const PAGE_SIZE = 60;

export default function SuggestedAlumni() {
  const [course, setCourse] = useState("All");
  const [year, setYear] = useState("All");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [alumni, setAlumni] = useState([]);
  const [total, setTotal] = useState(0);
  const [filterOptions, setFilterOptions] = useState({ courses: [], years: [] });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const debounceRef = useRef(null);

  function handleSearchChange(e) {
    const val = e.target.value;
    setSearch(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setAppliedSearch(val), 400);
  }

  // Any filter/search change starts the list over at the first page.
  useEffect(() => { setLimit(PAGE_SIZE); }, [course, year, appliedSearch]);

  useEffect(() => {
    if (limit === PAGE_SIZE) setLoading(true); else setLoadingMore(true);
    setError("");
    const params = new URLSearchParams();
    if (course !== "All") params.set("course", course);
    if (year !== "All") params.set("year", year);
    if (appliedSearch) params.set("search", appliedSearch);
    params.set("limit", limit);

    fetch(`${API}/alumni/suggested?${params.toString()}`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        setAlumni(d.alumni || []);
        setTotal(d.total || 0);
        setFilterOptions(d.filters || { courses: [], years: [] });
      })
      .catch(() => setError("Could not load alumni right now."))
      .finally(() => { setLoading(false); setLoadingMore(false); });
  }, [course, year, appliedSearch, limit]);

  return <div className="alumni-page-content suggested-page">
    <section className="directory-toolbar">
      <div className="directory-filters">
        <span>Filter by</span>
        <select value={course} onChange={(e) => setCourse(e.target.value)}>
          <option>All</option>
          {filterOptions.courses.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={year} onChange={(e) => setYear(e.target.value)}>
          <option>All</option>
          {filterOptions.years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
      <label className="directory-search">
        <span>⌕</span>
        <input value={search} onChange={handleSearchChange} placeholder="Search alumni, role, or company" />
      </label>
    </section>

    <div className="directory-heading"><div><span>Alumni network</span><h2>Suggested Alumni</h2></div><strong>{loading ? "…" : `${alumni.length} of ${total} profiles`}</strong></div>

    {error && <div className="directory-empty"><b>{error}</b></div>}

    {!error && loading && <div className="directory-empty"><b>Loading alumni…</b></div>}

    {!error && !loading && (
      alumni.length ? (
        <div className="alumni-directory-grid">
          {alumni.map((person) => (
            <article className="alumni-person-card" key={person._id}>
              <div className={`directory-avatar ${colorFor(person.name)}`}>
                {person.avatarUrl ? <img src={person.avatarUrl} alt="" /> : initials(person.name)}
              </div>
              <div className="person-info">
                <h3>{person.name}</h3>
                <strong>{person.role}</strong>
                <p>{person.company}</p>
                <span>{person.course}{person.year ? ` · Class of ${person.year}` : ""}</span>
                <span className="person-match">{person.matchScore}% match · {person.matchReason}</span>
              </div>
              <button type="button" onClick={() => setSelected(person)}>View Profile</button>
            </article>
          ))}
        </div>
      ) : (
        <div className="directory-empty"><b>No alumni found</b><span>Try changing your filters or search terms.</span></div>
      )
    )}

    {!error && !loading && alumni.length < total && (
      <div className="directory-load-more">
        <button type="button" disabled={loadingMore} onClick={() => setLimit((l) => l + PAGE_SIZE)}>
          {loadingMore ? "Loading…" : "Load More"}
        </button>
      </div>
    )}

    {selected && (
      <Modal open onClose={() => setSelected(null)}>
        <section className="tracer-modal coord-alumni-profile" role="dialog" aria-modal="true" aria-label="Alumni profile">
          <div className="modal-head">
            <h3>Alumni Profile</h3>
            <button type="button" aria-label="Close profile" onClick={() => setSelected(null)}>×</button>
          </div>
          <div className="coord-profile-summary">
            <div className={`directory-avatar ${colorFor(selected.name)}`} aria-hidden="true">
              {selected.avatarUrl ? <img src={selected.avatarUrl} alt="" /> : initials(selected.name)}
            </div>
            <div>
              <strong>{selected.name}</strong>
              <span>{selected.role}</span>
            </div>
          </div>
          <dl className="coord-profile-details">
            <div><dt>Match</dt><dd>{selected.matchScore}% · {selected.matchReason}</dd></div>
            <div><dt>Company</dt><dd>{selected.company}</dd></div>
            <div><dt>Course</dt><dd>{selected.course || "—"}</dd></div>
            <div><dt>Graduation Year</dt><dd>{selected.year || "—"}</dd></div>
            {selected.industry && <div><dt>Industry</dt><dd>{selected.industry}</dd></div>}
            {selected.location && <div><dt>Location</dt><dd>{selected.location}</dd></div>}
            {selected.skills && <div><dt>Skills</dt><dd>{selected.skills}</dd></div>}
          </dl>
          <div className="modal-actions coord-profile-actions">
            <button type="button" onClick={() => setSelected(null)}>Close</button>
          </div>
        </section>
      </Modal>
    )}
  </div>;
}
