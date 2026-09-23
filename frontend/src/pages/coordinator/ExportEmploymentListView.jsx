import { useState, useEffect } from "react";
import { useOutletContext } from "react-router-dom";
import Icon from "../../components/common/Icon.jsx";
import { API, authHeaders } from "../../services/api.js";

const STATUSES = ["Not Yet Updated", "Employed", "Unemployed", "Self-employed"];

const EMPTY_FILTERS = { search: "", status: "", course: "", batch_year: "" };

// Same shape as the admin Export Alumni Record page, minus the College
// filter — every /coordinator/employment* route already force-scopes
// `college` server-side to the coordinator's own assigned college, so
// there's nothing for that filter to choose between here.
export default function ExportEmploymentListView() {
  const { showToast } = useOutletContext();
  const [filters, setFilters]     = useState(EMPTY_FILTERS);
  const [total, setTotal]         = useState(null);
  const [counting, setCounting]   = useState(false);
  const [exporting, setExporting] = useState(null); // "csv" | "excel" | null
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

  async function handleExport(format) {
    setExporting(format);
    try {
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
          Narrow down your college's alumni records, then export the matching list, including
          their full tracer study answers, as CSV or Excel.
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
          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              className="maroon-action"
              disabled={exporting !== null}
              onClick={() => handleExport("csv")}
            >
              <span><Icon name="icon-17" /></span>
              <span>{exporting === "csv" ? "Exporting…" : "Export as CSV"}</span>
            </button>
            <button
              type="button"
              className="maroon-action"
              disabled={exporting !== null}
              onClick={() => handleExport("excel")}
            >
              <span><Icon name="icon-17" /></span>
              <span>{exporting === "excel" ? "Exporting…" : "Export as Excel"}</span>
            </button>
          </div>
        </div>
      </section>
    </section>
  );
}
