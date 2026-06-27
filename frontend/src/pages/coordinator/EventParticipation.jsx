import React, { useState, useEffect, useCallback, useRef } from "react";
import { useOutletContext, useLocation } from "react-router-dom";
import Icon from "../../components/common/Icon.jsx";

import { API, authHeaders, apiFetch } from "../../services/api.js";
const authGet = (path) => apiFetch(path);

function nowTime() {
  return new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function fmtDate(dt) {
  return new Date(dt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}
function fmtTime(dt) {
  return new Date(dt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default function EventParticipation() {
  const { showToast } = useOutletContext();
  const location = useLocation();
  // ── Events list ──────────────────────────────────────────────
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState("");

  // ── Form state ───────────────────────────────────────────────
  const [alumniSearch, setAlumniSearch] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selectedAlumni, setSelectedAlumni] = useState(null);
  const [timeIn, setTimeIn] = useState(nowTime());
  const [status, setStatus] = useState("Present");
  const [submitting, setSubmitting] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef(null);
  const debounceRef = useRef(null);

  // ── Stats ────────────────────────────────────────────────────
  const [stats, setStats] = useState(null);

  // ── Records table ────────────────────────────────────────────
  const [records, setRecords] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [tableSearch, setTableSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [tableLoading, setTableLoading] = useState(false);
  const tableDebounceRef = useRef(null);

  // ── View Event modal ─────────────────────────────────────────
  const [viewEvent, setViewEvent] = useState(null);

  // ── Load events on mount ─────────────────────────────────────
  useEffect(() => {
    const targetId = location.state?.eventId ? String(location.state.eventId) : null;
    authGet("/coordinator/attendance/events").then(data => {
      const evts = data.events ?? [];
      setEvents(evts);
      if (targetId && evts.some(e => String(e._id) === targetId)) {
        setSelectedEventId(targetId);
      } else if (evts.length > 0 && !selectedEventId) {
        setSelectedEventId(String(evts[0]._id));
      }
    });
  }, []);

  // ── Load stats when event changes ─────────────────────────────
  const loadStats = useCallback(async (eventId) => {
    if (!eventId) return;
    try {
      const data = await authGet(`/coordinator/attendance/${eventId}/stats`);
      setStats(data);
    } catch { setStats(null); }
  }, []);

  // ── Load records ─────────────────────────────────────────────
  const loadRecords = useCallback(async (eventId, pg, search, stFilter) => {
    if (!eventId) return;
    setTableLoading(true);
    try {
      const params = new URLSearchParams({ page: pg, limit: 10 });
      if (search)   params.set("search", search);
      if (stFilter) params.set("status", stFilter);
      const data = await authGet(`/coordinator/attendance/${eventId}/records?${params}`);
      setRecords(data.records ?? []);
      setPagination(data.pagination ?? null);
    } catch { showToast?.("Failed to load records."); }
    finally { setTableLoading(false); }
  }, []);

  useEffect(() => {
    if (selectedEventId) {
      loadStats(selectedEventId);
      loadRecords(selectedEventId, 1, "", "");
      setPage(1);
      setTableSearch("");
      setAppliedSearch("");
      setStatusFilter("");
    }
  }, [selectedEventId]);

  useEffect(() => {
    loadRecords(selectedEventId, page, appliedSearch, statusFilter);
  }, [page, appliedSearch, statusFilter]);

  // ── Alumni search debounce ───────────────────────────────────
  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (alumniSearch.length < 2) { setSearchResults([]); setShowDropdown(false); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await authGet(`/coordinator/attendance/alumni-search?q=${encodeURIComponent(alumniSearch)}`);
        setSearchResults(data.alumni ?? []);
        setShowDropdown(true);
      } catch { setSearchResults([]); }
    }, 300);
  }, [alumniSearch]);

  // close dropdown on outside click
  useEffect(() => {
    function handler(e) {
      if (searchRef.current && !searchRef.current.contains(e.target)) setShowDropdown(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function selectAlumni(a) {
    setSelectedAlumni(a);
    setAlumniSearch(`${a.firstName} ${a.lastName}`);
    setShowDropdown(false);
  }

  function clearAlumni() {
    setSelectedAlumni(null);
    setAlumniSearch("");
    setSearchResults([]);
  }

  async function handleRecord(e) {
    e.preventDefault();
    if (!selectedEventId)   { showToast?.("Select an event first."); return; }
    if (!selectedAlumni)    { showToast?.("Select an alumni first."); return; }
    setSubmitting(true);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`${API}/coordinator/attendance`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id:  selectedEventId,
          alumni_id: String(selectedAlumni._id),
          status,
          time_in:   timeIn,
        }),
      });
      const data = await res.json();
      if (!res.ok) { showToast?.(data.message || "Failed to record attendance."); return; }
      showToast?.("Attendance recorded.");
      clearAlumni();
      setTimeIn(nowTime());
      setStatus("Present");
      loadStats(selectedEventId);
      loadRecords(selectedEventId, page, appliedSearch, statusFilter);
    } catch {
      showToast?.("Failed to record attendance.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleTableSearch(e) {
    const val = e.target.value;
    setTableSearch(val);
    clearTimeout(tableDebounceRef.current);
    tableDebounceRef.current = setTimeout(() => { setAppliedSearch(val); setPage(1); }, 400);
  }

  function handleStatusFilter(e) {
    setStatusFilter(e.target.value);
    setPage(1);
  }

  async function handleViewEvent() {
    if (!selectedEventId) return;
    try {
      const data = await authGet(`/coordinator/attendance/${selectedEventId}/details`);
      setViewEvent(data.event ?? null);
    } catch { showToast?.("Failed to load event details."); }
  }

  function handleExport(format) {
    if (!selectedEventId) { showToast?.("Select an event first."); return; }
    const token = localStorage.getItem("auth_token");
    const url = `${API}/coordinator/attendance/${selectedEventId}/export?format=${format}`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `attendance.${format}`;
        a.click();
        URL.revokeObjectURL(a.href);
        showToast?.(`Exported as .${format}`);
      })
      .catch(() => showToast?.("Export failed."));
  }

  const selectedEvent = events.find(e => String(e._id) === selectedEventId);
  const idNo   = selectedAlumni ? String(selectedAlumni._id).slice(-8).toUpperCase() : "";
  const course = selectedAlumni?.course || "";

  // Attendance window status
  const attendanceStatus = (() => {
    if (!selectedEvent) return "no_event";
    const now   = new Date();
    const start = new Date(selectedEvent.event_datetime);
    if (now < start) return "not_started";
    const end = selectedEvent.end_datetime
      ? new Date(selectedEvent.end_datetime)
      : (() => { const d = new Date(selectedEvent.event_datetime); d.setHours(23, 59, 59, 999); return d; })();
    if (now > end) return "ended";
    return "open";
  })();

  // Schedule display string
  const scheduleLabel = selectedEvent
    ? (() => {
        const start = fmtDate(selectedEvent.event_datetime) + " | " + fmtTime(selectedEvent.event_datetime);
        return selectedEvent.end_datetime
          ? start + " – " + fmtTime(selectedEvent.end_datetime)
          : start;
      })()
    : null;

  return (
    <section className={`content coordinator-content view active-view`}>
      <div className="coord-participation-grid">

        {/* ── LEFT: form ── */}
        <form className="coord-attendance-card" onSubmit={handleRecord}>
          <h3>Attendance Log</h3>

          <label>
            Event:
            <select value={selectedEventId} onChange={e => setSelectedEventId(e.target.value)}>
              {events.length === 0
                ? <option value="">No events</option>
                : events.map(ev => (
                  <option key={String(ev._id)} value={String(ev._id)}>
                    {ev.title}
                  </option>
                ))
              }
            </select>
          </label>

          {scheduleLabel && (
            <p className="coord-event-schedule">
              {scheduleLabel}
            </p>
          )}

          {attendanceStatus === "not_started" && (
            <p className="coord-attendance-notice coord-notice-warn">
              Attendance is not yet open. This event has not started yet.
            </p>
          )}
          {attendanceStatus === "ended" && (
            <p className="coord-attendance-notice coord-notice-error">
              Attendance is already closed. This event has ended.
            </p>
          )}

          <label ref={searchRef} style={{ position: "relative" }}>
            Name:
            <div style={{ position: "relative", flex: 1 }}>
              <input
                placeholder="Search alumni by name or email"
                value={alumniSearch}
                onChange={e => { setAlumniSearch(e.target.value); setSelectedAlumni(null); }}
                autoComplete="off"
              />
              {showDropdown && searchResults.length > 0 && (
                <div className="coord-alumni-dropdown">
                  {searchResults.map(a => (
                    <div
                      key={String(a._id)}
                      className="coord-alumni-option"
                      onMouseDown={() => selectAlumni(a)}
                    >
                      <strong>{a.firstName} {a.lastName}</strong>
                      <span>{a.course || ""} · {a.email}</span>
                    </div>
                  ))}
                </div>
              )}
              {showDropdown && searchResults.length === 0 && alumniSearch.length >= 2 && (
                <div className="coord-alumni-dropdown">
                  <div className="coord-alumni-empty">No alumni found.</div>
                </div>
              )}
            </div>
          </label>

          <div className="coord-form-row">
            <label>
              ID No.
              <input value={idNo} readOnly placeholder="Auto-fill" />
            </label>
            <label>
              Course:
              <input value={course} readOnly placeholder="Auto-fill" />
            </label>
          </div>

          <div className="coord-form-row">
            <label>
              Time In:
              <input value={timeIn} onChange={e => setTimeIn(e.target.value)} />
            </label>
            <label>
              Status:
              <select value={status} onChange={e => setStatus(e.target.value)}>
                <option>Present</option>
              </select>
            </label>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting || attendanceStatus !== "open"}
          >
            <Icon name="icon-save" /> {submitting ? "Recording…" : "Record"}
          </button>
        </form>

        {/* ── RIGHT: stats ── */}
        <aside className="coord-current-status">
          <div className="coord-status-grid">
            <strong>{stats?.attendees ?? 0}<span>Attendees</span></strong>
            <strong>{stats?.feedbacks ?? 0}<span>Feedbacks</span></strong>
            <strong>{stats?.capacity ?? 0}<span>Capacity</span></strong>
            <strong>{stats ? `${stats.rate}%` : "0%"}<span>Rate</span></strong>
          </div>
          <p>
            Top Course Attending: <b>{stats?.topCourse ?? "—"}</b>
            <br />
            Lowest Participation: <b>{stats?.lowestCourse ?? "—"}</b>
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ marginTop: 10, fontSize: 12 }}
            onClick={() => { loadStats(selectedEventId); loadRecords(selectedEventId, page, appliedSearch, statusFilter); }}
          >
            <Icon name="icon-update" /> Refresh
          </button>
        </aside>
      </div>

      {/* ── Records table ── */}
      <section className="coord-records-card">
        <h3>Event Records</h3>
        <div className="coord-record-toolbar coord-employ-toolbar">
          <select
            value={selectedEventId}
            onChange={e => setSelectedEventId(e.target.value)}
            style={{ flex: "0 0 auto", width: 220 }}
          >
            {events.map(ev => (
              <option key={String(ev._id)} value={String(ev._id)}>
                {ev.title} ({ev.event_datetime ? fmtDate(ev.event_datetime) : ""})
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={handleStatusFilter}
            style={{ flex: "0 0 auto", width: 120 }}
          >
            <option value="">All Status</option>
            <option>Present</option>
          </select>
          <input
            className="coord-employ-search"
            placeholder="Search name, course, email…"
            value={tableSearch}
            onChange={handleTableSearch}
          />
        </div>

        {tableLoading ? (
          <p className="coord-employ-empty">Loading…</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Course</th>
                <th>Time In</th>
                <th>Status</th>
                <th>Feedback</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr><td colSpan={5} className="coord-employ-empty">No records found.</td></tr>
              ) : (
                records.map(r => (
                  <tr key={String(r._id)}>
                    <td data-label="Name">{r.name}</td>
                    <td data-label="Course">{r.course || "—"}</td>
                    <td data-label="Time In">{r.time_in}</td>
                    <td data-label="Status">
                      <span className={`coord-status-pill attendance-status ${String(r.status || "").toLowerCase()}`}>
                        {r.status}
                      </span>
                    </td>
                    <td data-label="Feedback">{r.feedback ? "Yes" : ""}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}

        {pagination && (
          <div className="coord-employ-pagination">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>‹ Prev</button>
            <span>Page {page} of {pagination.pages}</span>
            <button disabled={page >= pagination.pages} onClick={() => setPage(p => p + 1)}>Next ›</button>
          </div>
        )}

        <div className="coord-record-actions">
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" className="btn btn-primary" onClick={() => handleExport("xlsx")}>
              <Icon name="icon-export" /> Excel
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => handleExport("csv")}>
              <Icon name="icon-export" /> CSV
            </button>
          </div>
          <button type="button" className="btn btn-secondary" onClick={handleViewEvent}>
            <Icon name="icon-view" /> View Event
          </button>
        </div>
      </section>

      {/* ── View Event Modal ── */}
      {viewEvent && (
        <div className="coord-modal-backdrop" onClick={() => setViewEvent(null)}>
          <div className="coord-modal" onClick={e => e.stopPropagation()}>
            <div className="coord-modal-head">
              <h3>Event Details</h3>
              <button type="button" onClick={() => setViewEvent(null)}>&times;</button>
            </div>
            <div className="coord-modal-body" style={{ gap: 14 }}>
              <h4 style={{ margin: 0, color: "var(--maroon)", fontSize: 15 }}>{viewEvent.title}</h4>
              {viewEvent.description && <p style={{ margin: 0, fontSize: 13 }}>{viewEvent.description}</p>}
              <div className="coord-event-detail-grid">
                <span>Date</span><span>{viewEvent.event_datetime ? fmtDate(viewEvent.event_datetime) : "—"}</span>
                <span>Time</span><span>{viewEvent.event_datetime ? fmtTime(viewEvent.event_datetime) : "—"}</span>
                <span>Location</span><span>{viewEvent.location || "—"}</span>
                <span>Capacity</span><span>{viewEvent.capacity || "—"}</span>
                <span>Total Attendees</span><span>{viewEvent.total_attendees ?? 0}</span>
                <span>Attendance Rate</span><span>{viewEvent.capacity > 0 ? `${viewEvent.attendance_rate}%` : "—"}</span>
                <span>Colleges</span><span>{viewEvent.visibility === "Public" ? "All Colleges" : (viewEvent.visibility || "—")}</span>
                <span>Feedback Responses</span><span>{viewEvent.feedback_responses ?? 0}</span>
              </div>
            </div>
            <div className="coord-modal-foot">
              <button type="button" className="btn btn-secondary" onClick={() => setViewEvent(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
