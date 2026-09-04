import React, { useState, useEffect, useCallback, useRef } from "react";
import { useOutletContext } from "react-router-dom";
import Icon from "../../components/common/Icon.jsx";
import { Modal, ConfirmDialog } from "../../components/common/Primitives.jsx";
import AvatarCropper from "../../components/common/AvatarCropper.jsx";
import SkillsEditor from "../../components/common/SkillsEditor.jsx";
import { downloadCsv } from "./CoordinatorShared.jsx";

import { apiFetch, API, authHeaders } from "../../services/api.js";

const MAROON = "#570013";

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
// Same fixed lists the alumni's own Employment Details form uses — kept
// identical so a coordinator editing this on their behalf sees the exact
// same choices, not a different set that silently diverges over time.
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

const EMPTY_VALS = new Set(["N/A", "n/a", "None", "none", "null", "undefined", ""]);
function display(val) {
  return !val || EMPTY_VALS.has(String(val).trim()) ? "—" : val;
}

function CoordinatorStatusBadge({ status }) {
  const value = display(status);
  const cls = {
    Employed:          "employed",
    Unemployed:        "unemployed",
    "Self-employed":   "self-employed",
    "Not Yet Updated": "not-yet-updated",
  }[value] || "not-yet-updated";
  return <span className={`coord-status-pill coord-employment-status ${cls}`}>{value}</span>;
}

function timeAgo(date) {
  const diff = (Date.now() - new Date(date)) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min.`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr.`;
  return `${Math.floor(diff / 86400)}d`;
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-PH", { year: "numeric", month: "2-digit", day: "2-digit" });
}

// ── Alumni Record detail helpers — same look/behavior as the admin Alumni
// Record view/edit modal, adapted here for the coordinator's own page since
// the underlying data (fetched from /coordinator/employment/*, always
// scoped server-side to their assigned college) is the same shape. ─────────
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

  return (
    <div style={wrapStyle}>
      <label>
        {labelNode}
        <input type="text" value={value || ""} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}

