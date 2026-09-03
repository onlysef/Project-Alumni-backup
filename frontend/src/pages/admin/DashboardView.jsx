import React, { useState, useEffect, useRef } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import Icon from "../../components/common/Icon.jsx";
import { Dropdown } from "../../components/common/Primitives.jsx";
import { CourseJobChart, EmploymentChart, CHART_PALETTE, MiniDonut, DistributionBars } from "../../components/common/Charts.jsx";
import { reportFilters } from "../../data.js";

import { API, authHeaders } from "../../services/api.js";

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

    if (["BSIT", "BSCS", "BSIS", "BSIM"].includes(filter)) {
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

const DONUT_COURSES = ["All", "BSIT", "BSCS", "BSIS", "BSIM"];

const DURATION_ORDER = [
  "Less than 6 months", "6 months to 1 year", "1 to 2 years",
  "2 to 3 years", "3 to 5 years", "More than 5 years",
];

// ── Tracer Study Analytics (accordion) ────────────────────────────────────────
// DistributionBars, MiniDonut, and CHART_PALETTE now live in Charts.jsx so the
// AC AI Assistant chat can render the same charts inline in answers.

// Vertical bar chart — best for ordered or moderate-cardinality categories.
function MiniBarChart({ rows }) {
  if (!rows || rows.length === 0) return <p className="tracer-empty">No responses yet.</p>;
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div className="tracer-vbar-chart">
      {rows.map((r, i) => (
        <div className="tracer-vbar-col" key={r.label}>
          <div className="tracer-vbar-wrap">
            <div
              className="tracer-vbar"
              style={{ height: `${Math.max((r.count / max) * 100, 8)}%`, background: VERTICAL_CHART_COLORS[i % VERTICAL_CHART_COLORS.length] }}
              title={`${r.label}: ${r.count}`}
            >
              <span className="tracer-vbar-value">{r.count}</span>
            </div>
          </div>
          <div className="tracer-vbar-label" title={r.label}>{r.label}</div>
        </div>
      ))}
    </div>
  );
}

// Tag cloud — best for many categories that would otherwise need
// horizontal scrolling as bars (e.g. a long industry list). Uniform chip
// size keeps the row clean and consistent; the count inside each chip
// still shows magnitude without relying on size differences to read it.
function TagCloud({ rows }) {
  if (!rows || rows.length === 0) return <p className="tracer-empty">No responses yet.</p>;
  const total = rows.reduce((a, r) => a + r.count, 0);
  return (
    <div className="tracer-tagcloud">
      {rows.map((r, i) => {
        const pct = total > 0 ? Math.round((r.count / total) * 100) : 0;
        return (
          <span
            key={r.label}
            className="tracer-tag"
            style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }}
            title={`${r.label}: ${r.count} (${pct}%)`}
          >
            {r.label} <b>{r.count}</b>
          </span>
        );
      })}
    </div>
  );
}

// Trend/area line — best for ordinal data with a natural sequence (e.g.
// duration buckets), where the shape across categories in THEIR order
// matters more than ranking them by count.
const TREND_W = 560, TREND_H = 150, TREND_PAD = 26;

function TrendLine({ rows, order }) {
  if (!rows || rows.length === 0) return <p className="tracer-empty">No responses yet.</p>;
  const byLabel = new Map(rows.map((r) => [r.label, r.count]));
  const labels = order && order.length ? order : rows.map((r) => r.label);
  const ordered = labels.map((label) => ({ label, count: byLabel.get(label) || 0 }));
  const max = Math.max(...ordered.map((o) => o.count), 1);
  const stepX = ordered.length > 1 ? (TREND_W - TREND_PAD * 2) / (ordered.length - 1) : 0;
  const plotH = TREND_H - TREND_PAD * 2 - 18;
  const points = ordered.map((o, i) => ({
    ...o,
    x: TREND_PAD + i * stepX,
    y: TREND_PAD + 18 + (plotH - (o.count / max) * plotH),
  }));
  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const baseY = TREND_H - TREND_PAD;
  const areaD = `${pathD} L ${points[points.length - 1].x} ${baseY} L ${points[0].x} ${baseY} Z`;

  return (
    <div className="tracer-trend">
      <svg viewBox={`0 0 ${TREND_W} ${TREND_H}`} className="tracer-trend-svg" preserveAspectRatio="none" aria-hidden="true">
        <path d={areaD} className="tracer-trend-area" />
        <path d={pathD} className="tracer-trend-line" />
        {points.map((p) => (
          <g key={p.label}>
            <circle cx={p.x} cy={p.y} r="4.5" className="tracer-trend-dot" />
            <text x={p.x} y={p.y - 11} textAnchor="middle" className="tracer-trend-value">{p.count}</text>
          </g>
        ))}
      </svg>
      <div className="tracer-trend-labels" style={{ gridTemplateColumns: `repeat(${ordered.length}, 1fr)` }}>
        {ordered.map((o) => (
          <span key={o.label} title={o.label}>{o.label}</span>
        ))}
      </div>
    </div>
  );
}

