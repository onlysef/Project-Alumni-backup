import React, { useState, useEffect, useCallback, useRef } from "react";
import ReactDOM from "react-dom";
import { useOutletContext, useLocation } from "react-router-dom";
import Icon from "../../components/common/Icon.jsx";
import { useAuth } from "../../context/AuthContext.jsx";

import { apiFetch } from "../../services/api.js";

const apiGet    = (path)       => apiFetch(path);
const apiPost   = (path, body) => apiFetch(path, { method: "POST",   body });
const apiPut    = (path, body) => apiFetch(path, { method: "PUT",    body });
const apiDelete = (path)       => apiFetch(path, { method: "DELETE" });

const STATUS_ORDER = { "On Going": 0, "Coming Soon": 1, "Ended": 2 };

const COLLEGES = [
  "CPAG", "CCS", "COS", "CIT", "COE",
  "CBA", "COED", "CASS", "CCJE", "CAFA",
];

function computeStatus(event_datetime, end_datetime) {
  const now = new Date();
  const start = new Date(event_datetime);
  // Multi-day events stay On Going until end_datetime (or the end of the start day).
  const end = end_datetime
    ? new Date(end_datetime)
    : new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59, 999);
  if (now < start) return "Coming Soon";
  if (now > end) return "Ended";
  return "On Going";
}

