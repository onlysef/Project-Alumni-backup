import { useState, useEffect, useCallback, useRef } from "react";
import { useOutletContext } from "react-router-dom";
import { Modal } from "../../components/common/Primitives.jsx";
import { CollegePill, CoursePill, EmploymentStatusPill } from "../../components/common/TracerPills.jsx";
import { API, authHeaders } from "../../services/api.js";

const MAROON = "#570013";
const GOLD   = "#fac853";

const BASE_COLLEGES = ["CCS","CIT","CAFA","COED","CCJE","CPAG","CBA","CASS","COS","COE"];

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "2-digit" });
}

function mapStatus(raw) {
  if (raw === "Yes")            return "Employed";
  if (raw === "No")             return "Not Employed";
  if (raw === "Never Employed") return "Never Employed";
  return raw || "—";
}

// ── Detail view helpers ────────────────────────────────────────────────────────

function Section({ title }) {
  return (
    <div style={{ borderLeft: `3px solid ${MAROON}`, paddingLeft: 10, margin: "18px 0 10px" }}>
      <strong style={{ fontSize: 13, color: MAROON, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {title}
      </strong>
    </div>
  );
}

function Field({ label, value }) {
  const v = Array.isArray(value) ? value.join(", ") : value;
  if (!v && v !== 0) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: "4px 12px", marginBottom: 8, fontSize: 13 }}>
      <span style={{ color: "#76656a", fontWeight: 600 }}>{label}</span>
      <span style={{ color: "#2d2024", wordBreak: "break-word" }}>{v}</span>
    </div>
  );
}

