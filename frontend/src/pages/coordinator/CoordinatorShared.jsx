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

// Rasterizes one of this file's own <MiniBarChart> <svg> elements to a PNG
// data URL (for embedding into the .xlsx below, not a standalone download —
// see downloadChartExcel). A cloned SVG serialized on its own has no access
// to coordinator-dashboard.css (the blob it's drawn from is a standalone
// document), so its bar/gridline/label colors are inlined here as a <style>
// block rather than relying on the clone inheriting rules from the live page.
function renderSvgToPng(svgEl, { scale = 2, bgColor = "#ffffff" } = {}) {
  return new Promise((resolve, reject) => {
    if (!svgEl) { reject(new Error("No chart to export.")); return; }
    const clone = svgEl.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = `
      line { stroke: #777; stroke-width: 1; }
      .coord-chart-grid { stroke: #e6e0e0; }
      rect { fill: #a00000; }
      text { fill: #35262a; font-size: 11px; font-family: Arial, Helvetica, sans-serif; }
      .coord-chart-label { font-size: 9.5px; font-weight: 700; }
    `;
    clone.insertBefore(style, clone.firstChild);

    const viewBox = svgEl.viewBox?.baseVal;
    const width  = viewBox?.width  || svgEl.clientWidth  || 420;
    const height = viewBox?.height || svgEl.clientHeight || 245;

    const svgUrl = URL.createObjectURL(new Blob(
      [new XMLSerializer().serializeToString(clone)],
      { type: "image/svg+xml;charset=utf-8" }
    ));

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width  = width  * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(svgUrl);
      resolve({ dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height });
    };
    img.onerror = () => { URL.revokeObjectURL(svgUrl); reject(new Error("Could not render chart image.")); };
    img.src = svgUrl;
  });
}

// Builds a real .xlsx (data table + an embedded picture of the chart) so the
// exported file can be opened straight in Excel with the graph already
// inside it, not just a separate PNG next to a CSV of numbers. Mirrors the
// admin Tracer Dashboard's own downloadChartExcel. `exceljs` is dynamically
// imported (~900KB) so it's only fetched when Export is actually clicked.
export async function downloadChartExcel(filename, title, csvRows, svgEl) {
  const img = await renderSvgToPng(svgEl);
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

  const imageId = workbook.addImage({ base64: img.dataUrl.split(",")[1], extension: "png" });
  sheet.addImage(imageId, {
    tl: { col: colCount + 1, row: 0 },
    ext: { width: img.width / 2, height: img.height / 2 },
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// maxCharsPerLine used to be a flat 14 regardless of how much room a bar's
// slot actually had — fine for a handful of bars, but with many events the
// slot shrinks well below what 14 characters needs, so neighboring labels
// overlapped into each other. Now driven by the caller's actual slot width.
function wrapChartLabel(label = "", maxCharsPerLine = 14) {
  const words = String(label).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  });
  if (current) lines.push(current);

  if (lines.length <= 2) return lines;
  return [lines[0], `${lines[1].slice(0, Math.max(4, maxCharsPerLine - 2)).trim()}...`];
}

export function MiniBarChart({ title, values, labels }) {
  const max = Math.max(...values, 1);
  const count = Math.max(values.length, 1);
  const plotLeft = 50;
  // Each bar gets a guaranteed minimum slot instead of splitting one fixed
  // 340-unit plot width evenly across however many events there are —
  // with more than ~5 events that even split left each slot (and its
  // wrapped label) too narrow, so adjacent event names ran into each
  // other. The chart now grows wider (via the viewBox + matching inline
  // width below) instead of squeezing everything into the same footprint;
  // the wrapping .coord-chart-box-wrap scrolls horizontally if it doesn't
  // fit the card.
  const slot = Math.max(72, 340 / count);
  const plotWidth = slot * count;
  const plotRight = plotLeft + plotWidth;
  const viewBoxWidth = plotRight + 30;
  const barWidth = Math.min(42, Math.max(26, slot * 0.42));
  // Character budget scales with the slot each bar actually got, instead
  // of a constant that only fit the original few-bar case.
  const maxCharsPerLine = Math.max(8, Math.floor(slot / 6.5));

  return (
    <div className="coord-chart-box-wrap">
      <div className="coord-chart-box" role="img" aria-label={title}>
        <p>{title}</p>
        <svg viewBox={`0 0 ${viewBoxWidth} 260`} className="coord-chart" style={{ width: Math.max(420, viewBoxWidth) }}>
          <line x1={plotLeft} y1="18" x2={plotLeft} y2="176" />
          <line x1={plotLeft} y1="176" x2={plotRight} y2="176" />
          {[0, 1, 2, 3].map((n) => {
            const y = 176 - n * 42;
            return <line key={n} className="coord-chart-grid" x1={plotLeft} y1={y} x2={plotRight} y2={y} />;
          })}
          {values.map((value, index) => {
            const h = Math.round((value / max) * 140);
            const x = plotLeft + slot * index + (slot - barWidth) / 2;
            const labelLines = wrapChartLabel(labels[index], maxCharsPerLine);
            return (
              <g key={labels[index]}>
                <title>{labels[index]}</title>
                <rect x={x} y={176 - h} width={barWidth} height={h} rx="2" />
                <text x={x + barWidth / 2} y={176 - h - 5} textAnchor="middle" fontWeight="700">{value}</text>
                <text x={x + barWidth / 2} y="202" textAnchor="middle" className="coord-chart-label">
                  {labelLines.map((line, lineIndex) => (
                    <tspan key={line} x={x + barWidth / 2} dy={lineIndex === 0 ? 0 : 14}>{line}</tspan>
                  ))}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
