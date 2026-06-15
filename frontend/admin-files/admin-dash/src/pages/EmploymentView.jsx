import React, { useState, useEffect, useRef, useCallback } from "react";
import Icon from "../Icon.jsx";
import { Modal } from "../Primitives.jsx";
import TracerFormEditor from "./TracerFormEditor.jsx";

import { API } from "../shared.js";

function authHeaders() {
  const token = localStorage.getItem("auth_token");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60)      return `${diff}s ago`;
  if (diff < 3600)    return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400)   return `${Math.floor(diff / 3600)} hr ago`;
  if (diff < 604800)  return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)}wk ago`;
  return `${Math.floor(diff / 2592000)} mo ago`;
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-PH", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function groupActivities(acts) {
  const now = Date.now();
  const buckets = { "Just now": [], Today: [], "This week": [], "This month": [], Older: [] };
  acts.forEach((a) => {
    const diff = now - new Date(a.createdAt).getTime();
    if      (diff < 3_600_000)   buckets["Just now"].push(a);
    else if (diff < 86_400_000)  buckets.Today.push(a);
    else if (diff < 604_800_000) buckets["This week"].push(a);
    else if (diff < 2_592_000_000) buckets["This month"].push(a);
    else buckets.Older.push(a);
  });
  return Object.entries(buckets).filter(([, v]) => v.length > 0);
}

const COURSES    = ["BSIT", "BSCS", "BSIS"];
const STATUSES   = ["Not Yet Updated", "Employed", "Unemployed", "Self-employed"];
const ADD_STATUSES = ["Employed", "Unemployed", "Self-employed"];
const LIMITS     = [10, 25, 50, 100];
const INDUSTRIES = [
  "Information Technology",
  "Education",
  "Virtual Assistance and Remote Services",
  "Customer Service and Support",
  "Engineering and Construction",
  "Marketing",
  "Healthcare",
  "Manufacturing",
  "Finance and Banking",
  "Human Resources",
  "Government and Public Administration",
  "Non-Profit/NGO",
  "Other",
];
const BATCH_YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025];

const EMPTY_FILTERS   = { status: "", course: "", batch_year: "", date_updated: "", company: "" };
const EMPLOYMENT_TYPES = ["Regular/Permanent", "Contractual/Non-regular", "Part-time", "Self-employed/Business owner", "OFW", "Other"];
const EMPTY_ADD_FORM  = { alumni_id: "", employment_status: "", company_name: "", job_title: "", industry: "", work_location: "", salary_range: "", job_related_to_course: false, date_employed: "", reason_unemployed: "" };

const EMPTY_VALUES = new Set(["n/a", "none", "na", "null", "undefined", "-", ""]);
function fmtField(val) {
  const v = String(val ?? "").trim();
  return EMPTY_VALUES.has(v.toLowerCase()) ? "—" : v;
}

function StatusBadge({ status }) {
  const cls = {
    Employed:          "employed",
    Unemployed:        "unemployed",
    "Self-employed":   "self-employed",
    "Not Yet Updated": "not-yet-updated",
  }[status] || "not-yet-updated";
  return <span className={`status-badge ${cls}`}>{status || "Not Yet Updated"}</span>;
}

function ConfirmDialog({ open, message, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <Modal open onClose={onCancel}>
      <div className="confirm-dialog">
        <div className="modal-head">
          <h3>Confirm Action</h3>
          <button type="button" onClick={onCancel}>×</button>
        </div>
        <div className="confirm-dialog-body">{message}</div>
        <div className="modal-actions" style={{ padding: "0 20px 18px" }}>
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" style={{ background: "var(--maroon)", color: "#fff" }} onClick={onConfirm}>
            Confirm
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function EmploymentView({ active, showToast }) {
  // ─── records ────────────────────────────────────────────────────────────────
  const [records, setRecords]   = useState([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [page, setPage]         = useState(1);
  const [limit, setLimit]       = useState(10);
  const [total, setTotal]       = useState(0);
  const [pages, setPages]       = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  // ─── search + filter ────────────────────────────────────────────────────────
  const [searchInput, setSearchInput]       = useState("");
  const [search, setSearch]                 = useState("");
  const [filterOpen, setFilterOpen]         = useState(false);
  const [appliedFilters, setAppliedFilters] = useState(EMPTY_FILTERS);
  const [pendingFilters, setPendingFilters] = useState(EMPTY_FILTERS);

  // ─── view / edit modals ─────────────────────────────────────────────────────
  const [viewRecord, setViewRecord]               = useState(null);
  const [viewDetail, setViewDetail]               = useState(null);
  const [viewDetailLoading, setViewDetailLoading] = useState(false);
  const [editRecord, setEditRecord]   = useState(null);
  const [editForm, setEditForm]       = useState({});
  const [editErrors, setEditErrors]   = useState({});
  const [editSaving, setEditSaving]   = useState(false);

  // ─── tracer form editor ─────────────────────────────────────────────────────
  const [tracerOpen, setTracerOpen] = useState(false);

  // ─── activities ─────────────────────────────────────────────────────────────
  const [activities, setActivities]             = useState([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [activitiesExpanded, setActivitiesExpanded] = useState(false);

  // ─── export ─────────────────────────────────────────────────────────────────
  const [exportLoading, setExportLoading]   = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportRef = useRef(null);

  // ─── confirm dialog ─────────────────────────────────────────────────────────
  const [confirm, setConfirm] = useState({ open: false, message: "", onConfirm: null });

  // ─── add record modal ────────────────────────────────────────────────────────
  const [addOpen, setAddOpen]       = useState(false);
  const [addForm, setAddForm]       = useState(EMPTY_ADD_FORM);
  const [addErrors, setAddErrors]   = useState({});
  const [addSaving, setAddSaving]   = useState(false);
  const [alumniList, setAlumniList] = useState([]);
  const [alumniLoading, setAlumniLoading] = useState(false);

  const searchTimer = useRef(null);

  // ── debounce search ─────────────────────────────────────────────────────────
  useEffect(() => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 350);
    return () => clearTimeout(searchTimer.current);
  }, [searchInput]);

  // ── on mount: backfill missing records + sync tracer data into employment ───
  useEffect(() => {
    if (!active) return;
    Promise.all([
      fetch(`${API}/admin/employment/backfill`,     { method: "POST", headers: authHeaders() }).then(r => r.ok && r.json()),
      fetch(`${API}/admin/employment/sync-tracer`,  { method: "POST", headers: authHeaders() }).then(r => r.ok && r.json()),
    ])
      .then(([backfill, sync]) => {
        if ((backfill?.created > 0) || (sync?.updated > 0)) setRefreshKey(k => k + 1);
      })
      .catch(() => {});
  }, [active]);

  // ── fetch records ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          search,
          page,
          limit,
          status:       appliedFilters.status,
          course:       appliedFilters.course,
          batch_year:   appliedFilters.batch_year,
          date_updated: appliedFilters.date_updated,
          company:      appliedFilters.company,
        });
        const res = await fetch(`${API}/admin/employment?${params}`, { headers: authHeaders() });
        if (cancelled) return;
        if (!res.ok) throw new Error((await res.json()).message || "Failed to load records.");
        const data = await res.json();
        setRecords(data.records || []);
        setTotal(data.pagination?.total ?? 0);
        setPages(data.pagination?.pages ?? 0);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [active, search, page, limit, appliedFilters, refreshKey]);

  // ── fetch activities ────────────────────────────────────────────────────────
  const fetchActivities = useCallback(async () => {
    setActivitiesLoading(true);
    try {
      const res = await fetch(`${API}/admin/employment/activity?limit=30`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      setActivities(data.activities || []);
    } catch {
      // silently fail
    } finally {
      setActivitiesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    fetchActivities();
  }, [active, fetchActivities]);

  // ── fetch full record + tracer_data when the view modal opens ───────────────
  useEffect(() => {
    if (!viewRecord) { setViewDetail(null); return; }
    setViewDetailLoading(true);
    setViewDetail(null);
    fetch(`${API}/admin/employment/${viewRecord._id}`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => setViewDetail(d.record || null))
      .catch(() => {})
      .finally(() => setViewDetailLoading(false));
  }, [viewRecord]);

  // ── export menu click-outside ───────────────────────────────────────────────
  useEffect(() => {
    if (!exportMenuOpen) return;
    const handler = (e) => {
      if (exportRef.current && !exportRef.current.contains(e.target)) setExportMenuOpen(false);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [exportMenuOpen]);

  // ═══════════════════════════════════════════════════════════ ACTIONS ═════

  async function handleExport(format) {
    setExportMenuOpen(false);
    setExportLoading(true);
    try {
      const params = new URLSearchParams({
        format,
        search,
        status:     appliedFilters.status,
        course:     appliedFilters.course,
        batch_year: appliedFilters.batch_year,
        company:    appliedFilters.company,
      });
      const res = await fetch(`${API}/admin/employment/export?${params}`, {
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
      setTimeout(fetchActivities, 600);
    } catch (err) {
      showToast(err.message || "Export failed.");
    } finally {
      setExportLoading(false);
    }
  }

  function openEdit(r, tracerData = null) {
    setEditRecord(r);
    setEditForm({
      employment_status:     r.employment_status     || "",
      company_name:          tracerData?.companyName      || r.company_name          || "",
      job_title:             tracerData?.occupationTitle  || r.job_title             || "",
      industry:              tracerData?.industryField    || r.industry              || "",
      work_location:         tracerData?.workLocation     || r.work_location         || "",
      job_related_to_course: !!r.job_related_to_course,
      employment_type:       tracerData?.presentEmploymentType || r.employment_type      || "",
      years_in_current_job:  tracerData?.yearsInCurrentJob    || r.years_in_current_job || "",
      reason_unemployed:     r.reason_unemployed     || "",
    });
    setEditErrors({});
  }

  function validateEdit(f) {
    const e = {};
    if (!f.employment_status) { e.employment_status = "Status is required."; return e; }
    if (f.employment_status === "Employed") {
      if (!f.company_name?.trim())  e.company_name  = "Company name is required.";
      if (!f.job_title?.trim())     e.job_title     = "Job title is required.";
      if (!f.industry?.trim())      e.industry      = "Industry is required.";
      if (!f.work_location?.trim()) e.work_location = "Work location is required.";
    } else if (f.employment_status === "Unemployed") {
      if (!f.reason_unemployed?.trim()) e.reason_unemployed = "Reason is required.";
    } else if (f.employment_status === "Self-employed") {
      if (!f.industry?.trim()) e.industry = "Industry or business type is required.";
    }
    return e;
  }

  async function handleSaveEdit(ev) {
    ev.preventDefault();
    const errs = validateEdit(editForm);
    if (Object.keys(errs).length) { setEditErrors(errs); return; }
    setEditSaving(true);
    try {
      const res = await fetch(`${API}/admin/employment/${editRecord._id}`, {
        method: "PATCH", headers: authHeaders(), body: JSON.stringify(editForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Update failed.");
      showToast("Employment record updated successfully.");
      setEditRecord(null);
      setRefreshKey(k => k + 1);
      setTimeout(fetchActivities, 600);
    } catch (err) {
      showToast(err.message || "Update failed.");
    } finally {
      setEditSaving(false);
    }
  }

  function printRecord(r) {
    const co = r.employment_status === "Unemployed" ? "—" : fmtField(r.company_name);
    const w  = window.open("", "_blank");
    if (!w) { showToast(`${r.name} record is ready to print.`); return; }
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Employment Record — ${r.name}</title>
<style>
  body{font-family:Arial,sans-serif;margin:40px;color:#1e1e1e}
  h1{color:#570013;margin-bottom:22px;font-size:22px}
  table{border-collapse:collapse;width:100%}
  th,td{border:1px solid #ccc;padding:10px 14px;text-align:left}
  th{background:#570013;color:#fff;width:200px;font-size:13px}
  td{background:#f9f9f9;font-size:13px}
  .badge{display:inline-block;padding:2px 10px;border-radius:999px;font-weight:800;font-size:11px}
</style></head><body>
<h1>Employment Record</h1>
<table>
  <tr><th>Name</th><td>${r.name}</td></tr>
  <tr><th>Course</th><td>${r.course || "—"}</td></tr>
  <tr><th>Batch Year</th><td>${r.graduation_year || "—"}</td></tr>
  <tr><th>Employment Status</th><td>${r.employment_status}</td></tr>
  <tr><th>Company</th><td>${co}</td></tr>
  <tr><th>Job Title</th><td>${r.job_title || "—"}</td></tr>
  <tr><th>Industry</th><td>${r.industry || "—"}</td></tr>
  <tr><th>Work Location</th><td>${r.work_location || "—"}</td></tr>
  <tr><th>Salary Range</th><td>${r.salary_range || "—"}</td></tr>
  <tr><th>Related to Course</th><td>${r.job_related_to_course ? "Yes" : "No"}</td></tr>
  ${r.employment_status === "Unemployed" ? `<tr><th>Reason Unemployed</th><td>${r.reason_unemployed || "—"}</td></tr>` : ""}
  <tr><th>Last Updated</th><td>${fmtDate(r.last_updated)}</td></tr>
</table></body></html>`);
    w.document.close();
    w.print();
    showToast(`${r.name} record sent to printer.`);
    fetch(`${API}/admin/employment/log-print`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ alumni_name: r.name }),
    }).catch(() => {});
    setTimeout(fetchActivities, 800);
  }

  function applyFilters() {
    setAppliedFilters({ ...pendingFilters });
    setPage(1);
    setFilterOpen(false);
  }

  function clearFilters() {
    setPendingFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
    setPage(1);
    setFilterOpen(false);
  }

  const hasActiveFilters = Object.values(appliedFilters).some(Boolean);
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to   = Math.min(page * limit, total);


  // ─── add record ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!addOpen) return;
    setAlumniLoading(true);
    fetch(`${API}/admin/employment/alumni-without-record`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => setAlumniList(d.alumni || []))
      .catch(() => setAlumniList([]))
      .finally(() => setAlumniLoading(false));
  }, [addOpen]);

  function validateAdd(f) {
    const e = {};
    if (!f.alumni_id)          { e.alumni_id = "Please select an alumni."; return e; }
    if (!f.employment_status)  { e.employment_status = "Status is required."; return e; }
    if (f.employment_status === "Employed") {
      if (!f.company_name?.trim())  e.company_name  = "Company name is required.";
      if (!f.job_title?.trim())     e.job_title     = "Job title is required.";
      if (!f.industry?.trim())      e.industry      = "Industry is required.";
      if (!f.work_location?.trim()) e.work_location = "Work location is required.";
    } else if (f.employment_status === "Unemployed") {
      if (!f.reason_unemployed?.trim()) e.reason_unemployed = "Reason is required.";
    } else if (f.employment_status === "Self-employed") {
      if (!f.industry?.trim()) e.industry = "Industry or business type is required.";
    }
    return e;
  }

  async function handleAddRecord(ev) {
    ev.preventDefault();
    const errs = validateAdd(addForm);
    if (Object.keys(errs).length) { setAddErrors(errs); return; }
    setAddSaving(true);
    try {
      const res = await fetch(`${API}/admin/employment`, {
        method: "POST", headers: authHeaders(), body: JSON.stringify(addForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to create record.");
      showToast("Employment record created successfully.");
      setAddOpen(false);
      setAddForm(EMPTY_ADD_FORM);
      setAddErrors({});
      setRefreshKey(k => k + 1);
      setTimeout(fetchActivities, 600);
    } catch (err) {
      showToast(err.message || "Failed to create record.");
    } finally {
      setAddSaving(false);
    }
  }

  // ═══════════════════════════════════════════════════════════ RENDER ══════

  const groupedActs = groupActivities(activities);
  const visibleActs = activitiesExpanded ? groupedActs : groupedActs.slice(0, 2);

  return (
    <section className={`content employment-view view${active ? " active-view" : ""}`}>

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="employment-toolbar">
        <div className="section-title">
          <h3>Employment Details</h3>
          <span />
        </div>
        <div className="employment-actions">
          <div className="emp-export-wrap" ref={exportRef}>
            <button
              type="button"
              className="maroon-action"
              disabled={exportLoading}
              onClick={() => setExportMenuOpen(o => !o)}
            >
              <span><Icon name="icon-17" /></span>
              <span>{exportLoading ? "Exporting…" : "Export List"}</span>
            </button>
            <div className={`emp-export-menu${exportMenuOpen ? " show" : ""}`}>
              <button type="button" onClick={() => handleExport("csv")}>Export as CSV</button>
              <button type="button" onClick={() => handleExport("excel")}>Export as Excel</button>
            </div>
          </div>
          <button type="button" className="maroon-action" onClick={() => setTracerOpen(true)}>
            <span><Icon name="icon-18" /></span>
            <span>Edit Tracer Form</span>
          </button>
        </div>
      </div>

      {/* ── Employment Card ──────────────────────────────────────────────────── */}
      <section className="employment-card">

        {/* Search + filter row */}
        <div className="emp-search-row">
          <input
            className="emp-search"
            type="text"
            placeholder="Search by name, company…"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
          />
          <button
            type="button"
            className="table-filter"
            style={{ marginBottom: 0, minHeight: 36 }}
            onClick={() => { setPendingFilters({ ...appliedFilters }); setFilterOpen(true); }}
          >
            {hasActiveFilters ? "Filters Active ▾" : "Filter By ▾"}
          </button>
          {hasActiveFilters && (
            <button type="button" className="see-toggle" style={{ marginTop: 0 }} onClick={clearFilters}>
              Clear Filters
            </button>
          )}
        </div>

        {/* Rows-per-page */}
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "8px", marginBottom: "10px", fontSize: "12px", color: "var(--muted)" }}>
          <span>Rows per page:</span>
          <select className="emp-rows-select" value={limit} onChange={e => { setLimit(parseInt(e.target.value)); setPage(1); }}>
            {LIMITS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>

        {/* Table */}
        <div className="employment-table-wrap">
          <table className="employment-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Course</th>
                <th>Company</th>
                <th>Status</th>
                <th>Last Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="emp-loading">Loading employment records…</td></tr>
              ) : error ? (
                <tr><td colSpan={6} className="emp-error">{error} — <button type="button" style={{ color: "var(--maroon)", background: "none", border: "none", cursor: "pointer", fontWeight: 700 }} onClick={() => setRefreshKey(k => k + 1)}>Retry</button></td></tr>
              ) : records.length === 0 ? (
                <tr><td colSpan={6} className="emp-empty">No employment records found.</td></tr>
              ) : records.map(r => (
                <tr key={r._id}>
                  <td>{r.name}</td>
                  <td>{r.course || "—"}</td>
                  <td>{(r.employment_status === "Unemployed" || r.employment_status === "Not Yet Updated") ? "—" : fmtField(r.company_name)}</td>
                  <td><StatusBadge status={r.employment_status} /></td>
                  <td>{fmtDate(r.last_updated)}</td>
                  <td>
                    <button
                      type="button"
                      className="table-icon table-print"
                      aria-label="Print record"
                      onClick={() => setConfirm({
                        open: true,
                        message: `Print employment record for ${r.name}?`,
                        onConfirm: () => { setConfirm(c => ({ ...c, open: false })); printRecord(r); },
                      })}
                    >
                      <span><Icon name="icon-19" /></span>
                    </button>
                    <button
                      type="button"
                      className="table-icon table-view"
                      aria-label="View record"
                      onClick={() => setViewRecord(r)}
                    >
                      <span><Icon name="icon-20" /></span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!loading && total > 0 && (
          <div className="emp-pagination">
            <span className="emp-pagination-info">Showing {from}–{to} of {total} record{total !== 1 ? "s" : ""}</span>
            <div className="emp-pagination-controls">
              <button className="emp-pagination-btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>‹</button>
              {(() => {
                const start = Math.max(1, Math.min(page - 2, pages - 4));
                const end   = Math.min(pages, start + 4);
                return Array.from({ length: end - start + 1 }, (_, i) => start + i).map(p => (
                  <button
                    key={p}
                    className={`emp-pagination-btn${p === page ? " active" : ""}`}
                    onClick={() => setPage(p)}
                  >
                    {p}
                  </button>
                ));
              })()}
              <button className="emp-pagination-btn" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>›</button>
            </div>
          </div>
        )}
      </section>

      {/* ── Recent Activities ────────────────────────────────────────────────── */}
      <section className={`recent-card${activitiesExpanded ? " is-expanded" : ""}`}>
        <h3>Recent Activities</h3>
        {activitiesLoading ? (
          <p style={{ color: "var(--muted)", fontSize: "13px", margin: 0 }}>Loading activities…</p>
        ) : activities.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: "13px", margin: 0 }}>No recent activities yet.</p>
        ) : visibleActs.map(([group, items], gi) => (
          <React.Fragment key={group}>
            {gi > 0 && <h4>{group}</h4>}
            {items.map((a, i) => (
              <div
                key={i}
                className={`recent-row${gi > 0 && !activitiesExpanded ? " extra-row" : ""}`}
              >
                <span>{a.user_name}</span>
                <span>{a.action}{a.target_name ? ` — ${a.target_name}` : ""}</span>
                <time>{timeAgo(a.createdAt)}</time>
              </div>
            ))}
          </React.Fragment>
        ))}
        <button type="button" className="see-toggle" onClick={() => setActivitiesExpanded(e => !e)}>
          {activitiesExpanded ? "Hide" : "See More"}
        </button>
      </section>

      {/* ════════════════════════════════════════════════════ MODALS ══════════ */}

      {/* ── Filter Modal ─────────────────────────────────────────────────────── */}
      <Modal open={filterOpen} onClose={() => setFilterOpen(false)}>
        <div className="emp-filter-modal">
          <div className="modal-head">
            <h3>Filter Employment Records</h3>
            <button type="button" onClick={() => setFilterOpen(false)}>×</button>
          </div>
          <div className="emp-filter-grid">
            <label>
              Employment Status
              <select value={pendingFilters.status} onChange={e => setPendingFilters(f => ({ ...f, status: e.target.value }))}>
                <option value="">All statuses</option>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label>
              Course
              <select value={pendingFilters.course} onChange={e => setPendingFilters(f => ({ ...f, course: e.target.value }))}>
                <option value="">All courses</option>
                {COURSES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label>
              Batch Year
              <select value={pendingFilters.batch_year} onChange={e => setPendingFilters(f => ({ ...f, batch_year: e.target.value }))}>
                <option value="">All years</option>
                {BATCH_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
            <label>
              Company
              <input
                type="text"
                placeholder="Filter by company…"
                value={pendingFilters.company}
                onChange={e => setPendingFilters(f => ({ ...f, company: e.target.value }))}
              />
            </label>
            <label className="full-col">
              Date Last Updated
              <input
                type="date"
                value={pendingFilters.date_updated}
                onChange={e => setPendingFilters(f => ({ ...f, date_updated: e.target.value }))}
              />
            </label>
          </div>
          <div className="modal-actions" style={{ padding: "0 20px 18px" }}>
            <button type="button" onClick={clearFilters}>Clear All</button>
            <button type="button" style={{ background: "var(--maroon)", color: "#fff" }} onClick={applyFilters}>
              Apply Filters
            </button>
          </div>
        </div>
      </Modal>

      {/* ── View Record Modal ────────────────────────────────────────────────── */}
      <Modal open={!!viewRecord} onClose={() => setViewRecord(null)}>
        <section className="tracer-modal wider-modal" role="dialog" aria-modal="true">
          <div className="modal-head">
            <h3>Employment Record</h3>
            <button type="button" aria-label="Close" onClick={() => setViewRecord(null)}>×</button>
          </div>
          {viewRecord && (
            <>
              {(() => {
                const r  = viewDetail || viewRecord;
                const td = viewDetail?.tracer_data || null;
                const isUnemployed = r.employment_status === "Unemployed";
                const isNoRecord   = r.employment_status === "Not Yet Updated";

                // Tracer data takes priority; fall back to AlumniEmployment stored values
                const company  = (isUnemployed || isNoRecord)
                  ? "—"
                  : fmtField(td?.companyName || r.company_name);
                const jobTitle = td?.occupationTitle || r.job_title    || "—";
                const industry = td?.industryField   || r.industry     || "—";
                const workLoc  = td?.workLocation    || r.work_location || "—";

                // jobRelatedToDegree may be a full sentence — check startsWith 'yes'
                const jrd = String(td?.jobRelatedToDegree || '').toLowerCase().trim();
                const related = td?.jobRelatedToDegree
                  ? (jrd.startsWith('yes') ? "Yes" : "No")
                  : (r.job_related_to_course ? "Yes" : "No");

                return (
                  <div className="record-details">
                    <div><strong>Name</strong><span>{r.name}</span></div>
                    <div><strong>Course</strong><span>{r.course || "—"}</span></div>
                    <div><strong>Batch Year</strong><span>{r.graduation_year || "—"}</span></div>
                    <div><strong>Status</strong><span><StatusBadge status={r.employment_status} /></span></div>
                    <div><strong>Company</strong><span>{company}</span></div>
                    {!isUnemployed && !isNoRecord && (
                      <>
                        <div><strong>Job Title</strong><span>{jobTitle}</span></div>
                        <div><strong>Industry</strong><span>{industry}</span></div>
                        <div><strong>Work Location</strong><span>{workLoc}</span></div>
                        <div><strong>Employment Type</strong><span>{td?.presentEmploymentType || r.employment_type || "—"}</span></div>
                        <div><strong>Years in Job</strong><span>{td?.yearsInCurrentJob || r.years_in_current_job || "—"}</span></div>
                        <div><strong>Related to Course</strong><span>{related}</span></div>
                      </>
                    )}
                    {isUnemployed && (
                      <div><strong>Reason Unemployed</strong><span>{r.reason_unemployed || "—"}</span></div>
                    )}
                    <div><strong>Last Updated</strong><span>{fmtDate(r.last_updated)}</span></div>
                  </div>
                );
              })()}

              <div className="modal-actions record-actions">
                <button type="button" onClick={() => setViewRecord(null)}>Close</button>
                <button type="button" onClick={() => printRecord(viewRecord)}>Print Record</button>
                <button
                  type="button"
                  style={{ background: "var(--maroon)", color: "#fff" }}
                  onClick={() => { setViewRecord(null); openEdit(viewRecord, viewDetail?.tracer_data); }}
                >
                  Edit Record
                </button>
              </div>
            </>
          )}
        </section>
      </Modal>

      {/* ── Edit Record Modal ────────────────────────────────────────────────── */}
      <Modal open={!!editRecord} onClose={() => setEditRecord(null)}>
        <section className="tracer-modal wider-modal" role="dialog" aria-modal="true">
          <div className="modal-head">
            <h3>Edit Employment — {editRecord?.name}</h3>
            <button type="button" onClick={() => setEditRecord(null)}>×</button>
          </div>
          {editRecord && (
            <form onSubmit={handleSaveEdit}>
              <div className="edit-record-form">

                <label>
                  Employment Status *
                  <select
                    value={editForm.employment_status}
                    onChange={e => setEditForm(f => ({ ...f, employment_status: e.target.value }))}
                  >
                    <option value="">Select status…</option>
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {editErrors.employment_status && <span className="field-error">{editErrors.employment_status}</span>}
                </label>

                {editForm.employment_status && editForm.employment_status !== "Unemployed" && editForm.employment_status !== "Not Yet Updated" && (
                  <>
                    <div className="field-row">
                      <label>
                        Company Name{editForm.employment_status === "Employed" ? " *" : ""}
                        <input
                          type="text"
                          value={editForm.company_name}
                          onChange={e => setEditForm(f => ({ ...f, company_name: e.target.value }))}
                          placeholder="Company or business name"
                        />
                        {editErrors.company_name && <span className="field-error">{editErrors.company_name}</span>}
                      </label>
                      <label>
                        Job Title{editForm.employment_status === "Employed" ? " *" : ""}
                        <input
                          type="text"
                          value={editForm.job_title}
                          onChange={e => setEditForm(f => ({ ...f, job_title: e.target.value }))}
                          placeholder="Your job title"
                        />
                        {editErrors.job_title && <span className="field-error">{editErrors.job_title}</span>}
                      </label>
                    </div>

                    <div className="field-row">
                      <label>
                        Industry{["Employed", "Self-employed"].includes(editForm.employment_status) ? " *" : ""}
                        <select
                          value={editForm.industry}
                          onChange={e => setEditForm(f => ({ ...f, industry: e.target.value }))}
                        >
                          <option value="">Select industry…</option>
                          {INDUSTRIES.map(ind => <option key={ind} value={ind}>{ind}</option>)}
                        </select>
                        {editErrors.industry && <span className="field-error">{editErrors.industry}</span>}
                      </label>
                      <label>
                        Work Location{editForm.employment_status === "Employed" ? " *" : ""}
                        <input
                          type="text"
                          value={editForm.work_location}
                          onChange={e => setEditForm(f => ({ ...f, work_location: e.target.value }))}
                          placeholder="City, Province"
                        />
                        {editErrors.work_location && <span className="field-error">{editErrors.work_location}</span>}
                      </label>
                    </div>

                    <div className="field-row">
                      <label>
                        Employment Type
                        <select
                          value={editForm.employment_type}
                          onChange={e => setEditForm(f => ({ ...f, employment_type: e.target.value }))}
                        >
                          <option value="">Select type…</option>
                          {EMPLOYMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </label>
                      <label>
                        Years in Current Job
                        <input
                          type="text"
                          value={editForm.years_in_current_job}
                          onChange={e => setEditForm(f => ({ ...f, years_in_current_job: e.target.value }))}
                          placeholder="e.g. 2 years"
                        />
                      </label>
                    </div>

                    <label style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "8px" }}>
                      <input
                        type="checkbox"
                        style={{ width: "auto", minHeight: "auto" }}
                        checked={editForm.job_related_to_course}
                        onChange={e => setEditForm(f => ({ ...f, job_related_to_course: e.target.checked }))}
                      />
                      Job is related to my course
                    </label>
                  </>
                )}

                {editForm.employment_status === "Unemployed" && (
                  <label>
                    Reason for Unemployment *
                    <textarea
                      value={editForm.reason_unemployed}
                      onChange={e => setEditForm(f => ({ ...f, reason_unemployed: e.target.value }))}
                      placeholder="Briefly describe your situation…"
                    />
                    {editErrors.reason_unemployed && <span className="field-error">{editErrors.reason_unemployed}</span>}
                  </label>
                )}
              </div>

              <div className="modal-actions" style={{ padding: "0 20px 18px" }}>
                <button type="button" onClick={() => setEditRecord(null)}>Cancel</button>
                <button type="submit" disabled={editSaving}>
                  {editSaving ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </form>
          )}
        </section>
      </Modal>

      {/* ── Tracer Form Editor (integrated 6-page editor) ───────────────────── */}
      <TracerFormEditor
        open={tracerOpen}
        onClose={() => setTracerOpen(false)}
        showToast={showToast}
      />

      {/* ── Add Record Modal ─────────────────────────────────────────────────── */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)}>
        <section className="tracer-modal wider-modal" role="dialog" aria-modal="true">
          <div className="modal-head">
            <h3>Add Employment Record</h3>
            <button type="button" onClick={() => setAddOpen(false)}>×</button>
          </div>
          <form onSubmit={handleAddRecord}>
            <div className="edit-record-form">

              <label>
                Alumni *
                <select
                  value={addForm.alumni_id}
                  onChange={e => setAddForm(f => ({ ...f, alumni_id: e.target.value }))}
                  disabled={alumniLoading}
                >
                  <option value="">{alumniLoading ? "Loading alumni…" : alumniList.length === 0 ? "All alumni already have records" : "Select alumni…"}</option>
                  {alumniList.map(a => (
                    <option key={a._id} value={a._id}>
                      {a.firstName} {a.lastName}{a.course ? ` — ${a.course}` : ""}{a.graduationYear ? ` (${a.graduationYear})` : ""}
                    </option>
                  ))}
                </select>
                {addErrors.alumni_id && <span className="field-error">{addErrors.alumni_id}</span>}
              </label>

              <label>
                Employment Status *
                <select
                  value={addForm.employment_status}
                  onChange={e => setAddForm(f => ({ ...f, employment_status: e.target.value }))}
                >
                  <option value="">Select status…</option>
                  {ADD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                {addErrors.employment_status && <span className="field-error">{addErrors.employment_status}</span>}
              </label>

              {addForm.employment_status && addForm.employment_status !== "Unemployed" && (
                <>
                  <div className="field-row">
                    <label>
                      Company Name{addForm.employment_status === "Employed" ? " *" : ""}
                      <input
                        type="text"
                        value={addForm.company_name}
                        onChange={e => setAddForm(f => ({ ...f, company_name: e.target.value }))}
                        placeholder="Company or business name"
                      />
                      {addErrors.company_name && <span className="field-error">{addErrors.company_name}</span>}
                    </label>
                    <label>
                      Job Title{addForm.employment_status === "Employed" ? " *" : ""}
                      <input
                        type="text"
                        value={addForm.job_title}
                        onChange={e => setAddForm(f => ({ ...f, job_title: e.target.value }))}
                        placeholder="Your job title"
                      />
                      {addErrors.job_title && <span className="field-error">{addErrors.job_title}</span>}
                    </label>
                  </div>

                  <div className="field-row">
                    <label>
                      Industry{["Employed", "Self-employed"].includes(addForm.employment_status) ? " *" : ""}
                      <select
                        value={addForm.industry}
                        onChange={e => setAddForm(f => ({ ...f, industry: e.target.value }))}
                      >
                        <option value="">Select industry…</option>
                        {INDUSTRIES.map(ind => <option key={ind} value={ind}>{ind}</option>)}
                      </select>
                      {addErrors.industry && <span className="field-error">{addErrors.industry}</span>}
                    </label>
                    <label>
                      Work Location{addForm.employment_status === "Employed" ? " *" : ""}
                      <input
                        type="text"
                        value={addForm.work_location}
                        onChange={e => setAddForm(f => ({ ...f, work_location: e.target.value }))}
                        placeholder="City, Province"
                      />
                      {addErrors.work_location && <span className="field-error">{addErrors.work_location}</span>}
                    </label>
                  </div>

                  <label>
                    Date Employed
                    <input
                      type="date"
                      value={addForm.date_employed}
                      onChange={e => setAddForm(f => ({ ...f, date_employed: e.target.value }))}
                    />
                  </label>

                  <label style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "8px" }}>
                    <input
                      type="checkbox"
                      style={{ width: "auto", minHeight: "auto" }}
                      checked={addForm.job_related_to_course}
                      onChange={e => setAddForm(f => ({ ...f, job_related_to_course: e.target.checked }))}
                    />
                    Job is related to my course
                  </label>
                </>
              )}

              {addForm.employment_status === "Unemployed" && (
                <label>
                  Reason for Unemployment *
                  <textarea
                    value={addForm.reason_unemployed}
                    onChange={e => setAddForm(f => ({ ...f, reason_unemployed: e.target.value }))}
                    placeholder="Briefly describe the situation…"
                  />
                  {addErrors.reason_unemployed && <span className="field-error">{addErrors.reason_unemployed}</span>}
                </label>
              )}

            </div>
            <div className="modal-actions" style={{ padding: "0 20px 18px" }}>
              <button type="button" onClick={() => setAddOpen(false)}>Cancel</button>
              <button type="submit" disabled={addSaving || alumniLoading || alumniList.length === 0}>
                {addSaving ? "Saving…" : "Add Record"}
              </button>
            </div>
          </form>
        </section>
      </Modal>

      {/* ── Generic confirm dialog ────────────────────────────────────────────── */}
      <ConfirmDialog
        open={confirm.open}
        message={confirm.message}
        onConfirm={confirm.onConfirm}
        onCancel={() => setConfirm(c => ({ ...c, open: false }))}
      />
    </section>
  );
}
