import React, { useState, useEffect, useRef, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import Icon from "../../components/common/Icon.jsx";
import { Modal } from "../../components/common/Primitives.jsx";
import ActionMenu from "../../components/admin/ActionMenu.jsx";
import AvatarCropper from "../../components/common/AvatarCropper.jsx";
import SkillsEditor from "../../components/common/SkillsEditor.jsx";

import { API, authHeaders } from "../../services/api.js";
import { COLLEGE_CODES as COLLEGES, COURSES_BY_COLLEGE } from "../../constants/colleges.js";

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

const COURSES    = ["BSIT", "BSCS", "BSIS", "BSIM"];
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
const EMPTY_FILTERS   = { status: "", college: "", course: "", batch_year: "", date_updated: "", company: "" };
// Same fixed lists the alumni's own Employment Details form uses — kept
// identical so an admin editing this on their behalf sees the exact same
// choices, not a different set that silently diverges over time.
const SALARY_RANGES = [
  "Below PHP 15,000",
  "PHP 15,000 - PHP 25,000",
  "PHP 25,000 - PHP 35,000",
  "PHP 35,000 - PHP 45,000",
  "PHP 45,000 - PHP 60,000",
  "Above PHP 60,000",
  "Prefer not to say",
];
const EXPERIENCE_LEVELS = ["No experience yet", "Less than 1 year", "1-2 years", "3-5 years", "5-10 years", "10+ years"];
const EMPTY_ADD_FORM  = { alumni_id: "", employment_status: "", company_name: "", job_title: "", industry: "", work_location: "", salary_range: "", job_related_to_course: false, date_employed: "", reason_unemployed: "" };

const MAROON = "#570013";

// ── Alumni Record detail helpers (mirrors TracerResponsesView's DetailModal,
// duplicated rather than shared since that page's own modal is unrelated in
// scope and already works — this one additionally leads with a profile
// picture and the employment-specific summary). Each section renders as its
// own card, and fields inside as zebra-striped rows, instead of a single
// flat list of label/value pairs. ────────────────────────────────────────────
function RecordGroup({ title, children }) {
  const kids = Array.isArray(children) ? children : [children];
  return (
    <div style={{
      background: "#fff",
      border: "1px solid #f0dfe2",
      borderRadius: 14,
      padding: "16px 20px 18px",
      marginBottom: 16,
      boxShadow: "0 2px 10px rgba(87,0,19,0.06)",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 9,
        fontSize: 12, fontWeight: 800, color: MAROON, textTransform: "uppercase",
        letterSpacing: "0.06em", marginBottom: 12, paddingBottom: 10,
        borderBottom: `1.5px solid ${MAROON}16`,
      }}>
        <span style={{ width: 5, height: 14, borderRadius: 3, background: MAROON, flexShrink: 0 }} />
        {title}
      </div>
      <div className="record-fields-grid">{kids}</div>
    </div>
  );
}

function RecordField({ label, value }) {
  const v = Array.isArray(value) ? value.join(", ") : value;
  if (!v && v !== 0) return null;
  return (
    <div className="record-field-row" style={{ padding: "8px 10px", borderRadius: 8 }}>
      <div style={{ fontSize: 10.5, color: "#a8898d", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, color: "#2d2024", fontWeight: 600, wordBreak: "break-word", lineHeight: 1.35 }}>
        {v}
      </div>
    </div>
  );
}

function RecordLinkField({ label, value }) {
  if (!value) return null;
  const href = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return (
    <div className="record-field-row" style={{ padding: "8px 10px", borderRadius: 8 }}>
      <div style={{ fontSize: 10.5, color: "#a8898d", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
        {label}
      </div>
      <a href={href} target="_blank" rel="noopener noreferrer" style={{ fontSize: 14, color: MAROON, fontWeight: 600, wordBreak: "break-word", textDecoration: "none" }}>
        {value}
      </a>
    </div>
  );
}

function RecordMultilineField({ label, value }) {
  if (!value) return null;
  return (
    <div className="record-field-row" style={{ padding: "8px 10px", borderRadius: 8, gridColumn: "1 / -1" }}>
      <div style={{ fontSize: 10.5, color: "#a8898d", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 5 }}>{label}</div>
      <div style={{ color: "#2d2024", whiteSpace: "pre-line", lineHeight: 1.55, fontSize: 13.5 }}>{value}</div>
    </div>
  );
}

// Skills/Languages are stored as one big string, newline- or comma/semicolon-
// separated (same convention the Job Connect resume editor writes) — shown
// as chips instead of one long run-on line.
function RecordChips({ label, text }) {
  const items = String(text || "").split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  if (!items.length) return null;
  return (
    <div style={{ padding: "8px 10px", gridColumn: "1 / -1" }}>
      <div style={{ fontSize: 10.5, color: "#a8898d", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 7 }}>{label}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {items.map((s, i) => (
          <span key={i} style={{ background: `${MAROON}10`, color: MAROON, padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600 }}>
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}

// `rows` is the question's own row definitions ([{ key, label }, ...]) from
// the live form config — labels are looked up from there instead of a
// hardcoded dictionary, so this renders correctly for ANY rating_table
// question on ANY college's form, not just the seeded personal-growth one.
function RecordRatingsTable({ ratings, rows }) {
  const entries = Object.entries(ratings || {}).filter(([, v]) => v);
  if (!entries.length) return null;
  const labelFor = (key) => rows?.find((r) => r.key === key)?.label || key;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 4, borderRadius: 8, overflow: "hidden" }}>
      <thead>
        <tr>
          <th style={{ textAlign: "left", padding: "7px 10px", background: MAROON, color: "#fff", width: "55%" }}>Item</th>
          <th style={{ textAlign: "left", padding: "7px 10px", background: MAROON, color: "#fff" }}>Rating</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([key, val], i) => (
          <tr key={key} style={{ background: i % 2 === 0 ? "#faf5f5" : "#fff" }}>
            <td style={{ padding: "6px 10px", color: "#2d2024" }}>{labelFor(key)}</td>
            <td style={{ padding: "6px 10px", color: MAROON, fontWeight: 700 }}>{val}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AlumniAvatar({ url, name }) {
  const initials = (name || "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("") || "?";
  return url ? (
    <img
      src={url}
      alt={name}
      style={{ width: 84, height: 84, borderRadius: "50%", objectFit: "cover", border: "3px solid #fff", boxShadow: "0 2px 10px rgba(87,0,19,0.25)", flexShrink: 0 }}
    />
  ) : (
    <div style={{
      width: 84, height: 84, borderRadius: "50%", background: "#fff", color: MAROON,
      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: 800,
      border: "3px solid #fff", boxShadow: "0 2px 10px rgba(87,0,19,0.25)", flexShrink: 0,
    }}>
      {initials}
    </div>
  );
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

// Small tag marking a question as newly-added/unanswered (or explicitly
// flagged via Notify Alumni) — same "new questions" concept already used on
// the Notify Alumni list and the alumni's own post-login gate, surfaced here
// too so these don't just blend in with every other already-answered field.
function NewQuestionTag() {
  return (
    <span style={{ background: "#941527", color: "#fff", fontSize: 10, fontWeight: 800, padding: "1px 7px", borderRadius: 999, marginLeft: 8 }}>
      NEW
    </span>
  );
}

// Renders one editable input for a tracer-form question inside the Edit
// Record modal, matching whichever type the question actually is (mirrors
// the alumni-facing TracerStudyForm's own QuestionField, but with the
// plainer admin form styling already used elsewhere in this modal).
function EditQuestionField({ q, value, onChange, isNew }) {
  if (q.type === "static_text") return null;

  const wrapStyle = isNew
    ? { background: "#fffbea", border: "1px solid #fac853", borderRadius: 8, padding: "8px 10px 10px", marginBottom: 10 }
    : { marginBottom: 14 };
  const labelNode = <>{q.label}{isNew && <NewQuestionTag />}</>;

  if (q.type === "textarea") {
    return (
      <div style={wrapStyle}>
        <label>
          {labelNode}
          <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} />
        </label>
      </div>
    );
  }

  if (q.type === "radio" || q.type === "select") {
    return (
      <div style={wrapStyle}>
        <label>
          {labelNode}
          <select value={value || ""} onChange={(e) => onChange(e.target.value)}>
            <option value="">Select…</option>
            {(q.options || []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </label>
      </div>
    );
  }

  if (q.type === "checkbox") {
    const arr = Array.isArray(value) ? value : [];
    return (
      <div style={wrapStyle}>
        <span style={{ display: "block", fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{labelNode}</span>
        {(q.options || []).map((opt) => (
          <label key={opt} style={{ flexDirection: "row", alignItems: "center", gap: 8, fontWeight: 400, marginBottom: 4 }}>
            <input
              type="checkbox"
              style={{ width: "auto", minHeight: "auto" }}
              checked={arr.includes(opt)}
              onChange={(e) => onChange(e.target.checked ? [...arr, opt] : arr.filter((o) => o !== opt))}
            />
            {opt}
          </label>
        ))}
      </div>
    );
  }

  if (q.type === "rating_table") {
    const ratings = (value && typeof value === "object" && !Array.isArray(value)) ? value : {};
    return (
      <div style={wrapStyle}>
        <span style={{ display: "block", fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{labelNode}</span>
        {(q.rows || []).map((row) => (
          <div key={row.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 13, color: "#2d2024" }}>{row.label}</span>
            <select
              style={{ maxWidth: 180 }}
              value={ratings[row.key] || ""}
              onChange={(e) => onChange({ ...ratings, [row.key]: e.target.value })}
            >
              <option value="">—</option>
              {(q.ratingOptions || []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>
        ))}
      </div>
    );
  }

  // "text" and anything else falls back to a plain input
  return (
    <div style={wrapStyle}>
      <label>
        {labelNode}
        <input type="text" value={value || ""} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
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

export default function EmploymentView() {
  const { showToast } = useOutletContext();
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
  // Actual distinct batch years present in the data, not a hardcoded
  // range — a fixed list silently hid every alumnus outside it.
  const [batchYears, setBatchYears] = useState([]);
  useEffect(() => {
    fetch(`${API}/admin/employment/batch-years`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => setBatchYears(d.years || []))
      .catch(() => {});
  }, []);

  // ─── view / edit modals ─────────────────────────────────────────────────────
  const [viewRecord, setViewRecord]               = useState(null);
  const [viewDetail, setViewDetail]               = useState(null);
  const [viewDetailLoading, setViewDetailLoading] = useState(false);
  const [editRecord, setEditRecord]   = useState(null);
  const [editForm, setEditForm]       = useState({});
  const [editErrors, setEditErrors]   = useState({});
  const [editSaving, setEditSaving]   = useState(false);
  // Flat question-id -> value map for the FULL tracer study record (fixed
  // fields and custom/imported ones alike), edited alongside the existing
  // AlumniEmployment fields above and saved via a separate request to
  // /admin/employment/:id/tracer. Empty ({}) when this alumnus has never
  // submitted a tracer response — editing is limited to the employment
  // fields only in that case (no tracer response exists yet to correct).
  const [editTracerForm, setEditTracerForm] = useState({});
  // Question ids new_question_ids flagged as "new" for this specific alumni
  // (see getEmploymentRecord) — drives the "NEW" tag on EditQuestionField.
  const [editNewQuestionIds, setEditNewQuestionIds] = useState([]);
  // ─── edit record photo (admin/coordinator setting it on someone else's
  // behalf — same crop flow as the alumni's own "Upload Photo") ──────────────
  const avatarInputRef = useRef(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [cropSrc, setCropSrc]       = useState("");

  // ─── tracer form editor ─────────────────────────────────────────────────────

  // ─── activities ─────────────────────────────────────────────────────────────
  const [activities, setActivities]             = useState([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [activitiesExpanded, setActivitiesExpanded] = useState(false);


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
      Promise.all([
      fetch(`${API}/admin/employment/backfill`,     { method: "POST", headers: authHeaders() }).then(r => r.ok && r.json()),
      fetch(`${API}/admin/employment/sync-tracer`,  { method: "POST", headers: authHeaders() }).then(r => r.ok && r.json()),
    ])
      .then(([backfill, sync]) => {
        if ((backfill?.created > 0) || (sync?.updated > 0)) setRefreshKey(k => k + 1);
      })
      .catch(() => {});
  }, []);

  // ── fetch records ───────────────────────────────────────────────────────────
  useEffect(() => {
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
          college:      appliedFilters.college,
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
  }, [search, page, limit, appliedFilters, refreshKey]);

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
      fetchActivities();
  }, [fetchActivities]);

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

  // The Alumni Record's tracer-study sections are rendered straight off this
  // — the alumni's college's CURRENT live form config — rather than a fixed
  // set of hardcoded sections, so every page (however many, however titled,
  // whatever custom questions were added to it) shows up correctly for any
  // college, not just the ones with pages happening to match a guessed
  // naming convention. A custom question's id never changes even if the
  // admin later edits its wording or moves it to a different page, so this
  // has to be looked up live rather than baked into the stored answer.
  const [tracerConfig, setTracerConfig] = useState(null);
  useEffect(() => {
    // Edit Record opens by closing View Record first (setViewRecord(null)),
    // which would otherwise clear viewDetail (and this college lookup) right
    // as the Edit modal needs it — falling back to editRecord's own college
    // keeps this populated across that handoff instead of resetting to null.
    const college = viewDetail?.college || editRecord?.college;
    if (!college) { setTracerConfig(null); return; }
    fetch(`${API}/admin/tracer-form-config?college=${encodeURIComponent(college)}`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => setTracerConfig(d.config || null))
      .catch(() => setTracerConfig(null));
  }, [viewDetail?.college, editRecord?.college]);

  // ═══════════════════════════════════════════════════════════ ACTIONS ═════

  function openEdit(r, tracerData = null, newQuestionIds = []) {
    setEditRecord(r);
    setEditNewQuestionIds(newQuestionIds || []);
    setEditForm({
      employment_status:     r.employment_status     || "Not Yet Updated",
      company_name:          tracerData?.companyName      || r.company_name          || "",
      job_title:             tracerData?.occupationTitle  || r.job_title             || "",
      industry:              tracerData?.industryField    || r.industry              || "",
      // r.work_location (the actual specific place, e.g. "Clark") takes
      // priority — tracerData.placeOfWork is only ever a "Local"/"Abroad"
      // radio choice, not a real location, and shouldn't overwrite it.
      work_location:         r.work_location || tracerData?.resolvedWorkLocation || "",
      job_related_to_course: !!r.job_related_to_course,
      employment_type:       tracerData?.presentEmploymentType || r.employment_type      || "",
      years_in_current_job:  tracerData?.yearsInCurrentJob    || r.years_in_current_job || "",
      reason_unemployed:     r.reason_unemployed     || "",
      date_employed:         r.date_employed ? new Date(r.date_employed).toISOString().slice(0, 10) : "",
      salary_range:          r.salary_range          || "",
      skills:                r.skills                || "",
      experience:            r.experience            || "",
      contact_email:         r.contact_email         || "",
      contact_number:        r.contact_number        || "",
      facebook:              r.facebook              || "",
      linkedin:              r.linkedin              || "",
    });
    setEditErrors({});

    // Flatten the full tracer record the same way the alumni's own form
    // submits it — fixed-schema fields at the top level, custom/imported
    // ones merged in by their own id — so this can be saved back through
    // the exact same path (saveTracerAnswers) a real resubmission uses.
    // Left empty if this alumnus has never submitted one at all.
    const flat = {};
    if (tracerData) {
      Object.entries(tracerData).forEach(([k, v]) => {
        if (k === "extra_answers" || k === "submittedAt" || k === "resolvedCompanyName" || k === "resolvedWorkLocation") return;
        flat[k] = v;
      });
      Object.entries(tracerData.extra_answers || {}).forEach(([k, v]) => { flat[k] = v; });
    }
    setEditTracerForm(flat);
  }

  function validateEdit(f) {
    const e = {};
    const status = f.employment_status;
    if (status === "Employed") {
      if (!f.company_name?.trim())  e.company_name  = "Company name is required.";
      if (!f.job_title?.trim())     e.job_title     = "Job title is required.";
      if (!f.industry?.trim())      e.industry      = "Industry is required.";
      if (!f.work_location?.trim()) e.work_location = "Work location is required.";
    } else if (status === "Unemployed") {
      if (!f.reason_unemployed?.trim()) e.reason_unemployed = "Reason is required.";
    } else if (status === "Self-employed") {
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

      // Only present (and only sent) when this alumnus already has a
      // tracer response to correct — see openEdit's comment.
      if (Object.keys(editTracerForm).length > 0) {
        const tracerRes = await fetch(`${API}/admin/employment/${editRecord._id}/tracer`, {
          method: "PATCH", headers: authHeaders(), body: JSON.stringify(editTracerForm),
        });
        if (!tracerRes.ok) {
          const tracerErr = await tracerRes.json().catch(() => ({}));
          throw new Error(tracerErr.message || "Employment details saved, but the tracer study fields failed to save.");
        }
      }

      showToast("Alumni record updated successfully.");
      setEditRecord(null);
      setRefreshKey(k => k + 1);
      setTimeout(fetchActivities, 600);
    } catch (err) {
      showToast(err.message || "Update failed.");
    } finally {
      setEditSaving(false);
    }
  }

  function handleAvatarChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)) {
      showToast("Use a PNG, JPEG, GIF, or WEBP image.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      showToast("Image must be smaller than 2MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (loadEvent) => setCropSrc(loadEvent.target.result);
    reader.readAsDataURL(file);
  }

  async function uploadEditAvatar(avatarUrl) {
    setAvatarBusy(true);
    try {
      const res = await fetch(`${API}/admin/employment/${editRecord._id}/avatar`, {
        method: "PATCH", headers: authHeaders(), body: JSON.stringify({ avatarUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Could not update photo.");
      setEditRecord((r) => ({ ...r, avatarUrl }));
      setViewDetail((d) => (d ? { ...d, avatarUrl } : d));
      setCropSrc("");
      showToast("Photo updated.");
    } catch (err) {
      showToast(err.message || "Could not update photo.");
    } finally {
      setAvatarBusy(false);
    }
  }

  // Takes just the bare row (only _id/name guaranteed) and fetches the full
  // record + that college's live form config itself — this used to only
  // print whatever the caller already had in hand, so the row-level "quick
  // print" button (which only ever loaded the bare list row) silently
  // printed an incomplete record with no picture, no tracer pages, and no
  // resume, while printing from inside the Alumni Record modal looked
  // complete. Fetching fresh here every time makes both entry points
  // produce the exact same, always-complete printout.
  async function printRecord(rowRecord) {
    const w  = window.open("", "_blank");
    if (!w) { showToast(`${rowRecord.name} record is ready to print.`); return; }
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Alumni Record — ${rowRecord.name}</title></head><body style="font-family:Arial,sans-serif;padding:40px;color:#570013">Loading full record…</body></html>`);

    let r;
    try {
      const res = await fetch(`${API}/admin/employment/${rowRecord._id}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to load record.");
      r = data.record;
    } catch (err) {
      w.close();
      showToast(err.message || "Could not load the full record to print.");
      return;
    }

    let config = null;
    if (r.college) {
      try {
        const cfgRes  = await fetch(`${API}/admin/tracer-form-config?college=${encodeURIComponent(r.college)}`, { headers: authHeaders() });
        const cfgData = await cfgRes.json();
        config = cfgData.config || null;
      } catch { /* prints without dynamic tracer sections if this fails */ }
    }

    const td     = r.tracer_data || null;
    const resume = r.resume || null;

    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const fmt = (v) => {
      if (v === undefined || v === null || v === "") return "";
      if (Array.isArray(v)) return v.join(", ");
      if (typeof v === "object") return "";
      return String(v);
    };
    const fmtList = (v) => String(v || "").split(/[,;\n]/).map((s) => s.trim()).filter(Boolean).join(", ");
    const row    = (label, value) => { const v = fmt(value); return v ? `<tr><th>${esc(label)}</th><td>${esc(v)}</td></tr>` : ""; };
    const rowPre = (label, value) => { const v = fmt(value); return v ? `<tr><th>${esc(label)}</th><td style="white-space:pre-line">${esc(v)}</td></tr>` : ""; };

    const answerFor = (q) => {
      if (!td) return undefined;
      if (Object.prototype.hasOwnProperty.call(td, q.id)) return td[q.id];
      return td.extra_answers?.[q.id];
    };

    const section = (title, rowsHtml) => rowsHtml
      ? `<div class="card"><h2>${esc(title)}</h2><table>${rowsHtml}</table></div>`
      : "";

    let tracerSectionsHtml = "";
    if (td && config) {
      tracerSectionsHtml = config.pages.map((page) => {
        const rowsHtml = (page.questions || [])
          .filter((q) => q.type !== "static_text")
          .map((q) => {
            if (q.type === "rating_table") {
              const val = answerFor(q);
              if (!val || !Object.values(val).some(Boolean)) return "";
              const sub = (q.rows || [])
                .filter((rr) => val[rr.key])
                .map((rr) => `<tr><td>${esc(rr.label)}</td><td><strong>${esc(val[rr.key])}</strong></td></tr>`)
                .join("");
              return sub ? `<tr><th colspan="2" style="background:#f0dfe2;color:#570013;width:auto">${esc(q.label)}</th></tr>${sub}` : "";
            }
            return row(q.label, answerFor(q));
          })
          .filter(Boolean)
          .join("");
        return section(page.title, rowsHtml);
      }).join("");
    }

    const resumeRows = resume ? [
      row("LinkedIn", resume.linkedin),
      rowPre("Summary", resume.summary),
      row("Skills", fmtList(resume.skills)),
      rowPre("Experience", resume.experience),
      rowPre("Education", resume.education),
      rowPre("Certifications", resume.certifications),
      rowPre("Projects", resume.projects),
      row("Languages", fmtList(resume.languages)),
    ].filter(Boolean).join("") : "";
    const resumeHtml = section("Profile / Resume", resumeRows);

    const isUnemployed = r.employment_status === "Unemployed";
    const isNoRecord   = r.employment_status === "Not Yet Updated";
    const jobTitle = td?.occupationTitle || r.job_title    || "";
    const industry = td?.industryField   || r.industry     || "";
    const workLoc = r.work_location || td?.resolvedWorkLocation || "";
    const jrd = String(td?.jobRelatedToDegree || "").toLowerCase().trim();
    const related = td?.jobRelatedToDegree ? (jrd.startsWith("yes") ? "Yes" : "No") : (r.job_related_to_course ? "Yes" : "No");

    const initials = (r.name || "").split(" ").filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("") || "?";
    const avatarHtml = r.avatarUrl
      ? `<img src="${r.avatarUrl}" alt="" style="width:88px;height:88px;border-radius:50%;object-fit:cover;border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.3)" />`
      : `<div style="width:88px;height:88px;border-radius:50%;background:#fff;color:#570013;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:800;border:3px solid #fff">${esc(initials)}</div>`;

    const contactRows = [
      row("Email", r.contact_email || r.email),
      row("Contact Number", r.contact_number),
      row("Facebook", r.facebook),
      row("LinkedIn", r.linkedin),
    ].filter(Boolean).join("");
    const contactHtml = section("Contact Information", contactRows);

    const summaryRows = [
      !isUnemployed && !isNoRecord ? row("Company Name", td?.companyName || r.company_name) : "",
      !isUnemployed && !isNoRecord ? row("Job Title", jobTitle) : "",
      !isUnemployed && !isNoRecord ? row("Industry", industry) : "",
      !isUnemployed && !isNoRecord ? row("Work Location", workLoc) : "",
      !isUnemployed && !isNoRecord ? row("Employment Type", td?.presentEmploymentType || r.employment_type) : "",
      !isUnemployed && !isNoRecord ? row("Years in Job", td?.yearsInCurrentJob || r.years_in_current_job) : "",
      !isUnemployed && !isNoRecord ? row("Related to Course", related) : "",
      !isUnemployed && !isNoRecord ? row("Salary Range", r.salary_range) : "",
      !isUnemployed && !isNoRecord && r.date_employed ? row("Date Employed", fmtDate(r.date_employed)) : "",
      isUnemployed ? row("Reason Unemployed", r.reason_unemployed) : "",
      row("Last Updated", fmtDate(r.last_updated)),
    ].filter(Boolean).join("");

    // A second document.write() on an already-closed stream would just
    // append after "Loading full record…" instead of replacing it —
    // document.open() resets the stream so this write starts clean.
    w.document.open();
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Alumni Record — ${esc(r.name)}</title>
<style>
  @media print { @page { margin: 14mm; } .card { break-inside: avoid; page-break-inside: avoid; } }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact; }
  body{font-family:'Segoe UI',Arial,Helvetica,sans-serif;margin:0;color:#2d2024;background:#f5eef0;font-size:13px;line-height:1.5}
  .sheet{max-width:820px;margin:0 auto;background:#fff}
  .banner{display:flex;align-items:center;gap:20px;background:linear-gradient(135deg,#570013 0%,#8b1a2e 100%);color:#fff;padding:26px 30px}
  .banner h1{margin:0;font-size:21px;letter-spacing:.01em}
  .banner p{margin:5px 0 0;font-size:13px;opacity:.85}
  .badge{display:inline-block;margin-top:9px;padding:4px 13px;border-radius:999px;font-weight:800;font-size:11px;letter-spacing:.03em;background:#fff;color:#570013}
  .content{padding:24px 30px 8px}
  .card{background:#fff;border:1px solid #f0dfe2;border-radius:10px;padding:2px 0 0;margin-bottom:16px;overflow:hidden;box-shadow:0 1px 3px rgba(87,0,19,.06)}
  h2{color:#570013;font-size:12.5px;text-transform:uppercase;letter-spacing:.06em;background:#faf5f5;padding:9px 16px;margin:0;border-bottom:1px solid #f0dfe2}
  table{border-collapse:collapse;width:100%}
  th,td{padding:8px 16px;text-align:left;font-size:12.5px;vertical-align:top;border-bottom:1px solid #f5eaea}
  th{color:#8a7377;font-weight:700;width:210px}
  td{color:#2d2024}
  tr:last-child th, tr:last-child td { border-bottom: none; }
  tr:nth-child(even) th, tr:nth-child(even) td { background:#fcf8f8; }
  .footer{margin:10px 0 26px;padding-top:12px;border-top:1px solid #eee;font-size:11px;color:#9a8080;text-align:center}
</style></head><body>
  <div class="sheet">
    <div class="banner">
      ${avatarHtml}
      <div>
        <h1>${esc(r.name)}</h1>
        <p>${esc(r.college || "")}${r.college ? " · " : ""}${esc(r.course || "")}${r.graduation_year ? ` · Batch ${r.graduation_year}` : ""}</p>
        <span class="badge">${esc(r.employment_status || "Not Yet Updated")}</span>
      </div>
    </div>
    <div class="content">
      ${contactHtml}
      ${section("Employment Summary", summaryRows)}
      ${resumeHtml}
      ${tracerSectionsHtml}
      <div class="footer">Printed ${new Date().toLocaleString("en-PH")} — Tarlac State University Alumni Portal</div>
    </div>
  </div>
</body></html>`);
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
    <section className={`content employment-view view active-view`}>

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="employment-toolbar">
        <div className="section-title">
          <h3>Alumni Record</h3>
          <span />
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
                <th>College</th>
                <th>Course</th>
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
                  <td data-label="Name">{r.name}</td>
                  <td data-label="College">{r.college || "—"}</td>
                  <td data-label="Course">{r.course || "—"}</td>
                  <td data-label="Status"><StatusBadge status={r.employment_status} /></td>
                  <td data-label="Last Updated">{fmtDate(r.last_updated)}</td>
                  <td data-label="Actions">
                    <div className="desktop-row-actions">
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
                    </div>
                    <div className="mobile-row-actions">
                      <ActionMenu
                        actions={["print", "view"]}
                        onSelect={(action) => {
                          if (action === "view") {
                            setViewRecord(r);
                            return;
                          }
                          setConfirm({
                            open: true,
                            message: `Print employment record for ${r.name}?`,
                            onConfirm: () => { setConfirm(c => ({ ...c, open: false })); printRecord(r); },
                          });
                        }}
                      />
                    </div>
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
                key={a._id ?? `${group}-${i}`}
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
              College
              <select value={pendingFilters.college} onChange={e => setPendingFilters(f => ({ ...f, college: e.target.value, course: "" }))}>
                <option value="">All colleges</option>
                {COLLEGES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label>
              Course
              <select
                value={pendingFilters.course}
                onChange={e => setPendingFilters(f => ({ ...f, course: e.target.value }))}
                disabled={!pendingFilters.college}
              >
                <option value="">
                  {pendingFilters.college ? "All courses" : "All courses (pick a college)"}
                </option>
                {(COURSES_BY_COLLEGE[pendingFilters.college] || []).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label>
              Batch Year
              <select value={pendingFilters.batch_year} onChange={e => setPendingFilters(f => ({ ...f, batch_year: e.target.value }))}>
                <option value="">All years</option>
                {batchYears.map(y => <option key={y} value={y}>{y}</option>)}
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

      {/* ── Alumni Record Modal ──────────────────────────────────────────────── */}
      <Modal open={!!viewRecord} onClose={() => setViewRecord(null)}>
        <section className="tracer-modal wider-modal" role="dialog" aria-modal="true" style={{ maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div className="modal-head">
            <h3>Alumni Record</h3>
            <button type="button" aria-label="Close" onClick={() => setViewRecord(null)}>×</button>
          </div>
          {viewRecord && (
            <>
              <div style={{ flex: 1, overflowY: "auto", background: "#faf6f6", padding: "18px 20px" }}>
                {(() => {
                  const r  = viewDetail || viewRecord;
                  const td = viewDetail?.tracer_data || null;
                  const resume = viewDetail?.resume || null;
                  const isUnemployed = r.employment_status === "Unemployed";
                  const isNoRecord   = r.employment_status === "Not Yet Updated";

                  // Looks up any question's current answer regardless of
                  // whether it's a fixed-schema field (td.gender, etc.) or a
                  // custom/imported one (td.extra_answers[id]) — the same
                  // lookup works for every page on every college's form.
                  const answerFor = (q) => {
                    if (!td) return undefined;
                    if (Object.prototype.hasOwnProperty.call(td, q.id)) return td[q.id];
                    return td.extra_answers?.[q.id];
                  };
                  const renderQuestion = (q) => {
                    if (q.type === "static_text") return null;
                    const val = answerFor(q);
                    if (q.type === "rating_table") {
                      if (!val || !Object.values(val).some(Boolean)) return null;
                      return (
                        <div key={q.id} style={{ gridColumn: "1 / -1", marginBottom: 8 }}>
                          <div style={{ fontSize: 12, color: "#8a7377", fontWeight: 600, margin: "10px 8px 4px" }}>{q.label}</div>
                          <RecordRatingsTable ratings={val} rows={q.rows} />
                        </div>
                      );
                    }
                    // RecordField renders nothing for an empty value too, but
                    // that check has to happen here as well — otherwise a
                    // page whose only questions are unanswered still counts
                    // as "has content" at the array level (a real <RecordField>
                    // element isn't null even though it renders as one), and
                    // its section header shows with an empty card beneath it.
                    const isEmpty = Array.isArray(val) ? val.length === 0 : (!val && val !== 0);
                    if (isEmpty) return null;
                    return <RecordField key={q.id} label={q.label} value={val} />;
                  };

                  // Tracer data takes priority; fall back to AlumniEmployment stored values
                  const jobTitle = td?.occupationTitle || r.job_title    || "—";
                  const industry = td?.industryField   || r.industry     || "—";
                  const workLoc = r.work_location || td?.resolvedWorkLocation || "—";

                  // jobRelatedToDegree may be a full sentence — check startsWith 'yes'
                  const jrd = String(td?.jobRelatedToDegree || '').toLowerCase().trim();
                  const related = td?.jobRelatedToDegree
                    ? (jrd.startsWith('yes') ? "Yes" : "No")
                    : (r.job_related_to_course ? "Yes" : "No");

                  return (
                    <>
                      {/* Profile banner */}
                      <div style={{
                        position: "relative", overflow: "hidden",
                        display: "flex", alignItems: "center", gap: 18,
                        background: `linear-gradient(135deg, ${MAROON} 0%, #8b1a2e 100%)`,
                        borderRadius: 16, padding: "22px 24px", marginBottom: 16,
                        boxShadow: "0 6px 18px rgba(87,0,19,0.22)",
                      }}>
                        <div style={{ position: "absolute", top: -46, right: -30, width: 150, height: 150, borderRadius: "50%", background: "rgba(255,255,255,0.06)", pointerEvents: "none" }} />
                        <div style={{ position: "absolute", bottom: -60, right: 70, width: 110, height: 110, borderRadius: "50%", background: "rgba(255,255,255,0.05)", pointerEvents: "none" }} />
                        <AlumniAvatar url={r.avatarUrl} name={r.name} />
                        <div style={{ position: "relative", minWidth: 0 }}>
                          <div style={{ fontSize: 20, fontWeight: 800, color: "#fff", letterSpacing: "0.01em", overflowWrap: "anywhere" }}>{r.name}</div>
                          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.82)", marginTop: 4 }}>
                            {r.college ? `${r.college} · ` : ""}{r.course || "—"}{r.graduation_year ? ` · Batch ${r.graduation_year}` : ""}
                          </div>
                          <div style={{ marginTop: 9 }}><StatusBadge status={r.employment_status} /></div>
                        </div>
                      </div>

                      <RecordGroup title="Contact Information">
                        <RecordField label="Email" value={r.contact_email || r.email} />
                        <RecordField label="Contact Number" value={r.contact_number} />
                        <RecordLinkField label="Facebook" value={r.facebook} />
                        <RecordLinkField label="LinkedIn" value={r.linkedin} />
                      </RecordGroup>

                      <RecordGroup title="Employment Summary">
                        {!isUnemployed && !isNoRecord && (
                          <>
                            <RecordField label="Company Name" value={td?.companyName || r.company_name} />
                            <RecordField label="Job Title" value={jobTitle} />
                            <RecordField label="Industry" value={industry} />
                            <RecordField label="Work Location" value={workLoc} />
                            <RecordField label="Employment Type" value={td?.presentEmploymentType || r.employment_type} />
                            <RecordField label="Years in Job" value={td?.yearsInCurrentJob || r.years_in_current_job} />
                            <RecordField label="Related to Course" value={related} />
                            <RecordField label="Salary Range" value={r.salary_range} />
                            <RecordField label="Date Employed" value={r.date_employed ? fmtDate(r.date_employed) : ""} />
                          </>
                        )}
                        {isUnemployed && (
                          <RecordField label="Reason Unemployed" value={r.reason_unemployed} />
                        )}
                        <RecordField label="Last Updated" value={fmtDate(r.last_updated)} />
                      </RecordGroup>

                      {resume && (
                        <RecordGroup title="Profile / Resume">
                          <RecordField label="LinkedIn" value={resume.linkedin} />
                          <RecordMultilineField label="Summary" value={resume.summary} />
                          <RecordChips label="Skills" text={resume.skills} />
                          <RecordMultilineField label="Experience" value={resume.experience} />
                          <RecordMultilineField label="Education" value={resume.education} />
                          <RecordMultilineField label="Certifications" value={resume.certifications} />
                          <RecordMultilineField label="Projects" value={resume.projects} />
                          <RecordChips label="Languages" text={resume.languages} />
                          {!viewDetail?.resume_is_saved && (
                            <div style={{ fontSize: 11, color: "#9a8080", fontStyle: "italic", padding: "4px 8px" }}>
                              Suggested from their profile data — this alumnus hasn't saved a resume yet.
                            </div>
                          )}
                        </RecordGroup>
                      )}

                      {viewDetailLoading && (
                        <p style={{ fontSize: 13, color: "#9a8080", marginTop: 16 }}>Loading full tracer study record…</p>
                      )}

                      {td && tracerConfig && (
                        <>
                          {tracerConfig.pages.map((page) => {
                            const rendered = (page.questions || []).map(renderQuestion).filter(Boolean);
                            if (!rendered.length) return null;
                            return (
                              <RecordGroup key={page.id} title={page.title}>
                                {rendered}
                              </RecordGroup>
                            );
                          })}

                          {td.submittedAt && (
                            <div style={{ textAlign: "center", fontSize: 12, color: "#9a8080", marginTop: 4 }}>
                              Tracer study submitted: {fmtDate(td.submittedAt)}
                            </div>
                          )}
                        </>
                      )}

                      {!td && !viewDetailLoading && (
                        <p style={{ fontSize: 13, color: "#9a8080", marginTop: 16, textAlign: "center" }}>
                          This alumni hasn't submitted the tracer study form yet.
                        </p>
                      )}
                    </>
                  );
                })()}
              </div>

              <div className="modal-actions record-actions">
                <button type="button" onClick={() => setViewRecord(null)}>Close</button>
                <button type="button" onClick={() => printRecord(viewRecord)}>Print Record</button>
                <button
                  type="button"
                  style={{ background: "var(--maroon)", color: "#fff" }}
                  onClick={() => { setViewRecord(null); openEdit(viewDetail || viewRecord, viewDetail?.tracer_data, viewDetail?.new_question_ids); }}
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
            <h3>Edit Alumni Record — {editRecord?.name}</h3>
            <button type="button" onClick={() => setEditRecord(null)}>×</button>
          </div>
          {editRecord && (
            <form onSubmit={handleSaveEdit}>
              <div className="edit-record-form">

                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18, paddingBottom: 16, borderBottom: "1px solid #e4cccc" }}>
                  <AlumniAvatar url={editRecord.avatarUrl} name={editRecord.name} />
                  <div>
                    <button type="button" className="secondary-employment-btn" disabled={avatarBusy} onClick={() => avatarInputRef.current?.click()}>
                      {avatarBusy ? "Uploading…" : "Change Photo"}
                    </button>
                    <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={handleAvatarChange} />
                    <p style={{ fontSize: 11, color: "#9a8080", margin: "6px 0 0" }}>PNG, JPEG, GIF, or WEBP · max 2MB</p>
                  </div>
                </div>

                <div style={{ marginBottom: 18, paddingBottom: 16, borderBottom: "1px solid #e4cccc" }}>
                  <h4 style={{ color: "var(--maroon)", fontSize: 14, margin: "0 0 12px" }}>Contact Information</h4>
                  <div className="field-row">
                    <label>
                      Contact Email
                      <input
                        type="email"
                        value={editForm.contact_email}
                        onChange={e => setEditForm(f => ({ ...f, contact_email: e.target.value }))}
                        placeholder="you@example.com"
                      />
                    </label>
                    <label>
                      Contact Number
                      <input
                        type="tel"
                        value={editForm.contact_number}
                        onChange={e => setEditForm(f => ({ ...f, contact_number: e.target.value }))}
                        placeholder="09XX XXX XXXX"
                        maxLength={30}
                      />
                    </label>
                  </div>
                  <div className="field-row">
                    <label>
                      Facebook
                      <input
                        type="text"
                        value={editForm.facebook}
                        onChange={e => setEditForm(f => ({ ...f, facebook: e.target.value }))}
                        placeholder="facebook.com/name"
                      />
                    </label>
                    <label>
                      LinkedIn
                      <input
                        type="text"
                        value={editForm.linkedin}
                        onChange={e => setEditForm(f => ({ ...f, linkedin: e.target.value }))}
                        placeholder="linkedin.com/in/name"
                      />
                    </label>
                  </div>
                </div>

                <div style={{ marginBottom: 18, paddingBottom: 16, borderBottom: "1px solid #e4cccc" }}>
                  <h4 style={{ color: "var(--maroon)", fontSize: 14, margin: "0 0 12px" }}>Work Information</h4>
                  <div className="field-row">
                    <label>
                      Employment Status
                      <select
                        value={editForm.employment_status}
                        onChange={e => setEditForm(f => ({ ...f, employment_status: e.target.value }))}
                      >
                        <option value="Not Yet Updated">Not Yet Updated</option>
                        <option value="Employed">Employed</option>
                        <option value="Self-employed">Self-employed</option>
                        <option value="Unemployed">Unemployed</option>
                      </select>
                    </label>
                    <label>
                      Company Name
                      <input
                        type="text"
                        value={editForm.company_name}
                        onChange={e => setEditForm(f => ({ ...f, company_name: e.target.value }))}
                        placeholder="Company or business name"
                      />
                      {editErrors.company_name && <span className="field-error">{editErrors.company_name}</span>}
                    </label>
                  </div>

                  <div className="field-row">
                    <label>
                      Job Position
                      <input
                        type="text"
                        value={editForm.job_title}
                        onChange={e => setEditForm(f => ({ ...f, job_title: e.target.value }))}
                        placeholder="Your job title"
                      />
                      {editErrors.job_title && <span className="field-error">{editErrors.job_title}</span>}
                    </label>
                    <label>
                      Industry
                      <select
                        value={editForm.industry}
                        onChange={e => setEditForm(f => ({ ...f, industry: e.target.value }))}
                      >
                        <option value="">Select industry…</option>
                        {INDUSTRIES.map(ind => <option key={ind} value={ind}>{ind}</option>)}
                      </select>
                      {editErrors.industry && <span className="field-error">{editErrors.industry}</span>}
                    </label>
                  </div>

                  <div className="field-row">
                    <label>
                      Work Location
                      <input
                        type="text"
                        value={editForm.work_location}
                        onChange={e => setEditForm(f => ({ ...f, work_location: e.target.value }))}
                        placeholder="City, Province"
                      />
                      {editErrors.work_location && <span className="field-error">{editErrors.work_location}</span>}
                    </label>
                  </div>
                </div>

                {editForm.employment_status === "Unemployed" && (
                  <label style={{ display: "block", marginBottom: 18, paddingBottom: 16, borderBottom: "1px solid #e4cccc" }}>
                    Reason for Unemployment *
                    <textarea
                      value={editForm.reason_unemployed}
                      onChange={e => setEditForm(f => ({ ...f, reason_unemployed: e.target.value }))}
                      placeholder="Briefly describe the situation…"
                    />
                    {editErrors.reason_unemployed && <span className="field-error">{editErrors.reason_unemployed}</span>}
                  </label>
                )}

                <div style={{ marginBottom: 18, paddingBottom: 16, borderBottom: "1px solid #e4cccc" }}>
                  <h4 style={{ color: "var(--maroon)", fontSize: 14, margin: "0 0 12px" }}>Compensation</h4>
                  <div className="field-row">
                    <label>
                      Date Hired
                      <input
                        type="date"
                        value={editForm.date_employed}
                        onChange={e => setEditForm(f => ({ ...f, date_employed: e.target.value }))}
                      />
                    </label>
                    <label>
                      Monthly Salary
                      <select
                        value={editForm.salary_range}
                        onChange={e => setEditForm(f => ({ ...f, salary_range: e.target.value }))}
                      >
                        <option value="">Select a range…</option>
                        {editForm.salary_range && !SALARY_RANGES.includes(editForm.salary_range) && (
                          <option value={editForm.salary_range}>{editForm.salary_range}</option>
                        )}
                        {SALARY_RANGES.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </label>
                  </div>
                </div>

                <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid #e4cccc" }}>
                  <h4 style={{ color: "var(--maroon)", fontSize: 14, margin: "0 0 12px" }}>Qualifications</h4>
                  <label>
                    Skills
                    <SkillsEditor value={editForm.skills} onChange={(value) => setEditForm(f => ({ ...f, skills: value }))} />
                  </label>
                  <label style={{ marginTop: 10 }}>
                    Experience
                    <select
                      value={editForm.experience}
                      onChange={e => setEditForm(f => ({ ...f, experience: e.target.value }))}
                    >
                      <option value="">Select experience level…</option>
                      {editForm.experience && !EXPERIENCE_LEVELS.includes(editForm.experience) && (
                        <option value={editForm.experience}>{editForm.experience}</option>
                      )}
                      {EXPERIENCE_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </label>
                </div>

                {Object.keys(editTracerForm).length === 0 ? (
                  <p style={{ color: "var(--muted)", fontSize: 13, margin: "16px 0 0", paddingTop: 16, borderTop: "1px solid #e4cccc" }}>
                    This alumni hasn't submitted the tracer study form yet, so there's no tracer
                    record to edit here.
                  </p>
                ) : tracerConfig && (
                  <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid #e4cccc" }}>
                    <h4 style={{ color: "var(--maroon)", fontSize: 14, margin: "0 0 14px" }}>
                      Full Tracer Study Record
                      {editNewQuestionIds.length > 0 && (
                        <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 700, color: "#941527" }}>
                          — {editNewQuestionIds.length} new question{editNewQuestionIds.length !== 1 ? "s" : ""} detected
                        </span>
                      )}
                    </h4>
                    {tracerConfig.pages.map((page) => {
                      const editable = (page.questions || []).filter((q) => q.type !== "static_text");
                      if (!editable.length) return null;
                      return (
                        <div key={page.id} style={{ marginBottom: 18 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#8a7377", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
                            {page.title}
                          </div>
                          {editable.map((q) => (
                            <EditQuestionField
                              key={q.id}
                              q={q}
                              value={editTracerForm[q.id]}
                              onChange={(v) => setEditTracerForm((f) => ({ ...f, [q.id]: v }))}
                              isNew={editNewQuestionIds.includes(q.id)}
                            />
                          ))}
                        </div>
                      );
                    })}
                  </div>
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

      {cropSrc && <AvatarCropper src={cropSrc} busy={avatarBusy} onCancel={() => setCropSrc("")} onSave={uploadEditAvatar} />}

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