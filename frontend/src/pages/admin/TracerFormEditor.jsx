import { useState, useEffect, useCallback } from "react";
import { Modal } from "../../components/common/Primitives.jsx";

import { API, authHeaders } from "../../services/api.js";
const MAROON = "#570013";
const GOLD = "#fac853";

// ── helper: auto-generate a camelCase key from a label string ─────────────────
function toKey(str) {
  return (
    "q_" +
    str
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .trim()
      .replace(/\s+(.)/g, (_, c) => c.toUpperCase())
      .replace(/\s/g, "")
      .slice(0, 30) +
    "_" +
    Date.now().toString(36)
  );
}

// Question types available to the admin
const Q_TYPES = [
  { value: "text",         label: "Text input" },
  { value: "textarea",     label: "Multiline text" },
  { value: "radio",        label: "Radio buttons" },
  { value: "checkbox",     label: "Checkboxes (multi-select)" },
  { value: "select",       label: "Dropdown" },
  { value: "rating_table", label: "Rating / scale table" },
  { value: "static_text",  label: "Static text block" },
];

const BLANK_QUESTION = {
  type: "radio",
  label: "",
  options: [],
  required: false,
  rows: [],
  ratingOptions: [],
  content: "",
};

// ── Inline styles ─────────────────────────────────────────────────────────────
const s = {
  modal: {
    width: "min(960px, 96vw)",
    maxHeight: "90vh",
    display: "flex",
    flexDirection: "column",
    background: "#fff",
    borderRadius: 12,
    boxShadow: "0 8px 40px rgba(0,0,0,0.22)",
    overflow: "hidden",
  },
  header: {
    background: `linear-gradient(135deg, ${MAROON} 0%, #8b1a2e 100%)`,
    color: "#fff",
    padding: "16px 24px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexShrink: 0,
  },
  headerTitle: { fontWeight: 700, fontSize: 17, color: GOLD, letterSpacing: "0.02em" },
  closeBtn: {
    background: "rgba(255,255,255,0.15)",
    border: "none",
    color: "#fff",
    width: 32,
    height: 32,
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 18,
    lineHeight: "32px",
    textAlign: "center",
  },
  tabs: {
    display: "flex",
    borderBottom: `2px solid ${MAROON}22`,
    background: "#fdf8f8",
    flexShrink: 0,
    overflowX: "auto",
    padding: "0 16px",
  },
  tab: (active) => ({
    padding: "10px 16px",
    fontSize: 12,
    fontWeight: active ? 700 : 500,
    color: active ? MAROON : "#76656a",
    borderBottom: active ? `2px solid ${MAROON}` : "2px solid transparent",
    background: "none",
    border: "none",
    cursor: "pointer",
    whiteSpace: "nowrap",
    marginBottom: -2,
    transition: "color 0.15s",
  }),
  body: {
    flex: 1,
    overflowY: "auto",
    padding: "20px 24px",
  },
  pageTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 18,
  },
  pageTitleInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: 700,
    color: MAROON,
    border: `1.5px solid ${MAROON}40`,
    borderRadius: 6,
    padding: "6px 10px",
    fontFamily: "inherit",
    outline: "none",
  },
  qCard: {
    border: "1px solid #e4cccc",
    borderRadius: 8,
    marginBottom: 8,
    background: "#fff",
    overflow: "hidden",
  },
  qCardHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    background: "#fdf9f9",
    borderBottom: "1px solid #f3e8e8",
  },
  typeBadge: {
    fontSize: 10,
    fontWeight: 700,
    padding: "2px 8px",
    borderRadius: 99,
    background: `${MAROON}18`,
    color: MAROON,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    flexShrink: 0,
  },
  qLabel: {
    flex: 1,
    fontSize: 13,
    color: "#2d2024",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontWeight: 500,
  },
  iconBtn: (variant) => ({
    width: 28,
    height: 28,
    border: "1px solid",
    borderColor:
      variant === "danger" ? "#e8aaaa" : variant === "success" ? "#aaddc2" : "#e4cccc",
    borderRadius: 5,
    background:
      variant === "danger" ? "#fff5f5" : variant === "success" ? "#f0fbf6" : "#fff",
    color:
      variant === "danger" ? "#8a1f2f" : variant === "success" ? "#1f6b45" : "#76656a",
    cursor: "pointer",
    fontSize: 13,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  }),
  qBody: { padding: "12px 14px" },
  fieldLabel: {
    display: "block",
    fontSize: 11,
    fontWeight: 700,
    color: MAROON,
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  input: {
    width: "100%",
    padding: "7px 10px",
    border: "1px solid #d1b8bb",
    borderRadius: 6,
    fontSize: 13,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box",
    color: "#2d2024",
  },
  textarea: {
    width: "100%",
    padding: "7px 10px",
    border: "1px solid #d1b8bb",
    borderRadius: 6,
    fontSize: 13,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box",
    resize: "vertical",
    minHeight: 80,
    color: "#2d2024",
  },
  fieldRow: { marginBottom: 10 },
  row: { display: "flex", gap: 10, flexWrap: "wrap" },
  selectInput: {
    padding: "7px 10px",
    border: "1px solid #d1b8bb",
    borderRadius: 6,
    fontSize: 13,
    fontFamily: "inherit",
    color: "#2d2024",
    outline: "none",
    background: "#fff",
  },
  checkLabel: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    color: "#374151",
  },
  editActions: {
    display: "flex",
    gap: 8,
    marginTop: 12,
    paddingTop: 10,
    borderTop: "1px solid #f3e8e8",
  },
  primaryBtn: {
    padding: "7px 18px",
    borderRadius: 6,
    border: "none",
    background: MAROON,
    color: "#fff",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
  },
  secondaryBtn: {
    padding: "7px 14px",
    borderRadius: 6,
    border: "1px solid #d1b8bb",
    background: "#fff",
    color: "#76656a",
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
  },
  addQBtn: {
    width: "100%",
    padding: "10px",
    border: `1.5px dashed ${MAROON}50`,
    borderRadius: 8,
    background: `${MAROON}06`,
    color: MAROON,
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
    marginTop: 4,
  },
  footer: {
    padding: "14px 24px",
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
    borderTop: "1px solid #f0e6e6",
    flexShrink: 0,
    background: "#fdf9f9",
  },
  hint: { fontSize: 11, color: "#9a8080", marginTop: 3 },
};

