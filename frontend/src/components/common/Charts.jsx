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
  // A "share of total" percentage is only meaningful when there's something
  // to compare against — with a single category shown, it's mathematically
  // always 100% regardless of the actual count, which reads as a misleading
  // rate (e.g. "111 (100%)" can look like "100% employed") rather than the
  // trivial fact it actually is. Suppressed for exactly that one-row case;
  // 2+ rows still show a real, informative share.
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

// Line/trend chart — best for a metric tracked ACROSS an ordered sequence
// (batch year, month, etc.), where the shape of change over time is the
// actual point, not a ranked comparison DistributionBars' bars suit. `rows`
// is already in the sequence's natural order (oldest -> newest) by the time
// it gets here — see queryByYear()'s own comment on why. A row's `count`
// may be `null` (no data for that point, e.g. a batch with zero tracer
// responses yet) — rendered as a genuine GAP in the line rather than a
// misleading 0, since "no data" and "confirmed zero" are different facts.
export function TrendLine({ rows, unit = '%', max = 100 }) {
  const [tip, setTip] = useState(null);
  const wrapRef = useRef(null);
  if (!rows || rows.length === 0) {
    return <p className="tracer-empty">No responses yet.</p>;
  }

  // PAD_B (42, was 32) leaves room for the two-line axis label a gap point
  // now gets — the year plus an explicit "no data" sub-label (see the
  // x-axis label loop below) — without the second line clipping against the
  // bottom edge.
  const W = 600, H = 220, PAD_L = 36, PAD_R = 16, PAD_T = 16, PAD_B = 42;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const n = rows.length;
  const xFor = (i) => PAD_L + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yFor = (v) => PAD_T + plotH - (Math.max(0, Math.min(v, max)) / max) * plotH;

  const points = rows.map((r, i) => ({ ...r, x: xFor(i), y: r.count == null ? null : yFor(r.count) }));

  // Break the polyline into separate contiguous segments wherever a null
  // (no-data) point interrupts the sequence, instead of drawing a straight
  // line across the gap as if that value were actually known.
  const segments = [];
  let current = [];
  points.forEach((p) => {
    if (p.y == null) { if (current.length) { segments.push(current); current = []; } }
    else current.push(p);
  });
  if (current.length) segments.push(current);

  // A gap sitting BETWEEN two known points (e.g. 3 batches where only the
  // middle one has zero tracer responses) used to render as nothing at all —
  // both neighbors ended up as their own 1-point "segment" (a polyline needs
  // 2+ points to draw anything), so a short series with one interior gap
  // showed two disconnected dots and looked completely empty/broken rather
  // than like a real chart with one missing point. A dashed bridge across the
  // gap shows the overall shape without a dead-looking hole in the line.
  //
  // Deliberately NOT a circle/dot on that bridge (an earlier version placed
  // one, interpolated to sit visually on the dashed line) — caught live: at
  // chat-message rendering size, a dashed-vs-solid line and a hollow-vs-
  // filled dot are both too subtle a difference to actually notice, so that
  // interpolated marker read as a THIRD REAL DATA POINT sitting right on the
  // trend line, exactly the "why does 2025 have a number when there were no
  // responses" confusion this is meant to prevent. A vertical dashed guide
  // line (drawn further down, spanning the full plot height at the gap's x)
  // plus an explicit "no data" sub-label under that point's year (see the
  // x-axis label loop below) are both unambiguous regardless of render size —
  // neither can be mistaken for a plotted value. Only bridges INTERIOR gaps
  // (a known point on BOTH sides) — a gap at the very start or end of the
  // series has no second known point to interpolate a bridge position from
  // and is left as genuinely empty, same as before.
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
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const scale = rect.width / W;
    setTip({ x: x * scale, y: y * scale - 14, text });
  }

  function handleMove(e, p) {
    if (p.y == null) return;
    showTip(p.x, p.y, `${p.label}: ${p.count}${unit}`);
  }

  return (
    <div className="tracer-trend-line" ref={wrapRef} style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="auto" role="img" aria-label="Trend over time">
        {gridLines.map((g) => (
          <g key={g.y}>
            <line x1={PAD_L} y1={g.y} x2={W - PAD_R} y2={g.y} className="trend-gridline" />
            <text x={PAD_L - 8} y={g.y} className="trend-axis-label" textAnchor="end" dominantBaseline="middle">{g.label}</text>
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
        {points.map((p) => p.y == null ? null : (
          <circle
            key={p.label}
            cx={p.x}
            cy={p.y}
            r={4}
            className="trend-line-point"
            onMouseMove={(e) => handleMove(e, p)}
            onMouseLeave={() => setTip(null)}
          />
        ))}
        {bridges.flatMap((b) => b.gaps.map((g) => (
          // Full-height dashed vertical guide at the gap's x — unlike a dot
          // ON the line, this can't be mistaken for a plotted value; it
          // reads unambiguously as "something is marked at this position,"
          // and the "no data" sub-label below (in the axis-label loop)
          // explains what.
          <line
            key={`gap-guide-${g.label}`}
            x1={g.x} y1={PAD_T} x2={g.x} y2={PAD_T + plotH}
            className="trend-gap-guide"
          />
        )))}
        {points.map((p, i) => {
          // Thinning long label sequences — a batch-year axis with 15+ points
          // renders every label overlapping and unreadable at this width, so
          // only every Nth label is drawn once there are more than ~10 points.
          const stride = n > 10 ? Math.ceil(n / 8) : 1;
          if (i % stride !== 0 && i !== n - 1) return null;
          const labelY = H - PAD_B + 14;
          return (
            <g key={p.label}>
              <text x={p.x} y={labelY} className="trend-axis-label" textAnchor="middle">
                {String(p.label).replace(/^Batch\s+/i, '')}
              </text>
              {/* Explicit, always-visible (no hover needed) call-out for a
                  gap point — a static screenshot or a touch-screen viewer
                  never sees a hover tooltip, so the missing-data fact has to
                  be readable in the chart itself, not just on mouseover. */}
              {p.y == null && (
                <text x={p.x} y={labelY + 12} className="trend-axis-label trend-gap-label" textAnchor="middle">
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