export default function CoordinatorEmploymentView() {
  const { showToast } = useOutletContext();
  const [rows, setRows] = useState([]);
  const [activities, setActivities] = useState([]);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [course, setCourse] = useState("");
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const debounceRef = useRef(null);
  const requestIdRef = useRef(0);

  // ─── view / edit modals ─────────────────────────────────────────────────────
  const [viewRecord, setViewRecord]               = useState(null);
  const [viewDetail, setViewDetail]               = useState(null);
  const [viewDetailLoading, setViewDetailLoading] = useState(false);
  const [editRecord, setEditRecord]   = useState(null);
  const [editForm, setEditForm]       = useState({});
  const [editErrors, setEditErrors]   = useState({});
  const [editSaving, setEditSaving]   = useState(false);
  const [editTracerForm, setEditTracerForm] = useState({});
  const [editNewQuestionIds, setEditNewQuestionIds] = useState([]);
  const [tracerConfig, setTracerConfig] = useState(null);
  const [confirm, setConfirm] = useState({ open: false, message: "", onConfirm: null });
  // ─── edit record photo (coordinator setting it on an alumnus's behalf,
  // same crop flow as the alumni's own "Upload Photo") ────────────────────────
  const avatarInputRef = useRef(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [cropSrc, setCropSrc]       = useState("");

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const [emp, act] = await Promise.all([
        apiFetch("/coordinator/employment", {
          params: { search: appliedSearch, course, page, limit: 10 },
        }),
        apiFetch("/coordinator/employment/activity", { params: { limit: 10 } }),
      ]);
      if (requestIdRef.current !== requestId) return; // a newer request already landed
      setRows(emp.records ?? []);
      setPagination(emp.pagination ?? null);
      setActivities(act.activities ?? []);
    } catch {
      if (requestIdRef.current !== requestId) return;
      showToast?.("Failed to load employment data.");
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, [appliedSearch, course, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [appliedSearch, course]);

  // ── fetch full record + tracer_data when the view modal opens ───────────────
  useEffect(() => {
    if (!viewRecord) { setViewDetail(null); return; }
    setViewDetailLoading(true);
    setViewDetail(null);
    apiFetch(`/coordinator/employment/${viewRecord._id}`)
      .then(d => setViewDetail(d.record || null))
      .catch(() => {})
      .finally(() => setViewDetailLoading(false));
  }, [viewRecord]);

  // Their own college's live tracer form config — same dynamic, page-driven
  // rendering the admin Alumni Record uses, just always scoped to the one
  // college a coordinator manages (the endpoint ignores ?college= anyway).
  useEffect(() => {
    if (!viewRecord && !editRecord) { setTracerConfig(null); return; }
    apiFetch(`/coordinator/tracer-form-config`)
      .then(d => setTracerConfig(d.config || null))
      .catch(() => setTracerConfig(null));
  }, [viewRecord, editRecord]);

  function openEdit(r, tracerData = null, newQuestionIds = []) {
    setEditRecord(r);
    setEditNewQuestionIds(newQuestionIds || []);
    setEditForm({
      employment_status:     r.employment_status     || "Not Yet Updated",
      company_name:          tracerData?.companyName      || r.company_name          || "",
      job_title:             tracerData?.occupationTitle  || r.job_title             || "",
      industry:              tracerData?.industryField    || r.industry              || "",
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
      await apiFetch(`/coordinator/employment/${editRecord._id}`, { method: "PATCH", body: editForm });

      if (Object.keys(editTracerForm).length > 0) {
        try {
          await apiFetch(`/coordinator/employment/${editRecord._id}/tracer`, { method: "PATCH", body: editTracerForm });
        } catch (tracerErr) {
          throw new Error(tracerErr.message || "Employment details saved, but the tracer study fields failed to save.");
        }
      }

      showToast("Alumni record updated successfully.");
      setEditRecord(null);
      load();
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
      await apiFetch(`/coordinator/employment/${editRecord._id}/avatar`, { method: "PATCH", body: { avatarUrl } });
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

  // Same as the admin Alumni Record's row-level print — fetches the full
  // record + live tracer form config fresh every time so the printout is
  // always complete (avatar, tracer answers, resume), not just whatever the
  // list row already had in hand.
  async function printRecord(rowRecord) {
    const w = window.open("", "_blank");
    if (!w) { showToast(`${rowRecord.name} record is ready to print.`); return; }
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Alumni Record — ${rowRecord.name}</title></head><body style="font-family:Arial,sans-serif;padding:40px;color:#570013">Loading full record…</body></html>`);

    let r;
    try {
      const res = await fetch(`${API}/coordinator/employment/${rowRecord._id}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to load record.");
      r = data.record;
    } catch (err) {
      w.close();
      showToast(err.message || "Could not load the full record to print.");
      return;
    }

    let config = null;
    try {
      const cfgRes  = await fetch(`${API}/coordinator/tracer-form-config`, { headers: authHeaders() });
      const cfgData = await cfgRes.json();
      config = cfgData.config || null;
    } catch { /* prints without dynamic tracer sections if this fails */ }

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
    fetch(`${API}/coordinator/employment/log-print`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ alumni_name: r.name }),
    }).catch(() => {});
  }

  function handleSearchChange(e) {
    const val = e.target.value;
    setSearch(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setAppliedSearch(val), 400);
  }

  async function handleExport() {
    try {
      const data = await apiFetch("/coordinator/employment", {
        params: { search: appliedSearch, course, page: 1, limit: 99999 },
      });
      const all = data.records ?? [];
      downloadCsv("coordinator-employment-details.csv", [
        ["Name", "Course", "Position", "Status"],
        ...all.map((r) => [
          r.name,
          r.course ?? "",
          r.job_title ?? "",
          r.employment_status ?? "",
        ]),
      ]);
      showToast?.("Employment details exported.");
    } catch {
      showToast?.("Export failed.");
    }
  }

  return (
    <section
      className={`content coordinator-content view active-view`}
    >
      <section className="coord-records-card">
        <h3>Alumni Record</h3>

        <div className="coord-record-toolbar coord-employ-toolbar">
          <input
            type="search"
            className="coord-employ-search"
            placeholder="Search name or company…"
            value={search}
            onChange={handleSearchChange}
          />
          <select
            className="coord-employ-course-filter"
            value={course}
            onChange={(e) => setCourse(e.target.value)}
            aria-label="Filter by course"
          >
            <option value="">All Courses</option>
            <option value="BSIT">BSIT</option>
            <option value="BSCS">BSCS</option>
            <option value="BSIS">BSIS</option>
            <option value="BSIM">BSIM</option>
          </select>
        </div>

        {loading ? (
          <p className="coord-employ-empty">Loading…</p>
        ) : (
          <div className="coord-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Course</th>
                <th>Position</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="coord-employ-empty">
                    No records found.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row._id}>
                    <td data-label="Name">{display(row.name)}</td>
                    <td data-label="Course">{display(row.course)}</td>
                    <td data-label="Position">{display(row.job_title)}</td>
                    <td data-label="Status"><CoordinatorStatusBadge status={row.employment_status} /></td>
                    <td data-label="Actions">
                      <div className="desktop-row-actions">
                        <button
                          type="button"
                          className="table-icon table-print"
                          aria-label="Print record"
                          onClick={() => setConfirm({
                            open: true,
                            message: `Print employment record for ${row.name}?`,
                            onConfirm: () => { setConfirm(c => ({ ...c, open: false })); printRecord(row); },
                          })}
                        >
                          <span><Icon name="icon-19" /></span>
                        </button>
                        <button
                          type="button"
                          className="table-icon table-view"
                          aria-label="View record"
                          onClick={() => setViewRecord(row)}
                        >
                          <span><Icon name="icon-20" /></span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        )}

        {pagination && (
          <div className="coord-employ-pagination">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              ‹ Prev
            </button>
            <span>
              Page {page} of {pagination.pages}
            </span>
            <button
              disabled={page >= pagination.pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next ›
            </button>
          </div>
        )}

        <div className="coord-record-actions">
          <button type="button" onClick={handleExport} className="btn btn-primary">
            <Icon name="icon-export" /> Export
          </button>
        </div>
      </section>

      <section className="coord-card coord-activity">
        <h3>Recent Activities</h3>
        <div className="coord-activity-list">
          {activities.length === 0 ? (
            <p className="coord-employ-empty">No recent activity.</p>
          ) : (
            activities.map((a, i) => (
              <div
                className="coord-activity-row"
                key={`${a._id ?? i}`}
              >
                <span>
                  <strong className="coord-activity-name">{a.user_name}</strong>{" "}
                  {a.action}
                  {a.target_name ? ` — ${a.target_name}` : ""}
                </span>
                <span className="coord-activity-time">
                  {timeAgo(a.createdAt)}
                </span>
              </div>
            ))
          )}
        </div>
      </section>

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
                    const isEmpty = Array.isArray(val) ? val.length === 0 : (!val && val !== 0);
                    if (isEmpty) return null;
                    return <RecordField key={q.id} label={q.label} value={val} />;
                  };

                  const jobTitle = td?.occupationTitle || r.job_title    || "—";
                  const industry = td?.industryField   || r.industry     || "—";
                  const workLoc = r.work_location || td?.resolvedWorkLocation || "—";

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
                          <div style={{ marginTop: 9 }}><CoordinatorStatusBadge status={r.employment_status} /></div>
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

      {cropSrc && <AvatarCropper src={cropSrc} busy={avatarBusy} onCancel={() => setCropSrc("")} onSave={uploadEditAvatar} />}

      <ConfirmDialog
        open={confirm.open}
        message={confirm.message}
        onConfirm={confirm.onConfirm}
        onCancel={() => setConfirm(c => ({ ...c, open: false }))}
      />
    </section>
  );
}