// ── QuestionCard ──────────────────────────────────────────────────────────────
function QuestionCard({ q, qIdx, pageIdx, totalQ, onUpdate, onDelete, onMove, allQuestions = [] }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [error, setError] = useState("");

  function startEdit() {
    setForm({
      ...q,
      optionsText: Array.isArray(q.options) ? q.options.join("\n") : "",
      rowsText: Array.isArray(q.rows) ? q.rows.map((r) => r.label).join("\n") : "",
      ratingOptionsText: Array.isArray(q.ratingOptions) ? q.ratingOptions.join("\n") : "",
    });
    setError("");
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setForm({});
    setError("");
  }

  function saveEdit() {
    const lines = (str) =>
      (str || "")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

    const effectiveType = form.type ?? q.type;
    const options = ["radio", "checkbox", "select"].includes(effectiveType)
      ? lines(form.optionsText)
      : [];

    // A radio/checkbox/select question with zero options renders no
    // selectable choices at all — if it's also required, alumni can never
    // satisfy it, permanently blocking the tracer form for that college.
    if (["radio", "checkbox", "select"].includes(effectiveType) && options.length === 0) {
      setError("Add at least one option (one per line) — this question type needs selectable choices.");
      return;
    }
    setError("");

    const updated = {
      ...q,
      type: effectiveType,
      label: form.label ?? q.label,
      content: form.content ?? q.content,
      placeholder: form.placeholder ?? q.placeholder,
      required: form.required ?? q.required,
      showIf: form.showIf || null,
      options,
      rows:
        effectiveType === "rating_table"
          ? lines(form.rowsText).map((label) => ({
              key: label
                .toLowerCase()
                .replace(/[^a-z0-9 ]/g, "")
                .trim()
                .replace(/\s+(.)/g, (_, c) => c.toUpperCase())
                .replace(/\s/g, ""),
              label,
            }))
          : q.rows || [],
      ratingOptions:
        effectiveType === "rating_table" ? lines(form.ratingOptionsText) : [],
    };
    onUpdate(updated);
    setEditing(false);
  }

  const typeLabel = Q_TYPES.find((t) => t.value === q.type)?.label ?? q.type;
  const previewLabel =
    q.type === "static_text"
      ? (q.content || "").slice(0, 80) + (q.content?.length > 80 ? "…" : "")
      : (q.label || "").slice(0, 100) + ((q.label?.length ?? 0) > 100 ? "…" : "");

  return (
    <div style={s.qCard}>
      <div style={s.qCardHeader}>
        <span style={s.typeBadge}>{typeLabel}</span>
        <span style={s.qLabel} title={q.label || q.content}>
          {previewLabel || <em style={{ color: "#c0a0a5" }}>Untitled</em>}
        </span>
        {q.required && (
          <span style={{ ...s.typeBadge, background: "#fff0f0", color: "#b04050" }}>
            Required
          </span>
        )}
        <button
          type="button"
          style={s.iconBtn()}
          title="Move up"
          disabled={qIdx === 0}
          onClick={() => onMove("up")}
        >
          ↑
        </button>
        <button
          type="button"
          style={s.iconBtn()}
          title="Move down"
          disabled={qIdx === totalQ - 1}
          onClick={() => onMove("down")}
        >
          ↓
        </button>
        <button
          type="button"
          style={s.iconBtn()}
          title="Edit question"
          onClick={editing ? cancelEdit : startEdit}
        >
          {editing ? "✕" : "✎"}
        </button>
        <button
          type="button"
          style={s.iconBtn("danger")}
          title="Delete question"
          onClick={() => onDelete()}
        >
          🗑
        </button>
      </div>

      {editing && (
        <div style={s.qBody}>
          {/* Type */}
          <div style={s.fieldRow}>
            <label style={s.fieldLabel}>Question Type</label>
            <select
              style={s.selectInput}
              value={form.type ?? q.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
            >
              {Q_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* Static text content */}
          {(form.type ?? q.type) === "static_text" ? (
            <div style={s.fieldRow}>
              <label style={s.fieldLabel}>Content (plain text)</label>
              <textarea
                style={{ ...s.textarea, minHeight: 120 }}
                value={form.content ?? q.content ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                placeholder="Enter the static text to display…"
              />
            </div>
          ) : (
            <>
              {/* Label */}
              <div style={s.fieldRow}>
                <label style={s.fieldLabel}>Question Text / Label</label>
                <textarea
                  style={s.textarea}
                  value={form.label ?? q.label ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                  placeholder="Enter the question text…"
                />
              </div>

              {/* Placeholder (text/textarea only) */}
              {["text", "textarea"].includes(form.type ?? q.type) && (
                <div style={s.fieldRow}>
                  <label style={s.fieldLabel}>Placeholder (optional)</label>
                  <input
                    style={s.input}
                    type="text"
                    value={form.placeholder ?? q.placeholder ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, placeholder: e.target.value }))}
                    placeholder="e.g. Enter your answer"
                  />
                </div>
              )}

              {/* Options (radio / checkbox / select) */}
              {["radio", "checkbox", "select"].includes(form.type ?? q.type) && (
                <div style={s.fieldRow}>
                  <label style={s.fieldLabel}>Options (one per line)</label>
                  <textarea
                    style={s.textarea}
                    value={form.optionsText ?? (q.options || []).join("\n")}
                    onChange={(e) => {
                      const val = e.target.value;
                      setForm((f) => ({ ...f, optionsText: val }));
                      if (error) setError("");
                    }}
                    placeholder={"Option A\nOption B\nOption C"}
                  />
                  <p style={s.hint}>Each line becomes one selectable option.</p>
                </div>
              )}

              {/* Rating table rows + rating options */}
              {(form.type ?? q.type) === "rating_table" && (
                <>
                  <div style={s.fieldRow}>
                    <label style={s.fieldLabel}>Row Labels (one per line)</label>
                    <textarea
                      style={s.textarea}
                      value={form.rowsText ?? (q.rows || []).map((r) => r.label).join("\n")}
                      onChange={(e) => setForm((f) => ({ ...f, rowsText: e.target.value }))}
                      placeholder={"Technical Skills\nProblem-Solving Skills\n…"}
                    />
                    <p style={s.hint}>Each line = one row in the rating table.</p>
                  </div>
                  <div style={s.fieldRow}>
                    <label style={s.fieldLabel}>Rating Scale Columns (one per line)</label>
                    <textarea
                      style={{ ...s.textarea, minHeight: 60 }}
                      value={
                        form.ratingOptionsText ??
                        (q.ratingOptions || []).join("\n")
                      }
                      onChange={(e) =>
                        setForm((f) => ({ ...f, ratingOptionsText: e.target.value }))
                      }
                      placeholder={"Excellent\nCompetent\nSatisfactory\n…"}
                    />
                  </div>
                </>
              )}

              {/* Required toggle */}
              <div style={s.fieldRow}>
                <label style={s.checkLabel}>
                  <input
                    type="checkbox"
                    checked={form.required ?? q.required ?? false}
                    onChange={(e) => setForm((f) => ({ ...f, required: e.target.checked }))}
                  />
                  Required — alumni cannot skip this question
                </label>
              </div>
            </>
          )}

          {/* Conditional display */}
          <div style={{ ...s.fieldRow, marginTop: 14, paddingTop: 12, borderTop: "1px solid #f3e8e8" }}>
            <label style={{ ...s.fieldLabel, marginBottom: 8 }}>Conditional Display</label>
            <label style={s.checkLabel}>
              <input
                type="checkbox"
                checked={!!(form.showIf ?? q.showIf)}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    showIf: e.target.checked
                      ? (q.showIf || { questionId: "", values: [] })
                      : null,
                  }))
                }
              />
              Only show when another question has a specific answer
            </label>
          </div>
          {!!(form.showIf ?? q.showIf) && (
            <>
              <div style={s.fieldRow}>
                <label style={s.fieldLabel}>Depends on question</label>
                <select
                  style={{ ...s.selectInput, width: "100%" }}
                  value={(form.showIf ?? q.showIf)?.questionId || ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      showIf: { ...(f.showIf || {}), questionId: e.target.value },
                    }))
                  }
                >
                  <option value="">Select a question…</option>
                  {allQuestions.map((aq) => (
                    <option key={aq.id} value={aq.id}>
                      {aq.pageTitle ? `[${aq.pageTitle}] ` : ""}
                      {(aq.label || aq.content || aq.id).slice(0, 70)}
                    </option>
                  ))}
                </select>
              </div>
              <div style={s.fieldRow}>
                <label style={s.fieldLabel}>Show when answer is (one per line)</label>
                <textarea
                  style={{ ...s.textarea, minHeight: 60 }}
                  value={
                    Array.isArray((form.showIf ?? q.showIf)?.values)
                      ? (form.showIf ?? q.showIf).values.join("\n")
                      : ""
                  }
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      showIf: {
                        ...(f.showIf || {}),
                        values: e.target.value
                          .split("\n")
                          .map((v) => v.trim())
                          .filter(Boolean),
                      },
                    }))
                  }
                  placeholder={"Yes\nYes, I am currently employed"}
                />
                <p style={s.hint}>
                  Exact answer values that trigger this question to appear. One per line.
                </p>
              </div>
            </>
          )}

          {error && <p style={{ color: "#b3261e", fontSize: 12, fontWeight: 600, margin: "0 0 10px" }}>{error}</p>}
          <div style={s.editActions}>
            <button type="button" style={s.primaryBtn} onClick={saveEdit}>
              Save Question
            </button>
            <button type="button" style={s.secondaryBtn} onClick={cancelEdit}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const COLLEGES = ["CCS","CIT","CAFA","COED","CCJE","CPAG","CBA","CASS","COS","COE"];

