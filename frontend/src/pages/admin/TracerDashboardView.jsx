import React, { useState, useEffect } from "react";
import { useOutletContext } from "react-router-dom";
import { jsPDF } from "jspdf";
import { Dropdown } from "../../components/common/Primitives.jsx";
import { CHART_PALETTE, MiniDonut, DistributionBars, EmploymentChart } from "../../components/common/Charts.jsx";
import { renderChartImage } from "../../components/common/canvasCharts.js";
import Icon from "../../components/common/Icon.jsx";
import { API, authHeaders } from "../../services/api.js";
import { COLLEGE_CODES, COURSES_BY_COLLEGE } from "../../constants/colleges.js";

// Tracer Study Analytics: shared chart components live in Charts.jsx

const DURATION_ORDER = [
  "Less than 6 months", "6 months to 1 year", "1 to 2 years",
  "2 to 3 years", "3 to 5 years", "More than 5 years",
];

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
              style={{ height: `${Math.max((r.count / max) * 100, 8)}%`, background: CHART_PALETTE[i % CHART_PALETTE.length] }}
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

const TREND_W = 560, TREND_H = 190, TREND_PAD = 26;

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

function TracerAccordionRow({ num, title, subtitle, children }) {
  return (
    <div className="tracer-accordion-item">
      <div className="tracer-accordion-head">
        <div>
          <div className="tracer-accordion-title">{num}. {title}</div>
          <div className="tracer-accordion-subtitle">{subtitle}</div>
        </div>
      </div>
      <div className="tracer-accordion-body">{children}</div>
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

// exceljs is dynamically imported (~900KB) so it only loads on export.
async function downloadChartExcel(filename, title, csvRows, img) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Chart");

  sheet.addRow([title]).font = { bold: true, size: 14 };
  sheet.addRow([]);
  csvRows.forEach((row) => sheet.addRow(row));
  sheet.getRow(3).font = { bold: true };

  const colCount = csvRows[0].length;
  sheet.getColumn(1).width = 32;
  for (let c = 2; c <= colCount; c++) sheet.getColumn(c).width = 14;

  if (img) {
    const imageId = workbook.addImage({ base64: img.dataUrl.split(",")[1], extension: "png" });
    sheet.addImage(imageId, {
      tl: { col: colCount + 1, row: 0 },
      ext: { width: img.width, height: img.height },
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// Moved here from the main Dashboard along with the chart below.
function downloadEmploymentDonutCsv(donutData) {
  downloadCsv("employment-status-distribution.csv", [
    ["Status", "Percentage", "Count"],
    ["Employed", `${donutData.employedPct}%`, donutData.employed],
    ["Unemployed", `${donutData.unemployedPct}%`, donutData.unemployed],
    ["Not Yet Updated", `${donutData.unidentifiedPct}%`, donutData.unidentified],
    ["Total", "", donutData.total],
  ]);
}

function ChartBlock({ title, filename, csvRows, chartType, chartRows, chartOrder, children }) {
  return (
    <div className="tracer-chart-block">
      <div className="tracer-subhead-row">
        <h5 className="tracer-subhead">{title}</h5>
        <button
          type="button"
          className="tracer-chart-export"
          title={`Export ${title}`}
          aria-label={`Export ${title}`}
          onClick={async () => {
            const img = renderChartImage(chartType, {
              rows: chartRows, order: chartOrder,
              ratingOrder: RATING_ORDER, ratingColors: RATING_COLORS,
            });
            await downloadChartExcel(filename, title, csvRows, img);
          }}
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

function TracerStudyAnalytics({ data }) {
  if (!data) {
    return (
      <section className="panel tracer-analytics-panel">
        <div className="panel-head"><span>Tracer Study Analytics</span></div>
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
        <div className="tracer-chart-row">
          <ChartBlock title="By Gender" filename="tracer-gender.xlsx" csvRows={distCsv(data.respondentProfile.byGender)} chartType="donut" chartRows={data.respondentProfile.byGender}>
            <MiniDonut rows={data.respondentProfile.byGender} />
          </ChartBlock>
          <ChartBlock title="By Program" filename="tracer-program.xlsx" csvRows={distCsv(data.respondentProfile.byProgram)} chartType="bars" chartRows={data.respondentProfile.byProgram}>
            <DistributionBars rows={data.respondentProfile.byProgram} />
          </ChartBlock>
        </div>
      ),
    },
    {
      key: "exam", title: "Professional Examination",
      subtitle: "Professional-examination participation of tracer respondents.",
      body: (
        <ChartBlock title="Participation" filename="tracer-exam-participation.xlsx" csvRows={distCsv(data.professionalExam.byStatus)} chartType="donut" chartRows={data.professionalExam.byStatus}>
          <MiniDonut rows={data.professionalExam.byStatus} />
        </ChartBlock>
      ),
    },
    {
      key: "employment", title: "Employment Overview",
      subtitle: "Employment participation, classification, job-relevance, and duration.",
      body: (
        <>
          <div className="tracer-chart-row">
            <ChartBlock title="Employment Status" filename="tracer-employment-status.xlsx" csvRows={distCsv(data.employmentOverview.byStatus)} chartType="donut" chartRows={data.employmentOverview.byStatus}>
              <MiniDonut rows={data.employmentOverview.byStatus} />
            </ChartBlock>
            <ChartBlock title="Job-Relatedness" filename="tracer-job-relatedness.xlsx" csvRows={distCsv(data.employmentOverview.byJobRelevance)} chartType="vbars" chartRows={data.employmentOverview.byJobRelevance}>
              <MiniBarChart rows={data.employmentOverview.byJobRelevance} />
            </ChartBlock>
          </div>
          <ChartBlock title="Duration in Current Job" filename="tracer-job-duration.xlsx" csvRows={distCsv(data.employmentOverview.byDuration)} chartType="line" chartRows={data.employmentOverview.byDuration} chartOrder={DURATION_ORDER}>
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
          <ChartBlock title="Top Occupations" filename="tracer-occupations.xlsx" csvRows={distCsv(data.occupationIndustry.topOccupations)} chartType="bars" chartRows={data.occupationIndustry.topOccupations}>
            <DistributionBars rows={data.occupationIndustry.topOccupations} />
          </ChartBlock>
          <ChartBlock title="By Industry" filename="tracer-industry.xlsx" csvRows={distCsv(data.occupationIndustry.byIndustry)} chartType="bars" chartRows={data.occupationIndustry.byIndustry}>
            <TagCloud rows={data.occupationIndustry.byIndustry} />
          </ChartBlock>
        </>
      ),
    },
    {
      key: "unemployment", title: "Unemployment Reasons",
      subtitle: "Multi-response reasons selected by unemployed respondents.",
      body: (
        <ChartBlock title="Unemployment Reasons" filename="tracer-unemployment-reasons.xlsx" csvRows={distCsv(data.unemploymentReasons)} chartType="bars" chartRows={data.unemploymentReasons}>
          <DistributionBars rows={data.unemploymentReasons} />
        </ChartBlock>
      ),
    },
    {
      key: "growth", title: "Personal Growth Assessment",
      subtitle: "Likert-style comparison of personal-growth areas.",
      body: (
        <ChartBlock title="Personal Growth Assessment" filename="tracer-personal-growth.xlsx" csvRows={ratingMatrixCsv(data.personalGrowth)} chartType="rating" chartRows={data.personalGrowth}>
          <RatingMatrix rows={data.personalGrowth} />
        </ChartBlock>
      ),
    },
    {
      key: "education", title: "Further Education",
      subtitle: "Further-education participation and training pursuits.",
      body: (
        <div className="tracer-chart-row">
          <ChartBlock title="Pursued Further Education" filename="tracer-further-education.xlsx" csvRows={distCsv(data.furtherEducation.byFurtherEducation)} chartType="donut" chartRows={data.furtherEducation.byFurtherEducation}>
            <MiniDonut rows={data.furtherEducation.byFurtherEducation} />
          </ChartBlock>
          <ChartBlock title="Pursued Trainings" filename="tracer-trainings.xlsx" csvRows={distCsv(data.furtherEducation.byTrainings)} chartType="vbars" chartRows={data.furtherEducation.byTrainings}>
            <MiniBarChart rows={data.furtherEducation.byTrainings} />
          </ChartBlock>
        </div>
      ),
    },
    {
      key: "promotion", title: "Promotion and Recognition",
      subtitle: "Promotions and significant accomplishments reported.",
      body: (
        <>
          <ChartBlock title="Promoted in Current Job" filename="tracer-promoted.xlsx" csvRows={distCsv(data.promotion.byPromotion)} chartType="donut" chartRows={data.promotion.byPromotion}>
            <MiniDonut rows={data.promotion.byPromotion} />
          </ChartBlock>
          <ChartBlock title="Significant Accomplishments" filename="tracer-accomplishments.xlsx" csvRows={distCsv(data.promotion.byAccomplishments)} chartType="bars" chartRows={data.promotion.byAccomplishments}>
            <TagCloud rows={data.promotion.byAccomplishments} />
          </ChartBlock>
        </>
      ),
    },
    {
      key: "development", title: "Professional Development Activities",
      subtitle: "Participation in professional-development activities and certifications.",
      body: (
        <div className="tracer-chart-row">
          <ChartBlock title="Development Activities" filename="tracer-dev-activities.xlsx" csvRows={distCsv(data.professionalDevelopment.byDevActivities)} chartType="donut" chartRows={data.professionalDevelopment.byDevActivities}>
            <MiniDonut rows={data.professionalDevelopment.byDevActivities} />
          </ChartBlock>
          <ChartBlock title="Professional Certifications" filename="tracer-certifications.xlsx" csvRows={distCsv(data.professionalDevelopment.byCertifications)} chartType="vbars" chartRows={data.professionalDevelopment.byCertifications}>
            <MiniBarChart rows={data.professionalDevelopment.byCertifications} />
          </ChartBlock>
        </div>
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
          >
            {s.body}
          </TracerAccordionRow>
        ))}
      </div>
    </section>
  );
}

// ── Filter panel ───────────────────────────────────────────────────────────

const EMPTY_TRACER_FILTERS = {
  college: "", course: "", track: "",
  graduationYearFrom: "", graduationYearTo: "",
  surveyYear: "", gender: "", employmentStatus: "",
  jobRelatedToDegree: "", furtherEducation: "",
};

const BSIT_TRACKS = ["TSM", "WMA", "NA"];

// Display-only labels; values stay the stored "Yes"/"No".
const EMPLOYMENT_STATUS_LABELS = { Yes: "Employed", No: "Unemployed" };

function yearRange(min, max) {
  if (!min || !max) return [];
  const out = [];
  for (let y = max; y >= min; y--) out.push(y);
  return out;
}

function TracerFilterPanel({ pending, onChange, options, onApply, onReset, hasActive, appliedFilters, tracerAnalytics }) {
  const courseOptions = pending.college ? (COURSES_BY_COLLEGE[pending.college] || []) : [];
  const years = yearRange(options.graduationYearBounds?.min, options.graduationYearBounds?.max);

  function set(field, value) {
    onChange((p) => {
      const next = { ...p, [field]: value };
      if (field === "college") next.course = "";
      if (field === "college" || field === "course") next.track = "";
      return next;
    });
  }

  return (
    <section className="panel tracer-filter-panel">
      <div className="panel-head">
        <span>Filter Tracer Data</span>
        {hasActive && <span className="tracer-filters-badge">Filters Active</span>}
      </div>
      <div className="tracer-filter-grid">
        <label>College
          <select value={pending.college} onChange={(e) => set("college", e.target.value)}>
            <option value="">All Colleges</option>
            {COLLEGE_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label>Course / Program
          <select value={pending.course} onChange={(e) => set("course", e.target.value)} disabled={!pending.college}>
            <option value="">All Courses</option>
            {courseOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        {pending.course === "BSIT" && (
          <label>Track / Specialization
            <select value={pending.track} onChange={(e) => set("track", e.target.value)}>
              <option value="">All Tracks</option>
              {BSIT_TRACKS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        )}
        <label>Batch Year — From
          <select value={pending.graduationYearFrom} onChange={(e) => set("graduationYearFrom", e.target.value)}>
            <option value="">Any</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label>Batch Year — To
          <select value={pending.graduationYearTo} onChange={(e) => set("graduationYearTo", e.target.value)}>
            <option value="">Any</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label>Survey Year
          <select value={pending.surveyYear} onChange={(e) => set("surveyYear", e.target.value)}>
            <option value="">All Years</option>
            {(options.surveyYears || []).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label>Gender
          <select value={pending.gender} onChange={(e) => set("gender", e.target.value)}>
            <option value="">All Genders</option>
            {(options.genders || []).map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
        <label>Employment Status
          <select value={pending.employmentStatus} onChange={(e) => set("employmentStatus", e.target.value)}>
            <option value="">All Statuses</option>
            {(options.employmentStatuses || []).map((v) => <option key={v} value={v}>{EMPLOYMENT_STATUS_LABELS[v] || v}</option>)}
          </select>
        </label>
        <label>Job Related to Degree
          <select value={pending.jobRelatedToDegree} onChange={(e) => set("jobRelatedToDegree", e.target.value)}>
            <option value="">All Responses</option>
            {(options.jobRelatedToDegreeOptions || []).map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label>Further Education
          <select value={pending.furtherEducation} onChange={(e) => set("furtherEducation", e.target.value)}>
            <option value="">All Responses</option>
            {(options.furtherEducationOptions || []).map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
      </div>
      <div className="tracer-filter-actions">
        <div className="tracer-filter-downloads">
          <Dropdown
            menuClassName="filter-menu filter-menu-up"
            options={["Export as CSV", "Export as Excel"]}
            onSelect={(label) => downloadTracerDataExport(label.includes("Excel") ? "excel" : "csv", appliedFilters)}
            trigger={(toggleMenu) => (
              <button type="button" className="tracer-download-btn" onClick={toggleMenu}>
                Download Excel / CSV
              </button>
            )}
          />
          <button
            type="button"
            className="tracer-download-btn tracer-download-btn-gold"
            onClick={() => downloadTracerAnalyticsPdf(tracerAnalytics, appliedFilters)}
            disabled={!tracerAnalytics}
          >
            Download PDF Report
          </button>
        </div>
        <div className="tracer-filter-buttons">
          <button type="button" className="tracer-filter-reset" onClick={onReset}>Reset Filters</button>
          <button type="button" className="tracer-filter-apply" onClick={onApply}>Apply Filters</button>
        </div>
      </div>
    </section>
  );
}

// ── KPI grid ─────────────────────────────────────────────────────────────

// scopeNote tiles only follow the College/Course/Batch filters (see buildTracerFilterMatch).
const KPI_TILES = [
  { key: "employedRespondents",          label: "Total Employed",              icon: "icon-12" }, // briefcase
  { key: "unemployedRespondents",        label: "Total Unemployed",            icon: "icon-7"  }, // exit/log-out arrow
  { key: "totalTracerRespondents",       label: "Total Tracer Respondents",    icon: "icon-13" }, // file-check
  { key: "notYetTracerResponse",         label: "Not-Yet Tracer Response",     icon: "icon-24", scopeNote: true }, // pending dots
  { key: "overallResponseRate",          label: "Overall Response Rate",       icon: "icon-20", suffix: "%", scopeNote: true }, // eye/overview
  { key: "employmentRate",               label: "Employment Rate",             icon: "icon-8",  suffix: "%" }, // stat bars
  { key: "furtherEducationCount",        label: "Further Education",           icon: "icon-15" }, // paper plane
  { key: "professionalDevelopmentCount", label: "Professional Development",    icon: "icon-10" }, // gear
  { key: "awardsCount",                  label: "Awards / Recognition",        icon: "icon-25" }, // thumbs-up
  { key: "avgPersonalGrowthScore",       label: "Avg. Personal Growth Score",  icon: "icon-22", suffix: "/5" }, // smile
];

function formatKpiValue(kpis, tile) {
  const raw = kpis?.[tile.key];
  if (raw === null || raw === undefined) return "—";
  return `${raw}${tile.suffix || ""}`;
}

function TracerKpiGrid({ kpis }) {
  return (
    <section aria-label="Tracer dashboard KPI summary">
      <div className="tracer-kpi-grid">
        {KPI_TILES.map((t) => (
          <article className="stat-card" key={t.key}>
            <div>
              <p className="stat-value">{formatKpiValue(kpis, t)}</p>
              <p className="stat-label">{t.label}</p>
            </div>
            <span><Icon name={t.icon} /></span>
          </article>
        ))}
      </div>
      <p className="tracer-kpi-note">
        * Not-Yet Tracer Response and Overall Response Rate track the College, Course, and Batch Year filters only.
      </p>
    </section>
  );
}

// ── Export (CSV/Excel + PDF) ────────────────────────────────────────────────

function buildFilterQueryString(filters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
  return params.toString();
}

async function downloadTracerDataExport(format, filters) {
  const qs = buildFilterQueryString(filters);
  const res = await fetch(
    `${API}/admin/employment/tracer-analytics/export?format=${format}${qs ? `&${qs}` : ""}`,
    { headers: authHeaders() }
  );
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = format === "excel" ? "tracer-analytics.xlsx" : "tracer-analytics.csv";
  a.click();
  URL.revokeObjectURL(url);
}

const FILTER_LABELS = {
  college: "College", course: "Course", track: "Track / Specialization",
  graduationYearFrom: "Batch Year From", graduationYearTo: "Batch Year To",
  surveyYear: "Survey Year", gender: "Gender",
  employmentStatus: "Employment Status", jobRelatedToDegree: "Job Related to Degree",
  furtherEducation: "Further Education",
};

function hexToRgb(hex) {
  const num = parseInt(hex.replace("#", ""), 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

const PDF_CHART_COLORS = CHART_PALETTE.map(hexToRgb);
const PDF_RATING_COLORS = Object.fromEntries(
  Object.entries(RATING_COLORS).map(([k, v]) => [k, hexToRgb(v)])
);

// PDF drawn with jsPDF primitives; DOM screenshots rendered the donuts blank.
function downloadTracerAnalyticsPdf(data, filters) {
  if (!data) return;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const marginX = 40;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - marginX * 2;
  let y = 0;

  function ensureSpace(need) {
    if (y + need > pageHeight - 36) {
      doc.addPage();
      y = 36;
    }
  }

  function sectionHeader(title, subtitle) {
    const h = subtitle ? 38 : 26;
    ensureSpace(h + 4);
    doc.setFillColor(87, 0, 19);
    doc.roundedRect(marginX, y, contentWidth, h, 4, 4, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(255, 255, 255);
    doc.text(title, marginX + 12, y + (subtitle ? 16 : 17));
    if (subtitle) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(240, 220, 222);
      doc.text(subtitle, marginX + 12, y + 29);
    }
    y += h + 10;
  }

  function chartTitle(text) {
    ensureSpace(16);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(87, 0, 19);
    doc.text(text.toUpperCase(), marginX + 12, y + 8);
    y += 16;
  }

  function emptyNote() {
    ensureSpace(16);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(130, 118, 122);
    doc.text("No responses yet.", marginX + 12, y + 8);
    y += 18;
  }

  function barChart(rows, opts = {}) {
    if (!rows || !rows.length) { emptyNote(); return; }
    const list = opts.order
      ? opts.order.map((label) => rows.find((r) => r.label === label) || { label, count: 0 })
      : rows;
    const total = list.reduce((a, r) => a + r.count, 0);
    const max = Math.max(...list.map((r) => r.count), 1);
    const barH = 12, rowGap = 8;
    const labelW = Math.min(contentWidth * 0.34, 150);
    const barX = marginX + 12 + labelW + 8;
    const barW = contentWidth - 24 - labelW - 8 - 56;

    list.forEach((r, i) => {
      ensureSpace(barH + rowGap);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(60, 50, 53);
      doc.text(doc.splitTextToSize(String(r.label), labelW)[0], marginX + 12, y + barH - 2);

      doc.setFillColor(240, 226, 226);
      doc.roundedRect(barX, y, barW, barH, 2, 2, "F");
      const w = r.count > 0 ? Math.max((r.count / max) * barW, 4) : 0;
      if (w > 0) {
        const [cr, cg, cb] = PDF_CHART_COLORS[i % PDF_CHART_COLORS.length];
        doc.setFillColor(cr, cg, cb);
        doc.roundedRect(barX, y, w, barH, 2, 2, "F");
      }

      const pct = total > 0 ? Math.round((r.count / total) * 100) : 0;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(87, 0, 19);
      doc.text(`${r.count} (${pct}%)`, barX + barW + 6, y + barH - 2);

      y += barH + rowGap;
    });
    y += 4;
  }

  // Stacked horizontal bar per skill (Excellent…Non-Acceptable segments),
  // plus a swatch legend — mirrors the on-screen RatingMatrix component.
  function ratingChart(rows) {
    const hasData = rows?.some((r) => Object.keys(r.ratings).length > 0);
    if (!hasData) { emptyNote(); return; }
    const barH = 13, rowGap = 9;
    const labelW = Math.min(contentWidth * 0.3, 140);
    const barX = marginX + 12 + labelW + 8;
    const barW = contentWidth - 24 - labelW - 8;

    rows.forEach((r) => {
      ensureSpace(barH + rowGap);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(60, 50, 53);
      doc.text(doc.splitTextToSize(r.skill, labelW)[0], marginX + 12, y + barH - 2);

      const total = Object.values(r.ratings).reduce((a, b) => a + b, 0);
      doc.setFillColor(240, 226, 226);
      doc.roundedRect(barX, y, barW, barH, 2, 2, "F");
      let segX = barX;
      RATING_ORDER.forEach((k) => {
        const c = r.ratings[k] || 0;
        if (!c || total === 0) return;
        const segW = (c / total) * barW;
        const [cr, cg, cb] = PDF_RATING_COLORS[k];
        doc.setFillColor(cr, cg, cb);
        doc.rect(segX, y, segW, barH, "F");
        segX += segW;
      });
      y += barH + rowGap;
    });

    y += 4;
    ensureSpace(14);
    let legendX = marginX + 12;
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    RATING_ORDER.forEach((k) => {
      const [cr, cg, cb] = PDF_RATING_COLORS[k];
      doc.setFillColor(cr, cg, cb);
      doc.rect(legendX, y, 7, 7, "F");
      doc.setTextColor(60, 50, 53);
      doc.text(k, legendX + 10, y + 6.5);
      legendX += 10 + doc.getTextWidth(k) + 14;
    });
    y += 16;
  }

  function chartBlock(title, rows, opts) {
    chartTitle(title);
    barChart(rows, opts);
  }

  // ── Cover header (page 1 only) ──────────────────────────────────────────
  const headerH = 78;
  doc.setFillColor(87, 0, 19);
  doc.rect(0, 0, pageWidth, headerH, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(255, 255, 255);
  doc.text("Tracer Study Analytics Report", marginX, 34);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(240, 220, 222);
  doc.text(`Generated ${new Date().toLocaleString()}`, marginX, 52);
  const activeFilters = Object.entries(filters).filter(([, v]) => v);
  const filtersLine = activeFilters.length
    ? `Filters Applied: ${activeFilters.map(([k, v]) => `${FILTER_LABELS[k] || k} = ${k === "employmentStatus" ? (EMPLOYMENT_STATUS_LABELS[v] || v) : v}`).join("  ·  ")}`
    : "Filters Applied: None (all data)";
  doc.text(doc.splitTextToSize(filtersLine, contentWidth), marginX, 66);
  y = headerH + 20;

  // ── KPI Summary ───────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(87, 0, 19);
  doc.text("KPI Summary", marginX, y);
  y += 14;

  const cols = 2;
  const cardGap = 10;
  const cardW = (contentWidth - cardGap * (cols - 1)) / cols;
  const cardH = 42;
  let col = 0;
  KPI_TILES.forEach((t) => {
    if (col === 0) ensureSpace(cardH + cardGap);
    const cx = marginX + col * (cardW + cardGap);
    doc.setFillColor(87, 0, 19);
    doc.roundedRect(cx, y, cardW, cardH, 5, 5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(255, 255, 255);
    doc.text(formatKpiValue(data.kpis, t), cx + 10, y + 20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(240, 220, 222);
    doc.text(doc.splitTextToSize(t.label, cardW - 20), cx + 10, y + 32);
    col++;
    if (col === cols) { col = 0; y += cardH + cardGap; }
  });
  if (col !== 0) y += cardH + cardGap;
  y += 8;

  // ── Chart sections ────────────────────────────────────────────────────
  sectionHeader("1. Respondent Profile", "Gender and course distribution of tracer respondents.");
  chartBlock("By Gender", data.respondentProfile.byGender);
  chartBlock("By Program", data.respondentProfile.byProgram);

  sectionHeader("2. Professional Examination", "Professional-examination participation of tracer respondents.");
  chartBlock("Participation", data.professionalExam.byStatus);

  sectionHeader("3. Employment Overview", "Employment participation, classification, job-relevance, and duration.");
  chartBlock("Employment Status", data.employmentOverview.byStatus);
  chartBlock("Job-Relatedness", data.employmentOverview.byJobRelevance);
  chartBlock("Duration in Current Job", data.employmentOverview.byDuration, { order: DURATION_ORDER });

  sectionHeader("4. Occupation and Industry", "Most common occupations and industries of employed respondents.");
  chartBlock("Top Occupations", data.occupationIndustry.topOccupations);
  chartBlock("By Industry", data.occupationIndustry.byIndustry);

  sectionHeader("5. Unemployment Reasons", "Multi-response reasons selected by unemployed respondents.");
  chartBlock("Unemployment Reasons", data.unemploymentReasons);

  sectionHeader("6. Personal Growth Assessment", "Likert-style comparison of personal-growth areas.");
  ratingChart(data.personalGrowth);

  sectionHeader("7. Further Education", "Further-education participation and training pursuits.");
  chartBlock("Pursued Further Education", data.furtherEducation.byFurtherEducation);
  chartBlock("Pursued Trainings", data.furtherEducation.byTrainings);

  sectionHeader("8. Promotion and Recognition", "Promotions and significant accomplishments reported.");
  chartBlock("Promoted in Current Job", data.promotion.byPromotion);
  chartBlock("Significant Accomplishments", data.promotion.byAccomplishments);

  sectionHeader("9. Professional Development Activities", "Participation in professional-development activities and certifications.");
  chartBlock("Development Activities", data.professionalDevelopment.byDevActivities);
  chartBlock("Professional Certifications", data.professionalDevelopment.byCertifications);

  doc.save(`tracer-analytics-${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ── Page ─────────────────────────────────────────────────────────────────

// Module-level cache, keyed by filters, so returning shows the last charts instantly.
const cachedDonutData = new Map();
const cachedTracerAnalytics = new Map();
let cachedTracerFilterOptions = null;

export default function TracerDashboardView() {
  const { showToast } = useOutletContext();
  const [pendingFilters, setPendingFilters] = useState(EMPTY_TRACER_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(EMPTY_TRACER_FILTERS);
  const [filterOptions, setFilterOptions] = useState(cachedTracerFilterOptions ?? {});
  const [tracerAnalytics, setTracerAnalytics] = useState(() => cachedTracerAnalytics.get(buildFilterQueryString(EMPTY_TRACER_FILTERS)) ?? null);

  const [donutData, setDonutData] = useState(() => cachedDonutData.get(buildFilterQueryString(EMPTY_TRACER_FILTERS)) ?? null);

  useEffect(() => {
    let cancelled = false;
    const qs = buildFilterQueryString(appliedFilters);
    const cached = cachedDonutData.get(qs);
    if (cached) setDonutData(cached);
    async function fetchDonutStats() {
      try {
        const res = await fetch(`${API}/admin/employment/donut-stats${qs ? `?${qs}` : ""}`, { headers: authHeaders() });
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (!cancelled) { cachedDonutData.set(qs, json); setDonutData(json); }
      } catch {}
    }
    fetchDonutStats();
    const interval = setInterval(fetchDonutStats, 30000);
    return () => { cancelled = true; clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(appliedFilters)]);

  useEffect(() => {
    async function fetchFilterOptions() {
      try {
        const res = await fetch(`${API}/admin/employment/tracer-filter-options`, { headers: authHeaders() });
        if (!res.ok) return;
        const json = await res.json();
        cachedTracerFilterOptions = json;
        setFilterOptions(json);
      } catch {}
    }
    fetchFilterOptions();
  }, []);

  useEffect(() => {
    // Drop responses from a superseded filter set.
    let cancelled = false;
    const qs = buildFilterQueryString(appliedFilters);
    const cached = cachedTracerAnalytics.get(qs);
    if (cached) setTracerAnalytics(cached);
    async function fetchTracerAnalytics() {
      try {
        const res = await fetch(`${API}/admin/employment/tracer-analytics${qs ? `?${qs}` : ""}`, { headers: authHeaders() });
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (!cancelled) { cachedTracerAnalytics.set(qs, json); setTracerAnalytics(json); }
      } catch {}
    }
    fetchTracerAnalytics();
    const interval = setInterval(fetchTracerAnalytics, 30000);
    return () => { cancelled = true; clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(appliedFilters)]);

  function applyFilters() {
    const next = { ...pendingFilters };
    if (next.graduationYearFrom && next.graduationYearTo &&
        Number(next.graduationYearFrom) > Number(next.graduationYearTo)) {
      [next.graduationYearFrom, next.graduationYearTo] = [next.graduationYearTo, next.graduationYearFrom];
    }
    setPendingFilters(next);
    setAppliedFilters(next);
  }

  function resetFilters() {
    setPendingFilters(EMPTY_TRACER_FILTERS);
    setAppliedFilters(EMPTY_TRACER_FILTERS);
  }

  const hasActiveFilters = Object.values(appliedFilters).some(Boolean);

  return (
    <section className="content tracer-dashboard-view view active-view">
      <div className="admin-hero" aria-label="Tracer dashboard header">
        <h1 className="admin-hero-title">Tracer Study Analytics Dashboard</h1>
        <p className="admin-hero-subtitle">
          Explore respondent profile, employment outcomes, personal growth, further education, and
          recognition, filtered by batch year, college, course, and survey responses.
        </p>
      </div>

      <TracerFilterPanel
        pending={pendingFilters}
        onChange={setPendingFilters}
        options={filterOptions}
        onApply={applyFilters}
        onReset={resetFilters}
        hasActive={hasActiveFilters}
        appliedFilters={appliedFilters}
        tracerAnalytics={tracerAnalytics}
      />

      <TracerKpiGrid kpis={tracerAnalytics?.kpis} />

      <section className="panel">
        <div className="panel-head">
          <span>Employed vs Unemployed</span>
          <button
            className="chart-export-button"
            type="button"
            onClick={() => {
              if (!donutData) {
                showToast?.("Chart data is still loading.");
                return;
              }
              downloadEmploymentDonutCsv(donutData);
              showToast?.("Employment chart exported.");
            }}
          >
            <Icon name="icon-download" />
            <span>Exports</span>
          </button>
        </div>
        <EmploymentChart data={donutData} />
      </section>

      <TracerStudyAnalytics data={tracerAnalytics} />
    </section>
  );
}
