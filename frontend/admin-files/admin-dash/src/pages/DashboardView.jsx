import React, { useState, useEffect, useRef } from "react";
import Icon from "../Icon.jsx";
import { Dropdown } from "../Primitives.jsx";
import { CourseJobChart, EmploymentChart } from "../Charts.jsx";
import { employmentSets, assistantGreetings, assistantReply, currentTime, reportFilters } from "../data.js";

import { API } from "../shared.js";

function authHeaders() {
  const token = localStorage.getItem("auth_token");
  return { Authorization: `Bearer ${token}` };
}

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const reportNames = [
  "Employment Status Distribution",
  "Course vs Job",
  "Survey Completion Report",
];

function downloadReport(name, employmentIndex, courseJobData, employmentSets) {
  let csv = "";
  let filename = "";

  if (name === "Employment Status Distribution") {
    const set = employmentSets[employmentIndex] || employmentSets[0];
    csv = "Status,Percentage\nEmployed," + set.employed + "%\nUnemployed," + set.unemployed + "%\nUnidentified," + set.unidentified + "%\nTotal Records," + set.count;
    filename = "employment-status-distribution.csv";
  } else if (name === "Course vs Job") {
    const rows = courseJobData.byCourse || [];
    if (rows.length) {
      csv = "Course,Employment Rate,Job-Related Rate,Employed,Total\n" +
        rows.map((d) =>
          `${d.course},${d.employmentRate}%,${d.jobRelatedRate}%,${d.employed},${d.total}`
        ).join("\n");
    } else {
      csv = "Course,Employment Rate\nNo data available";
    }
    filename = "course-vs-job.csv";
  } else {
    csv = "Report,Status\nSurvey Completion Report,No data available";
    filename = "survey-completion-report.csv";
  }

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const COURSE_JOB_METRICS = [
  { label: "Employment Rate",  key: "employmentRate" },
  { label: "Job-Related Rate", key: "jobRelatedRate" },
  { label: "BSIT Tracks",     key: "bsitTracks" },
];

export default function DashboardView({ active, showToast }) {
  const [employmentIndex, setEmploymentIndex] = useState(0);
  const [courseJobData, setCourseJobData]     = useState({ byCourse: [], bsitByTrack: [] });
  const [courseJobMetric, setCourseJobMetric] = useState("employmentRate");
  const [totalUsers, setTotalUsers] = useState(null);
  const [employedCount, setEmployedCount] = useState(null);
  const [tracerCount, setTracerCount]     = useState(null);
  const [postActivities, setPostActivities] = useState([]);
  const [activitiesLoading, setActivitiesLoading] = useState(true);

  useEffect(() => {
    if (!active) return;

    async function fetchTotalUsers() {
      try {
        const res = await fetch(`${API}/admin/users`, { headers: authHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        setTotalUsers(data.users?.length ?? 0);
      } catch {
        // silently fail — stat card stays at last known value
      }
    }

    async function fetchEmploymentStats() {
      try {
        const res = await fetch(`${API}/admin/employment/stats`, { headers: authHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        setEmployedCount(data.employed ?? 0);
        setTracerCount(data.tracerSubmissions ?? 0);
      } catch {
        // silently fail
      }
    }

    async function fetchCourseJobStats() {
      try {
        const res = await fetch(`${API}/admin/employment/course-stats`, { headers: authHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        setCourseJobData(data);
      } catch {
        // silently fail
      }
    }

    async function fetchActivities() {
      try {
        const res = await fetch(`${API}/admin/announcements/activity`, { headers: authHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        setPostActivities(data.activities || []);
      } catch {
        // silently fail
      } finally {
        setActivitiesLoading(false);
      }
    }

    fetchTotalUsers();
    fetchActivities();
    fetchEmploymentStats();
    fetchCourseJobStats();

    const interval = setInterval(() => {
      fetchTotalUsers();
      fetchActivities();
      fetchEmploymentStats();
      fetchCourseJobStats();
    }, 30000);
    return () => clearInterval(interval);
  }, [active]);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <section className={`content figma-group-69 view${active ? " active-view" : ""}`}>
      <div className="admin-hero" aria-label="Welcome banner">
        {/* NOTE: placeholder copy — replace with your actual welcome message. */}
        <h1 className="admin-hero-title">Hello, Admin!</h1>
        <p className="admin-hero-subtitle">
          Welcome to the Alumni Tracer Management System. Monitor alumni data,
          manage accounts, and review reports — all in one place.
        </p>
        <div className="admin-hero-pills">
          <span className="hero-pill hero-pill-gold">
            <Icon name="icon-7" /> Role: Administrator
          </span>
          <span className="hero-pill">
            <Icon name="icon-11" /> Alumni Tracer System
          </span>
          <span className="hero-pill">
            <Icon name="icon-13" /> {today}
          </span>
        </div>
      </div>

      <div className="stats" aria-label="Dashboard summary">
        <article className="stat-card">
          <div>
            <p className="stat-value">{totalUsers === null ? "—" : totalUsers}</p>
            <p className="stat-label">Total Users</p>
          </div>
          <span><Icon name="icon-11" /></span>
        </article>
        <article className="stat-card">
          <div>
            <p className="stat-value">{employedCount === null ? "—" : employedCount}</p>
            <p className="stat-label">Employed Alumni</p>
          </div>
          <span><Icon name="icon-12" /></span>
        </article>
        <article className="stat-card">
          <div><p className="stat-value">{tracerCount === null ? "—" : tracerCount}</p><p className="stat-label">Tracer Submissions</p></div>
          <span><Icon name="icon-13" /></span>
        </article>
      </div>

      <div className="grid">
        <div className="left-stack">
          <Assistant showToast={showToast} />

          <section className="panel">
            <div className="panel-head">
              <span>Course vs Job</span>
              <Dropdown
                menuClassName="filter-menu"
                active={COURSE_JOB_METRICS.find((m) => m.key === courseJobMetric)?.label}
                options={COURSE_JOB_METRICS.map((m) => m.label)}
                onSelect={(label) => {
                  const m = COURSE_JOB_METRICS.find((x) => x.label === label);
                  if (m) setCourseJobMetric(m.key);
                  showToast(`Course chart: ${label}`);
                }}
                trigger={(toggle) => (
                  <button className="filter" type="button" onClick={toggle}>
                    {COURSE_JOB_METRICS.find((m) => m.key === courseJobMetric)?.label ?? "Filter"}
                  </button>
                )}
              />
            </div>
            <CourseJobChart data={courseJobData} metric={courseJobMetric} />
          </section>

          <section className="panel">
            <div className="panel-head">
              <span>Employed vs Unemployed</span>
              <Dropdown
                menuClassName="filter-menu"
                active={employmentSets[employmentIndex].label}
                options={employmentSets.map((s) => s.label)}
                onSelect={(label) => {
                  const i = employmentSets.findIndex((s) => s.label === label);
                  setEmploymentIndex(i);
                  showToast(`Employment chart filtered: ${label}`);
                }}
                trigger={(toggle) => (
                  <button className="filter" type="button" onClick={toggle}>
                    {employmentSets[employmentIndex].label === "All" ? "Filter" : employmentSets[employmentIndex].label}
                  </button>
                )}
              />
            </div>
            <EmploymentChart index={employmentIndex} />
          </section>
        </div>

        <aside className="right-stack">
          <section className="panel">
            <div className="panel-head light">Recent Post Activities</div>
            <div className="activity-list">
              {activitiesLoading ? (
                <div className="activity" style={{ justifyContent: "center", color: "var(--muted, #76656a)", fontSize: 13 }}>
                  Loading…
                </div>
              ) : postActivities.length === 0 ? (
                <div className="activity" style={{ justifyContent: "center", color: "var(--muted, #76656a)", fontSize: 13 }}>
                  No recent activity yet.
                </div>
              ) : postActivities.map((a) => (
                <div className="activity" key={a._id}>
                  <p>
                    <strong>{a.user_name}</strong>{" "}
                    {a.action}{" "}
                    <em style={{ fontStyle: "normal" }}>&ldquo;{a.announcement_title}&rdquo;</em>
                  </p>
                  <time dateTime={a.createdAt}>{timeAgo(a.createdAt)}</time>
                </div>
              ))}
            </div>
          </section>

          <section className="panel reports">
            <div className="panel-head">Reports</div>
            {reportNames.map((name, i) => (
              <div className="report-row" key={name}>
                <span>{name}</span>
                <Dropdown
                  menuClassName="report-filter-menu"
                  options={reportFilters[i] || ["All", "This Month", "This Year"]}
                  active={(reportFilters[i] || ["All"])[0]}
                  onSelect={(label) => showToast(`${name}: ${label}`)}
                  trigger={(toggle) => (
                    <button type="button" onClick={toggle}>Filter</button>
                  )}
                />
                <button
                  className="download"
                  type="button"
                  aria-label={`Download ${name}`}
                  onClick={() => {
                    downloadReport(name, employmentIndex, courseJobData, employmentSets);
                    showToast(`${name} downloaded.`);
                  }}
                >
                  <span><Icon name="icon-download" /></span>
                </button>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </section>
  );
}

function Assistant({ showToast }) {
  const [greeting] = useState(
    () => assistantGreetings[Math.floor(Math.random() * assistantGreetings.length)]
  );
  const [messages, setMessages] = useState([
    { type: "bot", text: greeting, time: currentTime() },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [collapsedPanel, setCollapsedPanel] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = () => setMenuOpen(false);
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [menuOpen]);

  function send(message = input.trim()) {
    if (!message) {
      showToast("Type a message first.");
      inputRef.current?.focus();
      return;
    }
    setMessages((prev) => [...prev, { type: "user", text: message, time: currentTime() }]);
    setInput("");
    setThinking(true);
    setTimeout(() => {
      setMessages((prev) => [...prev, { type: "bot", text: assistantReply(message), time: currentTime() }]);
      setThinking(false);
    }, 450);
  }

  return (
    <section className={`panel${collapsedPanel ? " assistant-collapsed" : ""}`}>
      <div className="panel-head">
        <div className="left-title">
          <span className="tiny-logo">AC</span>
          <span>AC - Assistant</span>
        </div>
        <span style={{ position: "relative" }}>
          <button
            className="dots"
            type="button"
            aria-label="Assistant options"
            aria-expanded={String(menuOpen)}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((o) => !o);
            }}
          >
            ...
          </button>
          {menuOpen && (
            <div className="assistant-menu show" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => {
                  setInput("What can you help me with?");
                  inputRef.current?.focus();
                  showToast("Help prompt added.");
                  setMenuOpen(false);
                }}
              >
                Ask for help
              </button>
              <button
                type="button"
                onClick={() => {
                  setMessages((prev) => prev.slice(0, 1));
                  showToast("Assistant chat cleared.");
                  setMenuOpen(false);
                }}
              >
                Clear chat
              </button>
              <button
                type="button"
                onClick={() => {
                  setCollapsedPanel((c) => {
                    showToast(!c ? "Assistant minimized." : "Assistant restored.");
                    return !c;
                  });
                  setMenuOpen(false);
                }}
              >
                {collapsedPanel ? "Restore" : "Minimize"}
              </button>
            </div>
          )}
        </span>
      </div>
      <div className={`assistant-body${thinking ? " is-thinking" : ""}`}>
        {messages.map((m, i) => (
          <div className={m.type === "user" ? "chat-row user" : "chat-row"} key={i}>
            {m.type === "bot" && <div className="bot">AC</div>}
            <div>
              <div className="bubble" style={{ whiteSpace: "pre-line" }}>{m.text}</div>
              <div className="chat-time">{m.time}</div>
            </div>
          </div>
        ))}
        <div className="chips" aria-label="Suggested prompts">
          <span>Ask about</span>
          {["Alumni Records", "Tracer Survey", "Employment Status"].map((c) => (
            <button type="button" key={c} onClick={() => send(c)}>{c}</button>
          ))}
        </div>
        <div className="message">
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a message"
            aria-label="Type a message"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <button className="send" type="button" aria-label="Send message" onClick={() => send()}>
            <span><Icon name="icon-15" /></span>
          </button>
        </div>
      </div>
    </section>
  );
}