// ── TracerFormEditor (main export) ────────────────────────────────────────────
export default function TracerFormEditor({ open, onClose, showToast }) {
  const [college, setCollege] = useState("CCS");
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(null); // { pageIdx, qIdx }
  const [confirmDeletePage, setConfirmDeletePage] = useState(null); // pageIdx

  // ── import dialog state ────────────────────────────────────────────────────────
  const [importOpen, setImportOpen] = useState(false);
  const [importTab, setImportTab] = useState("college"); // "college" | "gform"
  const [importCollegeSel, setImportCollegeSel] = useState("");
  const [gformUrl, setGformUrl] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importPending, setImportPending] = useState(null); // { pages, sourceLabel, warnings } awaiting overwrite confirmation

  function loadConfig(col) {
    setCurrentPage(0);
    setLoading(true);
    fetch(`${API}/admin/tracer-form-config?college=${col}`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setConfig(d.config || { version: 1, pages: [] }))
      .catch(() => setConfig(null))
      .finally(() => setLoading(false));
  }

  // Load config each time the modal opens or college changes
  useEffect(() => {
    if (!open) return;
    loadConfig(college);
  }, [open, college]);

  function closeImportDialog() {
    setImportOpen(false);
    setImportPending(null);
    setImportCollegeSel("");
    setGformUrl("");
  }

  function applyImportedPages(pages, sourceLabel, warnings = []) {
    setConfig({ version: 1, pages });
    setCurrentPage(0);
    closeImportDialog();
    let msg = `Imported ${pages.length} page${pages.length !== 1 ? "s" : ""} from ${sourceLabel}. Review the content, then click "Save Form" to apply it to ${college}.`;
    if (warnings.length) {
      msg += ` ${warnings.length} question${warnings.length !== 1 ? "s" : ""} could not be imported (unsupported type) — add ${warnings.length !== 1 ? "them" : "it"} manually if needed.`;
    }
    showToast(msg);
  }

  function requestApplyImport(pages, sourceLabel, warnings) {
    if (config && config.pages.length > 0) {
      setImportPending({ pages, sourceLabel, warnings });
    } else {
      applyImportedPages(pages, sourceLabel, warnings);
    }
  }

  // ── import another college's saved form as a starting point ──────────────────
  function importFromCollege() {
    if (!importCollegeSel) return;
    setImportBusy(true);
    fetch(`${API}/admin/tracer-form-config?college=${importCollegeSel}`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        const pages = d.config?.pages || [];
        if (pages.length === 0) {
          showToast(`${importCollegeSel} doesn't have a tracer form yet either.`);
          return;
        }
        requestApplyImport(pages, importCollegeSel, []);
      })
      .catch(() => showToast("Import failed. Please try again."))
      .finally(() => setImportBusy(false));
  }

  // ── import a public Google Form as a starting point ───────────────────────────
  function importFromGoogleForm() {
    if (!gformUrl.trim()) return;
    setImportBusy(true);
    fetch(`${API}/admin/tracer-form-config/import-google-form`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ url: gformUrl.trim() }),
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.message || "Import failed.");
        return d;
      })
      .then((d) => {
        const pages = d.pages || [];
        if (pages.length === 0) {
          showToast("No importable questions were found on that form.");
          return;
        }
        requestApplyImport(pages, d.title || "Google Form", d.warnings || []);
      })
      .catch((err) => showToast(err.message || "Could not import from that link."))
      .finally(() => setImportBusy(false));
  }

  // ── config mutators ──────────────────────────────────────────────────────────
  const updatePageTitle = useCallback((pageIdx, title) => {
    setConfig((c) => {
      const pages = c.pages.map((p, i) => (i === pageIdx ? { ...p, title } : p));
      return { ...c, pages };
    });
  }, []);

  const updateQuestion = useCallback((pageIdx, qIdx, updated) => {
    setConfig((c) => {
      const pages = c.pages.map((p, i) => {
        if (i !== pageIdx) return p;
        const questions = p.questions.map((q, j) => (j === qIdx ? updated : q));
        return { ...p, questions };
      });
      return { ...c, pages };
    });
  }, []);

  const deleteQuestion = useCallback((pageIdx, qIdx) => {
    setConfig((c) => {
      const pages = c.pages.map((p, i) => {
        if (i !== pageIdx) return p;
        const questions = p.questions.filter((_, j) => j !== qIdx);
        return { ...p, questions };
      });
      return { ...c, pages };
    });
  }, []);

  const addQuestion = useCallback((pageIdx) => {
    const newQ = {
      id: toKey("new question"),
      type: "radio",
      label: "",
      options: [],
      required: false,
      rows: [],
      ratingOptions: [],
      content: "",
      order: 999,
    };
    setConfig((c) => {
      const pages = c.pages.map((p, i) =>
        i === pageIdx ? { ...p, questions: [...p.questions, newQ] } : p
      );
      return { ...c, pages };
    });
  }, []);

  const moveQuestion = useCallback((pageIdx, qIdx, dir) => {
    setConfig((c) => {
      const pages = c.pages.map((p, i) => {
        if (i !== pageIdx) return p;
        const qs = [...p.questions];
        const swap = dir === "up" ? qIdx - 1 : qIdx + 1;
        if (swap < 0 || swap >= qs.length) return p;
        [qs[qIdx], qs[swap]] = [qs[swap], qs[qIdx]];
        return { ...p, questions: qs };
      });
      return { ...c, pages };
    });
  }, []);

  // ── page-level mutators ───────────────────────────────────────────────────────
  function addPage() {
    const newPage = {
      id: "page_" + Date.now().toString(36),
      title: "New Page",
      questions: [],
    };
    setConfig((c) => {
      setCurrentPage(c.pages.length);
      return { ...c, pages: [...c.pages, newPage] };
    });
  }

  const deletePage = useCallback((pageIdx) => {
    setConfig((c) => {
      const pages = c.pages.filter((_, i) => i !== pageIdx);
      return { ...c, pages };
    });
    setCurrentPage((prev) => (prev > 0 && prev >= pageIdx ? prev - 1 : prev));
    setConfirmDeletePage(null);
  }, []);

  const movePage = useCallback((pageIdx, dir) => {
    setConfig((c) => {
      const pages = [...c.pages];
      const swap = dir === "left" ? pageIdx - 1 : pageIdx + 1;
      if (swap < 0 || swap >= pages.length) return c;
      [pages[pageIdx], pages[swap]] = [pages[swap], pages[pageIdx]];
      return { ...c, pages };
    });
    setCurrentPage((prev) => (dir === "left" ? prev - 1 : prev + 1));
  }, []);

  // ── save ─────────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!config) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/admin/tracer-form-config?college=${college}`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ config }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Save failed.");
      showToast(`${college} tracer form saved. Alumni will see the updated form immediately.`);
      onClose();
    } catch (err) {
      showToast(err.message || "Save failed. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // ── confirm delete guard ──────────────────────────────────────────────────────
  function requestDelete(pageIdx, qIdx) {
    setConfirmDelete({ pageIdx, qIdx });
  }

  function confirmDoDelete() {
    if (!confirmDelete) return;
    deleteQuestion(confirmDelete.pageIdx, confirmDelete.qIdx);
    setConfirmDelete(null);
  }

  // ── render ────────────────────────────────────────────────────────────────────
  const allQuestionsFlat = config
    ? config.pages.flatMap((p) =>
        (p.questions || [])
          .filter((q2) => q2.type !== "static_text")
          .map((q2) => ({ id: q2.id, label: q2.label, content: q2.content, pageTitle: p.title }))
      )
    : [];

  return (
    <Modal open={open} onClose={onClose}>
      <div style={s.modal} role="dialog" aria-modal="true" aria-label="Edit Tracer Form">

        {/* Header */}
        <div style={s.header}>
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginBottom: 2 }}>
              TSU · Alumni Portal
            </div>
            <div style={s.headerTitle}>Edit Tracer Form</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <select
              value={college}
              onChange={(e) => setCollege(e.target.value)}
              style={{
                background: "rgba(255,255,255,0.15)",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.35)",
                borderRadius: 6,
                padding: "5px 10px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {COLLEGES.map((c) => <option key={c} value={c} style={{ color: "#000" }}>{c}</option>)}
            </select>
            {!loading && config && (
              <button
                type="button"
                style={{
                  background: "rgba(255,255,255,0.15)",
                  color: "#fff",
                  border: "1px solid rgba(255,255,255,0.35)",
                  borderRadius: 6,
                  padding: "5px 12px",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
                onClick={() => setImportOpen(true)}
                title="Import questions from another college's form or a Google Form"
              >
                Import…
              </button>
            )}
            <button type="button" style={s.closeBtn} onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: "48px", textAlign: "center", color: "#76656a", flex: 1 }}>
            Loading form configuration…
          </div>
        ) : !config ? (
          <div style={{ padding: "48px", textAlign: "center", color: "#b04050", flex: 1 }}>
            Could not load form configuration. Please try again.
          </div>
        ) : (
          <>
            {/* Page tabs */}
            <div style={s.tabs}>
              {config.pages.map((page, i) => (
                <button
                  key={page.id}
                  type="button"
                  style={s.tab(currentPage === i)}
                  onClick={() => setCurrentPage(i)}
                >
                  Page {i + 1}: {page.title}
                </button>
              ))}
              <button
                type="button"
                style={{
                  ...s.tab(false),
                  color: MAROON,
                  fontWeight: 800,
                  paddingLeft: 20,
                  paddingRight: 20,
                  opacity: 0.75,
                }}
                onClick={addPage}
                title="Add a new page"
              >
                + Page
              </button>
            </div>

            {/* Page body */}
            <div style={s.body}>
              {config.pages.length === 0 && (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "#76656a" }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: MAROON, marginBottom: 6 }}>
                    No tracer form yet for {college}
                  </p>
                  <p style={{ fontSize: 13, marginBottom: 20 }}>
                    Build it from scratch with "+ Page" above, or use "Import…" in the header to
                    copy another college's form or a Google Form as a starting point.
                  </p>
                  <button type="button" style={s.primaryBtn} onClick={addPage}>
                    + Add First Page
                  </button>
                </div>
              )}
              {config.pages[currentPage] && (
                <>
                  {/* Editable page title */}
                  <div style={s.pageTitleRow}>
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 6,
                        background: MAROON,
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 700,
                        fontSize: 13,
                        flexShrink: 0,
                      }}
                    >
                      {currentPage + 1}
                    </div>
                    <input
                      style={s.pageTitleInput}
                      type="text"
                      value={config.pages[currentPage].title}
                      onChange={(e) => updatePageTitle(currentPage, e.target.value)}
                      placeholder="Page title…"
                    />
                    <button
                      type="button"
                      style={s.iconBtn()}
                      title="Move page left"
                      disabled={currentPage === 0}
                      onClick={() => movePage(currentPage, "left")}
                    >
                      ◀
                    </button>
                    <button
                      type="button"
                      style={s.iconBtn()}
                      title="Move page right"
                      disabled={currentPage === config.pages.length - 1}
                      onClick={() => movePage(currentPage, "right")}
                    >
                      ▶
                    </button>
                    <button
                      type="button"
                      style={s.iconBtn("danger")}
                      title="Delete this page"
                      disabled={config.pages.length <= 1}
                      onClick={() => setConfirmDeletePage(currentPage)}
                    >
                      🗑
                    </button>
                  </div>

                  {/* Hint */}
                  <p
                    style={{
                      fontSize: 12,
                      color: "#9a8080",
                      marginBottom: 14,
                      marginTop: -4,
                    }}
                  >
                    {config.pages[currentPage].questions.length} question
                    {config.pages[currentPage].questions.length !== 1 ? "s" : ""} on this page.
                    Changes save to the database when you click "Save Form".
                  </p>

                  {/* Question cards */}
                  {config.pages[currentPage].questions.map((q, qIdx) => (
                    <QuestionCard
                      key={q.id}
                      q={q}
                      qIdx={qIdx}
                      pageIdx={currentPage}
                      totalQ={config.pages[currentPage].questions.length}
                      allQuestions={allQuestionsFlat.filter((aq) => aq.id !== q.id)}
                      onUpdate={(updated) => updateQuestion(currentPage, qIdx, updated)}
                      onDelete={() => requestDelete(currentPage, qIdx)}
                      onMove={(dir) => moveQuestion(currentPage, qIdx, dir)}
                    />
                  ))}

                  {/* Add question */}
                  <button
                    type="button"
                    style={s.addQBtn}
                    onClick={() => addQuestion(currentPage)}
                  >
                    + Add Question to Page {currentPage + 1}
                  </button>
                </>
              )}
            </div>

            {/* Footer */}
            <div style={s.footer}>
              <button type="button" style={s.secondaryBtn} onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                style={{ ...s.primaryBtn, opacity: saving ? 0.7 : 1 }}
                disabled={saving}
                onClick={handleSave}
              >
                {saving ? "Saving…" : "Save Form"}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Delete page confirmation */}
      {confirmDeletePage !== null && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
          }}
          onClick={() => setConfirmDeletePage(null)}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 10,
              padding: "28px 32px",
              maxWidth: 380,
              width: "90%",
              boxShadow: "0 4px 24px rgba(0,0,0,0.18)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h4 style={{ margin: "0 0 10px", color: MAROON, fontSize: 15 }}>Delete Page?</h4>
            <p style={{ margin: "0 0 20px", fontSize: 13, color: "#555", lineHeight: 1.5 }}>
              This will permanently remove <strong>Page {confirmDeletePage + 1}</strong> and all
              its questions from the form. This cannot be undone until you close without saving.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button style={s.secondaryBtn} onClick={() => setConfirmDeletePage(null)}>
                Cancel
              </button>
              <button
                style={{ ...s.primaryBtn, background: "#8a1f2f" }}
                onClick={() => deletePage(confirmDeletePage)}
              >
                Delete Page
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import dialog */}
      {importOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
          }}
          onClick={closeImportDialog}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 10,
              padding: "24px 28px",
              maxWidth: 440,
              width: "90%",
              boxShadow: "0 4px 24px rgba(0,0,0,0.18)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {importPending ? (
              <>
                <h4 style={{ margin: "0 0 10px", color: MAROON, fontSize: 15 }}>Replace current form?</h4>
                <p style={{ margin: "0 0 20px", fontSize: 13, color: "#555", lineHeight: 1.5 }}>
                  Importing <strong>{importPending.sourceLabel}</strong> will replace all{" "}
                  {config?.pages.length} page{config?.pages.length !== 1 ? "s" : ""} currently shown for{" "}
                  <strong>{college}</strong> in this editor. Nothing is saved until you click "Save Form".
                  {importPending.warnings?.length > 0 && (
                    <> {importPending.warnings.length} question{importPending.warnings.length !== 1 ? "s" : ""} on
                    the source couldn't be imported (unsupported type).</>
                  )}
                </p>
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button style={s.secondaryBtn} onClick={() => setImportPending(null)}>
                    Cancel
                  </button>
                  <button
                    style={{ ...s.primaryBtn, background: "#8a1f2f" }}
                    onClick={() => applyImportedPages(importPending.pages, importPending.sourceLabel, importPending.warnings)}
                  >
                    Import & Replace
                  </button>
                </div>
              </>
            ) : (
              <>
                <h4 style={{ margin: "0 0 4px", color: MAROON, fontSize: 15 }}>Import Tracer Form</h4>
                <p style={{ margin: "0 0 16px", fontSize: 12, color: "#9a8080" }}>
                  Copy questions in as a starting point for <strong>{college}</strong>. Nothing is saved until
                  you click "Save Form".
                </p>

                <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
                  <button
                    type="button"
                    style={{ ...s.tab(importTab === "college"), border: `1.5px solid ${MAROON}30`, borderRadius: 6 }}
                    onClick={() => setImportTab("college")}
                  >
                    Another College
                  </button>
                  <button
                    type="button"
                    style={{ ...s.tab(importTab === "gform"), border: `1.5px solid ${MAROON}30`, borderRadius: 6 }}
                    onClick={() => setImportTab("gform")}
                  >
                    Google Form Link
                  </button>
                </div>

                {importTab === "college" ? (
                  <div style={s.fieldRow}>
                    <label style={s.fieldLabel}>Copy from</label>
                    <select
                      style={{ ...s.selectInput, width: "100%" }}
                      value={importCollegeSel}
                      onChange={(e) => setImportCollegeSel(e.target.value)}
                    >
                      <option value="">Select a college…</option>
                      {COLLEGES.filter((c) => c !== college).map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div style={s.fieldRow}>
                    <label style={s.fieldLabel}>Public Google Form link</label>
                    <input
                      style={s.input}
                      type="text"
                      value={gformUrl}
                      onChange={(e) => setGformUrl(e.target.value)}
                      placeholder="https://docs.google.com/forms/d/e/.../viewform"
                    />
                    <p style={s.hint}>
                      The form's sharing must be set to "Anyone with the link can view." Questions like
                      images, linear scales, and grids aren't supported yet and will be skipped.
                    </p>
                  </div>
                )}

                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
                  <button style={s.secondaryBtn} onClick={closeImportDialog}>
                    Cancel
                  </button>
                  <button
                    style={{
                      ...s.primaryBtn,
                      opacity: importBusy || (importTab === "college" ? !importCollegeSel : !gformUrl.trim()) ? 0.6 : 1,
                    }}
                    disabled={importBusy || (importTab === "college" ? !importCollegeSel : !gformUrl.trim())}
                    onClick={importTab === "college" ? importFromCollege : importFromGoogleForm}
                  >
                    {importBusy ? "Importing…" : "Import"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
          }}
          onClick={() => setConfirmDelete(null)}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 10,
              padding: "28px 32px",
              maxWidth: 380,
              width: "90%",
              boxShadow: "0 4px 24px rgba(0,0,0,0.18)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h4 style={{ margin: "0 0 10px", color: MAROON, fontSize: 15 }}>Delete Question?</h4>
            <p style={{ margin: "0 0 20px", fontSize: 13, color: "#555", lineHeight: 1.5 }}>
              This question will be removed from the page. Alumni who have already submitted
              their responses will not be affected.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button style={s.secondaryBtn} onClick={() => setConfirmDelete(null)}>
                Cancel
              </button>
              <button
                style={{ ...s.primaryBtn, background: "#8a1f2f" }}
                onClick={confirmDoDelete}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
