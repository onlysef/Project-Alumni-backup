import { useState, useEffect, useCallback } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

import { API } from "../../services/api.js";
const MAROON = "#7b1a2e";
const GOLD   = "#c49a2a";

// ── Shared input styles ───────────────────────────────────────────────────────
const inp = {
  width: "100%", padding: "0.55rem 0.75rem", border: "1px solid #d1d5db",
  borderRadius: 6, fontSize: "0.9rem", boxSizing: "border-box", outline: "none",
  fontFamily: "inherit",
};
const lbl = {
  display: "block", fontSize: "0.85rem", fontWeight: 600,
  marginBottom: 4, color: "#374151",
};
const fld = { marginBottom: "1.1rem" };
const radioRow = { display: "flex", alignItems: "center", gap: 8, marginBottom: 6, cursor: "pointer" };

function RadioOpt({ name, value, checked, onChange, label }) {
  return (
    <label style={radioRow}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange}
        style={{ accentColor: MAROON, width: 16, height: 16, cursor: "pointer" }} />
      <span style={{ fontSize: "0.9rem", color: "#374151" }}>{label}</span>
    </label>
  );
}

function CheckOpt({ checked, onChange, label }) {
  return (
    <label style={{ ...radioRow, alignItems: "flex-start" }}>
      <input type="checkbox" checked={checked} onChange={onChange}
        style={{ accentColor: MAROON, width: 16, height: 16, marginTop: 2, cursor: "pointer", flexShrink: 0 }} />
      <span style={{ fontSize: "0.9rem", color: "#374151", lineHeight: 1.4 }}>{label}</span>
    </label>
  );
}

// ── Returns true if question q should be shown given the current answers ─────
function isVisible(q, answers) {
  if (!q.showIf) return true;
  const depVal = answers[q.showIf.questionId];
  if (Array.isArray(depVal)) {
    return depVal.some((v) => q.showIf.values.includes(v));
  }
  return (q.showIf.values || []).includes(depVal);
}

