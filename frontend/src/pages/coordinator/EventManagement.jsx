import React, { useState, useEffect, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import Icon from "../../components/common/Icon.jsx";

const API = import.meta.env.DEV
  ? "http://localhost:5000/api"
  : "https://project-alumni-phi.vercel.app/api";

function apiGet(path) {
  const token = localStorage.getItem("auth_token");
  return fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
}
function apiPost(path, body) {
  const token = localStorage.getItem("auth_token");
  return fetch(`${API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(r => r.json());
}
function apiPut(path, body) {
  const token = localStorage.getItem("auth_token");
  return fetch(`${API}${path}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(r => r.json());
}
function apiDelete(path) {
  const token = localStorage.getItem("auth_token");
  return fetch(`${API}${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json());
}

const STATUS_ORDER = { "On Going": 0, "Coming Soon": 1, "Ended": 2 };

function computeStatus(event_datetime) {
  const now = new Date();
  const d = new Date(event_datetime);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  if (d >= todayStart && d <= todayEnd) return "On Going";
  if (d > todayEnd) return "Coming Soon";
  return "Ended";
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

const BLANK = { title: "", description: "", location: "", event_datetime: "", visibility: "Public", capacity: "" };

export default function EventManagement() {
  const { showToast } = useOutletContext();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [submitting, setSubmitting] = useState(false);

  // modals
  const [editEvent, setEditEvent] = useState(null);
  const [editForm, setEditForm] = useState(BLANK);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [interestedModal, setInterestedModal] = useState(null);
  const [interestedList, setInterestedList] = useState([]);
  const [interestedLoading, setInterestedLoading] = useState(false);

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

  // sorted copy for List of Events panel
  const sortedEvents = [...events].sort((a, b) =>
    STATUS_ORDER[computeStatus(a.event_datetime)] - STATUS_ORDER[computeStatus(b.event_datetime)]
  );

  // recent posts = newest first (already sorted desc by backend)
  const recentEvents = [...events];

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.title.trim())          { showToast?.("Title is required."); return; }
    if (!form.event_datetime)        { showToast?.("Date & time is required."); return; }
    setSubmitting(true);
    try {
      const data = await apiPost("/coordinator/events", { ...form, capacity: Number(form.capacity) || 0 });
      if (data.event) {
        setEvents(prev => [data.event, ...prev]);
        setForm(BLANK);
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
      visibility:     event.visibility || "Public",
      capacity:       event.capacity ?? "",
    });
  }

  async function handleEdit(e) {
    e.preventDefault();
    if (!editForm.title.trim())       { showToast?.("Title is required."); return; }
    if (!editForm.event_datetime)     { showToast?.("Date & time is required."); return; }
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
              <div className="coord-form-row">
                <input
                  type="datetime-local"
                  className="coord-datetime-input"
                  value={form.event_datetime}
                  onChange={e => setForm(p => ({ ...p, event_datetime: e.target.value }))}
                />
                <select
                  value={form.visibility}
                  onChange={e => setForm(p => ({ ...p, visibility: e.target.value }))}
                >
                  <option value="Public">Public</option>
                  <option value="CCS Alumni">CCS Alumni</option>
                  <option value="All Alumni">All Alumni</option>
                  <option value="Private">Private</option>
                </select>
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
                <p>{event.description || "No description."}</p>
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
          <h3>List of Events</h3>
          <div className="coord-event-list-inner">
            {loading ? (
              <p className="coord-employ-empty" style={{ padding: 12 }}>Loading…</p>
            ) : sortedEvents.length === 0 ? (
              <p className="coord-employ-empty" style={{ padding: 12 }}>No events found.</p>
            ) : (
              sortedEvents.map(event => {
                const status = computeStatus(event.event_datetime);
                const slug = status.toLowerCase().replace(/\s+/g, "-");
                return (
                  <article key={event._id}>
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
      {editEvent && (
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
                  <label className="coord-field"><span>Date & Time</span>
                    <input
                      type="datetime-local"
                      className="coord-datetime-input"
                      value={editForm.event_datetime}
                      onChange={e => setEditForm(p => ({ ...p, event_datetime: e.target.value }))}
                    />
                  </label>
                  <label className="coord-field"><span>Visibility</span>
                    <select value={editForm.visibility} onChange={e => setEditForm(p => ({ ...p, visibility: e.target.value }))}>
                      <option value="Public">Public</option>
                      <option value="CCS Alumni">CCS Alumni</option>
                      <option value="All Alumni">All Alumni</option>
                      <option value="Private">Private</option>
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
        </div>
      )}

      {/* DELETE MODAL */}
      {deleteId && (
        <div className="coord-modal-backdrop" onClick={() => setDeleteId(null)}>
          <div className="coord-modal coord-modal-sm" onClick={e => e.stopPropagation()}>
            <div className="coord-modal-head">
              <h3>Delete Event</h3>
              <button type="button" onClick={() => setDeleteId(null)}>&times;</button>
            </div>
            <div className="coord-modal-body">
              <p>Are you sure you want to delete this event? This cannot be undone.</p>
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
        </div>
      )}

      {/* INTERESTED MODAL */}
      {interestedModal && (
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
        </div>
      )}
    </section>
  );
}
