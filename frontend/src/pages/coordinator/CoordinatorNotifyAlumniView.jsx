import { useState, useEffect } from "react";
import { useOutletContext } from "react-router-dom";
import Icon from "../../components/common/Icon.jsx";
import { ConfirmDialog } from "../../components/common/Primitives.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { API, authHeaders } from "../../services/api.js";
import { COURSES_BY_COLLEGE } from "../../constants/colleges.js";

// Temporary: the 254 bulk-migrated alumni accounts must not be emailed until
// explicitly authorized. Flip back to false once that permission is granted.
// The backend has its own copy of this same flag (the real enforcement
// point — see notifyAlumniToUpdate in employmentController.js), so leaving
// this true is a UI convenience, not the only thing stopping a send.
const NOTIFY_ALUMNI_DISABLED = true;

const STATUSES = ["Not Yet Updated", "Employed", "Unemployed", "Self-employed"];
const LIMIT = 25;

const EMPTY_FILTERS = { search: "", status: "", course: "", batch_year: "" };

function NewQuestionsBadge({ count }) {
  if (count === null || count === undefined) {
    return <span style={{ color: "#9a8080", fontSize: 12 }}>Not yet submitted</span>;
  }
  if (count === 0) {
    return <span style={{ color: "#1f6b45", fontSize: 12, fontWeight: 600 }}>Up to date</span>;
  }
  return <span style={{ color: "#941527", fontSize: 12, fontWeight: 700 }}>{count} new question{count !== 1 ? "s" : ""}</span>;
}

