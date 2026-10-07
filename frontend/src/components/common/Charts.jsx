import React, { useState, useRef } from "react";

// BSIM temporarily included alongside the original 3 courses.
const COURSE_COLORS   = { BSIT: "#941527", BSCS: "#dea045", BSIS: "#eaaa63", BSIM: "#6b4226" };
const COURSE_SWATCHES = { BSIT: "red",     BSCS: "gold",    BSIS: "peach",   BSIM: "gray"     };
const TRACK_COLORS    = { TSM: "#6b1020",  WMA: "#941527",  NA: "#bf2a40"   };
const TRACK_SWATCHES  = { TSM: "red",      WMA: "gold",     NA: "peach"     };
const AXIS_LABELS = ["100%", "80%", "60%", "40%", "20%", "0%"];

export function CourseJobChart({ data, metric }) {
  const [tip, setTip] = useState(null);
  const chartRef = useRef(null);

  const isEmpty = !data || (!data.byCourse?.length && !data.bsitByTrack?.length);
  if (isEmpty) {
    return (
      <div className="chart-body bar-layout" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted, #76656a)", fontSize: 13 }}>
        Loading data…
      </div>
    );
  }

  const isTrackView   = metric === "bsitTracks";
  const activeMetric  = isTrackView ? "employmentRate" : metric;
  const metricLabel   = activeMetric === "employmentRate" ? "employment rate" : "job-related rate";
  const items         = isTrackView ? (data.bsitByTrack || []) : (data.byCourse || []);
  const getColor      = (d) => isTrackView ? TRACK_COLORS[d.track]  : COURSE_COLORS[d.course];
  const getSwatch     = (d) => isTrackView ? TRACK_SWATCHES[d.track] : COURSE_SWATCHES[d.course];
  const getLabel      = (d) => isTrackView ? d.track : d.course;

  const values        = items.map((d) => d[activeMetric]);
  const maxVal        = Math.max(...values);
  const topLabel      = items.filter((d) => d[activeMetric] === maxVal).map(getLabel).join(", ");
  const avg           = values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
  const totalAlumni   = isTrackView
    ? items.reduce((a, d) => a + d.total, 0)
    : (data.totalAlumni ?? items.reduce((a, d) => a + d.total, 0));
  const totalRelated  = items.reduce((a, d) => a + d.jobRelated, 0);
  const jobRelatedRate = totalAlumni > 0 ? Math.round((totalRelated / totalAlumni) * 100) : 0;

  function handleMouseMove(e, d) {
    const rect = chartRef.current?.getBoundingClientRect();
    if (!rect) return;
    const count = activeMetric === "employmentRate" ? d.employed : d.jobRelated;
    setTip({
      x: e.clientX - rect.left + 12,
      y: e.clientY - rect.top - 44,
      color: getColor(d),
      text: `${getLabel(d)}: ${d[activeMetric]}% ${metricLabel} (${count} of ${d.total} alumni)`,
    });
  }

  return (
    <div className="chart-body bar-layout" ref={chartRef} style={{ position: "relative" }}>
      <div
        className="bars"
        aria-label="Course vs job bar chart"
        style={{ gridTemplateColumns: `38px repeat(${items.length}, 1fr)` }}
      >
        <div className="axis">
          {AXIS_LABELS.map((p) => <span key={p}>{p}</span>)}
        </div>
        {items.map((d) => (
          <div
            className="bar-wrap"
            key={getLabel(d)}
            onMouseMove={(e) => handleMouseMove(e, d)}
            onMouseLeave={() => setTip(null)}
          >
            <div
              className={`bar ${getLabel(d).toLowerCase()}`}
              style={{ height: `${Math.max(d[activeMetric] * 1.4, 24)}px`, background: getColor(d) }}
            >
              {d[activeMetric]}%
            </div>
            <div className="bar-label">{getLabel(d)}</div>
          </div>
        ))}
      </div>
      <div className="legend">
        {items.map((d) => (
          <div className="legend-row" key={getLabel(d)}>
            <span className={`swatch ${getSwatch(d)}`} style={{ background: getColor(d) }} />
            <span>{getLabel(d)} — {d[activeMetric]}%</span>
          </div>
        ))}
        <div className="chart-insights">
          <div><strong>{isTrackView ? "Top Track" : "Top Course"}</strong><span>{topLabel || "—"}</span></div>
          <div>
            <strong>{activeMetric === "employmentRate" ? "Average Employment Rate" : "Average Job-Related Rate"}</strong>
            <span>{avg}%</span>
          </div>
          <div><strong>Job-Related</strong><span>{jobRelatedRate}%</span></div>
          <div><strong>{isTrackView ? "BSIT Alumni" : "Total Alumni"}</strong><span>{totalAlumni}</span></div>
        </div>
      </div>
      {tip && (
        <div
          className="chart-tooltip"
          style={{
            position: "absolute",
            left: tip.x,
            top: tip.y,
            background: tip.color,
            pointerEvents: "none",
            zIndex: 9999,
          }}
        >
          {tip.text}
        </div>
      )}
    </div>
  );
}

