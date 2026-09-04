import React, { useState, useEffect, useRef } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import Icon from "../../components/common/Icon.jsx";
import { Dropdown } from "../../components/common/Primitives.jsx";

import { API, authHeaders } from "../../services/api.js";

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function DashboardView() {
  const { showToast } = useOutletContext();
  const navigate = useNavigate();
  const [totalUsers, setTotalUsers] = useState(null);
  const [employedCount, setEmployedCount] = useState(null);
  const [tracerCount, setTracerCount]     = useState(null);
  const [postActivities, setPostActivities] = useState([]);
  const [activitiesLoading, setActivitiesLoading] = useState(true);
  const [activityWindow, setActivityWindow] = useState("24");

  useEffect(() => {
  
    async function fetchTotalUsers() {
      try {
        const res = await fetch(`${API}/admin/users`, { headers: authHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        // "Total Users" should read as portal health (real, active accounts) —
        // counting pending (never-activated) and suspended accounts alongside
        // active ones made the tile jump on every new registration or
        // suspension, neither of which reflects actual active usage.
        const activeCount = (data.users || []).filter(u => u.status === "active").length;
        setTotalUsers(activeCount);
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

    fetchTotalUsers();
    fetchEmploymentStats();

    const interval = setInterval(() => {
      fetchTotalUsers();
      fetchEmploymentStats();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function fetchActivities() {
      setActivitiesLoading(true);
      try {
        const limit = activityWindow === "all" ? 50 : 20;
        const res = await fetch(`${API}/admin/announcements/activity?hours=${activityWindow}&limit=${limit}`, { headers: authHeaders() });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const seen = new Map();
        for (const activity of data.activities || []) {
          const key = `${activity.user_id || activity.user_name}|${activity.announcement_id || activity.announcement_title}|${activity.action}`;
          const previous = seen.get(key);
          if (!previous || new Date(activity.createdAt) > new Date(previous.createdAt)) seen.set(key, activity);
        }
        if (!cancelled) {
          setPostActivities([...seen.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
        }
      } catch {} finally {
        if (!cancelled) setActivitiesLoading(false);
      }
    }
    fetchActivities();
    const interval = setInterval(fetchActivities, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [activityWindow]);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <section className={`content figma-group-69 view active-view`}>
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
        <aside className="right-stack">
          <section className="panel">
            <div className="panel-head light">
              <span>{activityWindow === "all" ? "Post Activity History" : "Recent Post Activities"}</span>
              <Dropdown
                menuClassName="filter-menu activity-window-menu"
                active={activityWindow === "24" ? "Last 24 hours" : activityWindow === "168" ? "Last 7 days" : "Full history"}
                options={["Last 24 hours", "Last 7 days", "Full history"]}
                onSelect={(label) => setActivityWindow(label === "Last 24 hours" ? "24" : label === "Last 7 days" ? "168" : "all")}
                trigger={(toggle) => (
                  <button className="filter activity-window-filter" type="button" onClick={toggle}>
                    {activityWindow === "24" ? "Last 24 hours" : activityWindow === "168" ? "Last 7 days" : "Full history"}
                  </button>
                )}
              />
            </div>
            <div className="activity-list recent-post-activity-list" key={activityWindow}>
              {activitiesLoading ? (
                <div className="activity" style={{ justifyContent: "center", color: "var(--muted, #76656a)", fontSize: 13 }}>
                  Loading…
                </div>
              ) : postActivities.length === 0 ? (
                <div className="activity" style={{ justifyContent: "center", color: "var(--muted, #76656a)", fontSize: 13 }}>
                  {activityWindow === "all" ? "No activity history yet." : "No activity in this period."}
                </div>
              ) : postActivities.map((a) => (
                <div
                  className="activity activity-clickable"
                  key={a._id}
                  role="button"
                  tabIndex={0}
                  onClick={() => a.announcement_id && navigate("/admin/announcements", { state: { postId: String(a.announcement_id) } })}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); a.announcement_id && navigate("/admin/announcements", { state: { postId: String(a.announcement_id) } }); } }}
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