const RATING_ORDER  = ["Excellent", "Competent", "Satisfactory", "Beginner", "Non-Acceptable"];
const RATING_COLORS = {
  Excellent: "#941527", Competent: "#dea045", Satisfactory: "#eaaa63",
  Beginner: "#6b4226", "Non-Acceptable": "#8f8f8f",
};

const VERTICAL_CHART_COLORS = ["#b51f3d", "#f0b43c", "#9b6cff", "#21b6a8", "#4f8df7", "#f47b35"];

function RatingMatrix({ rows }) {
  const hasData = rows?.some((r) => Object.keys(r.ratings).length > 0);
  if (!hasData) return <p className="tracer-empty">No responses yet.</p>;
  return (
    <div className="tracer-rating-matrix">
      {rows.map((r) => {
        const total = Object.values(r.ratings).reduce((a, b) => a + b, 0);
        return (
          <div className="tracer-rating-row" key={r.skill}>
            <span className="tracer-rating-label">{r.skill}</span>
            <div className="tracer-rating-stack">
              {total === 0 ? (
                <span className="tracer-rating-empty">No responses</span>
              ) : (
                RATING_ORDER.map((k) => {
                  const c = r.ratings[k] || 0;
                  if (!c) return null;
                  const pct = Math.round((c / total) * 100);
                  return (
                    <div
                      key={k}
                      className="tracer-rating-seg"
                      title={`${k}: ${c} (${pct}%)`}
                      style={{ width: `${pct}%`, background: RATING_COLORS[k] }}
                    />
                  );
                })
              )}
            </div>
          </div>
        );
      })}
      <div className="tracer-rating-legend">
        {RATING_ORDER.map((k) => (
          <span key={k} className="tracer-rating-legend-item">
            <i style={{ background: RATING_COLORS[k] }} />{k}
          </span>
        ))}
      </div>
    </div>
  );
}

function TracerAccordionRow({ num, title, subtitle, open, onToggle, children }) {
  const hasOpened = useRef(open);
  if (open) hasOpened.current = true;

  return (
    <div className="tracer-accordion-item">
      <button
        type="button"
        className="tracer-accordion-head"
        onClick={onToggle}
        aria-expanded={open}
      >
        <div>
          <div className="tracer-accordion-title">{num}. {title}</div>
          <div className="tracer-accordion-subtitle">{subtitle}</div>
        </div>
        <span className={`tracer-accordion-chevron${open ? " open" : ""}`}>
          <svg width="12" height="8" viewBox="0 0 12 8" fill="none" aria-hidden="true">
            <path d="M1 1.5L6 6.5L11 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {hasOpened.current && (
        <div
          className={`tracer-accordion-collapse${open ? " open" : ""}`}
          aria-hidden={!open}
          inert={open ? undefined : "true"}
        >
          <div className="tracer-accordion-body">{children}</div>
        </div>
      )}
    </div>
  );
}

function pctOf(count, total) { return total > 0 ? `${Math.round((count / total) * 100)}%` : ""; }

// CSV rows for a single distribution chart (Label, Count, Percent).
function distCsv(list) {
  const total = (list || []).reduce((a, r) => a + r.count, 0);
  return [["Label", "Count", "Percent"], ...(list || []).map((r) => [r.label, r.count, pctOf(r.count, total)])];
}