function fmtDate(dt) {
  return new Date(dt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}
function fmtTime(dt) {
  return new Date(dt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function toDatetimeLocal(dt) {
  if (!dt) return "";
  const d = new Date(dt);
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// The past-date check applies only when the start is being changed.
function validateEventDates(startStr, endStr, previousStartStr) {
  if (!startStr) return "";
  const start = new Date(startStr);
  if (isNaN(start.getTime())) return "Invalid start date & time.";
  const startIsChanging = previousStartStr === undefined || startStr !== previousStartStr;
  if (startIsChanging && start < new Date()) return "Event date & time cannot be in the past.";
  if (endStr) {
    const end = new Date(endStr);
    if (isNaN(end.getTime())) return "Invalid end date & time.";
    if (end <= start) return "End date & time must be after the start date & time.";
  }
  return "";
}

function blankForm(myCollege) {
  return { title: "", description: "", location: "", event_datetime: "", end_datetime: "", visibility: myCollege || "Public", capacity: "", image: "" };
}

export default function EventManagement() {
  const { showToast } = useOutletContext();
  const { user } = useAuth();
  const myCollege = user?.college || "";
  const location = useLocation();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [highlightId, setHighlightId] = useState(null);
  const highlightRef = useRef(null);
  const [form, setForm] = useState(() => blankForm(myCollege));
  const [submitting, setSubmitting] = useState(false);

  // modals
  const [editEvent, setEditEvent] = useState(null);
  const [editForm, setEditForm] = useState(() => blankForm(myCollege));
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [interestedModal, setInterestedModal] = useState(null);
  const [interestedList, setInterestedList] = useState([]);
  const [interestedLoading, setInterestedLoading] = useState(false);

  const fileInputRef = useRef(null);

  function handleImagePick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast?.("Please choose an image file.");
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      showToast?.("Image must be 3MB or smaller.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setForm(p => ({ ...p, image: reader.result }));
    reader.readAsDataURL(file);
  }

  function clearImage() {
    setForm(p => ({ ...p, image: "" }));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet("/coordinator/events");
      setEvents(data.events ?? []);
    } catch {
      showToast?.("Failed to load events.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  // Pre-highlight event when navigated from activity feed
  useEffect(() => {
    const id = location.state?.eventId;
    if (id) setHighlightId(String(id));
  }, [location.state]);

  // Scroll highlighted event into view once rendered
  useEffect(() => {
    if (highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightId, events]);

  // sorted copy for List of Events panel
  const sortedEvents = [...events].sort((a, b) =>
    STATUS_ORDER[computeStatus(a.event_datetime, a.end_datetime)] - STATUS_ORDER[computeStatus(b.event_datetime, b.end_datetime)]
  );

  const [listYearFilter, setListYearFilter] = useState("");
  const eventYears = [...new Set(events.map(e => new Date(e.event_datetime).getFullYear()))].sort((a, b) => b - a);
  const visibleEvents = listYearFilter
    ? sortedEvents.filter(e => String(new Date(e.event_datetime).getFullYear()) === listYearFilter)
    : sortedEvents;

  // recent posts = newest first (already sorted desc by backend)
  const recentEvents = [...events];

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.title.trim())          { showToast?.("Title is required."); return; }
    if (!form.event_datetime)        { showToast?.("Date & time is required."); return; }
    const dateError = validateEventDates(form.event_datetime, form.end_datetime);
    if (dateError)                   { showToast?.(dateError); return; }
    setSubmitting(true);
    try {
      const data = await apiPost("/coordinator/events", { ...form, capacity: Number(form.capacity) || 0 });
      if (data.event) {
        setEvents(prev => [data.event, ...prev]);
        setForm(blankForm(myCollege));
        if (fileInputRef.current) fileInputRef.current.value = "";
        showToast?.("Event created successfully.");
      } else {
        showToast?.(data.message || "Failed to create event.");
      }
    } catch {
      showToast?.("Failed to create event.");
    } finally {
      setSubmitting(false);
    }
  }

  function openEdit(event) {
    setEditEvent(event);
    setEditForm({
      title:          event.title,
      description:    event.description || "",
      location:       event.location || "",
      event_datetime: toDatetimeLocal(event.event_datetime),
      end_datetime:   event.end_datetime ? toDatetimeLocal(event.end_datetime) : "",
      visibility:     event.visibility || "Public",
      capacity:       event.capacity ?? "",
    });
  }

  async function handleEdit(e) {
    e.preventDefault();
    if (!editForm.title.trim())       { showToast?.("Title is required."); return; }
    if (!editForm.event_datetime)     { showToast?.("Date & time is required."); return; }
    const dateError = validateEventDates(editForm.event_datetime, editForm.end_datetime, toDatetimeLocal(editEvent.event_datetime));
    if (dateError)                    { showToast?.(dateError); return; }
    setEditSubmitting(true);
    try {
      const data = await apiPut(`/coordinator/events/${editEvent._id}`, { ...editForm, capacity: Number(editForm.capacity) || 0 });
      if (data.event) {
        setEvents(prev => prev.map(ev => ev._id === data.event._id ? data.event : ev));
        setEditEvent(null);
        showToast?.("Event updated.");
      } else {
        showToast?.(data.message || "Failed to update event.");
      }
    } catch {
      showToast?.("Failed to update event.");
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await apiDelete(`/coordinator/events/${deleteId}`);
      setEvents(prev => prev.filter(ev => ev._id !== deleteId));
      setDeleteId(null);
      showToast?.("Event deleted.");
    } catch {
      showToast?.("Failed to delete event.");
    } finally {
      setDeleting(false);
    }
  }

  async function openInterested(event) {
    setInterestedModal(event);
    setInterestedLoading(true);
    setInterestedList([]);
    try {
      const data = await apiGet(`/coordinator/events/${event._id}/interested`);
      setInterestedList(data.alumni ?? []);
    } catch {
      showToast?.("Failed to load interested alumni.");
    } finally {
      setInterestedLoading(false);
    }
  }

  return (
    <section className={`content coordinator-content view active-view`}>
      <div className="coord-events-layout">

        {/* LEFT */}
        <div className="coord-event-left">
          <form className="coord-create-card" onSubmit={handleCreate}>
            <h3>Create Events</h3>
            <div className="coord-create-body">
              <input
                placeholder="Title"
                value={form.title}
                onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
              />
              <textarea
                placeholder="Description"
                value={form.description}
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              />
              <input
                placeholder="Location"
                value={form.location}
                onChange={e => setForm(p => ({ ...p, location: e.target.value }))}
              />
              <input
                type="number"
                placeholder="Capacity (e.g. 100)"
                min="0"
                value={form.capacity}
                onChange={e => setForm(p => ({ ...p, capacity: e.target.value }))}
              />

              <div className="coord-image-field">
                <span className="coord-image-label">Event Image (optional)</span>
                {form.image ? (
                  <div className="coord-image-preview-wrap">
                    <img src={form.image} alt="Event preview" className="coord-image-preview" />
                    <button type="button" className="coord-image-remove" onClick={clearImage}>
                      Remove
                    </button>
                  </div>
                ) : (
                  <div
                    className="coord-image-dropzone"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Icon name="icon-add" /> Click to upload a picture for this post
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={handleImagePick}
                />
              </div>

              <div className="coord-form-row">
                <label className="coord-labeled-field">
                  <span>Start Date &amp; Time</span>
                  <input
                    type="datetime-local"
                    className="coord-datetime-input"
                    value={form.event_datetime}
                    min={toDatetimeLocal(new Date())}
                    onChange={e => setForm(p => ({ ...p, event_datetime: e.target.value }))}
                  />
                </label>
                <label className="coord-labeled-field">
                  <span>End Date &amp; Time</span>
                  <input
                    type="datetime-local"
                    className="coord-datetime-input"
                    value={form.end_datetime}
                    onChange={e => setForm(p => ({ ...p, end_datetime: e.target.value }))}
                  />
                </label>
              </div>
              <div className="coord-form-row">
                <label className="coord-labeled-field">
                  <span>Colleges</span>
                  <select
                    value={form.visibility}
                    onChange={e => setForm(p => ({ ...p, visibility: e.target.value }))}
                  >
                    <option value="Public">All Colleges</option>
                    {(myCollege ? [myCollege] : COLLEGES).map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </div>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                <Icon name="icon-add" /> {submitting ? "Creating…" : "Create"}
              </button>
            </div>
          </form>

          <h3 className="coord-section-kicker">Recent Event Posts</h3>

          {loading ? (
            <p className="coord-employ-empty">Loading…</p>
          ) : recentEvents.length === 0 ? (
            <p className="coord-employ-empty">No events yet.</p>
          ) : (
            recentEvents.map(event => (
              <article className="coord-post-card" key={event._id}>
                <h4>{event.title}</h4>
                {event.image && (
                  <img src={event.image} alt={event.title} className="coord-post-image" />
                )}
                <p className="coord-post-description">{event.description || "No description."}</p>
                <small>
                  Date: {fmtDate(event.event_datetime)} | Location: {event.location || "TBA"}
                </small>
                <div className="coord-post-footer">
                  <span>
                    <Icon name="icon-11" /> {event.interested_count ?? 0}
                  </span>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => openInterested(event)}
                    >
                      <Icon name="icon-view" /> {event.interested_count ?? 0} Interested
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary coord-post-edit-btn"
                      onClick={() => openEdit(event)}
                    >
                      <Icon name="icon-edit" />
                    </button>
                    <button
                      type="button"
                      className="btn coord-post-delete-btn"
                      onClick={() => setDeleteId(event._id)}
                    >
                      <Icon name="icon-delete" />
                    </button>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>

        {/* RIGHT */}
        <aside className="coord-event-list">
          <h3>
            <span>List of Events</span>
            {eventYears.length > 0 && (
              <select
                className="coord-event-list-year"
                value={listYearFilter}
                onChange={e => setListYearFilter(e.target.value)}
                aria-label="Filter events by year"
              >
                <option value="">All Years</option>
                {eventYears.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            )}
          </h3>
          <div className="coord-event-list-inner">
            {loading ? (
              <p className="coord-employ-empty" style={{ padding: 12 }}>Loading…</p>
            ) : visibleEvents.length === 0 ? (
              <p className="coord-employ-empty" style={{ padding: 12 }}>No events found.</p>
            ) : (
              visibleEvents.map(event => {
                const status = computeStatus(event.event_datetime, event.end_datetime);
                const slug = status.toLowerCase().replace(/\s+/g, "-");
                const isHighlighted = String(event._id) === highlightId;
                return (
                  <article
                    key={event._id}
                    ref={isHighlighted ? highlightRef : null}
                    role="button"
                    tabIndex={0}
                    onClick={() => openEdit(event)}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openEdit(event); } }}
                    style={isHighlighted ? { outline: `2px solid #570013`, borderRadius: 6, background: "rgba(87,0,19,0.06)" } : undefined}
                  >
                    <span className={`coord-event-status status-${slug}`}>{status}</span>
                    <strong>Title: {event.title}</strong>
                    <span>Date: {fmtDate(event.event_datetime)}</span>
                    <span>Time: {fmtTime(event.event_datetime)}</span>
                    <span>Location: {event.location || "TBA"}</span>
                  </article>
                );
              })
            )}
          </div>
        </aside>
      </div>

      {/* EDIT MODAL */}
      {/* Portaled to <body>; the page's entrance transform would break position: fixed. */}
      {editEvent && ReactDOM.createPortal(
        <div className="coord-modal-backdrop" onClick={() => setEditEvent(null)}>
          <div className="coord-modal" onClick={e => e.stopPropagation()}>
            <div className="coord-modal-head">
              <h3>Edit Event</h3>
              <button type="button" onClick={() => setEditEvent(null)}>&times;</button>
            </div>
            <form onSubmit={handleEdit}>
              <div className="coord-modal-body">
                <label className="coord-field"><span>Title</span>
                  <input value={editForm.title} onChange={e => setEditForm(p => ({ ...p, title: e.target.value }))} />
                </label>
                <label className="coord-field"><span>Description</span>
                  <textarea value={editForm.description} onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))} />
                </label>
                <label className="coord-field"><span>Location</span>
                  <input value={editForm.location} onChange={e => setEditForm(p => ({ ...p, location: e.target.value }))} />
                </label>
                <label className="coord-field"><span>Capacity</span>
                  <input
                    type="number"
                    min="0"
                    placeholder="e.g. 100"
                    value={editForm.capacity}
                    onChange={e => setEditForm(p => ({ ...p, capacity: e.target.value }))}
                  />
                </label>
                <div className="coord-form-row">
                  <label className="coord-field"><span>Start Date &amp; Time</span>
                    <input
                      type="datetime-local"
                      className="coord-datetime-input"
                      value={editForm.event_datetime}
                      onChange={e => setEditForm(p => ({ ...p, event_datetime: e.target.value }))}
                    />
                  </label>
                  <label className="coord-field"><span>End Date &amp; Time</span>
                    <input
                      type="datetime-local"
                      className="coord-datetime-input"
                      value={editForm.end_datetime}
                      onChange={e => setEditForm(p => ({ ...p, end_datetime: e.target.value }))}
                    />
                  </label>
                </div>
                <div className="coord-form-row">
                  <label className="coord-field"><span>Colleges</span>
                    <select value={editForm.visibility} onChange={e => setEditForm(p => ({ ...p, visibility: e.target.value }))}>
                      <option value="Public">All Colleges</option>
                      {/* Keep a legacy visibility value selectable so editing doesn't blank it. */}
                      {[...new Set([...(myCollege ? [myCollege] : COLLEGES), editForm.visibility].filter((c) => c && c !== "Public"))].map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
              <div className="coord-modal-foot">
                <button type="submit" className="btn btn-primary" disabled={editSubmitting}>
                  <Icon name="icon-update" /> {editSubmitting ? "Saving…" : "Save Changes"}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setEditEvent(null)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* DELETE MODAL */}
      {deleteId && (() => {
        const ev = events.find(e => String(e._id) === String(deleteId));
        return ReactDOM.createPortal(
          <div className="coord-modal-backdrop" onClick={() => setDeleteId(null)}>
            <div className="coord-modal coord-modal-sm" onClick={e => e.stopPropagation()}>
              <div className="coord-modal-head">
                <h3>Delete Event</h3>
                <button type="button" onClick={() => setDeleteId(null)}>&times;</button>
              </div>
              <div className="coord-modal-body">
                {ev && <p style={{ fontWeight: 600, marginBottom: 8 }}>&ldquo;{ev.title}&rdquo;</p>}
                <p>Are you sure you want to delete this event? This cannot be undone.</p>
                <p style={{ marginTop: 10, padding: "8px 12px", background: "#fff3cd", borderLeft: "3px solid #d69e2e", borderRadius: 4, fontSize: 13, color: "#7d5a00" }}>
                  <strong>Warning:</strong> All attendance records and feedback submissions linked to this event will also be permanently deleted.
                </p>
              </div>
              <div className="coord-modal-foot">
                <button type="button" className="btn coord-btn-danger" onClick={handleDelete} disabled={deleting}>
                  <Icon name="icon-delete" /> {deleting ? "Deleting…" : "Delete"}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setDeleteId(null)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>,
          document.body
        );
      })()}

      {/* INTERESTED MODAL */}
      {interestedModal && ReactDOM.createPortal(
        <div className="coord-modal-backdrop" onClick={() => setInterestedModal(null)}>
          <div className="coord-modal" onClick={e => e.stopPropagation()}>
            <div className="coord-modal-head">
              <h3>Interested Alumni</h3>
              <button type="button" onClick={() => setInterestedModal(null)}>&times;</button>
            </div>
            <div className="coord-modal-body">
              <p className="coord-modal-subtitle">{interestedModal.title}</p>
              {interestedLoading ? (
                <p className="coord-employ-empty">Loading…</p>
              ) : interestedList.length === 0 ? (
                <p className="coord-employ-empty">No alumni have marked interest yet.</p>
              ) : (
                <table className="coord-interested-table">
                  <thead><tr><th>Name</th><th>Course</th><th>Email</th></tr></thead>
                  <tbody>
                    {interestedList.map(a => (
                      <tr key={String(a._id)}>
                        <td>{a.name}</td>
                        <td>{a.course || "—"}</td>
                        <td>{a.email}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="coord-modal-foot">
              <button type="button" className="btn btn-secondary" onClick={() => setInterestedModal(null)}>
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </section>
  );
}