export function EmploymentChart({ data }) {
  const [tip, setTip] = useState(null);
  const donutRef = useRef(null);
  const containerRef = useRef(null);

  if (!data) {
    return (
      <div className="chart-body donut-layout" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted, #76656a)", fontSize: 13 }}>
        Loading data…
      </div>
    );
  }

  const ep = data.employedPct     ?? 0;
  const up = data.unemployedPct   ?? 0;
  const ip = data.unidentifiedPct ?? 0;
  const background = `conic-gradient(#941527 0 ${ep}%, #e9ad69 ${ep}% ${ep + up}%, #d7d7d7 ${ep + up}% 100%)`;

  const segments = [
    { label: "Employed",      pct: ep, count: data.employed,     color: "#941527", end: ep },
    { label: "Unemployed",    pct: up, count: data.unemployed,   color: "#e9ad69", end: ep + up },
    { label: "Not Yet Updated", pct: ip, count: data.unidentified, color: "#8f8f8f", end: 100 },
  ];
  const chartKey = `${data.employed}-${data.unemployed}-${data.unidentified}-${data.total}`;

  function handleMove(e) {
    const donut = donutRef.current;
    const container = containerRef.current;
    if (!donut || !container) return;
    const rect = donut.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    const distance = Math.sqrt(x * x + y * y);
    const outerRadius = rect.width / 2;
    const innerRadius = outerRadius * 0.46;
    if (distance < innerRadius || distance > outerRadius) { setTip(null); return; }
    const angle = ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360;
    const percent = angle / 3.6;
    const seg = segments.find((s) => percent <= s.end) ?? segments[2];
    const cRect = container.getBoundingClientRect();
    setTip({
      x: e.clientX - cRect.left + 12,
      y: e.clientY - cRect.top  - 44,
      color: seg.color,
      text: `${seg.label}: ${seg.pct}% (${seg.count} of ${data.total} alumni)`,
    });
  }

  return (
    <div key={chartKey} className="chart-body donut-layout donut-data-transition" ref={containerRef} style={{ position: "relative" }}>
      <div className="donut-shell">
        <div
          className="donut"
          ref={donutRef}
          role="img"
          aria-label={`Employment distribution — ${data.total} alumni`}
          style={{ background }}
          onMouseMove={handleMove}
          onMouseLeave={() => setTip(null)}
        />
        <div className="donut-center" aria-hidden="true">
          <strong>{data.total}</strong>
          <span>Total Alumni</span>
        </div>
      </div>
      <div className="legend">
        <div className="legend-row"><span className="swatch red"   style={{ background: "#941527" }} /><span>Employed</span><b>{data.employed} · {ep}%</b></div>
        <div className="legend-row"><span className="swatch peach" style={{ background: "#e9ad69" }} /><span>Unemployed</span><b>{data.unemployed} · {up}%</b></div>
        <div className="legend-row"><span className="swatch gray"  style={{ background: "#d7d7d7" }} /><span>Unidentified</span><b>{data.unidentified} · {ip}%</b></div>
        <div className="chart-insights">
          {segments.filter((s) => s.count > 0).map((s) => (
            <div key={s.label}><strong>{s.label}</strong><span>{s.count} {s.label === "Not Yet Updated" ? "records" : "alumni"}</span></div>
          ))}
          <div><strong>Total</strong><span>{data.total} alumni</span></div>
        </div>
      </div>
      {tip && (
        <div
          className="chart-tooltip"
          style={{ position: "absolute", left: tip.x, top: tip.y, background: tip.color, pointerEvents: "none", zIndex: 9999 }}
        >
          {tip.text}
        </div>
      )}
    </div>
  );
}

// ── Shared small chart primitives (dashboard tracer analytics + AC chatbot) ───

