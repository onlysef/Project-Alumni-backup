import React, { useState, useEffect, useRef } from "react";
import Icon from "../Icon.jsx";
import { Dropdown } from "../Primitives.jsx";
import { CourseJobChart, EmploymentChart } from "../Charts.jsx";
import { reportFilters } from "../data.js";

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

function downloadReport(name, courseJobData, donutData, surveyStats, activeFilter) {
  const filter = activeFilter || "All";
  let csv = "";
  let filename = "";

  if (name === "Employment Status Distribution") {
    if (donutData) {
      if (filter === "Employed") {
        csv = `Status,Percentage,Count\nEmployed,${donutData.employedPct}%,${donutData.employed}`;
      } else if (filter === "Unemployed") {
        csv = `Status,Percentage,Count\nUnemployed,${donutData.unemployedPct}%,${donutData.unemployed}`;
      } else if (filter === "Unidentified") {
        csv = `Status,Percentage,Count\nUnidentified,${donutData.unidentifiedPct}%,${donutData.unidentified}`;
      } else {
        csv = "Status,Percentage,Count\n" +
          `Employed,${donutData.employedPct}%,${donutData.employed}\n` +
          `Unemployed,${donutData.unemployedPct}%,${donutData.unemployed}\n` +
          `Unidentified,${donutData.unidentifiedPct}%,${donutData.unidentified}\n` +
          `Total,,${donutData.total}`;
      }
    } else {
      csv = "Status,Percentage,Count\nNo data available,,";
    }
    filename = "employment-status-distribution.csv";

  } else if (name === "Course vs Job") {
    const courseRows = courseJobData.byCourse  || [];
    const trackRows  = courseJobData.bsitByTrack || [];

    if (["BSIT", "BSCS", "BSIS"].includes(filter)) {
      const row = courseRows.find((d) => d.course === filter);
      csv = row
        ? `Course,Employment Rate,Job-Related Rate,Employed,Total\n${row.course},${row.employmentRate}%,${row.jobRelatedRate}%,${row.employed},${row.total}`
        : `Course,Employment Rate,Job-Related Rate,Employed,Total\n${filter},No data,,,`;
    } else if (["TSM", "WMA", "NA"].includes(filter)) {
      const row = trackRows.find((d) => d.track === filter);
      csv = row
        ? `Track,Employment Rate,Job-Related Rate,Employed,Total\n${row.track},${row.employmentRate}%,${row.jobRelatedRate}%,${row.employed},${row.total}`
        : `Track,Employment Rate,Job-Related Rate,Employed,Total\n${filter},No data,,,`;
    } else {
      csv = courseRows.length
        ? "Course,Employment Rate,Job-Related Rate,Employed,Total\n" +
          courseRows.map((d) => `${d.course},${d.employmentRate}%,${d.jobRelatedRate}%,${d.employed},${d.total}`).join("\n")
        : "Course,Employment Rate\nNo data available";
    }
    filename = "course-vs-job.csv";

  } else {
    if (surveyStats) {
      if (filter === "Completed") {
        csv = `Status,Count\nCompleted,${surveyStats.completed}\nCompletion Rate,${surveyStats.completionRate}%`;
      } else if (filter === "Pending") {
        csv = `Status,Count\nPending,${surveyStats.pending}\nTotal Alumni,${surveyStats.total}`;
      } else if (filter === "This Month") {
        csv = `Status,Count\nSubmitted This Month,${surveyStats.thisMonth}`;
      } else {
        csv = "Status,Count\n" +
          `Total Alumni,${surveyStats.total}\n` +
          `Completed,${surveyStats.completed}\n` +
          `Pending,${surveyStats.pending}\n` +
          `Completion Rate,${surveyStats.completionRate}%\n` +
          `Submitted This Month,${surveyStats.thisMonth}`;
      }
    } else {
      csv = "Status,Count\nNo data available,";
    }
    filename = "survey-completion-report.csv";
  }

  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const COURSE_JOB_METRICS = [
  { label: "Employment Rate",  key: "employmentRate" },
  { label: "Job-Related Rate", key: "jobRelatedRate" },
  { label: "BSIT Tracks",     key: "bsitTracks" },
];

const DONUT_COURSES = ["All", "BSIT", "BSCS", "BSIS"];

export default function DashboardView({ active, showToast, onOpenPost }) {
  const [donutData, setDonutData]               = useState(null);
  const [donutCourse, setDonutCourse]           = useState("All");
  const [courseJobData, setCourseJobData]       = useState({ byCourse: [], bsitByTrack: [] });
  const [surveyStats, setSurveyStats]           = useState(null);
  const [reportActiveFilters, setReportActiveFilters] = useState(["All", "All", "All"]);
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
      } catch {}
    }

    async function fetchEmploymentStats() {
      try {
        const res = await fetch(`${API}/admin/employment/stats`, { headers: authHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        setEmployedCount(data.employed ?? 0);
        setTracerCount(data.tracerSubmissions ?? 0);
      } catch {}
    }

    async function fetchCourseJobStats() {
      try {
        const res = await fetch(`${API}/admin/employment/course-stats`, { headers: authHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        setCourseJobData(data);
      } catch {}
    }

    async function fetchActivities() {
      try {
        const res = await fetch(`${API}/admin/announcements/activity`, { headers: authHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        const raw = data.activities || [];
        const seen = new Map();
        for (const a of raw) {
          const key = `${a.user_id || a.user_name}|${a.announcement_id || a.announcement_title}|${a.action}`;
          const prev = seen.get(key);
          if (!prev || new Date(a.createdAt) > new Date(prev.createdAt)) seen.set(key, a);
        }
        const deduped = [...seen.values()].sort(
          (x, y) => new Date(y.createdAt) - new Date(x.createdAt)
        );
        setPostActivities(deduped);
      } catch {} finally {
        setActivitiesLoading(false);
      }
    }

    async function fetchSurveyStats() {
      try {
        const res = await fetch(`${API}/admin/employment/survey-stats`, { headers: authHeaders() });
        if (!res.ok) {
          console.error("survey-stats:", res.status, await res.text());
          return;
        }
        setSurveyStats(await res.json());
      } catch (err) {
        console.error("survey-stats fetch error:", err);
      }
    }

    fetchTotalUsers();
    fetchActivities();
    fetchEmploymentStats();
    fetchCourseJobStats();
    fetchSurveyStats();

    const interval = setInterval(() => {
      fetchTotalUsers();
      fetchActivities();
      fetchEmploymentStats();
      fetchCourseJobStats();
      fetchSurveyStats();
    }, 30000);
    return () => clearInterval(interval);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    async function fetchDonutStats() {
      try {
        const qs  = donutCourse !== "All" ? `?course=${donutCourse}` : "";
        const res = await fetch(`${API}/admin/employment/donut-stats${qs}`, { headers: authHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        setDonutData(data);
      } catch {}
    }
    fetchDonutStats();
  }, [active, donutCourse]);

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
          manage accounts, and review reports all in one place.
        </p>
        <div className="admin-hero-pills">
          <span className="hero-pill hero-pill-gold"> Role: Administrator
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
                active={donutCourse}
                options={DONUT_COURSES}
                onSelect={(label) => {
                  setDonutCourse(label);
                  setDonutData(null);
                  showToast(`Employment chart: ${label}`);
                }}
                trigger={(toggle) => (
                  <button className="filter" type="button" onClick={toggle}>
                    {donutCourse === "All" ? "Filter" : donutCourse}
                  </button>
                )}
              />
            </div>
            <EmploymentChart data={donutData} />
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
                <div
                  className="activity activity-clickable"
                  key={a._id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenPost?.(a.announcement_id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenPost?.(a.announcement_id); } }}
                >
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
            {reportNames.map((name, i) => {
              const activeFilter = reportActiveFilters[i] || "All";
              const options = reportFilters[i] || ["All"];
              return (
                <div className="report-row" key={name}>
                  <span>{name}</span>
                  <Dropdown
                    menuClassName="report-filter-menu"
                    options={options}
                    active={activeFilter}
                    onSelect={(label) => {
                      setReportActiveFilters((prev) => {
                        const next = [...prev];
                        next[i] = label;
                        return next;
                      });
                      showToast(`${name}: ${label}`);
                    }}
                    trigger={(toggle) => (
                      <button type="button" onClick={toggle}>
                        {activeFilter === "All" ? "Filter" : activeFilter}
                      </button>
                    )}
                  />
                  <button
                    className="download"
                    type="button"
                    aria-label={`Download ${name}`}
                    onClick={() => {
                      if (name === "Survey Completion Report" && !surveyStats) {
                        showToast("Survey data is still loading. Please wait and try again.");
                        return;
                      }
                      if (name === "Employment Status Distribution" && !donutData) {
                        showToast("Employment data is still loading. Please wait and try again.");
                        return;
                      }
                      downloadReport(name, courseJobData, donutData, surveyStats, activeFilter);
                      showToast(`${name} downloaded.`);
                    }}
                  >
                    <span><Icon name="icon-download" /></span>
                  </button>
                </div>
              );
            })}
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
