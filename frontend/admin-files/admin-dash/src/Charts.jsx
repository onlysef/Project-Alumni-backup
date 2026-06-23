import React, { useState, useRef } from "react";

const COURSE_COLORS   = { BSIT: "#941527", BSCS: "#dea045", BSIS: "#eaaa63" };
const COURSE_SWATCHES = { BSIT: "red",     BSCS: "gold",    BSIS: "peach"   };
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
      <div className="bars" aria-label="Course vs job bar chart">
        <div className="axis">
          {AXIS_LABELS.map((p) => <span key={p}>{p}</span>)}
        </div>
        {items.map((d, i) => (
          <div
            className="bar-wrap"
            key={getLabel(d)}
            onMouseMove={(e) => handleMouseMove(e, d)}
            onMouseLeave={() => setTip(null)}
          >
            <div
              className={`bar ${["bsit", "bscs", "bsis"][i] ?? "bsit"}`}
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
          <div><strong>Average</strong><span>{avg}%</span></div>
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
    { label: "Unidentified",  pct: ip, count: data.unidentified, color: "#8f8f8f", end: 100 },
  ];

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
    <div className="chart-body donut-layout" ref={containerRef} style={{ position: "relative" }}>
      <div
        className="donut"
        ref={donutRef}
        aria-label={`Employment distribution — ${data.total} alumni`}
        style={{ background }}
        onMouseMove={handleMove}
        onMouseLeave={() => setTip(null)}
      />
      <div className="legend">
        <div className="legend-row"><span className="swatch red"   style={{ background: "#941527" }} /><span>Employed — {ep}%</span></div>
        <div className="legend-row"><span className="swatch peach" style={{ background: "#e9ad69" }} /><span>Unemployed — {up}%</span></div>
        <div className="legend-row"><span className="swatch gray"  style={{ background: "#d7d7d7" }} /><span>Unidentified — {ip}%</span></div>
        <div className="chart-insights">
          <div><strong>Employed</strong><span>{data.employed} alumni</span></div>
          <div><strong>Unemployed</strong><span>{data.unemployed} alumni</span></div>
          <div><strong>No Data</strong><span>{data.unidentified} records</span></div>
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
