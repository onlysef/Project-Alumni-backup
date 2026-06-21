import React, { useState } from "react";
import Icon from "../SimpleIcon.jsx";
import { MiniBarChart, downloadCsv } from "./CoordinatorShared.jsx";

export default function CoordinatorHome({ active, showToast }) {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const stats = [
    ["398", "Total Alumni", "icon-11"],
    ["14", "Annual Completed Events", "icon-5"],
    ["40", "Recent Feedback Submission", "icon-13"],
    ["4.7", "Avg. Event Rating", "icon-12"],
  ];

  const reports = ["Event Attendance Report", "Top Events Report", "Feedback Completion Report"];

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
        {stats.map(([value, label, icon]) => (
          <article className="coord-stat" key={label}>
            <div>
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
            <Icon name={icon} />
          </article>
        ))}
        <article className="coord-highlight">
          <strong>Top Event:</strong>
          <span>Job Fair 2026</span>
          <strong>Low Response:</strong>
          <span>March Seminar</span>
        </article>
      </div>

      <div className="coord-dashboard-grid">
        <div className="coord-left-stack">
          <section className="coord-card">
            <h3>Event Attendance</h3>
            <MiniBarChart title="Event Attendance" values={[125, 150, 95, 205, 175]} labels={["Event 1", "Event 2", "Event 3", "Event 4", "Event 5"]} />
          </section>
          <section className="coord-card">
            <h3>Event Feedback Completion</h3>
            <MiniBarChart title="Event Feedback Counts" values={[45, 60, 33, 72, 52]} labels={["Event A", "Event B", "Event C", "Event D", "Event E"]} />
          </section>
        </div>
        <aside className="coord-right-stack">
          <section className="coord-card coord-activity">
            <h3>Activity</h3>
            {["Danica Macapagal submitted event feedback", "Danica Macapagal submitted event feedback"].map((activity, index) => (
              <div className="coord-activity-row" key={`${activity}-${index}`}>
                <span>{activity}</span>
                <time>5 min.</time>
              </div>
            ))}
          </section>
          <section className="coord-card coord-reports">
            <h3>Reports</h3>
            {reports.map((report) => (
              <div className="coord-report-row" key={report}>
                <span>{report}</span>
                <button type="button">Year</button>
                <button
                  className="coord-icon-button"
                  type="button"
                  aria-label={`Download ${report}`}
                  onClick={() => {
                    downloadCsv(`${report.toLowerCase().replaceAll(" ", "-")}.csv`, [["Report", "Year"], [report, "2026"]]);
                    showToast(`${report} downloaded.`);
                  }}
                >
                  <Icon name="icon-download" />
                </button>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </section>
  );
}