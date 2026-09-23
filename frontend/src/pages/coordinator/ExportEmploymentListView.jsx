import { useState, useEffect } from "react";
import { useOutletContext } from "react-router-dom";
import { jsPDF } from "jspdf";
import Icon from "../../components/common/Icon.jsx";
import { Dropdown } from "../../components/common/Primitives.jsx";
import { API, authHeaders } from "../../services/api.js";

const STATUSES = ["Not Yet Updated", "Employed", "Unemployed", "Self-employed"];

const EMPTY_FILTERS = { search: "", status: "", course: "", batch_year: "" };

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-PH", { year: "numeric", month: "2-digit", day: "2-digit" });
}

// Same shape as the admin Export Alumni Record page, minus the College
// filter — every /coordinator/employment* route already force-scopes
// `college` server-side to the coordinator's own assigned college, so
// there's nothing for that filter to choose between here.
export default function ExportEmploymentListView() {
  const { showToast } = useOutletContext();
  const [filters, setFilters]     = useState(EMPTY_FILTERS);
  const [total, setTotal]         = useState(null);
  const [counting, setCounting]   = useState(false);
  const [exporting, setExporting] = useState(null); // "csv" | "excel" | "pdf" | null
  const [batchYears, setBatchYears] = useState([]);

  useEffect(() => {
    fetch(`${API}/coordinator/employment/batch-years`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => setBatchYears(d.years || []))
      .catch(() => {});
  }, []);

  const hasActiveFilters = Object.values(filters).some(Boolean);

  // Live preview of how many records the current filters match — fetched
  // from the same list endpoint the Alumni Record table itself uses, just
  // with limit=1 so only pagination.total is needed.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      setCounting(true);
      const params = new URLSearchParams({ page: 1, limit: 1, ...filters });
      fetch(`${API}/coordinator/employment?${params}`, { headers: authHeaders() })
        .then(r => r.json())
        .then(d => { if (!cancelled) setTotal(d.pagination?.total ?? 0); })
        .catch(() => { if (!cancelled) setTotal(null); })
        .finally(() => { if (!cancelled) setCounting(false); });
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [filters]);

  // CSV/Excel carry every tracer-study answer as its own column — a PDF
  // page can't reasonably fit that many columns per row and stay readable.
  // PDF is a compact, printable overview table instead (core fields only);
  // the full answer set is still there in CSV/Excel for anyone who needs
  // to process the raw data.
  async function exportPdf() {
    const PAGE_SIZE = 200;
    let page = 1, pages = 1;
    const records = [];
    do {
      const params = new URLSearchParams({ page, limit: PAGE_SIZE, ...filters });
      const res = await fetch(`${API}/coordinator/employment?${params}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to load records.");
      records.push(...(data.records || []));
      pages = data.pagination?.pages ?? 1;
      page += 1;
    } while (page <= pages);

    const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "landscape" });
    const marginX = 36;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const columns = [
      { label: "Name",          width: 140, get: (r) => r.name },
      { label: "Course",        width: 70,  get: (r) => r.course },
      { label: "Batch",         width: 50,  get: (r) => r.graduation_year },
      { label: "Status",        width: 100, get: (r) => r.employment_status },
      { label: "Company",       width: 150, get: (r) => r.company_name },
      { label: "Job Title",     width: 150, get: (r) => r.job_title },
      { label: "Last Updated",  width: 90,  get: (r) => fmtDate(r.last_updated) },
    ];
    const rowHeight = 18;

    function truncate(text, width) {
      const s = String(text ?? "").trim() || "—";
      if (doc.getTextWidth(s) <= width) return s;
      let cut = s;
      while (cut.length > 1 && doc.getTextWidth(cut + "…") > width) cut = cut.slice(0, -1);
      return cut + "…";
    }

    function drawHeader(y) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(255, 255, 255);
      doc.setFillColor(87, 0, 19);
      doc.rect(marginX, y, pageWidth - marginX * 2, rowHeight, "F");
      let x = marginX + 6;
      columns.forEach((col) => {
        doc.text(col.label, x, y + 12);
        x += col.width;
      });
      return y + rowHeight;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(87, 0, 19);
    doc.text("Alumni Record Export", marginX, 40);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(120, 100, 104);
    doc.text(`${records.length} record${records.length !== 1 ? "s" : ""} · Generated ${new Date().toLocaleString("en-PH")}`, marginX, 54);

    let y = drawHeader(70);
    records.forEach((r, i) => {
      if (y + rowHeight > pageHeight - 36) {
        doc.addPage();
        y = drawHeader(36);
      }
      if (i % 2 === 1) {
        doc.setFillColor(250, 245, 245);
        doc.rect(marginX, y, pageWidth - marginX * 2, rowHeight, "F");
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(45, 32, 36);
      let x = marginX + 6;
      columns.forEach((col) => {
        doc.text(truncate(col.get(r), col.width - 8), x, y + 12);
        x += col.width;
      });
      y += rowHeight;
    });

    doc.save("employment-details.pdf");
  }

  async function handleExport(format) {
    setExporting(format);
    try {
      if (format === "pdf") {
        await exportPdf();
        showToast("Exported as PDF successfully.");
        return;
      }
      const params = new URLSearchParams({ format, ...filters });
      const res = await fetch(`${API}/coordinator/employment/export?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
      });
      if (!res.ok) throw new Error("Export failed.");
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = format === "excel" ? "employment-details.xlsx" : "employment-details.csv";
      a.click();
      URL.revokeObjectURL(url);
      showToast(`Exported as ${format.toUpperCase()} successfully.`);
    } catch (err) {
      showToast(err.message || "Export failed.");
    } finally {
      setExporting(null);
    }
  }

  return (
    <section className="content coordinator-content export-employment-view view active-view">
      <div className="admin-hero" aria-label="Export employment list header">
        <h1 className="admin-hero-title">Export Alumni Record</h1>
        <p className="admin-hero-subtitle">
          Narrow down your college's alumni records, then export the matching list as CSV or Excel
          (with their full tracer study answers) or as a compact PDF summary.
        </p>
      </div>

      <section className="employment-card">
        <div className="emp-search-row">
          <input
            className="emp-search"
            type="text"
            placeholder="Search by name…"
            value={filters.search}
            onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
          />
          {hasActiveFilters && (
            <button type="button" className="see-toggle" style={{ marginTop: 0 }} onClick={() => setFilters(EMPTY_FILTERS)}>
              Clear Filters
            </button>
          )}
        </div>

        <div className="emp-filter-grid" style={{ marginTop: 4 }}>
          <label>
            Employment Status
            <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
              <option value="">All statuses</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>
            Course
            <select value={filters.course} onChange={e => setFilters(f => ({ ...f, course: e.target.value }))}>
              <option value="">All courses</option>
              <option value="BSIT">BSIT</option>
              <option value="BSCS">BSCS</option>
              <option value="BSIS">BSIS</option>
              <option value="BSIM">BSIM</option>
            </select>
          </label>
          <label>
            Batch Year
            <select value={filters.batch_year} onChange={e => setFilters(f => ({ ...f, batch_year: e.target.value }))}>
              <option value="">All years</option>
              {batchYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
        </div>

        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexWrap: "wrap", gap: 12, marginTop: 20, paddingTop: 16, borderTop: "1px solid #f0e6e6",
        }}>
          <span style={{ fontSize: 13, color: "#76656a" }}>
            {counting ? "Counting matching records…" : total === null ? "" : `${total} record${total !== 1 ? "s" : ""} match these filters`}
          </span>
          <Dropdown
            menuClassName="admin-menu"
            portal
            options={["CSV", "Excel", "PDF"]}
            onSelect={(choice) => handleExport(choice.toLowerCase())}
            trigger={(toggle) => (
              <button type="button" className="maroon-action" disabled={exporting !== null} onClick={toggle}>
                <span><Icon name="icon-17" /></span>
                <span>{exporting ? `Exporting ${exporting.toUpperCase()}…` : "Export ▾"}</span>
              </button>
            )}
          />
        </div>
      </section>
    </section>
  );
}