// ── Render a single question in answer mode ───────────────────────────────────
function QuestionField({ q, answers, onAnswer }) {
  const val = answers[q.id];

  if (q.type === "static_text") {
    const paragraphs = (q.content || "").split(/\n\n+/);
    // Last paragraph rendered in a highlighted consent box; preceding ones as plain text
    const bodyParas = paragraphs.slice(0, -1);
    const lastPara  = paragraphs[paragraphs.length - 1] || "";
    return (
      <div>
        {bodyParas.map((para, i) => (
          <p key={i} style={{ fontSize: "0.9rem", color: "#374151", lineHeight: 1.7, marginBottom: 16 }}>
            {para}
          </p>
        ))}
        {lastPara && (
          <div style={{
            background: "#f9f5f5", border: `1px solid ${MAROON}30`,
            borderRadius: 8, padding: "16px 20px", marginBottom: 20,
          }}>
            <p style={{ fontSize: "0.85rem", color: "#555", lineHeight: 1.6, margin: 0 }}>
              {lastPara}
            </p>
          </div>
        )}
      </div>
    );
  }

  if (q.type === "text") {
    return (
      <div style={fld}>
        <label style={lbl}>{q.label}{q.required ? " *" : ""}</label>
        <input
          type="text"
          value={val || ""}
          onChange={(e) => onAnswer(q.id, e.target.value)}
          placeholder={q.placeholder || ""}
          style={inp}
        />
      </div>
    );
  }

  if (q.type === "textarea") {
    return (
      <div style={fld}>
        <label style={lbl}>{q.label}{q.required ? " *" : ""}</label>
        <textarea
          value={val || ""}
          onChange={(e) => onAnswer(q.id, e.target.value)}
          placeholder={q.placeholder || ""}
          style={{ ...inp, height: 100, resize: "vertical" }}
        />
      </div>
    );
  }

  if (q.type === "radio") {
    return (
      <div style={fld}>
        <label style={{ ...lbl, marginBottom: 10 }}>{q.label}{q.required ? " *" : ""}</label>
        {(q.options || []).map((opt) => (
          <RadioOpt
            key={opt}
            name={q.id}
            value={opt}
            checked={val === opt}
            onChange={() => onAnswer(q.id, opt)}
            label={opt}
          />
        ))}
      </div>
    );
  }

  if (q.type === "checkbox") {
    const checked = Array.isArray(val) ? val : [];
    return (
      <div style={fld}>
        <label style={{ ...lbl, marginBottom: 10 }}>{q.label}{q.required ? " *" : ""}</label>
        {(q.options || []).map((opt) => (
          <CheckOpt
            key={opt}
            checked={checked.includes(opt)}
            onChange={() =>
              onAnswer(
                q.id,
                checked.includes(opt) ? checked.filter((x) => x !== opt) : [...checked, opt]
              )
            }
            label={opt}
          />
        ))}
      </div>
    );
  }

  if (q.type === "select") {
    return (
      <div style={fld}>
        <label style={lbl}>{q.label}{q.required ? " *" : ""}</label>
        <select
          value={val || ""}
          onChange={(e) => onAnswer(q.id, e.target.value)}
          style={inp}
        >
          <option value="">Select your answer</option>
          {(q.options || []).map((opt) => (
            <option key={opt}>{opt}</option>
          ))}
        </select>
      </div>
    );
  }

  if (q.type === "rating_table") {
    const ratings = (typeof val === "object" && val !== null && !Array.isArray(val)) ? val : {};
    return (
      <div style={{ ...fld, marginTop: 8 }}>
        <label style={{ ...lbl, marginBottom: 12 }}>
          {q.label}{q.required ? " *" : ""}
        </label>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead>
              <tr style={{ background: `${MAROON}0d` }}>
                <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600, color: "#374151", minWidth: 160 }} />
                {(q.ratingOptions || []).map((r) => (
                  <th key={r} style={{ textAlign: "center", padding: "8px 6px", fontWeight: 600, color: MAROON, whiteSpace: "nowrap" }}>
                    {r}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(q.rows || []).map((row, i) => (
                <tr key={row.key} style={{ background: i % 2 === 0 ? "#fff" : "#fdf8f8" }}>
                  <td style={{ padding: "10px 12px", color: "#374151", fontWeight: 500 }}>{row.label}</td>
                  {(q.ratingOptions || []).map((r) => (
                    <td key={r} style={{ textAlign: "center", padding: "10px 6px" }}>
                      <input
                        type="radio"
                        name={`${q.id}_${row.key}`}
                        value={r}
                        checked={ratings[row.key] === r}
                        onChange={() => onAnswer(q.id, { ...ratings, [row.key]: r })}
                        style={{ accentColor: MAROON, width: 16, height: 16, cursor: "pointer" }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return null;
}

// ── Validate the current page ─────────────────────────────────────────────────
function validatePage(page, answers) {
  for (const q of page.questions) {
    if (q.type === "static_text") continue;
    if (!isVisible(q, answers)) continue;
    if (!q.required) continue;

    const val = answers[q.id];

    // validValues check (used for consent — must be "Agree")
    if (q.validValues && q.validValues.length > 0) {
      if (!q.validValues.includes(val)) {
        return q.id === "consent"
          ? "You must agree to participate to continue."
          : `Please provide a valid answer for: ${q.label.slice(0, 60)}`;
      }
      continue;
    }

    if (q.type === "checkbox") {
      if (!val || val.length === 0) {
        return `Please select at least one option for: ${q.label.slice(0, 60)}`;
      }
    } else if (q.type === "rating_table") {
      const ratings = (typeof val === "object" && val !== null) ? val : {};
      const unrated = (q.rows || []).find((row) => !ratings[row.key]);
      if (unrated) {
        return `Please rate all items (missing: ${unrated.label})`;
      }
    } else if (!val) {
      const short = q.label ? q.label.slice(0, 60) : "this question";
      return `Please answer: ${short}${q.label?.length > 60 ? "…" : ""}`;
    }
  }
  return null;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function TracerStudyForm() {
  const { token, firstLogin, setTracerStudyDone } = useAuth();
  const navigate = useNavigate();

  const [config, setConfig]               = useState(null);
  const [configLoading, setConfigLoading]   = useState(true);
  const [configError, setConfigError]     = useState(""); // error loading the form config
  const [step, setStep]                   = useState(1);
  const [answers, setAnswers]             = useState({});
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState(""); // validation / submission errors
  const [isAlreadySubmitted, setIsAlreadySubmitted] = useState(false);
  const [existingDataLoading, setExistingDataLoading] = useState(true);

  // Fetch (or re-fetch) form config from backend
  // keepOnError=true: on failure, preserve existing config (used for background re-fetches)
  const fetchConfig = useCallback((keepOnError = false) => {
    if (!token) return;
    fetch(`${API}/alumni/tracer-form-config`, {
      cache: "no-cache",
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.message || `Server error (${r.status})`);
        return data;
      })
      .then((d) => {
        setConfig(d.config || null);
        setConfigError("");
      })
      .catch((err) => {
        console.error("TracerStudyForm fetch error:", err);
        if (!keepOnError) {
          setConfigError(err.message || "Could not load the tracer form.");
          setConfig(null);
        }
      })
      .finally(() => setConfigLoading(false));
  }, [token]);

  // Initial fetch on mount
  useEffect(() => {
    fetchConfig(false);
  }, [fetchConfig]);

  // Re-fetch when the user switches back to this tab — picks up any admin edits
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") fetchConfig(true);
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [fetchConfig]);

  // Load existing tracer response on mount so alumni can edit their previous answers
  useEffect(() => {
    if (!token) { setExistingDataLoading(false); return; }
    fetch(`${API}/alumni/tracer-study`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok || !data.submitted || !data.data) return;
        setIsAlreadySubmitted(true);

        // Flatten the stored response back into the same shape the form uses
        const raw = data.data;
        const STORED_KEYS = [
          "contactNumber", "gender", "programsCompleted", "professionalExam",
          "professionalExamName", "employmentStatus", "placeOfWork", "occupationTitle",
          "industryField", "presentEmploymentType", "jobRelatedToDegree",
          "yearsInCurrentJob", "reasonsNotEmployed", "furtherEducation",
          "furtherEducationType", "pursuedTrainings", "trainingType",
          "personalGrowthRatings", "promotedInJob", "significantAccomplishments",
          "professionalCertifications", "professionalDevelopmentActivities",
        ];
        const flat = {};
        STORED_KEYS.forEach((key) => {
          const v = raw[key];
          if (v !== undefined && v !== null && v !== "") flat[key] = v;
        });
        // Merge extra_answers (admin-added questions) back into the flat object
        if (raw.extra_answers && typeof raw.extra_answers === "object") {
          Object.entries(raw.extra_answers).forEach(([k, v]) => {
            if (v !== undefined && v !== null) flat[k] = v;
          });
        }
        setAnswers(flat);
      })
      .catch((err) => console.error("TracerStudyForm: could not load existing response", err))
      .finally(() => setExistingDataLoading(false));
  }, [token]);

  // Guards — must come after all hooks
  if (firstLogin) return <Navigate to="/alumni/onboarding" replace />;

  const TOTAL_STEPS = config ? config.pages.length : 6;
  const currentPage = config ? config.pages[step - 1] : null;

  function setAnswer(id, value) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  function handleNext() {
    if (!currentPage) return;
    const err = validatePage(currentPage, answers);
    if (err) { setError(err); return; }
    setError("");
    setStep((s) => s + 1);
    window.scrollTo(0, 0);
  }

  function handleBack() {
    setError("");
    setStep((s) => s - 1);
    window.scrollTo(0, 0);
  }

  async function handleSubmit() {
    if (!currentPage) return;
    const err = validatePage(currentPage, answers);
    if (err) { setError(err); return; }
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${API}/alumni/tracer-study`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(answers),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || "Submission failed. Please try again."); return; }
      setTracerStudyDone();
      navigate("/alumni/dashboard", { replace: true });
    } catch {
      setError("Could not connect to server.");
    } finally {
      setLoading(false);
    }
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  if (configLoading || existingDataLoading) {
    return (
      <div style={{
        height: "100vh", display: "flex", alignItems: "center",
        justifyContent: "center", background: "#f5f0f0", fontFamily: "sans-serif",
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 40, height: 40, border: `4px solid ${MAROON}30`, borderTopColor: MAROON, borderRadius: "50%", margin: "0 auto 16px", animation: "spin 0.8s linear infinite" }} />
          <p style={{ color: MAROON, fontWeight: 600, fontSize: 14 }}>Loading form…</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div style={{
        height: "100vh", display: "flex", alignItems: "center",
        justifyContent: "center", background: "#f5f0f0", fontFamily: "sans-serif",
      }}>
        <div style={{ textAlign: "center", padding: 24, maxWidth: 400 }}>
          <p style={{ color: "#b91c1c", fontWeight: 600, fontSize: 14, marginBottom: 6 }}>
            Could not load the tracer form.
          </p>
          {configError && (
            <p style={{ color: "#6b7280", fontSize: 12, marginBottom: 12, fontFamily: "monospace", background: "#f3f4f6", padding: "6px 10px", borderRadius: 4 }}>
              {configError}
            </p>
          )}
          <p style={{ color: "#6b7280", fontSize: 12, marginBottom: 16 }}>
            Please refresh to try again. If the problem persists, contact the administrator.
          </p>
          <button
            style={{ padding: "8px 20px", background: MAROON, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}
            onClick={() => window.location.reload()}
          >
            Refresh
          </button>
        </div>
      </div>
    );
  }

  // A college with no tracer form authored yet returns zero pages — render
  // an honest "not available yet" screen instead of a 0-step form with a
  // dead progress bar and a Submit button that can never fire (currentPage
  // would be undefined).
  if (config.pages.length === 0) {
    return (
      <div style={{
        height: "100vh", display: "flex", alignItems: "center",
        justifyContent: "center", background: "#f5f0f0", fontFamily: "sans-serif",
      }}>
        <div style={{ textAlign: "center", padding: 24, maxWidth: 420 }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>🕒</div>
          <p style={{ color: MAROON, fontWeight: 700, fontSize: 15, marginBottom: 8 }}>
            Tracer study form not yet available
          </p>
          <p style={{ color: "#6b7280", fontSize: 13, lineHeight: 1.6 }}>
            Your college's tracer study form hasn't been set up yet. Please check back later —
            we'll notify you once it's ready.
          </p>
        </div>
      </div>
    );
  }

  const stepTitles = config.pages.map((p) => p.title);

  // ── Layout ────────────────────────────────────────────────────────────────
  return (
    <div style={{ height: "100vh", overflowY: "auto", background: "#f5f0f0", fontFamily: "sans-serif" }}>

      {/* Header */}
      <div style={{ background: `linear-gradient(135deg, ${MAROON} 0%, #9b2235 100%)`, padding: "20px 24px", color: "#fff" }}>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", marginBottom: 2 }}>
            Tarlac State University · College of Computer Studies
          </div>
          <div style={{ fontWeight: 700, fontSize: 17, color: GOLD, letterSpacing: "0.01em" }}>
            TSU – CCS Graduate Tracer Study
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ background: "#fff", borderBottom: "1px solid #eee", padding: "12px 24px" }}>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            {stepTitles.map((_, i) => (
              <div key={i} style={{
                fontSize: 11, fontWeight: i + 1 === step ? 700 : 400,
                color: i + 1 <= step ? MAROON : "#9ca3af",
                flex: 1, textAlign: "center",
              }}>
                {i + 1 <= step ? "●" : "○"}
              </div>
            ))}
          </div>
          <div style={{ height: 4, background: "#e5e7eb", borderRadius: 99 }}>
            <div style={{
              height: "100%", borderRadius: 99,
              background: `linear-gradient(90deg, ${MAROON}, #9b2235)`,
              width: `${((step - 1) / (TOTAL_STEPS - 1)) * 100}%`,
              transition: "width 0.35s ease",
            }} />
          </div>
          <div style={{ textAlign: "right", fontSize: 12, color: "#6b7280", marginTop: 4 }}>
            Page {step} of {TOTAL_STEPS}
          </div>
        </div>
      </div>

      {/* Card */}
      <div style={{ maxWidth: 760, margin: "24px auto", padding: "0 16px 40px" }}>
        <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 2px 16px rgba(0,0,0,0.08)", overflow: "hidden" }}>

          {/* Section title bar */}
          <div style={{ background: `${MAROON}12`, borderLeft: `4px solid ${MAROON}`, padding: "14px 24px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: MAROON, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {currentPage ? currentPage.title : ""}
            </div>
          </div>

          <div style={{ padding: "24px 28px" }}>

            {isAlreadySubmitted && (
              <div style={{
                background: "#fffbeb", border: "1px solid #fcd34d", color: "#92400e",
                borderRadius: 6, padding: "10px 14px", marginBottom: 20, fontSize: "0.875rem",
                display: "flex", alignItems: "flex-start", gap: 8,
              }}>
                <span style={{ fontWeight: 700, flexShrink: 0 }}>⚠</span>
                <span>
                  You have already submitted this form. Your previous answers are pre-filled below.
                  You may update them and click <strong>Submit</strong> to save the latest version.
                </span>
              </div>
            )}

            {error && (
              <div style={{
                background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c",
                borderRadius: 6, padding: "10px 14px", marginBottom: 20, fontSize: "0.875rem",
              }}>
                {error}
              </div>
            )}

            {/* Render all visible questions on the current page */}
            {currentPage && currentPage.questions
              .filter((q) => isVisible(q, answers))
              .map((q) => (
                <QuestionField
                  key={q.id}
                  q={q}
                  answers={answers}
                  onAnswer={setAnswer}
                />
              ))
            }

            {/* Navigation buttons */}
            <div style={{ display: "flex", gap: 10, marginTop: 28, justifyContent: "space-between" }}>
              <button
                type="button"
                onClick={handleBack}
                disabled={step === 1}
                style={{
                  padding: "9px 24px", borderRadius: 8, border: `1.5px solid ${MAROON}`,
                  background: "#fff", color: MAROON, fontWeight: 600, fontSize: "0.9rem",
                  cursor: step === 1 ? "not-allowed" : "pointer",
                  opacity: step === 1 ? 0.4 : 1, transition: "opacity 0.2s",
                }}
              >
                Back
              </button>

              {step < TOTAL_STEPS ? (
                <button
                  type="button"
                  onClick={handleNext}
                  style={{
                    padding: "9px 28px", borderRadius: 8, border: "none",
                    background: MAROON, color: "#fff", fontWeight: 600, fontSize: "0.9rem",
                    cursor: "pointer",
                  }}
                >
                  Next
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={loading}
                  style={{
                    padding: "9px 28px", borderRadius: 8, border: "none",
                    background: MAROON, color: "#fff", fontWeight: 600, fontSize: "0.9rem",
                    cursor: loading ? "not-allowed" : "pointer",
                    opacity: loading ? 0.7 : 1,
                  }}
                >
                  {loading ? "Submitting…" : "Submit"}
                </button>
              )}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
