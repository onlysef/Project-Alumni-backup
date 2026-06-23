import React, { useState, useEffect } from "react";
import Icon from "../SimpleIcon.jsx";
import { MiniBarChart, downloadCsv } from "./CoordinatorShared.jsx";

const API = import.meta.env.DEV
  ? "http://localhost:5000/api"
  : "https://project-alumni-phi.vercel.app/api";

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const REPORTS = [
  { label: "Event Attendance Report",   type: "event-attendance"    },
  { label: "Top Events Report",         type: "top-events"          },
  { label: "Feedback Completion Report",type: "feedback-completion" },
];

export default function CoordinatorHome({ active, showToast }) {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const [data, setData] = useState(null);
  const [allEvents, setAllEvents] = useState([]);
  const currentYear = new Date().getFullYear();
  const [reportYears, setReportYears] = useState(
    Object.fromEntries(REPORTS.map(r => [r.type, currentYear]))
  );
  const [reportEvents, setReportEvents] = useState(
    Object.fromEntries(REPORTS.map(r => [r.type, ""]))
  );

  useEffect(() => {
    if (!active) return;
    const token = localStorage.getItem("auth_token");
    fetch(`${API}/coordinator/dashboard`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(setData)
      .catch(() => {});
    fetch(`${API}/coordinator/attendance/events`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(d => setAllEvents(d.events ?? []))
      .catch(() => {});
  }, [active]);

  const statCards = [
    [data?.totalAlumni     ?? "—", "Total Alumni",               "icon-11"],
    [data?.completedEvents ?? "—", "Annual Completed Events",     "icon-5"],
    [data?.recentFeedbacks ?? "—", "Recent Feedback Submission",  "icon-13"],
    [data?.avgRating       ?? "—", "Avg. Event Rating",           "icon-12"],
  ];

  const chartLabels     = data?.chartEvents?.map(e => e.label)      ?? [];
  const attendanceVals  = data?.chartEvents?.map(e => e.attendance)  ?? [];
  const feedbackVals    = data?.chartEvents?.map(e => e.feedbacks)   ?? [];

  return (
    <section className={`content coordinator-content view${active ? " active-view" : ""}`}>
      <div className="coord-hero" aria-label="Welcome banner">
        <h1 className="coord-hero-title">Hello, Coordinator!</h1>
        <p className="coord-hero-subtitle">
          Welcome to the Alumni Tracer Management System. Manage events, track
          participation, and review alumni feedback all in one place.
        </p>
        <div className="coord-hero-pills">
          <span className="coord-hero-pill coord-hero-pill-gold">Role: Coordinator</span>
          <span className="coord-hero-pill">
            <Icon name="icon-13" /> {today}
          </span>
        </div>
      </div>

      <div className="coord-stats">
        {statCards.map(([value, label, icon]) => (
          <article className="coord-stat" key={label}>
            <div>
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
            <Icon name={icon} />
          </article>
        ))}
        <article className="coord-highlight">
          <div>
            <strong>Top Event:</strong>
            <span>{data?.topEvent ?? "—"}</span>
            <strong>Low Response:</strong>
            <span>{data?.lowEvent ?? "—"}</span>
          </div>
          <Icon name="icon-trophy" />
        </article>
      </div>

      <div className="coord-dashboard-grid">
        <div className="coord-left-stack">
          <section className="coord-card">
            <h3>Event Attendance</h3>
            <MiniBarChart
              title="Event Attendance"
              values={attendanceVals.length ? attendanceVals : [0]}
              labels={chartLabels.length   ? chartLabels    : ["No data"]}
            />
          </section>
          <section className="coord-card">
            <h3>Event Feedback Completion</h3>
            <MiniBarChart
              title="Event Feedback Counts"
              values={feedbackVals.length ? feedbackVals : [0]}
              labels={chartLabels.length  ? chartLabels   : ["No data"]}
            />
          </section>
        </div>
        <aside className="coord-right-stack">
          <section className="coord-card coord-activity">
            <h3>Activity</h3>
            {data?.activity?.length ? (
              data.activity.map((a, i) => (
                <div className="coord-activity-row" key={i}>
                  <span>{a.text}</span>
                  <time>{timeAgo(a.time)}</time>
                </div>
              ))
            ) : (
              <p style={{ fontSize: 13, color: "#888" }}>No recent activity.</p>
            )}
          </section>
          <section className="coord-card coord-reports">
            <h3>Reports</h3>
            {REPORTS.map((report) => {
              const year      = reportYears[report.type];
              const eventId   = reportEvents[report.type];
              function download() {
                const token = localStorage.getItem("auth_token");
                const params = new URLSearchParams({ format: "xlsx" });
                if (eventId) params.set("eventId", eventId);
                else params.set("year", year);
                const url = `${API}/coordinator/reports/${report.type}?${params}`;
                fetch(url, { headers: { Authorization: `Bearer ${token}` } })
                  .then(r => r.blob())
                  .then(blob => {
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = `${report.type}-${eventId || year}.xlsx`;
                    a.click();
                    URL.revokeObjectURL(a.href);
                    showToast?.(`${report.label} downloaded.`);
                  })
                  .catch(() => showToast?.("Export failed."));
              }
              return (
                <div className="coord-report-row" key={report.type}>
                  <span>{report.label}</span>
                  <div className="coord-report-filters">
                    <select
                      className="coord-report-select"
                      value={eventId}
                      onChange={e => setReportEvents(prev => ({ ...prev, [report.type]: e.target.value }))}
                    >
                      <option value="">All Events</option>
                      {allEvents.map(ev => (
                        <option key={String(ev._id)} value={String(ev._id)}>{ev.title}</option>
                      ))}
                    </select>
                    {!eventId && (
                      <select
                        className="coord-report-select coord-report-year"
                        value={year}
                        onChange={e => setReportYears(prev => ({ ...prev, [report.type]: Number(e.target.value) }))}
                      >
                        {Array.from({ length: currentYear - 2019 }, (_, i) => currentYear - i).map(y => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                    )}
                    <button
                      className="coord-icon-button"
                      type="button"
                      aria-label={`Download ${report.label}`}
                      onClick={download}
                    >
                      <Icon name="icon-download" />
                    </button>
                  </div>
                </div>
              );
            })}
          </section>
        </aside>
      </div>
    </section>
  );
}