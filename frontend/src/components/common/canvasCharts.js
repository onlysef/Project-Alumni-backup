// Canvas chart renderers for the Excel exports (DOM screenshots rendered the donuts blank).

import { CHART_PALETTE } from "./Charts.jsx";

function fitText(ctx, text, maxWidth) {
  const str = String(text ?? "");
  if (ctx.measureText(str).width <= maxWidth) return str;
  let lo = 0, hi = str.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(str.slice(0, mid) + "…").width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? str.slice(0, lo) + "…" : "…";
}

function makeCanvas(logicalW, logicalH) {
  const canvas = document.createElement("canvas");
  canvas.width = logicalW * 2;
  canvas.height = logicalH * 2;
  const ctx = canvas.getContext("2d");
  ctx.scale(2, 2);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, logicalW, logicalH);
  ctx.textBaseline = "alphabetic";
  return { canvas, ctx };
}

function toResult(canvas, logicalW, logicalH) {
  return { dataUrl: canvas.toDataURL("image/png"), width: logicalW, height: logicalH };
}

function pctOf(count, total) {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

// ── Donut (mirrors MiniDonut) ────────────────────────────────────────────────
function drawDonut(rows) {
  const total = (rows || []).reduce((a, r) => a + r.count, 0);
  if (!rows || !rows.length || total === 0) return null;

  const W = 420, H = 260;
  const { canvas, ctx } = makeCanvas(W, H);

  const cx = 110, cy = H / 2, outerR = 85, innerR = outerR * 0.46;
  let angle = -Math.PI / 2;
  rows.forEach((r, i) => {
    const slice = (r.count / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, outerR, angle, angle + slice);
    ctx.closePath();
    ctx.fillStyle = CHART_PALETTE[i % CHART_PALETTE.length];
    ctx.fill();
    angle += slice;
  });
  // Punch the hole (same ring ratio EmploymentChart's own donut uses).
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  ctx.fillStyle = "#570013";
  ctx.font = "bold 20px Arial";
  ctx.textAlign = "center";
  ctx.fillText(String(total), cx, cy + 7);

  // Legend to the right of the ring.
  const legendX = 220, rowH = 22;
  ctx.textAlign = "left";
  rows.forEach((r, i) => {
    const y = 40 + i * rowH;
    ctx.fillStyle = CHART_PALETTE[i % CHART_PALETTE.length];
    ctx.fillRect(legendX, y - 10, 12, 12);
    ctx.fillStyle = "#2d2024";
    ctx.font = "12px Arial";
    const label = fitText(ctx, r.label, 130);
    ctx.fillText(label, legendX + 18, y);
    ctx.fillStyle = "#570013";
    ctx.font = "bold 12px Arial";
    ctx.fillText(`${r.count} (${pctOf(r.count, total)}%)`, legendX + 150, y);
  });

  return toResult(canvas, W, H);
}

// ── Ranked horizontal bars (mirrors DistributionBars and TagCloud — a tag
// cloud has no distinct chart shape of its own, it's just a ranked list). ──
function drawHBars(rows) {
  if (!rows || !rows.length) return null;
  const total = rows.reduce((a, r) => a + r.count, 0);
  const max = Math.max(...rows.map((r) => r.count), 1);

  const W = 480;
  const barH = 18, rowGap = 14, topPad = 10;
  const H = topPad + rows.length * (barH + rowGap);
  const { canvas, ctx } = makeCanvas(W, H);

  const labelW = 140, countW = 70;
  const barX = labelW + 8;
  const barW = W - labelW - 8 - countW - 10;

  rows.forEach((r, i) => {
    const y = topPad + i * (barH + rowGap);
    ctx.fillStyle = "#2d2024";
    ctx.font = "12px Arial";
    ctx.textAlign = "left";
    ctx.fillText(fitText(ctx, r.label, labelW - 4), 4, y + barH * 0.72);

    ctx.fillStyle = "#f0e2e2";
    ctx.fillRect(barX, y, barW, barH);

    const w = r.count > 0 ? Math.max((r.count / max) * barW, 3) : 0;
    if (w > 0) {
      ctx.fillStyle = CHART_PALETTE[i % CHART_PALETTE.length];
      ctx.fillRect(barX, y, w, barH);
    }

    ctx.fillStyle = "#570013";
    ctx.font = "bold 11px Arial";
    ctx.fillText(`${r.count} (${pctOf(r.count, total)}%)`, barX + barW + 6, y + barH * 0.72);
  });

  return toResult(canvas, W, H);
}

// ── Vertical bars (mirrors MiniBarChart) ─────────────────────────────────────
function drawVBars(rows) {
  if (!rows || !rows.length) return null;
  const max = Math.max(...rows.map((r) => r.count), 1);

  const W = 480, H = 300;
  const { canvas, ctx } = makeCanvas(W, H);

  const topPad = 30, bottomPad = 40;
  const plotH = H - topPad - bottomPad;
  const colW = W / rows.length;
  const barW = Math.min(colW * 0.5, 70);

  rows.forEach((r, i) => {
    const h = r.count > 0 ? Math.max((r.count / max) * plotH, 4) : 0;
    const x = i * colW + (colW - barW) / 2;
    const y = topPad + (plotH - h);

    ctx.fillStyle = CHART_PALETTE[i % CHART_PALETTE.length];
    ctx.fillRect(x, y, barW, h);

    ctx.fillStyle = "#570013";
    ctx.font = "bold 12px Arial";
    ctx.textAlign = "center";
    ctx.fillText(String(r.count), x + barW / 2, y - 6);

    ctx.fillStyle = "#2d2024";
    ctx.font = "11px Arial";
    ctx.fillText(fitText(ctx, r.label, colW - 6), x + barW / 2, H - bottomPad + 16);
  });

  return toResult(canvas, W, H);
}

// ── Line / area trend (mirrors TrendLine) ───────────────────────────────────
function drawLine(rows, order) {
  if (!rows || !rows.length) return null;
  const byLabel = new Map(rows.map((r) => [r.label, r.count]));
  const labels = order && order.length ? order : rows.map((r) => r.label);
  const ordered = labels.map((label) => ({ label, count: byLabel.get(label) || 0 }));
  const max = Math.max(...ordered.map((o) => o.count), 1);

  const W = 480, H = 260;
  const { canvas, ctx } = makeCanvas(W, H);

  const pad = 28, bottomPad = 40;
  const plotW = W - pad * 2;
  const plotH = H - pad - bottomPad;
  const stepX = ordered.length > 1 ? plotW / (ordered.length - 1) : 0;

  const points = ordered.map((o, i) => ({
    ...o,
    x: pad + i * stepX,
    y: pad + (plotH - (o.count / max) * plotH),
  }));

  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.lineTo(points[points.length - 1].x, pad + plotH);
  ctx.lineTo(points[0].x, pad + plotH);
  ctx.closePath();
  ctx.fillStyle = "rgba(148, 21, 39, 0.12)";
  ctx.fill();

  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.strokeStyle = "#941527";
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.stroke();

  points.forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#941527";
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "#570013";
    ctx.font = "bold 11px Arial";
    ctx.textAlign = "center";
    ctx.fillText(String(p.count), p.x, p.y - 10);

    ctx.fillStyle = "#2d2024";
    ctx.font = "10px Arial";
    ctx.fillText(fitText(ctx, p.label, stepX || plotW), p.x, H - bottomPad + 16);
  });

  return toResult(canvas, W, H);
}