// CSV rows for the personal-growth rating matrix (Skill, Rating, Count, Percent).
function ratingMatrixCsv(rows) {
  const out = [["Skill", "Rating", "Count", "Percent"]];
  (rows || []).forEach(({ skill, ratings }) => {
    const total = Object.values(ratings).reduce((a, b) => a + b, 0);
    Object.entries(ratings).forEach(([rating, count]) => {
      out.push([skill, rating, count, pctOf(count, total)]);
    });
  });
  return out;
}

function downloadCsv(filename, rows) {
  const csv = rows.map((r) => r.map((v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// Wraps a single chart with its own title + CSV export button.
function ChartBlock({ title, filename, csvRows, children }) {
  return (
    <div className="tracer-chart-block">
      <div className="tracer-subhead-row">
        <h5 className="tracer-subhead">{title}</h5>
        <button
          type="button"
          className="tracer-chart-export"
          title={`Export ${title} as CSV`}
          aria-label={`Export ${title} as CSV`}
          onClick={() => downloadCsv(filename, csvRows)}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            <polyline points="7 10 12 15 17 10" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Export
        </button>
      </div>
      {children}
    </div>
  );
}

const TRACER_COLLEGES = ["CCS", "CIT", "CAFA", "COED", "CCJE", "CPAG", "CBA", "CASS", "COS", "COE"];

function TracerStudyAnalytics({ data, college, onCollegeChange }) {
  const [open, setOpen] = useState({});
  const toggle = (key) => setOpen((o) => ({ ...o, [key]: !o[key] }));

  const collegeFilter = (
    <Dropdown
      menuClassName="filter-menu"
      active={college}
      options={TRACER_COLLEGES}
      onSelect={onCollegeChange}
      trigger={(toggleMenu) => (
        <button className="filter" type="button" onClick={toggleMenu}>
          {college}
        </button>
      )}
    />
  );

  if (!data) {
    return (
      <section className="panel tracer-analytics-panel">
        <div className="panel-head"><span>Tracer Study Analytics</span>{collegeFilter}</div>
        <div className="chart-body" style={{ textAlign: "center", color: "var(--muted, #76656a)" }}>
          Loading tracer study data…
        </div>
      </section>
    );
  }

  const SECTIONS = [
    {
      key: "profile", title: "Respondent Profile",
      subtitle: "Gender and course distribution of tracer respondents.",
      body: (
        <>
          <ChartBlock title="By Gender" filename="tracer-gender.csv" csvRows={distCsv(data.respondentProfile.byGender)}>
            <MiniDonut rows={data.respondentProfile.byGender} />
          </ChartBlock>
          <ChartBlock title="By Program" filename="tracer-program.csv" csvRows={distCsv(data.respondentProfile.byProgram)}>
            <DistributionBars rows={data.respondentProfile.byProgram} />
          </ChartBlock>
        </>
      ),
    },
    {
      key: "exam", title: "Professional Examination",
      subtitle: "Professional-examination participation of tracer respondents.",
      body: (
        <ChartBlock title="Participation" filename="tracer-exam-participation.csv" csvRows={distCsv(data.professionalExam.byStatus)}>
          <MiniDonut rows={data.professionalExam.byStatus} />
        </ChartBlock>
      ),
    },
    {
      key: "employment", title: "Employment Overview",
      subtitle: "Employment participation, classification, job-relevance, and duration.",
      body: (
        <>
          <ChartBlock title="Employment Status" filename="tracer-employment-status.csv" csvRows={distCsv(data.employmentOverview.byStatus)}>
            <MiniDonut rows={data.employmentOverview.byStatus} />
          </ChartBlock>
          <ChartBlock title="Job-Relatedness" filename="tracer-job-relatedness.csv" csvRows={distCsv(data.employmentOverview.byJobRelevance)}>
            <MiniBarChart rows={data.employmentOverview.byJobRelevance} />
          </ChartBlock>
          <ChartBlock title="Duration in Current Job" filename="tracer-job-duration.csv" csvRows={distCsv(data.employmentOverview.byDuration)}>
            <TrendLine rows={data.employmentOverview.byDuration} order={DURATION_ORDER} />
          </ChartBlock>
        </>
      ),
    },
    {
      key: "occupation", title: "Occupation and Industry",
      subtitle: "Most common occupations and industries of employed respondents.",
      body: (
        <>
          <ChartBlock title="Top Occupations" filename="tracer-occupations.csv" csvRows={distCsv(data.occupationIndustry.topOccupations)}>
            <DistributionBars rows={data.occupationIndustry.topOccupations} />
          </ChartBlock>
          <ChartBlock title="By Industry" filename="tracer-industry.csv" csvRows={distCsv(data.occupationIndustry.byIndustry)}>
            <TagCloud rows={data.occupationIndustry.byIndustry} />
          </ChartBlock>
        </>
      ),
    },
    {
      key: "unemployment", title: "Unemployment Reasons",
      subtitle: "Multi-response reasons selected by unemployed respondents.",
      body: (
        <ChartBlock title="Unemployment Reasons" filename="tracer-unemployment-reasons.csv" csvRows={distCsv(data.unemploymentReasons)}>
          <DistributionBars rows={data.unemploymentReasons} />
        </ChartBlock>
      ),
    },
    {
      key: "growth", title: "Personal Growth Assessment",
      subtitle: "Likert-style comparison of personal-growth areas.",
      body: (
        <ChartBlock title="Personal Growth Assessment" filename="tracer-personal-growth.csv" csvRows={ratingMatrixCsv(data.personalGrowth)}>
          <RatingMatrix rows={data.personalGrowth} />
        </ChartBlock>
      ),
    },
    {
      key: "education", title: "Further Education",
      subtitle: "Further-education participation and training pursuits.",
      body: (
        <>
          <ChartBlock title="Pursued Further Education" filename="tracer-further-education.csv" csvRows={distCsv(data.furtherEducation.byFurtherEducation)}>
            <MiniDonut rows={data.furtherEducation.byFurtherEducation} />
          </ChartBlock>
          <ChartBlock title="Pursued Trainings" filename="tracer-trainings.csv" csvRows={distCsv(data.furtherEducation.byTrainings)}>
            <MiniDonut rows={data.furtherEducation.byTrainings} />
          </ChartBlock>
        </>
      ),
    },
    {
      key: "promotion", title: "Promotion and Recognition",
      subtitle: "Promotions and significant accomplishments reported.",
      body: (
        <>
          <ChartBlock title="Promoted in Current Job" filename="tracer-promoted.csv" csvRows={distCsv(data.promotion.byPromotion)}>
            <MiniDonut rows={data.promotion.byPromotion} />
          </ChartBlock>
          <ChartBlock title="Significant Accomplishments" filename="tracer-accomplishments.csv" csvRows={distCsv(data.promotion.byAccomplishments)}>
            <MiniDonut rows={data.promotion.byAccomplishments} />
          </ChartBlock>
        </>
      ),
    },
    {
      key: "development", title: "Professional Development Activities",
      subtitle: "Participation in professional-development activities and certifications.",
      body: (
        <>
          <ChartBlock title="Development Activities" filename="tracer-dev-activities.csv" csvRows={distCsv(data.professionalDevelopment.byDevActivities)}>
            <MiniDonut rows={data.professionalDevelopment.byDevActivities} />
          </ChartBlock>
          <ChartBlock title="Professional Certifications" filename="tracer-certifications.csv" csvRows={distCsv(data.professionalDevelopment.byCertifications)}>
            <MiniDonut rows={data.professionalDevelopment.byCertifications} />
          </ChartBlock>
        </>
      ),
    },
  ];

  return (
    <section className="panel tracer-analytics-panel">
      <div className="panel-head">
        <span style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span>Tracer Study Analytics</span>
          <span style={{ fontWeight: 500, fontSize: 12, opacity: 0.85 }}>{data.total} responses</span>
        </span>
        {collegeFilter}
      </div>
      <div className="tracer-analytics-note">
        Charts reflect free-text and single/multi-select answers as submitted — some categories
        (e.g. exam names, occupations) are grouped by exact wording and may show near-duplicate
        entries if alumni phrased answers differently.
      </div>
      <div className="tracer-accordion">
        {SECTIONS.map((s, i) => (
          <TracerAccordionRow
            key={s.key}
            num={i + 1}
            title={s.title}
            subtitle={s.subtitle}
            open={!!open[s.key]}
            onToggle={() => toggle(s.key)}
          >
            {s.body}
          </TracerAccordionRow>
        ))}
      </div>
    </section>
  );
}

export default function DashboardView() {
  const { showToast } = useOutletContext();
  const navigate = useNavigate();
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
  const [activityWindow, setActivityWindow] = useState("24");
  const [tracerAnalytics, setTracerAnalytics] = useState(null);
  const [tracerCollege, setTracerCollege] = useState("CCS");

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

    async function fetchCourseJobStats() {
      try {
        const res = await fetch(`${API}/admin/employment/course-stats`, { headers: authHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        setCourseJobData(data);
      } catch {}
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
    fetchEmploymentStats();
    fetchCourseJobStats();
    fetchSurveyStats();

    const interval = setInterval(() => {
      fetchTotalUsers();
      fetchEmploymentStats();
      fetchCourseJobStats();
      fetchSurveyStats();
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

  useEffect(() => {
    let cancelled = false;
      async function fetchDonutStats() {
      try {
        const qs  = donutCourse !== "All" ? `?course=${donutCourse}` : "";
        const res = await fetch(`${API}/admin/employment/donut-stats${qs}`, { headers: authHeaders() });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setDonutData(data);
      } catch {}
    }
    fetchDonutStats();
    return () => { cancelled = true; };
  }, [donutCourse]);

  useEffect(() => {
    // Switching colleges quickly can let an in-flight request for the
    // PREVIOUS college resolve after the new one already did, overwriting
    // the correct data with stale data. `cancelled` is flipped by this
    // effect's own cleanup (which runs whenever tracerCollege changes),
    // so a late response from an abandoned request is dropped instead of
    // applied.
    let cancelled = false;
    async function fetchTracerAnalytics() {
      try {
        const qs  = tracerCollege ? `?college=${tracerCollege}` : "";
        const res = await fetch(`${API}/admin/employment/tracer-analytics${qs}`, { headers: authHeaders() });
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (!cancelled) setTracerAnalytics(json);
      } catch {}
    }
    fetchTracerAnalytics();
    const interval = setInterval(fetchTracerAnalytics, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [tracerCollege]);

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
        <div className="left-stack">

          <section className="panel">
            <div className="panel-head">
              <span>Employment Rate by Course</span>
              <div className="chart-head-actions">
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
                <button
                  className="chart-export-button"
                  type="button"
                  onClick={() => {
                    if (!courseJobData.byCourse?.length && !courseJobData.bsitByTrack?.length) {
                      showToast("Chart data is still loading.");
                      return;
                    }
                    downloadReport("Course vs Job", courseJobData, donutData, surveyStats, "All");
                    showToast("Employment rate by course exported.");
                  }}
                >
                  <Icon name="icon-download" />
                  <span>Exports</span>
                </button>
              </div>
            </div>
            <CourseJobChart data={courseJobData} metric={courseJobMetric} />
          </section>

          <section className="panel">
            <div className="panel-head">
              <span>Employed vs Unemployed</span>
              <div className="chart-head-actions">
                <Dropdown
                  menuClassName="filter-menu"
                  active={donutCourse}
                  options={DONUT_COURSES}
                  onSelect={(label) => {
                    setDonutCourse(label);
                    showToast(`Employment chart: ${label}`);
                  }}
                  trigger={(toggle) => (
                    <button className="filter" type="button" onClick={toggle}>
                      {donutCourse === "All" ? "Filter" : donutCourse}
                    </button>
                  )}
                />
                <button
                  className="chart-export-button"
                  type="button"
                  onClick={() => {
                    if (!donutData) {
                      showToast("Chart data is still loading.");
                      return;
                    }
                    downloadReport("Employment Status Distribution", courseJobData, donutData, surveyStats, "All");
                    showToast("Employment chart exported.");
                  }}
                >
                  <Icon name="icon-download" />
                  <span>Exports</span>
                </button>
              </div>
            </div>
            <EmploymentChart data={donutData} />
          </section>
        </div>

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

      <TracerStudyAnalytics data={tracerAnalytics} college={tracerCollege} onCollegeChange={setTracerCollege} />
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
