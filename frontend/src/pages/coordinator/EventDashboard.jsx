import React, { useState, useEffect, useRef } from "react";
import { useOutletContext } from "react-router-dom";
import Icon from "../../components/common/Icon.jsx";
import { MiniBarChart, downloadChartExcel } from "./CoordinatorShared.jsx";
import { API, apiFetch } from "../../services/api.js";

const REPORTS = [
  { label: "Event Attendance Report",   type: "event-attendance"    },
  { label: "Top Events Report",         type: "top-events"          },
  { label: "Feedback Completion Report",type: "feedback-completion" },
];

// Module-level, not state — survives this component unmounting when the
// coordinator navigates away and back, so returning to the Event Dashboard
// shows the last-known numbers instantly instead of flashing "…" again
// while a fresh copy loads silently in the background.
const cachedChartEvents = new Map(); // keyed by year
let cachedStats = null;

export default function EventDashboard() {
  const { showToast } = useOutletContext();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [chartEvents, setChartEvents] = useState(() => cachedChartEvents.get(currentYear) ?? []);
  const [loading, setLoading] = useState(!cachedChartEvents.has(currentYear));
  const [stats, setStats] = useState(cachedStats);
  const [statsLoading, setStatsLoading] = useState(!cachedStats);
  const [allEvents, setAllEvents] = useState([]);
  const [reportEventId, setReportEventId] = useState("");
  const [reportYear, setReportYear] = useState(currentYear);
  const attendanceChartRef = useRef(null);
  const feedbackChartRef   = useRef(null);
  const topEventsChartRef  = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const cached = cachedChartEvents.get(year);
    if (cached) { setChartEvents(cached); setLoading(false); }
    else setLoading(true);
    function fetchChartData() {
      apiFetch(`/coordinator/events-dashboard?year=${year}`)
        .then(data => {
          if (cancelled) return;
          const events = data.chartEvents ?? [];
          cachedChartEvents.set(year, events);
          setChartEvents(events);
        })
        .catch(() => { if (!cancelled) showToast?.("Failed to load event dashboard."); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }
    fetchChartData();
    // Keeps the charts live while the coordinator stays on this page (e.g.
    // attendance being recorded elsewhere right now), not just on year change.
    const interval = setInterval(fetchChartData, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [year]);

  useEffect(() => {
    let cancelled = false;
    function fetchStats() {
      apiFetch("/coordinator/dashboard")
        .then(data => { if (!cancelled) { cachedStats = data; setStats(data); } })
        .catch(() => {})
        .finally(() => { if (!cancelled) setStatsLoading(false); });
    }
    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  useEffect(() => {
    apiFetch("/coordinator/attendance/events")
      .then(data => setAllEvents(data.events ?? []))
      .catch(() => {});
  }, []);

  const statCards = [
    [stats?.completedEvents ?? "—", "Annual Completed Events",    "icon-5"],
    [stats?.recentFeedbacks ?? "—", "Recent Feedback Submission", "icon-13"],
    [stats?.avgRating       ?? "—", "Avg. Event Rating",          "icon-12"],
  ];

  function downloadReport(report, format) {
    const token = localStorage.getItem("auth_token");
    const params = new URLSearchParams({ format });
    if (reportEventId) params.set("eventId", reportEventId);
    else params.set("year", reportYear);
    const url = `${API}/coordinator/reports/${report.type}?${params}`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${report.type}-${reportEventId || reportYear}.${format}`;
        a.click();
        URL.revokeObjectURL(a.href);
        showToast?.(`${report.label} downloaded.`);
      })
      .catch(() => showToast?.("Export failed."));
  }

  const chartLabels    = chartEvents.map(e => e.label);
  const attendanceVals = chartEvents.map(e => e.attendance);
  const feedbackRates  = chartEvents.map(e => e.feedbackRate);
  const attendanceTotal = attendanceVals.reduce((sum, v) => sum + Number(v || 0), 0);
  const avgFeedbackRate = feedbackRates.length
    ? Math.round(feedbackRates.reduce((sum, v) => sum + Number(v || 0), 0) / feedbackRates.length)
    : 0;

  const topEvents        = [...chartEvents].sort((a, b) => b.attendance - a.attendance);
  const topEventLabels   = topEvents.map(e => e.label);
  const topEventVals     = topEvents.map(e => e.attendance);
  const topEventName     = topEvents[0]?.label ?? "—";

  return (
    <section className={`content coordinator-content view active-view`}>
      <div className="coord-stats">
        {statCards.map(([value, label, icon]) => (
          <article className={`coord-stat${statsLoading ? " coord-stat-loading" : ""}`} key={label}>
            <div>
              <strong>{statsLoading ? "…" : value}</strong>
              <span>{label}</span>
            </div>
            <Icon name={icon} />
          </article>
        ))}
        <article className={`coord-highlight${statsLoading ? " coord-stat-loading" : ""}`}>
          <div>
            <strong>Top Event:</strong>
            <span>{statsLoading ? "…" : (stats?.topEvent ?? "—")}</span>
            <strong>Low Response:</strong>
            <span>{statsLoading ? "…" : (stats?.lowEvent ?? "—")}</span>
          </div>
          <Icon name="icon-trophy" />
        </article>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 4 }}>
        <h3 className="coord-section-kicker" style={{ margin: 0 }}>Event Dashboard</h3>
        <select
          className="coord-report-select"
          style={{ width: "auto", padding: "0 12px" }}
          value={year}
          onChange={e => setYear(Number(e.target.value))}
        >
          {Array.from({ length: currentYear - 2019 }, (_, i) => currentYear - i).map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      <div className="coord-left-stack">
        <section className="coord-card" ref={attendanceChartRef}>
          <div className="coord-chart-card-head">
            <h3>Event Attendance</h3>
            <button
              className="chart-export-button"
              type="button"
              onClick={async () => {
                try {
                  await downloadChartExcel(
                    `event-attendance-${year}.xlsx`,
                    "Event Attendance",
                    [
                      ["Event", "Attendance"],
                      ...(chartLabels.length ? chartLabels.map((label, i) => [label, attendanceVals[i] ?? 0]) : [["No data", 0]]),
                    ],
                    attendanceChartRef.current?.querySelector("svg")
                  );
                  showToast?.("Event attendance chart exported.");
                } catch {
                  showToast?.("Could not export the chart.");
                }
              }}
            >
              <Icon name="icon-download" />
              <span>Exports</span>
            </button>
          </div>
          {loading ? (
            <p className="coord-employ-empty" style={{ padding: 20 }}>Loading…</p>
          ) : (
            <MiniBarChart
              title="Event Attendance"
              values={attendanceVals.length ? attendanceVals : [0]}
              labels={chartLabels.length   ? chartLabels    : ["No data"]}
            />
          )}
          <div className="coord-chart-legend" aria-label="Event attendance chart explanation">
            <span><i className="coord-legend-swatch attendance" aria-hidden="true" />Attendance recorded per event in {year}</span>
            <strong>{chartLabels.length ? `Total attendance: ${attendanceTotal}` : "No attendance data yet"}</strong>
          </div>
        </section>

        <section className="coord-card" ref={topEventsChartRef}>
          <div className="coord-chart-card-head">
            <h3>Top Events</h3>
            <button
              className="chart-export-button"
              type="button"
              onClick={async () => {
                try {
                  await downloadChartExcel(
                    `top-events-${year}.xlsx`,
                    "Top Events",
                    [
                      ["Event", "Attendance"],
                      ...(topEventLabels.length ? topEventLabels.map((label, i) => [label, topEventVals[i] ?? 0]) : [["No data", 0]]),
                    ],
                    topEventsChartRef.current?.querySelector("svg")
                  );
                  showToast?.("Top events chart exported.");
                } catch {
                  showToast?.("Could not export the chart.");
                }
              }}
            >
              <Icon name="icon-download" />
              <span>Exports</span>
            </button>
          </div>
          {loading ? (
            <p className="coord-employ-empty" style={{ padding: 20 }}>Loading…</p>
          ) : (
            <MiniBarChart
              title="Top Events by Attendance"
              values={topEventVals.length ? topEventVals : [0]}
              labels={topEventLabels.length ? topEventLabels : ["No data"]}
            />
          )}
          <div className="coord-chart-legend" aria-label="Top events chart explanation">
            <span><i className="coord-legend-swatch attendance" aria-hidden="true" />Events ranked by attendance in {year}</span>
            <strong>{topEventLabels.length ? `Top event: ${topEventName}` : "No attendance data yet"}</strong>
          </div>
        </section>

        <section className="coord-card" ref={feedbackChartRef}>
          <div className="coord-chart-card-head">
            <h3>Event Feedback Completion</h3>
            <button
              className="chart-export-button"
              type="button"
              onClick={async () => {
                try {
                  await downloadChartExcel(
                    `event-feedback-completion-${year}.xlsx`,
                    "Event Feedback Completion",
                    [
                      ["Event", "Feedback Completion Rate (%)"],
                      ...(chartLabels.length ? chartLabels.map((label, i) => [label, feedbackRates[i] ?? 0]) : [["No data", 0]]),
                    ],
                    feedbackChartRef.current?.querySelector("svg")
                  );
                  showToast?.("Event feedback completion chart exported.");
                } catch {
                  showToast?.("Could not export the chart.");
                }
              }}
            >
              <Icon name="icon-download" />
              <span>Exports</span>
            </button>
          </div>
          {loading ? (
            <p className="coord-employ-empty" style={{ padding: 20 }}>Loading…</p>
          ) : (
            <MiniBarChart
              title="Event Feedback Completion Rate (%)"
              values={feedbackRates.length ? feedbackRates : [0]}
              labels={chartLabels.length    ? chartLabels   : ["No data"]}
            />
          )}
          <div className="coord-chart-legend" aria-label="Event feedback completion chart explanation">
            <span><i className="coord-legend-swatch feedback" aria-hidden="true" />Feedback submissions ÷ attendance per event in {year}</span>
            <strong>{chartLabels.length ? `Average completion rate: ${avgFeedbackRate}%` : "No feedback data yet"}</strong>
          </div>
        </section>

        <section className="coord-card coord-reports">
          <h3>Reports</h3>

          <div className="coord-reports-toolbar">
            <select
              className="coord-report-select"
              value={reportEventId}
              onChange={e => setReportEventId(e.target.value)}
            >
              <option value="">All Events</option>
              {allEvents.map(ev => (
                <option key={String(ev._id)} value={String(ev._id)}>{ev.title}</option>
              ))}
            </select>
            {!reportEventId && (
              <select
                className="coord-report-select coord-report-year"
                value={reportYear}
                onChange={e => setReportYear(Number(e.target.value))}
              >
                {Array.from({ length: currentYear - 2019 }, (_, i) => currentYear - i).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            )}
          </div>

          {REPORTS.map((report) => (
            <div className="coord-report-row-clean" key={report.type}>
              <span>{report.label}</span>
              <div className="coord-report-actions">
                <button type="button" className="btn btn-primary" onClick={() => downloadReport(report, "xlsx")}>
                  <Icon name="icon-export" /> Excel
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => downloadReport(report, "csv")}>
                  <Icon name="icon-export" /> CSV
                </button>
              </div>
            </div>
          ))}
        </section>
      </div>
    </section>
  );
}