// ── Stacked horizontal bars (mirrors RatingMatrix) ──────────────────────────
function drawStackedBars(rows, ratingOrder, ratingColors) {
  const hasData = rows?.some((r) => Object.keys(r.ratings).length > 0);
  if (!hasData) return null;

  const W = 480;
  const barH = 18, rowGap = 14, topPad = 10, legendH = 30;
  const H = topPad + rows.length * (barH + rowGap) + legendH;
  const { canvas, ctx } = makeCanvas(W, H);

  const labelW = 140;
  const barX = labelW + 8;
  const barW = W - labelW - 8 - 10;

  rows.forEach((r, i) => {
    const y = topPad + i * (barH + rowGap);
    ctx.fillStyle = "#2d2024";
    ctx.font = "12px Arial";
    ctx.textAlign = "left";
    ctx.fillText(fitText(ctx, r.skill, labelW - 4), 4, y + barH * 0.72);

    const total = Object.values(r.ratings).reduce((a, b) => a + b, 0);
    ctx.fillStyle = "#f0e2e2";
    ctx.fillRect(barX, y, barW, barH);

    if (total > 0) {
      let segX = barX;
      ratingOrder.forEach((key) => {
        const c = r.ratings[key] || 0;
        if (!c) return;
        const segW = (c / total) * barW;
        ctx.fillStyle = ratingColors[key];
        ctx.fillRect(segX, y, segW, barH);
        segX += segW;
      });
    } else {
      ctx.fillStyle = "#8f8f8f";
      ctx.font = "italic 10px Arial";
      ctx.fillText("No responses", barX + 6, y + barH * 0.72);
    }
  });

  // Legend row.
  let legendX = 4;
  const legendY = topPad + rows.length * (barH + rowGap) + 14;
  ctx.font = "11px Arial";
  ratingOrder.forEach((key) => {
    ctx.fillStyle = ratingColors[key];
    ctx.fillRect(legendX, legendY - 9, 10, 10);
    ctx.fillStyle = "#2d2024";
    ctx.fillText(key, legendX + 14, legendY);
    legendX += 14 + ctx.measureText(key).width + 16;
  });

  return toResult(canvas, W, H);
}

export function renderChartImage(chartType, { rows, order, ratingOrder, ratingColors } = {}) {
  switch (chartType) {
    case "donut": return drawDonut(rows);
    case "bars":  return drawHBars(rows);
    case "vbars": return drawVBars(rows);
    case "line":  return drawLine(rows, order);
    case "rating": return drawStackedBars(rows, ratingOrder, ratingColors);
    default: return null;
  }
}
