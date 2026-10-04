import React, { useState, useEffect } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import Icon from "../../components/common/Icon.jsx";
import { Dropdown } from "../../components/common/Primitives.jsx";

import { apiFetch } from "../../services/api.js";

const ACTIVITY_WINDOW_LABELS = { "24": "Last 24 hours", "168": "Last 7 days", all: "Full history" };

// Module-level cache so returning shows the last numbers instantly.
let cachedDashboardData = null;
const cachedActivity = new Map(); // keyed by activityWindow ("24"/"168"/"all")

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function CoordinatorHome() {
  const navigate = useNavigate();
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const [data, setData] = useState(cachedDashboardData);
  const [loading, setLoading] = useState(!cachedDashboardData);
  const [activity, setActivity] = useState(() => cachedActivity.get("24") ?? []);
  const [activityLoading, setActivityLoading] = useState(!cachedActivity.has("24"));
  const [activityWindow, setActivityWindow] = useState("24");

  useEffect(() => {
    function fetchDashboard() {
      apiFetch("/coordinator/dashboard")
        .then(res => { cachedDashboardData = res; setData(res); })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const cached = cachedActivity.get(activityWindow);
    if (cached) { setActivity(cached); setActivityLoading(false); }
    else setActivityLoading(true);
    const limit = activityWindow === "all" ? 50 : 20;
    function fetchActivity() {
      apiFetch(`/coordinator/dashboard/activity?hours=${activityWindow}&limit=${limit}`)
        .then(res => {
          if (cancelled) return;
          const list = res.activity ?? [];
          cachedActivity.set(activityWindow, list);
          setActivity(list);
        })
        .catch(() => {})
        .finally(() => { if (!cancelled) setActivityLoading(false); });
    }
    fetchActivity();
    const interval = setInterval(fetchActivity, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [activityWindow]);

  const collegeLabel = data?.college ? ` (${data.college})` : "";
  const statCards = [
    [data?.totalAlumni    ?? "—", `Total Alumni${collegeLabel}`,    "icon-11"],
    [data?.activeAlumni   ?? "—", `Active Alumni${collegeLabel}`,   "icon-active"],
    [data?.inactiveAlumni ?? "—", `Inactive Alumni${collegeLabel}`, "icon-inactive"],
  ];

  return (
    <section className={`content coordinator-content view active-view`}>
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
          <article className={`stat-card${loading ? " coord-stat-loading" : ""}`} key={label}>
            <div>
              <p className="stat-value">{loading ? "…" : value}</p>
              <p className="stat-label">{label}</p>
            </div>
            <span><Icon name={icon} /></span>
          </article>
        ))}
      </div>

      <div className="coord-left-stack">
        <section className="coord-card coord-activity">
          <div className="coord-chart-card-head">
            <h3>Activity</h3>
            <Dropdown
              menuClassName="filter-menu activity-window-menu"
              active={ACTIVITY_WINDOW_LABELS[activityWindow]}
              options={Object.values(ACTIVITY_WINDOW_LABELS)}
              onSelect={(label) => {
                const key = Object.keys(ACTIVITY_WINDOW_LABELS).find(k => ACTIVITY_WINDOW_LABELS[k] === label);
                if (key) setActivityWindow(key);
              }}
              trigger={(toggle) => (
                <button className="filter activity-window-filter" type="button" onClick={toggle}>
                  {ACTIVITY_WINDOW_LABELS[activityWindow]}
                </button>
              )}
            />
          </div>
          {activityLoading ? (
            <p style={{ fontSize: 13, color: "#888" }}>Loading…</p>
          ) : activity.length ? (
            <div className="activity-list">
              {activity.map((a, i) => {
                const navigable = a.type === "attendance" || a.type === "feedback";
                const dest = a.type === "attendance" ? "/coordinator/participation" : "/coordinator/events";
                return (
                <div
                  className={`activity${navigable ? " activity-clickable" : ""}`}
                  key={a._id ?? i}
                  role={navigable ? "button" : undefined}
                  tabIndex={navigable ? 0 : undefined}
                  onClick={navigable ? () => navigate(dest, { state: { eventId: a.event_id ?? null } }) : undefined}
                  onKeyDown={navigable ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      navigate(dest, { state: { eventId: a.event_id ?? null } });
                    }
                  } : undefined}
                  style={navigable ? { cursor: "pointer" } : undefined}
                >
                  <p>
                    {a.name ? (
                      <>
                        <strong>{a.name}</strong>{" "}
                        {a.detail ?? ""}
                      </>
                    ) : (
                      a.text ?? ""
                    )}
                  </p>
                  <time>{timeAgo(a.time)}</time>
                </div>
                );
              })}
            </div>
          ) : (
            <p style={{ fontSize: 13, color: "#888" }}>
              {activityWindow === "all" ? "No activity history yet." : "No activity in this period."}
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
