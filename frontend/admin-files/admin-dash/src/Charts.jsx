import React, { useState, useRef } from "react";
import { careerSets, employmentSets } from "./data.js";

function Tooltip({ tip }) {
  if (!tip) return null;
  return (
    <div
      className="chart-tooltip"
      style={{
        position: "fixed",
        left: tip.x,
        top: tip.y,
        background: tip.color,
        pointerEvents: "none",
        zIndex: 9999,
      }}
    >
      {tip.text}
    </div>
  );
}

const barColors = { bsit: "#941527", bscs: "#dea045", bsis: "#eaaa63" };
const barClasses = ["bsit", "bscs", "bsis"];
const barLabels = ["Highly\nAligned", "Moderately\nAligned", "Slightly\nAligned"];

export function CareerChart({ index }) {
  const data = careerSets[index];
  const [tip, setTip] = useState(null);

  const topIndex = data.values.indexOf(Math.max(...data.values));
  const average = Math.round(
    data.values.reduce((t, v) => t + v, 0) / data.values.length
  );
  const lowIndex = data.values.indexOf(Math.min(...data.values));
  const names = ["BSIT", "BSCS", "BSIS"];

  return (
    <div className="chart-body bar-layout">
      <div className="bars" aria-label="Course and career alignment bar chart">
        <div className="axis">
          {["60%", "50%", "40%", "30%", "20%", "10%", "0%"].map((p) => (
            <span key={p}>{p}</span>
          ))}
        </div>
        {data.values.map((value, i) => {
          const cls = barClasses[i];
          return (
            <div
              className="bar-wrap"
              key={cls}
              onMouseMove={(e) =>
                setTip({
                  x: e.clientX + 15,
                  y: e.clientY + 15,
                  color: barColors[cls],
                  text: `${barLabels[i].replace(/\s+/g, " ").trim()}: ${value}% career alignment`,
                })
              }
              onMouseLeave={() => setTip(null)}
            >
              <div
                className={`bar ${cls}`}
                style={{ height: `${Math.max(value * 2.2, 24)}px` }}
              >
                {value}%
              </div>
              <div className="bar-label">
                {barLabels[i].split("\n").map((l, k) => (
                  <React.Fragment key={k}>
                    {l}
                    {k === 0 && <br />}
                  </React.Fragment>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="legend">
        {["red", "gold", "peach"].map((sw, i) => (
          <div className="legend-row" key={sw}>
            <span className={`swatch ${sw}`} />
            <span>{data.legends[i]}</span>
          </div>
        ))}
        <div className="chart-insights">
          <div><strong>Top Match</strong><span>{names[topIndex]}</span></div>
          <div><strong>Average</strong><span>{average}%</span></div>
          <div><strong>BSIT Tracks</strong><span>TSM, NA, WMA</span></div>
          <div><strong>Focus Area</strong><span>{names[lowIndex]} alignment</span></div>
        </div>
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}

export function EmploymentChart({ index }) {
  const data = employmentSets[index];
  const [tip, setTip] = useState(null);
  const donutRef = useRef(null);

  const employedEnd = data.employed;
  const unemployedEnd = data.employed + data.unemployed;
  const background = `conic-gradient(#941527 0 ${employedEnd}%, #d7d7d7 ${employedEnd}% ${unemployedEnd}%, #e9ad69 ${unemployedEnd}% 100%)`;

  const verified = Math.round(data.count / (data.employed / 100));
  const needsUpdate = Math.round(data.count * (data.unidentified / data.employed));
  const trend = data.employed >= 75 ? "+12% employed" : "+8% employed";

  function handleMove(e) {
    const donut = donutRef.current;
    const rect = donut.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    const distance = Math.sqrt(x * x + y * y);
    const outerRadius = rect.width / 2;
    const innerRadius = outerRadius * 0.46;
    if (distance < innerRadius || distance > outerRadius) {
      setTip(null);
      return;
    }
    const angle = ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360;
    const percent = angle / 3.6;
    const segments = [
      { key: "employed", label: "Employed", color: "#941527" },
      { key: "unemployed", label: "Unemployed", color: "#eaaa63" },
      { key: "unidentified", label: "Unidentified", color: "#8f8f8f" },
    ];
    const seg =
      percent <= data.employed
        ? segments[0]
        : percent <= data.employed + data.unemployed
        ? segments[2]
        : segments[1];
    setTip({ x: e.clientX, y: e.clientY, color: seg.color, text: `${seg.label}: ${data[seg.key]}%` });
  }

  return (
    <div className="chart-body donut-layout">
      <div
        className="donut"
        ref={donutRef}
        aria-label={`${data.count} employed alumni`}
        style={{ background }}
        onMouseMove={handleMove}
        onMouseLeave={() => setTip(null)}
      />
      <div className="legend">
        <div className="legend-row"><span className="swatch red" /><span>Employed - {data.employed}%</span></div>
        <div className="legend-row"><span className="swatch peach" /><span>Unemployed - {data.unemployed}%</span></div>
        <div className="legend-row"><span className="swatch gray" /><span>Unidentified - {data.unidentified}%</span></div>
        <div className="chart-insights">
          <div><strong>Verified</strong><span>{verified} alumni</span></div>
          <div><strong>Needs Update</strong><span>{needsUpdate} records</span></div>
          <div><strong>Trend</strong><span>{trend}</span></div>
        </div>
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}