// Coordinator's own take on the admin Notify Alumni page — same filter/
// select/notify flow, but scoped to just their assigned college the whole
// way through (no college picker; the backend forces it regardless, this
// just keeps the UI from offering a choice that doesn't exist).
export default function CoordinatorNotifyAlumniView() {
  const { showToast } = useOutletContext();
  const { user } = useAuth();
  const college = user?.college || "";

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage]       = useState(1);
  const [records, setRecords] = useState([]);
  const [total, setTotal]     = useState(0);
  const [pages, setPages]     = useState(0);
  const [loading, setLoading] = useState(false);

  const [newQuestionsOnly, setNewQuestionsOnly] = useState(false);
  const [batchYears, setBatchYears] = useState([]);
  useEffect(() => {
    fetch(`${API}/coordinator/employment/batch-years`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => setBatchYears(d.years || []))
      .catch(() => {});
  }, []);

  const [selected, setSelected]         = useState(new Set()); // alumni_id set
  const [selectingAll, setSelectingAll] = useState(false);

  // Lets the coordinator require specific EXISTING questions be re-answered/
  // updated (not just auto-detected new ones), scoped to their own college's
  // tracer form — always available since college is fixed, no picker needed.
  const [questionOptions, setQuestionOptions]     = useState([]); // [{ id, label, type, pageTitle }]
  const [questionsLoading, setQuestionsLoading]   = useState(true);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState(new Set());

  const [notifying, setNotifying] = useState(false);
  const [confirm, setConfirm]     = useState({ open: false, message: "", onConfirm: null });

  const hasActiveFilters = Object.values(filters).some(Boolean);

  useEffect(() => { setPage(1); }, [filters, newQuestionsOnly]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ page, limit: LIMIT, ...filters, new_questions_only: newQuestionsOnly ? "true" : "" });
    fetch(`${API}/coordinator/employment/notify-candidates?${params}`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        setRecords(d.records || []);
        setTotal(d.pagination?.total ?? 0);
        setPages(d.pagination?.pages ?? 0);
      })
      .catch(() => { if (!cancelled) { setRecords([]); setTotal(0); setPages(0); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filters, newQuestionsOnly, page]);

  useEffect(() => {
    let cancelled = false;
    setQuestionsLoading(true);
    // No ?college= here — the coordinator endpoint always resolves to their
    // own assigned college regardless of any query param.
    fetch(`${API}/coordinator/tracer-form-config`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        const options = [];
        (d.config?.pages || []).forEach(p => (p.questions || []).forEach(q => {
          if (q.type === "static_text") return;
          options.push({ id: q.id, label: q.label || q.content || q.id, type: q.type, pageTitle: p.title });
        }));
        setQuestionOptions(options);
      })
      .catch(() => { if (!cancelled) setQuestionOptions([]); })
      .finally(() => { if (!cancelled) setQuestionsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  function toggleQuestion(id) {
    setSelectedQuestionIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const pageIds = records.map(r => r.alumni_id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every(id => selected.has(id));

  function toggleOne(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAllOnPage() {
    setSelected(prev => {
      const next = new Set(prev);
      if (allOnPageSelected) pageIds.forEach(id => next.delete(id));
      else pageIds.forEach(id => next.add(id));
      return next;
    });
  }

  // Walks every page matching the current filters (not just the one on
  // screen) so "select all" can cover more than the visible 25 rows without
  // needing a separate backend endpoint.
  async function selectAllMatchingFilters() {
    setSelectingAll(true);
    try {
      const qs = { ...filters, new_questions_only: newQuestionsOnly ? "true" : "" };
      const first = await fetch(`${API}/coordinator/employment/notify-candidates?${new URLSearchParams({ page: 1, limit: 100, ...qs })}`, { headers: authHeaders() }).then(r => r.json());
      const totalPages = first.pagination?.pages ?? 1;
      const allIds = (first.records || []).map(r => r.alumni_id);
      for (let p = 2; p <= totalPages; p++) {
        const d = await fetch(`${API}/coordinator/employment/notify-candidates?${new URLSearchParams({ page: p, limit: 100, ...qs })}`, { headers: authHeaders() }).then(r => r.json());
        allIds.push(...(d.records || []).map(r => r.alumni_id));
      }
      setSelected(prev => new Set([...prev, ...allIds]));
      showToast(`Added ${allIds.length} alumni matching the current filters to your selection.`);
    } catch {
      showToast("Could not load all matching alumni. Please try again.");
    } finally {
      setSelectingAll(false);
    }
  }

  function handleNotify() {
    const count = selected.size;
    const qCount = selectedQuestionIds.size;
    const message = qCount > 0
      ? `Send a reminder to the ${count} selected alumni, asking them to specifically update ${qCount} selected question${qCount !== 1 ? "s" : ""}?`
      : `Send a reminder to the ${count} selected alumni to update their employment details for accreditation?`;
    setConfirm({
      open: true,
      message,
      onConfirm: async () => {
        setConfirm(c => ({ ...c, open: false }));
        setNotifying(true);
        try {
          const body = { alumni_ids: Array.from(selected) };
          if (qCount > 0) body.question_ids = Array.from(selectedQuestionIds);
          const res  = await fetch(`${API}/coordinator/employment/notify`, {
            method:  "POST",
            headers: authHeaders(),
            body:    JSON.stringify(body),
          });
          const data = await res.json();
          if (!res.ok) { showToast(data.message || "Failed to send notifications."); return; }
          showToast(data.message);
          setSelected(new Set());
          setSelectedQuestionIds(new Set());
        } catch {
          showToast("Could not connect to server.");
        } finally {
          setNotifying(false);
        }
      },
    });
  }

  return (
    <section className="content notify-alumni-view view active-view">
      <div className="admin-hero" aria-label="Notify alumni header">
        <h1 className="admin-hero-title">Notify Alumni</h1>
        <p className="admin-hero-subtitle">
          Filter {college} alumni by course, batch year, or status, then check exactly who should
          get a reminder to update their employment details for accreditation.
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
              {(COURSES_BY_COLLEGE[college] || []).map(c => <option key={c} value={c}>{c}</option>)}
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

        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13, color: "#570013", fontWeight: 600, cursor: "pointer" }}>
          <input type="checkbox" checked={newQuestionsOnly} onChange={e => setNewQuestionsOnly(e.target.checked)} />
          Only show alumni with new survey questions to answer
        </label>

        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #f0e6e6" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#570013", marginBottom: 6 }}>
            Require specific questions to be updated (optional)
          </div>
          {questionsLoading ? (
            <p style={{ fontSize: 12, color: "#9a8080", margin: 0 }}>Loading {college}'s questions…</p>
          ) : questionOptions.length === 0 ? (
            <p style={{ fontSize: 12, color: "#9a8080", margin: 0 }}>{college} has no tracer form questions yet.</p>
          ) : (
            <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid #f0e6e6", borderRadius: 8, padding: "6px 10px" }}>
              {questionOptions.map(q => (
                <label key={q.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "6px 2px", fontSize: 13, color: "#2d2024", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={selectedQuestionIds.has(q.id)}
                    onChange={() => toggleQuestion(q.id)}
                    style={{ marginTop: 2 }}
                  />
                  <span>
                    {q.label}
                    <span style={{ display: "block", fontSize: 11, color: "#9a8080" }}>{q.pageTitle} · {q.type}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          {selectedQuestionIds.size > 0 && (
            <p style={{ fontSize: 12, color: "#941527", fontWeight: 600, marginTop: 6 }}>
              {selectedQuestionIds.size} question{selectedQuestionIds.size !== 1 ? "s" : ""} selected.
            </p>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, margin: "16px 0 8px" }}>
          <span style={{ fontSize: 13, color: "#76656a" }}>
            {selected.size > 0 ? `${selected.size} alumni selected` : `${total} alumni match these filters`}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="see-toggle" onClick={selectAllMatchingFilters} disabled={selectingAll || total === 0}>
              {selectingAll ? "Selecting…" : `Select All Matching (${total})`}
            </button>
            {selected.size > 0 && (
              <button type="button" className="see-toggle" onClick={() => setSelected(new Set())}>
                Clear Selection
              </button>
            )}
          </div>
        </div>

        <div className="employment-table-wrap">
          <table className="employment-table">
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  <input type="checkbox" checked={allOnPageSelected} onChange={toggleAllOnPage} aria-label="Select all on this page" />
                </th>
                <th>Name</th>
                <th>Course</th>
                <th>Status</th>
                <th>Survey</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="emp-loading">Loading alumni…</td></tr>
              ) : records.length === 0 ? (
                <tr><td colSpan={5} className="emp-empty">No alumni match these filters.</td></tr>
              ) : records.map(r => (
                <tr key={r.alumni_id}>
                  <td>
                    <input type="checkbox" checked={selected.has(r.alumni_id)} onChange={() => toggleOne(r.alumni_id)} aria-label={`Select ${r.name}`} />
                  </td>
                  <td data-label="Name">{r.name}</td>
                  <td data-label="Course">{r.course || "—"}</td>
                  <td data-label="Status">{r.employment_status || "Not Yet Updated"}</td>
                  <td data-label="Survey"><NewQuestionsBadge count={r.newQuestionsCount} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div className="emp-pagination-controls" style={{ marginTop: 10 }}>
            <button className="emp-pagination-btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>‹</button>
            {Array.from({ length: Math.min(pages, 5) }, (_, i) => {
              const start = Math.max(1, Math.min(page - 2, pages - 4));
              return start + i;
            }).filter(p => p >= 1 && p <= pages).map(p => (
              <button key={p} className={`emp-pagination-btn${p === page ? " active" : ""}`} onClick={() => setPage(p)}>{p}</button>
            ))}
            <button className="emp-pagination-btn" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>›</button>
          </div>
        )}

        <div style={{
          display: "flex", alignItems: "center", justifyContent: "flex-end",
          gap: 12, marginTop: 20, paddingTop: 16, borderTop: "1px solid #f0e6e6",
        }}>
          <button
            type="button"
            className="maroon-action"
            disabled={NOTIFY_ALUMNI_DISABLED || notifying || selected.size === 0}
            title={NOTIFY_ALUMNI_DISABLED ? "Disabled — email permission not yet granted for the migrated alumni batch" : selected.size === 0 ? "Select at least one alumni first" : undefined}
            onClick={handleNotify}
          >
            <span><Icon name="icon-9" /></span>
            <span>{notifying ? "Sending…" : `Notify ${selected.size || ""} Alumni`}</span>
          </button>
        </div>
      </section>

      <ConfirmDialog
        open={confirm.open}
        message={confirm.message}
        onConfirm={confirm.onConfirm}
        onCancel={() => setConfirm(c => ({ ...c, open: false }))}
      />
    </section>
  );
}