function RatingsTable({ ratings }) {
  const entries = Object.entries(ratings || {}).filter(([, v]) => v);
  if (!entries.length) return null;
  const labels = {
    technicalSkills:        "Technical Skills",
    problemSolvingSkills:   "Problem Solving",
    communicationSkills:    "Communication",
    projectManagement:      "Project Management",
    teamworkCollaboration:  "Teamwork",
    adaptability:           "Adaptability",
    workLifeBalance:        "Work-Life Balance",
    criticalThinkingSkills: "Critical Thinking",
  };
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 8 }}>
      <thead>
        <tr>
          <th style={{ textAlign: "left", padding: "6px 10px", background: MAROON, color: "#fff", borderRadius: "4px 0 0 0", width: "55%" }}>Competency</th>
          <th style={{ textAlign: "left", padding: "6px 10px", background: MAROON, color: "#fff", borderRadius: "0 4px 0 0" }}>Rating</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([key, val], i) => (
          <tr key={key} style={{ background: i % 2 === 0 ? "#faf5f5" : "#fff" }}>
            <td style={{ padding: "5px 10px", color: "#2d2024" }}>{labels[key] || key}</td>
            <td style={{ padding: "5px 10px", color: "#2d2024", fontWeight: 600 }}>{val}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DetailModal({ response, onClose }) {
  const [questionLabels, setQuestionLabels] = useState({});
  const college = response?.alumni?.college;

  // Map custom-question ids to their current labels.
  useEffect(() => {
    if (!college) { setQuestionLabels({}); return; }
    fetch(`${API}/admin/tracer-form-config?college=${encodeURIComponent(college)}`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => {
        const map = {};
        (d.config?.pages || []).forEach(p => (p.questions || []).forEach(q => { map[q.id] = q.label; }));
        setQuestionLabels(map);
      })
      .catch(() => setQuestionLabels({}));
  }, [college]);

  if (!response) return null;
  const r    = response;
  const user = r.alumni || {};
  const isEmployed     = r.employmentStatus === "Yes";
  const isNeverEmployed = r.employmentStatus === "Never Employed";

  return (
    <Modal open onClose={onClose}>
      <div style={{
        width: "min(700px, 96vw)",
        maxHeight: "88vh",
        display: "flex",
        flexDirection: "column",
        background: "#fff",
        borderRadius: 12,
        boxShadow: "0 8px 40px rgba(0,0,0,0.22)",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          background: `linear-gradient(135deg, ${MAROON} 0%, #8b1a2e 100%)`,
          color: "#fff",
          padding: "16px 22px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: GOLD }}>Tracer Form Response</div>
            <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>
              {user.firstName} {user.lastName}
              {user.course ? ` · ${user.course}` : ""}
              {user.college ? ` · ${user.college}` : ""}
              {user.graduationYear ? ` · Batch ${user.graduationYear}` : ""}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.15)", border: "none", color: "#fff",
              width: 32, height: 32, borderRadius: 6, cursor: "pointer",
              fontSize: 18, lineHeight: "32px", textAlign: "center",
            }}
          >×</button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "6px 22px 22px" }}>

          <Section title="A · Personal Information" />
          <Field label="Contact Number" value={r.contactNumber} />
          <Field label="Gender"         value={r.gender} />

          <Section title="B · Educational Background" />
          <Field label="Programs Completed"    value={r.programsCompleted} />
          <Field label="Passed Professional Exam" value={r.professionalExam} />
          {r.professionalExam === "Yes" && (
            <Field label="Exam Name" value={r.professionalExamName} />
          )}

          <Section title="C · Employment" />
          <Field label="Employment Status" value={mapStatus(r.employmentStatus)} />

          {isEmployed && (
            <>
              <Field label="Place of Work"       value={r.placeOfWork} />
              <Field label="Occupation / Title"  value={r.occupationTitle} />
              <Field label="Industry"            value={r.industryField} />
              <Field label="Employment Type"     value={r.presentEmploymentType} />
              <Field label="Job Related to Degree" value={r.jobRelatedToDegree} />
              <Field label="Years in Current Job"  value={r.yearsInCurrentJob} />
            </>
          )}
          {!isEmployed && !isNeverEmployed && r.reasonsNotEmployed?.length > 0 && (
            <Field label="Reasons Not Employed" value={r.reasonsNotEmployed} />
          )}
          {isNeverEmployed && r.reasonsNotEmployed?.length > 0 && (
            <Field label="Reasons Never Employed" value={r.reasonsNotEmployed} />
          )}

          <Section title="D · Personal Growth" />
          <Field label="Further Education"      value={r.furtherEducation} />
          {r.furtherEducation === "Yes" && (
            <Field label="Education Type" value={r.furtherEducationType} />
          )}
          <Field label="Pursued Trainings"      value={r.pursuedTrainings} />
          {r.pursuedTrainings === "Yes" && (
            <Field label="Training Type" value={r.trainingType} />
          )}
          {Object.values(r.personalGrowthRatings || {}).some(Boolean) && (
            <>
              <div style={{ fontSize: 12, color: "#76656a", fontWeight: 600, marginTop: 8, marginBottom: 4 }}>
                Competency Self-Ratings
              </div>
              <RatingsTable ratings={r.personalGrowthRatings} />
            </>
          )}

          <Section title="E · Professional Growth" />
          <Field label="Promoted in Job"                   value={r.promotedInJob} />
          <Field label="Significant Accomplishments"       value={r.significantAccomplishments} />
          <Field label="Professional Certifications"       value={r.professionalCertifications} />
          <Field label="Development Activities"            value={r.professionalDevelopmentActivities} />

          {Object.keys(r.extra_answers || {}).length > 0 && (
            <>
              <Section title="Additional Answers" />
              {Object.entries(r.extra_answers).map(([k, v]) => (
                <Field key={k} label={questionLabels[k] || k} value={Array.isArray(v) ? v.join(", ") : String(v ?? "")} />
              ))}
            </>
          )}

          <div style={{ marginTop: 18, paddingTop: 12, borderTop: "1px solid #e4cccc", fontSize: 12, color: "#76656a" }}>
            Submitted: {fmtDate(r.submittedAt)}
          </div>
        </div>

        <div style={{ padding: "12px 22px", borderTop: "1px solid #e4cccc", display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: MAROON, color: "#fff", border: "none",
              borderRadius: 7, padding: "8px 22px", fontWeight: 600,
              fontSize: 13, cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function TracerResponsesView() {
  const { showToast } = useOutletContext();

  const [responses, setResponses]       = useState([]);
  const [loading, setLoading]           = useState(false);
  const [page, setPage]                 = useState(1);
  const [total, setTotal]               = useState(0);
  const [pages, setPages]               = useState(0);

  const [searchInput, setSearchInput]   = useState("");
  const [search, setSearch]             = useState("");
  const [college, setCollege]           = useState("");
  const [colleges, setColleges]         = useState([]);
  const [batch, setBatch]               = useState("");
  const [batches, setBatches]           = useState([]);
  const [dateFrom, setDateFrom]         = useState("");
  const [dateTo, setDateTo]             = useState("");

  const [detail, setDetail]             = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const LIMIT       = 10;
  const searchTimer = useRef(null);

  useEffect(() => {
    fetch(`${API}/admin/employment/responses/colleges`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => {
        const merged = [...new Set([...BASE_COLLEGES, ...(d.colleges || [])])].sort();
        setColleges(merged);
        setBatches(d.batches || []);
      })
      .catch(() => setColleges([...BASE_COLLEGES]));
  }, []);

  // Debounce search
  useEffect(() => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setSearch(searchInput); setPage(1); }, 350);
    return () => clearTimeout(searchTimer.current);
  }, [searchInput]);

  const fetchResponses = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        search, college, batch, date_from: dateFrom, date_to: dateTo,
        page, limit: LIMIT,
      });
      const res  = await fetch(`${API}/admin/employment/responses?${params}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setResponses(data.responses || []);
      setTotal(data.pagination?.total ?? 0);
      setPages(data.pagination?.pages ?? 1);
    } catch (err) {
      showToast(err.message || "Failed to load responses.");
    } finally {
      setLoading(false);
    }
  }, [search, college, batch, dateFrom, dateTo, page]);

  useEffect(() => { fetchResponses(); }, [fetchResponses]);

  async function handleViewAnswer(alumni_id) {
    setDetailLoading(true);
    try {
      const res  = await fetch(`${API}/admin/employment/responses/${alumni_id}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) { showToast(data.message || "Failed to load response."); return; }
      setDetail(data.response);
    } catch {
      showToast("Could not connect to server.");
    } finally {
      setDetailLoading(false);
    }
  }

  const from = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const to   = Math.min(page * LIMIT, total);
  const hasActiveFilters = Boolean(college || batch || dateFrom || dateTo || search);

  return (
    <section className="content tracer-responses-view view active-view">
      <div className="admin-hero" aria-label="Tracer responses header">
        <h1 className="admin-hero-title">Tracer Form Responses</h1>
        <p className="admin-hero-subtitle">
          Browse every alumni tracer study submission, search by name, filter by college and
          submission date, and open a response to see the full answer sheet.
        </p>
      </div>

      <section className="employment-card">
        <div className="emp-search-row tracer-filter-row">
          <input
            type="text"
            className="emp-search"
            placeholder="Search by name…"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
          />
          <select className="table-filter tracer-filter-select" value={college} onChange={e => { setCollege(e.target.value); setPage(1); }}>
            <option value="">All colleges</option>
            {colleges.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="table-filter tracer-filter-select" value={batch} onChange={e => { setBatch(e.target.value); setPage(1); }}>
            <option value="">All batches</option>
            {batches.map(b => <option key={b} value={b}>Batch {b}</option>)}
          </select>
          <div className="tracer-date-range">
            <span className="tracer-date-label">Date:</span>
            <input
              type="date"
              title="Date submitted from"
              value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); setPage(1); }}
              className="emp-search tracer-date-input"
            />
            <span className="tracer-date-label">–</span>
            <input
              type="date"
              title="Date submitted to"
              value={dateTo}
              onChange={e => { setDateTo(e.target.value); setPage(1); }}
              className="emp-search tracer-date-input"
            />
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              className="see-toggle tracer-clear-btn"
              onClick={() => {
                setCollege(""); setBatch("");
                setDateFrom(""); setDateTo("");
                setSearchInput(""); setSearch("");
                setPage(1);
              }}
            >
              Clear Filters
            </button>
          )}
        </div>

        <table className="employment-table tracer-responses-table" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th>Name</th>
              <th>College</th>
              <th>Course</th>
              <th>Status</th>
              <th>Date Submitted</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="emp-loading">Loading responses…</td></tr>
            ) : responses.length === 0 ? (
              <tr><td colSpan={6} className="emp-empty">No tracer form submissions found.</td></tr>
            ) : responses.map(r => (
              <tr key={r._id}>
                <td data-label="Name">{r.name}</td>
                <td data-label="College"><CollegePill college={r.college} /></td>
                <td data-label="Course"><CoursePill course={r.course} /></td>
                <td data-label="Status"><EmploymentStatusPill status={r.employmentStatus} /></td>
                <td data-label="Date Submitted">{fmtDate(r.submittedAt)}</td>
                <td data-label="Actions">
                  <button
                    type="button"
                    disabled={detailLoading}
                    onClick={() => handleViewAnswer(r.alumni_id)}
                    style={{
                      background: MAROON, color: "#fff", border: "none",
                      borderRadius: 6, padding: "5px 13px",
                      fontSize: 12, fontWeight: 600, cursor: "pointer",
                      opacity: detailLoading ? 0.6 : 1,
                    }}
                  >
                    View Answer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="tracer-response-cards">
          {loading ? (
            <p className="emp-loading">Loading responses…</p>
          ) : responses.length === 0 ? (
            <p className="emp-empty">No tracer form submissions found.</p>
          ) : responses.map(r => (
            <article className="tracer-response-card" key={r._id}>
              <div className="tracer-response-card-head">
                <strong>{r.name}</strong>
                <span className="tracer-response-card-pills">
                  <CollegePill college={r.college} />
                  <CoursePill course={r.course} />
                  <EmploymentStatusPill status={r.employmentStatus} />
                </span>
              </div>
              <div className="tracer-response-card-date">Submitted {fmtDate(r.submittedAt)}</div>
              <button
                type="button"
                className="tracer-response-card-btn"
                disabled={detailLoading}
                onClick={() => handleViewAnswer(r.alumni_id)}
              >
                View Answer
              </button>
            </article>
          ))}
        </div>

        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 4px 0", flexWrap: "wrap", gap: 8,
        }}>
          <span style={{ fontSize: 12, color: "#76656a" }}>
            {total > 0 ? `Showing ${from}–${to} of ${total} response${total !== 1 ? "s" : ""}` : "No responses found"}
          </span>
          {pages > 1 && (
            <div className="emp-pagination-controls">
              <button className="emp-pagination-btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>‹</button>
              {Array.from({ length: Math.min(pages, 5) }, (_, i) => {
                const start = Math.max(1, Math.min(page - 2, pages - 4));
                return start + i;
              }).filter(p => p >= 1 && p <= pages).map(p => (
                <button
                  key={p}
                  className={`emp-pagination-btn${p === page ? " active" : ""}`}
                  onClick={() => setPage(p)}
                >{p}</button>
              ))}
              <button className="emp-pagination-btn" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>›</button>
            </div>
          )}
        </div>
      </section>

      {detail && <DetailModal response={detail} onClose={() => setDetail(null)} />}
    </section>
  );
}