// Same palette as the Course vs Job chart above — red, gold, peach, brown —
// extended with harmonious shades for categories beyond 4.
export const CHART_PALETTE = ["#941527", "#dea045", "#eaaa63", "#6b4226", "#570013", "#c23b52", "#e9ad69", "#8f8f8f"];
// Donuts need stronger hue separation than the brand-toned bar palette,
// especially for adjacent or very small segments on dark backgrounds.
const MINI_DONUT_PALETTE = [
  "#b51f3d", // crimson
  "#f0b43c", // gold
  "#9b6cff", // purple
  "#21b6a8", // teal
  "#4f8df7", // blue
  "#f47b35", // orange
  "#d7d7d7", // neutral
  "#e85d9e", // pink
];

// Small donut — best for binary/few-category distributions (Yes/No, gender, status).
export function MiniDonut({ rows }) {
  if (!rows || rows.length === 0) return <p className="tracer-empty">No responses yet.</p>;
  const total = rows.reduce((a, r) => a + r.count, 0);
  let acc = 0;
  const segments = rows.map((r, i) => {
    const pct   = total > 0 ? (r.count / total) * 100 : 0;
    const start = acc;
    acc += pct;
    // Keep LGBTQIA+ visually distinct from the adjacent gold/orange gender
    // category instead of assigning two nearly identical warm colors.
    const color = /lgbtq/i.test(String(r.label))
      ? "#9b6cff"
      : MINI_DONUT_PALETTE[i % MINI_DONUT_PALETTE.length];
    return { ...r, pct: Math.round(pct), start, end: acc, color };
  });
  const gradient = segments.map((s) => `${s.color} ${s.start}% ${s.end}%`).join(", ");
  return (
    <div className="tracer-donut-layout">
      <div className="tracer-donut" style={{ background: `conic-gradient(${gradient})` }}>
        <span className="tracer-donut-total">{total}</span>
      </div>
      <div className="tracer-donut-legend">
        {segments.map((s) => (
          <div className="tracer-donut-legend-row" key={s.label}>
            <span className="tracer-donut-swatch" style={{ background: s.color }} />
            <span className="tracer-donut-legend-label" title={s.label}>{s.label}</span>
            <span className="tracer-donut-legend-value">{s.count} <em>({s.pct}%)</em></span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Horizontal ranked bar list — best for many categories, ranked by count.
export function DistributionBars({ rows, limit }) {
  if (!rows || rows.length === 0) {
    return <p className="tracer-empty">No responses yet.</p>;
  }
  const shown = limit ? rows.slice(0, limit) : rows;
  const total = rows.reduce((a, r) => a + r.count, 0);
  const max   = Math.max(...shown.map((r) => r.count), 1);
  // Hide share-of-total for a single row; it's always 100%.
  const showPct = shown.length > 1;
  return (
    <div className="tracer-bars">
      {shown.map((r) => {
        const pct = total > 0 ? Math.round((r.count / total) * 100) : 0;
        return (
          <div className="tracer-bar-row" key={r.label}>
            <div className="tracer-bar-label">{r.label}</div>
            <div className="tracer-bar-meter">
              <div className="tracer-bar-track">
                <div className="tracer-bar-fill" style={{ width: `${Math.max((r.count / max) * 100, 4)}%` }} />
              </div>
              <span className="tracer-bar-count">{r.count}{showPct && <em> ({pct}%)</em>}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Horizontal bar chart — one solid-colored, rounded bar per row, label to
// the left, value at the bar's end. Used for chat chart.type === "bars"
// (AiAssistantView.jsx) — replaced the earlier vertical-column version with
// this horizontal, per-category-colored look to match the requested
// reference style (rounded horizontal bars of varying length/color, not a
// vertical column chart).
// Below this many rows, every bar is shown at once (no internal scroll) —
// the whole point of a chart is seeing it all at a glance. Past it, the
// list would grow taller than is reasonable inside a chat bubble, so it
// switches to a capped, scrollable height instead (see handleCopy in
// AiAssistantView.jsx, which already lifts this cap before rasterizing a
// copy so the exported image is never cropped by it either way).
const HBAR_SCROLL_THRESHOLD = 15;

export function MiniBarChart({ rows }) {
  if (!rows || rows.length === 0) return <p className="tracer-empty">No responses yet.</p>;
  const max = Math.max(...rows.map((r) => r.count), 1);
  const scrollable = rows.length > HBAR_SCROLL_THRESHOLD;
  return (
    <div className={`tracer-hbar-chart${scrollable ? ' tracer-hbar-chart--scroll' : ''}`}>
      {rows.map((r, i) => {
        // A fixed pixel/percent floor applied to EVERY bar (even a genuine
        // 0) made visibly different counts (e.g. 0 vs 6 vs 8) render at
        // nearly the same length — caught live: a 0-count row and an
        // 8-count row looked "pantay" (equal) because both got clamped up
        // to the same minimum. A true 0 gets its own near-zero sliver
        // (clearly shorter than any real count); every other bar scales
        // proportionally to `max` with only a small floor so a tiny-but-
        // real count (1-2) still remains visible as a bar at all. The value
        // number is rendered OUTSIDE the bar's end (not clamped inside it)
        // so a short bar never needs extra width just to fit its own label.
        const widthPct = r.count === 0 ? 1.5 : Math.max((r.count / max) * 100, 3);
        return (
          <div className="tracer-hbar-row" key={r.label}>
            <div className="tracer-hbar-label" title={r.label}>{r.label}</div>
            <div className="tracer-hbar-track">
              <div
                className="tracer-hbar-fill"
                style={{ width: `${widthPct}%`, background: CHART_PALETTE[i % CHART_PALETTE.length] }}
                title={`${r.label}: ${r.count}`}
              />
              <span className="tracer-hbar-value">{r.count}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Grouped (clustered) vertical bar chart — one column per category, with
// one bar per series side by side inside it. Built for a genuine
// multi-series comparison (e.g. chart.type === "grouped-bars" from
// computeSkillCompare in verifiedCount.js: two skills, each rated across
// the same 5 levels) — flattening N series x M categories into one long
// single-series bar list (the earlier shape this replaced) forces the
// reader to mentally regroup rows back into series themselves; this
// renders them already grouped, which is what a side-by-side comparison
// question actually asks to see.
// `series`: [{ name, color? }] — color defaults to CHART_PALETTE[index] if
// omitted, same convention MiniBarChart/DistributionBars already use.
// `rows`: [{ category, values: [n, n, ...] }] — one value per series, in
// the same order as `series`.
export function GroupedBarChart({ series, rows, unit = '' }) {
  if (!rows || rows.length === 0 || !series || series.length === 0) {
    return <p className="tracer-empty">No responses yet.</p>;
  }
  // A single series (this chart reused as a plain standing bar graph for a
  // top-N ranking — see verifiedCount.js's computeVerifiedRanking) colors
  // each bar by its own CATEGORY instead of by series: with only one
  // series, series-based coloring made every bar identical (every program
  // in a ranking rendered maroon-on-maroon) — caught live, "parang isang
  // kulay lang", the system's own multi-color palette never showed up at
  // all for this shape. A genuine multi-series comparison (2+ series, e.g.
  // computeSkillCompare's two-skill breakdown) keeps series-based coloring
  // — there, color has to stay consistent per-series ACROSS every category
  // so the legend means anything (all "technical skills" bars share one
  // color so they're visually traceable across columns).
  const isSingleSeries = series.length === 1;
  const seriesColors = series.map((s, i) => s.color || CHART_PALETTE[i % CHART_PALETTE.length]);
  const max = Math.max(...rows.flatMap((r) => r.values), 1);
  return (
    <div className="tracer-gbar-chart">
      {/* The legend is redundant (and actively misleading — it would show
          ONE swatch while the bars below use several different colors) once
          bars are colored per-category instead of per-series, so it's
          dropped for the single-series case; each bar's own label underneath
          it already says what it is. */}
      {!isSingleSeries && (
        <div className="tracer-gbar-legend">
          {series.map((s, i) => (
            <span className="tracer-gbar-legend-item" key={s.name}>
              <i style={{ background: seriesColors[i] }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
      <div className="tracer-gbar-cols">
        {rows.map((r, rowIndex) => (
          <div className="tracer-gbar-col" key={r.category}>
            <div className="tracer-gbar-bars">
              {r.values.map((v, i) => {
                const color = isSingleSeries ? CHART_PALETTE[rowIndex % CHART_PALETTE.length] : seriesColors[i];
                return (
                  <div
                    className="tracer-gbar-wrap"
                    key={series[i]?.name || i}
                    title={`${series[i]?.name || ''} — ${r.category}: ${v}${unit}`}
                  >
                    {/* Value sits ABOVE the bar, not inside it — a short bar
                        (a low count like "Beginner"/"Non-Acceptable" next to
                        a much taller max) isn't tall enough to contain its
                        own white label text, which then overflowed onto the
                        plain page background and became invisible there.
                        Outside placement means the label is always legible
                        regardless of how short the bar is. */}
                    <span className="tracer-gbar-value">{v}{unit}</span>
                    <div
                      className="tracer-gbar-bar"
                      style={{ height: `${Math.max((v / max) * 100, v > 0 ? 4 : 0)}%`, background: color }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="tracer-gbar-label" title={r.category}>{r.category}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Trend line. A null count is drawn as a gap (no data), not zero.
export function TrendLine({ rows, unit = '%', max = 100 }) {
  const [tip, setTip] = useState(null);
  const svgRef = useRef(null);
  if (!rows || rows.length === 0) {
    return <p className="tracer-empty">No responses yet.</p>;
  }

  // This chart was originally built for ONE shape of x-axis label — short
  // batch years ("2020".."2026", 4 characters) — plain horizontal labels at
  // a fixed 600px width fit that fine regardless of how many years there
  // were. It's since been reused (via the "make it a line graph" chart-type
  // override — see aggregationService.js's queryInner()) for per-PROGRAM
  // breakdowns too, whose labels ("BSIT - TSM", "BSIS - Business Analytics")
  // are both longer and more numerous — plain labels packed into the same
  // fixed width collided into an unreadable overlapping smear. A first fix
  // tried rotating them, but rotated text at a small readable size is its
  // own kind of hard-to-read (reported live: "masakit sa mata" — hurts the
  // eyes). MiniBarChart (the vertical bar chart right next to this one —
  // see its own usage in AiAssistantView.jsx) already solves the identical
  // "many/long category labels" problem a completely different way: it
  // doesn't cram everything into one fixed width at all — it gives each
  // category a real, comfortable, plain-horizontal-text column and lets the
  // whole chart scroll horizontally instead. Matched here: a wide-label
  // chart renders at its own natural pixel width (not squeezed into a fixed
  // 600px) inside a horizontally-scrollable wrapper, so every label stays
  // plain, horizontal, and the same small size as MiniBarChart's own labels
  // — no rotation needed at all. The original short-label case (actual
  // batch years) is untouched: maxLabelLen stays well under the threshold,
  // so that chart keeps its original fixed 600px, 100%-responsive, no-
  // scroll rendering exactly as it always did.
  const cleanLabels = rows.map((r) => String(r.label).replace(/^Batch\s+/i, ''));
  const maxLabelLen = Math.max(0, ...cleanLabels.map((l) => l.length));
  const needsWideLayout = maxLabelLen > 6 || rows.length > 8;
  // 150px comfortably fits this dataset's longest real label ("BSIS -
  // Business Analytics", ~26 characters) on one plain horizontal line at
  // MiniBarChart's own label size without crowding its neighbors.
  const PER_LABEL_PX = 150;

  const W = needsWideLayout ? Math.max(600, rows.length * PER_LABEL_PX) : 600;
  // PAD_T widened from 16 to keep the always-visible value label (see
  // trend-point-value below) above the chart's own highest possible point
  // (max, 0% headroom left above it) from crowding the card's top edge.
  const H = 220, PAD_L = 36, PAD_R = 16, PAD_T = 26, PAD_B = 42;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const n = rows.length;
  const xFor = (i) => PAD_L + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yFor = (v) => PAD_T + plotH - (Math.max(0, Math.min(v, max)) / max) * plotH;

  const points = rows.map((r, i) => ({ ...r, x: xFor(i), y: r.count == null ? null : yFor(r.count) }));

  const segments = [];
  let current = [];
  points.forEach((p) => {
    if (p.y == null) { if (current.length) { segments.push(current); current = []; } }
    else current.push(p);
  });
  if (current.length) segments.push(current);

  // Interior gaps: dashed bridge + vertical guide + "no data" label (no dot; it read as a real point).
  const bridges = [];
  {
    let i = 0;
    while (i < points.length) {
      if (points[i].y != null) { i++; continue; }
      let j = i;
      while (j < points.length && points[j].y == null) j++;
      const before = points[i - 1];
      const after = points[j];
      if (before && after) bridges.push({ before, after, gaps: points.slice(i, j) });
      i = j;
    }
  }

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ y: PAD_T + plotH * (1 - f), label: Math.round(max * f) }));

  function showTip(x, y, text) {
    // Measures the <svg> itself, not the outer wrapping div — in the wide/
    // scrollable layout (see needsWideLayout above), the div's own
    // bounding rect is clamped to its VISIBLE (scrolled) width, which would
    // badly under-scale the tooltip position; the svg's rendered width is
    // always what actually matters (100%-of-container when responsive, or
    // its own explicit W-pixel width when scrollable — a 1:1 match with the
    // viewBox either way).
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const scale = rect.width / W;
    setTip({ x: x * scale, y: y * scale - 14, text });
  }

  function handleMove(e, p) {
    if (p.y == null) return;
    showTip(p.x, p.y, `${p.label}: ${p.count}${unit}`);
  }

  return (
    <div
      className={`tracer-trend-line${needsWideLayout ? ' tracer-trend-line-scroll' : ''}`}
      style={{ position: 'relative' }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width={needsWideLayout ? W : '100%'}
        height="auto"
        role="img"
        aria-label="Trend over time"
      >
        {gridLines.map((g) => (
          <g key={g.y}>
            <line x1={PAD_L} y1={g.y} x2={W - PAD_R} y2={g.y} className="trend-gridline" />
            <text x={PAD_L - 8} y={g.y} className="trend-axis-label trend-yaxis-value" textAnchor="end" dominantBaseline="middle">{g.label}</text>
          </g>
        ))}
        {bridges.map((b, i) => (
          <polyline
            key={`bridge-${i}`}
            className="trend-line-bridge"
            points={`${b.before.x},${b.before.y} ${b.after.x},${b.after.y}`}
            fill="none"
          />
        ))}
        {segments.map((seg, i) => (
          <polyline
            key={i}
            className="trend-line-path"
            points={seg.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
          />
        ))}
        {points.map((p, i) => p.y == null ? null : (
          <g key={p.label}>
            <circle
              cx={p.x}
              cy={p.y}
              r={4}
              className="trend-line-point"
              onMouseMove={(e) => handleMove(e, p)}
              onMouseLeave={() => setTip(null)}
            />
            {/* MiniBarChart (the bar chart right next to this one) shows
                its value permanently on every bar — this line chart only
                revealed a value on hover, via the tooltip above, which
                reads as "unreadable" for anyone not actively hovering (e.g.
                looking at an exported/copied image of the chart). Mirrors
                that same always-visible, bold number here, placed just
                above each point instead of inside a bar (a line chart has
                no bar body to put it inside). Bare number only (no unit
                suffix) — the chart's own title already states the unit
                ("Employment Rate by Program (%)"), and the shorter text
                leaves more breathing room at the edges. The FIRST/LAST
                point anchor outward (start/end) instead of centered — a
                centered label at the very first point collided with the
                y-axis's own top gridline number sitting just to its left
                (reported live as "111100" running together); the last
                point's centered label would equally run past the chart's
                right edge. */}
            <text
              x={i === 0 ? p.x + 4 : i === n - 1 ? p.x - 4 : p.x}
              y={p.y - 10}
              className="trend-point-value"
              textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
            >
              {p.count}
            </text>
          </g>
        ))}
        {bridges.flatMap((b) => b.gaps.map((g) => (
          <line
            key={`gap-guide-${g.label}`}
            x1={g.x} y1={PAD_T} x2={g.x} y2={PAD_T + plotH}
            className="trend-gap-guide"
          />
        )))}
        {points.map((p, i) => {
          // n > 10 only ever applies to the original batch-year case (this
          // dataset never has more than ~8 programs/specializations) — the
          // wide layout above already gives every program its own 150px
          // column, wide enough for one plain line of text, so no label
          // needs to be skipped there.
          const stride = n > 10 ? Math.ceil(n / 8) : 1;
          if (i % stride !== 0 && i !== n - 1) return null;
          const labelY = H - PAD_B + 14;
          const labelText = String(p.label).replace(/^Batch\s+/i, '');
          return (
            <g key={p.label}>
              <text x={p.x} y={labelY} className="trend-xaxis-label" textAnchor="middle">
                {labelText}
              </text>
              {p.y == null && (
                <text x={p.x} y={labelY + 12} className="trend-xaxis-label trend-gap-label" textAnchor="middle">
                  no data
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {tip && (
        <div className="chart-tooltip trend-tooltip" style={{ position: 'absolute', left: tip.x, top: tip.y, pointerEvents: 'none', zIndex: 9999 }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}
