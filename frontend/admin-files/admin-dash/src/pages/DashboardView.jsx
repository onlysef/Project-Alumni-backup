import React, { useState, useEffect, useRef } from "react";
import Icon from "../Icon.jsx";
import { Dropdown } from "../Primitives.jsx";
import { CareerChart, EmploymentChart } from "../Charts.jsx";
import { careerSets, employmentSets, assistantGreetings, assistantReply, currentTime, reportFilters } from "../data.js";

const API = "http://localhost:5000/api";

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
  "Course vs Career Relationship",
  "Survey Completion Report",
];

export default function DashboardView({ active, showToast }) {
  const [careerIndex, setCareerIndex] = useState(0);
  const [employmentIndex, setEmploymentIndex] = useState(0);
  const [totalUsers, setTotalUsers] = useState(null);
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

    const interval = setInterval(() => {
      fetchTotalUsers();
      fetchActivities();
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
        <h1 className="admin-hero-title">Hello, Admin! <span aria-hidden="true">👋</span></h1>
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
          <div><p className="stat-value">260</p><p className="stat-label">Employed Alumni</p></div>
          <span><Icon name="icon-12" /></span>
        </article>
        <article className="stat-card">
          <div><p className="stat-value">100</p><p className="stat-label">Recent Tracer Submissions</p></div>
          <span><Icon name="icon-13" /></span>
        </article>
      </div>

      <div className="grid">
        <div className="left-stack">
          <Assistant showToast={showToast} />

          <section className="panel">
            <div className="panel-head">
              <span>Course vs Career Recommendation</span>
              <Dropdown
                menuClassName="filter-menu"
                active={careerSets[careerIndex].label}
                options={careerSets.map((s) => s.label)}
                onSelect={(label) => {
                  const i = careerSets.findIndex((s) => s.label === label);
                  setCareerIndex(i);
                  showToast(`Course chart filtered: ${label}`);
                }}
                trigger={(toggle) => (
                  <button className="filter" type="button" onClick={toggle}>
                    {careerSets[careerIndex].label === "All" ? "Filter" : careerSets[careerIndex].label}
                  </button>
                )}
              />
            </div>
            <CareerChart index={careerIndex} />
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
                  className="print"
                  type="button"
                  aria-label={`Print ${name}`}
                  onClick={() => {
                    showToast(`${name} is ready to print.`);
                    window.print();
                  }}
                >
                  <span><Icon name="icon-16" /></span>
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
