import React, { useState, useEffect, useRef, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import { jsPDF } from "jspdf";
import Icon from "../../components/common/Icon.jsx";
import { Modal } from "../../components/common/Primitives.jsx";
import ActionMenu from "../../components/admin/ActionMenu.jsx";
import AvatarCropper from "../../components/common/AvatarCropper.jsx";
import SkillsEditor from "../../components/common/SkillsEditor.jsx";

import { API, authHeaders } from "../../services/api.js";
import { COLLEGE_CODES as COLLEGES, COLLEGE_NAMES, COURSES_BY_COLLEGE } from "../../constants/colleges.js";

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

// resume.experience is a list; flattened to text for the row renderers.
function formatExperienceEntries(experience) {
  if (!Array.isArray(experience)) return "";
  return experience.map((entry) => {
    const titleLine = [entry.title, entry.company].filter(Boolean).join(" - ") + (entry.employment_type ? ` (${entry.employment_type})` : "");
    const lines = [titleLine];
    if (entry.meta) lines.push(entry.meta);
    String(entry.description || "").split("\n").map((s) => s.trim()).filter(Boolean).forEach((s) => lines.push(`• ${s}`));
    return lines.join("\n");
  }).join("\n\n");
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
const EMPTY_FILTERS   = { status: "", college: "", course: "", batch_year: "", date_updated: "" };
// Same lists as the alumni's Employment Details form; keep in sync.
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

// Alumni Record detail helpers
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

function NewQuestionTag() {
  return (
    <span style={{ background: "#941527", color: "#fff", fontSize: 10, fontWeight: 800, padding: "1px 7px", borderRadius: 999, marginLeft: 8 }}>
      NEW
    </span>
  );
}

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
  // Full tracer record as a flat question-id map; empty if the alumnus never submitted.
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

  // Sections come from the college's live form config, not a hardcoded list.
  const [tracerConfig, setTracerConfig] = useState(null);
  useEffect(() => {
    // Fall back to editRecord's college; opening Edit clears viewDetail.
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
      // Prefer r.work_location; tracerData.placeOfWork is only Local/Abroad.
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

  // Fetches the full record + form config itself so every download entry point gives a complete PDF.
  async function printRecord(rowRecord) {
    let r;
    try {
      const res = await fetch(`${API}/admin/employment/${rowRecord._id}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to load record.");
      r = data.record;
    } catch (err) {
      showToast(err.message || "Could not load the full record to download.");
      return;
    }

    let config = null;
    if (r.college) {
      try {
        const cfgRes  = await fetch(`${API}/admin/tracer-form-config?college=${encodeURIComponent(r.college)}`, { headers: authHeaders() });
        const cfgData = await cfgRes.json();
        config = cfgData.config || null;
      } catch { /* downloads without dynamic tracer sections if this fails */ }
    }

    const td     = r.tracer_data || null;
    const resume = r.resume || null;

    const fmt = (v) => {
      if (v === undefined || v === null || v === "") return "";
      if (Array.isArray(v)) return v.join(", ");
      if (typeof v === "object") return "";
      return String(v);
    };
    const fmtList = (v) => String(v || "").split(/[,;\n]/).map((s) => s.trim()).filter(Boolean).join(", ");
    const answerFor = (q) => {
      if (!td) return undefined;
      if (Object.prototype.hasOwnProperty.call(td, q.id)) return td[q.id];
      return td.extra_answers?.[q.id];
    };

    const doc = new jsPDF({ unit: "pt", format: "letter" });
    const marginX = 50;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const contentWidth = pageWidth - marginX * 2;
    const labelColWidth = 150;
    let y = 50;

    function ensureSpace(need) {
      if (y + need > pageHeight - 50) {
        doc.addPage();
        y = 50;
      }
    }

    function field(label, value, pre = false) {
      const v = fmt(value);
      if (!v) return;
      const valueWidth = contentWidth - labelColWidth;
      const wrapped = pre
        ? v.split("\n").map((l) => l.trim()).filter(Boolean).flatMap((l) => doc.splitTextToSize(l, valueWidth))
        : doc.splitTextToSize(v, valueWidth);
      // Wrap the label too, and advance by whichever side has more lines.
      const labelWrapped = doc.splitTextToSize(label, labelColWidth - 10);
      const lineCount = Math.max(labelWrapped.length, wrapped.length);
      ensureSpace(Math.max(14, lineCount * 13));
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(138, 115, 119);
      doc.text(labelWrapped, marginX, y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(45, 32, 36);
      doc.text(wrapped, marginX + labelColWidth, y);
      y += Math.max(14, lineCount * 13);
    }

    function sectionHeading(title) {
      ensureSpace(28);
      y += 6;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11.5);
      doc.setTextColor(87, 0, 19);
      doc.text(title.toUpperCase(), marginX, y);
      y += 5;
      doc.setDrawColor(240, 223, 226);
      doc.line(marginX, y, pageWidth - marginX, y);
      y += 14;
    }

    const isUnemployed = r.employment_status === "Unemployed";
    const isNoRecord   = r.employment_status === "Not Yet Updated";
    const jobTitle = td?.occupationTitle || r.job_title    || "";
    const industry = td?.industryField   || r.industry     || "";
    const workLoc = r.work_location || td?.resolvedWorkLocation || "";
    const jrd = String(td?.jobRelatedToDegree || "").toLowerCase().trim();
    const related = td?.jobRelatedToDegree ? (jrd.startsWith("yes") ? "Yes" : "No") : (r.job_related_to_course ? "Yes" : "No");

    // ── Header ───────────────────────────────────────────────────────────
    doc.setFillColor(87, 0, 19);
    doc.rect(0, 0, pageWidth, 74, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(255, 255, 255);
    doc.text(r.name || "", marginX, 34);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(255, 255, 255);
    const subtitle = [r.college, r.course, r.graduation_year ? `Batch ${r.graduation_year}` : ""].filter(Boolean).join("  ·  ");
    doc.text(subtitle, marginX, 51);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.text((r.employment_status || "Not Yet Updated").toUpperCase(), marginX, 66);
    y = 100;

    // ── Contact Information ─────────────────────────────────────────────
    if (fmt(r.contact_email || r.email) || fmt(r.contact_number) || fmt(r.facebook) || fmt(r.linkedin)) {
      sectionHeading("Contact Information");
      field("Email", r.contact_email || r.email);
      field("Contact Number", r.contact_number);
      field("Facebook", r.facebook);
      field("LinkedIn", r.linkedin);
      y += 6;
    }

    // ── Employment Summary ──────────────────────────────────────────────
    const summaryFields = [
      !isUnemployed && !isNoRecord ? ["Company Name", td?.companyName || r.company_name] : null,
      !isUnemployed && !isNoRecord ? ["Job Title", jobTitle] : null,
      !isUnemployed && !isNoRecord ? ["Industry", industry] : null,
      !isUnemployed && !isNoRecord ? ["Work Location", workLoc] : null,
      !isUnemployed && !isNoRecord ? ["Employment Type", td?.presentEmploymentType || r.employment_type] : null,
      !isUnemployed && !isNoRecord ? ["Years in Job", td?.yearsInCurrentJob || r.years_in_current_job] : null,
      !isUnemployed && !isNoRecord ? ["Related to Course", related] : null,
      !isUnemployed && !isNoRecord ? ["Salary Range", r.salary_range] : null,
      !isUnemployed && !isNoRecord && r.date_employed ? ["Date Employed", fmtDate(r.date_employed)] : null,
      isUnemployed ? ["Reason Unemployed", r.reason_unemployed] : null,
      ["Last Updated", fmtDate(r.last_updated)],
    ].filter((f) => f && fmt(f[1]));
    if (summaryFields.length) {
      sectionHeading("Employment Summary");
      summaryFields.forEach(([l, v]) => field(l, v));
      y += 6;
    }

    // ── Profile / Resume ─────────────────────────────────────────────────
    if (resume) {
      const resumeFields = [
        ["LinkedIn", resume.linkedin, false],
        ["Summary", resume.summary, true],
        ["Skills", fmtList(resume.skills), false],
        ["Experience", formatExperienceEntries(resume.experience), true],
        ["Education", resume.education, true],
        ["Certifications", resume.certifications, true],
        ["Projects", resume.projects, true],
        ["Languages", fmtList(resume.languages), false],
      ].filter(([, v]) => fmt(v));
      if (resumeFields.length) {
        sectionHeading("Profile / Resume");
        resumeFields.forEach(([l, v, pre]) => field(l, v, pre));
        y += 6;
      }
    }

    // ── Dynamic tracer sections (per this college's live form) ─────────
    if (td && config) {
      config.pages.forEach((page) => {
        const pageFields = [];
        (page.questions || [])
          .filter((q) => q.type !== "static_text")
          .forEach((q) => {
            if (q.type === "rating_table") {
              const val = answerFor(q);
              if (!val || !Object.values(val).some(Boolean)) return;
              (q.rows || []).filter((rr) => val[rr.key]).forEach((rr) => pageFields.push([rr.label, val[rr.key]]));
              return;
            }
            const v = answerFor(q);
            if (fmt(v)) pageFields.push([q.label, v]);
          });
        if (pageFields.length) {
          sectionHeading(page.title);
          pageFields.forEach(([l, v]) => field(l, v));
          y += 6;
        }
      });
    }

    // ── Footer ───────────────────────────────────────────────────────────
    ensureSpace(20);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8.5);
    doc.setTextColor(154, 128, 128);
    doc.text(`Generated ${new Date().toLocaleString("en-PH")} — Tarlac State University Alumni Portal`, pageWidth / 2, pageHeight - 24, { align: "center" });

    const filename = (r.name || "alumni-record").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    doc.save(`${filename}-record.pdf`);

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

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="admin-hero" aria-label="Alumni record header">
        <h1 className="admin-hero-title">Alumni Record</h1>
        <p className="admin-hero-subtitle">
          Every alumni's employment record in one place, searchable by name or filtered by type and status.
        </p>
      </div>

      {/* ── Employment Card ──────────────────────────────────────────────────── */}
      <section className="employment-card">

        {/* Search + filter row */}
        <div className="emp-search-row">
          <input
            className="emp-search"
            type="text"
            placeholder="Search by name…"
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
                        aria-label="Download record"
                        onClick={() => setConfirm({
                          open: true,
                          message: `Download employment record for ${r.name}?`,
                          onConfirm: () => { setConfirm(c => ({ ...c, open: false })); printRecord(r); },
                        })}
                      >
                        <span><Icon name="icon-download" /></span>
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
                            message: `Download employment record for ${r.name}?`,
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
                {COLLEGES.map(c => <option key={c} value={c}>{COLLEGE_NAMES[c]}</option>)}
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
                    // Filter empty values here too, or a page with no answers shows an empty section.
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
                          <RecordMultilineField label="Experience" value={formatExperienceEntries(resume.experience)} />
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
                <button type="button" onClick={() => printRecord(viewRecord)}>Download Record</button>
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
                        max={new Date().toISOString().slice(0, 10)}
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
                    <SkillsEditor value={editForm.skills} onChange={(value) => setEditForm(f => ({ ...f, skills: value }))} extractEndpoint="/admin/skills/extract" />
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
                      max={new Date().toISOString().slice(0, 10)}
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