import React, { useState } from "react";
import Icon from "../SimpleIcon.jsx";
import { initialEvents } from "./CoordinatorShared.jsx";

export default function EventManagement({ active, showToast }) {
  const [events, setEvents] = useState(initialEvents);
  const [form, setForm] = useState({ title: "", description: "", location: "", date: "", time: "", scope: "Public" });

  function createEvent(e) {
    e.preventDefault();
    if (!form.title.trim()) {
      showToast("Add an event title first.");
      return;
    }
    setEvents((prev) => [
      {
        id: Date.now(),
        title: form.title,
        description: form.description || "No description added yet.",
        location: form.location || "To be announced",
        date: form.date || "TBA",
        time: form.time || "TBA",
        status: "Coming Soon",
        interested: 0,
      },
      ...prev,
    ]);
    setForm({ title: "", description: "", location: "", date: "", time: "", scope: "Public" });
    showToast("Event created.");
  }

  return (
    <section className={`content coordinator-content view${active ? " active-view" : ""}`}>
      <div className="coord-events-layout">
        <div className="coord-event-left">
          <form className="coord-create-card" onSubmit={createEvent}>
            <h3>Create Events</h3>
            <input placeholder="Title" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} />
            <textarea placeholder="Description" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
            <input placeholder="Location" value={form.location} onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))} />
            <div className="coord-form-row">
              <input placeholder="Date & Time" value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} />
              <select value={form.scope} onChange={(e) => setForm((p) => ({ ...p, scope: e.target.value }))}>
                <option>Select Scope</option>
                <option>CCS Alumni</option>
                <option>All Alumni</option>
                <option>Public</option>
              </select>
            </div>
            <button type="submit">Create Event</button>
          </form>

          <h3 className="coord-section-kicker">Recent Event Posts</h3>
          <article className="coord-post-card">
            <h4>{events[0]?.title}</h4>
            <p>{events[0]?.description}</p>
            <small>Date: {events[0]?.date} | Location: {events[0]?.location}</small>
            <div className="coord-post-footer">
              <span><Icon name="icon-12" /> 100</span>
              <span><Icon name="icon-11" /> 45</span>
              <span><Icon name="icon-13" /> 12</span>
              <button type="button">{events[0]?.interested} Interested</button>
            </div>
          </article>
        </div>

        <aside className="coord-event-list">
          <h3>List of Events</h3>
          <div className="coord-event-list-inner">
            {events.map((event) => (
              <article key={event.id}>
                <span className="coord-event-status">{event.status}</span>
                <strong>Title: {event.title}</strong>
                <span>Date: {event.date}</span>
                <span>Time: {event.time}</span>
                <span>Location: {event.location}</span>
              </article>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}