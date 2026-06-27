import React from "react";

export const initialEvents = [
  {
    id: 1,
    title: "CCS Alumni Career Talk and Networking 2026",
    date: "May 15, 2026",
    time: "9:00 AM - 3:00 PM",
    location: "CCS Building, Room 301",
    status: "On Going",
    description:
      "This event brings together graduates of the College of Computer Studies to share experiences, industry insights, and professional advice with current students and fellow alumni.",
    interested: 135,
  },
  {
    id: 2,
    title: "CCS Tech-Skills Workshop: Web Development",
    date: "May 22, 2026",
    time: "1:00 PM - 5:00 PM",
    location: "Smart Classroom 1",
    status: "Coming Soon",
    description: "Hands-on upskilling session for alumni and graduating students.",
    interested: 78,
  },
  {
    id: 3,
    title: "Alumni Meetup and Industry Forum",
    date: "May 29, 2026",
    time: "10:00 AM - 2:00 PM",
    location: "University Gymnasium",
    status: "Coming Soon",
    description: "Industry discussion and networking forum for CCS alumni.",
    interested: 94,
  },
];

export const initialRecords = [
  { id: 1, name: "Juan D.L.C.", course: "BSIT", timeIn: "1:00 PM", feedback: true },
  { id: 2, name: "Danica Macapagal", course: "BSCS", timeIn: "1:08 PM", feedback: true },
  { id: 3, name: "Maria Santos", course: "BSIS", timeIn: "1:18 PM", feedback: false },
];

export const initialContacts = [
  { id: 1, name: "Maria Santos", title: "Data Scientist", year: "2023", course: "BSIS", email: "m.santos@gmail.com", phone: "0923746653" },
  { id: 2, name: "Katie Salazar", title: "Web Developer", year: "2023", course: "BSIT", email: "k.salazar@gmail.com", phone: "0965376549" },
  { id: 3, name: "Whitney Flores", title: "Junior Developer", year: "2022", course: "BSIT", email: "w.flores@gmail.com", phone: "0965398585" },
  { id: 4, name: "John Ocampo", title: "Tech Support", year: "2023", course: "BSIT", email: "j.ocampo@gmail.com", phone: "0970946653" },
];

export const blankContact = { name: "", title: "", year: "", course: "", email: "", phone: "" };

export function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function wrapChartLabel(label = "") {
  const words = String(label).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length > 14 && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  });
  if (current) lines.push(current);

  if (lines.length <= 2) return lines;
  return [lines[0], `${lines[1].slice(0, 12).trim()}...`];
}

export function MiniBarChart({ title, values, labels }) {
  const max = Math.max(...values, 1);
  const count = Math.max(values.length, 1);
  const plotLeft = 50;
  const plotRight = 390;
  const plotWidth = plotRight - plotLeft;
  const slot = plotWidth / count;
  const barWidth = Math.min(38, Math.max(24, slot * 0.48));

  return (
    <div className="coord-chart-box" role="img" aria-label={title}>
      <p>{title}</p>
      <svg viewBox="0 0 420 245" className="coord-chart">
        <line x1="50" y1="18" x2="50" y2="176" />
        <line x1="50" y1="176" x2="390" y2="176" />
        {[0, 1, 2, 3].map((n) => {
          const y = 176 - n * 42;
          return <line key={n} className="coord-chart-grid" x1="50" y1={y} x2="390" y2={y} />;
        })}
        {values.map((value, index) => {
          const h = Math.round((value / max) * 140);
          const x = plotLeft + slot * index + (slot - barWidth) / 2;
          const labelLines = wrapChartLabel(labels[index]);
          return (
            <g key={labels[index]}>
              <title>{labels[index]}</title>
              <rect x={x} y={176 - h} width={barWidth} height={h} rx="2" />
              <text x={x + barWidth / 2} y={176 - h - 5} textAnchor="middle" fontWeight="700">{value}</text>
              <text x={x + barWidth / 2} y="202" textAnchor="middle" className="coord-chart-label">
                {labelLines.map((line, lineIndex) => (
                  <tspan key={line} x={x + barWidth / 2} dy={lineIndex === 0 ? 0 : 13}>{line}</tspan>
                ))}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
