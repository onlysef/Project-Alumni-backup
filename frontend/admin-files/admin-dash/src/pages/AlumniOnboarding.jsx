import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const API = "http://localhost:5000/api";

const EMPLOYMENT_STATUSES = ["Employed", "Unemployed", "Self-employed"];

const SALARY_RANGES = [
  "Below ₱10,000",
  "₱10,000 – ₱19,999",
  "₱20,000 – ₱29,999",
  "₱30,000 – ₱39,999",
  "₱40,000 – ₱49,999",
  "₱50,000 and above",
];

export default function AlumniOnboarding() {
  const { user, token, firstLogin, setFirstLoginDone } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Step 1 — Change Password
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Step 2 — Employment Info
  const [empStatus, setEmpStatus] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [industry, setIndustry] = useState("");
  const [workLocation, setWorkLocation] = useState("");
  const [salaryRange, setSalaryRange] = useState("");
  const [jobRelated, setJobRelated] = useState("");
  const [dateEmployed, setDateEmployed] = useState("");
  const [reasonUnemployed, setReasonUnemployed] = useState("");

  if (!firstLogin) return <Navigate to="/alumni/dashboard" replace />;

  async function handleChangePassword(e) {
    e.preventDefault();
    setError("");
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API}/alumni/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ newPassword }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || "Failed to change password."); return; }
      setStep(2);
    } catch {
      setError("Could not connect to server.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCompleteOnboarding(e) {
    e.preventDefault();
    setError("");
    if (!empStatus) { setError("Please select your employment status."); return; }

    const body = { employment_status: empStatus };
    if (empStatus === "Employed" || empStatus === "Self-employed") {
      if (!companyName) { setError("Please enter your company/business name."); return; }
      if (!industry)    { setError("Please enter your industry."); return; }
      body.company_name  = companyName;
      body.job_title     = jobTitle;
      body.industry      = industry;
      body.work_location = workLocation;
      body.salary_range  = salaryRange;
      body.job_related_to_course = jobRelated === "yes" ? true : jobRelated === "no" ? false : null;
      body.date_employed = dateEmployed || null;
    }
    if (empStatus === "Unemployed") {
      body.reason_unemployed = reasonUnemployed;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API}/alumni/complete-onboarding`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || "Failed to save. Please try again."); return; }
      setFirstLoginDone();
      navigate("/alumni/dashboard", { replace: true });
    } catch {
      setError("Could not connect to server.");
    } finally {
      setLoading(false);
    }
  }

  const inputStyle = {
    width: "100%", padding: "0.6rem 0.75rem", border: "1px solid #d1d5db",
    borderRadius: "6px", fontSize: "0.95rem", boxSizing: "border-box",
    outline: "none",
  };
  const labelStyle = { display: "block", fontSize: "0.875rem", fontWeight: 600, marginBottom: "4px", color: "#374151" };
  const fieldStyle = { marginBottom: "1rem" };
  const btnStyle = {
    width: "100%", padding: "0.7rem", background: "#2563eb", color: "#fff",
    border: "none", borderRadius: "6px", fontSize: "1rem", fontWeight: 600,
    cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1,
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "sans-serif" }}>
      <div style={{ background: "#fff", borderRadius: "12px", boxShadow: "0 4px 24px rgba(0,0,0,0.10)", padding: "2.5rem", width: "100%", maxWidth: "480px" }}>

        {/* Header */}
        <div style={{ marginBottom: "1.75rem", textAlign: "center" }}>
          <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 52, height: 52, background: "#eff6ff", borderRadius: "50%", marginBottom: "0.75rem" }}>
            <span style={{ fontSize: "1.5rem" }}>🎓</span>
          </div>
          <h1 style={{ margin: 0, fontSize: "1.4rem", fontWeight: 700, color: "#111827" }}>
            {step === 1 ? `Welcome, ${user?.firstName}!` : "Employment Information"}
          </h1>
          <p style={{ margin: "0.35rem 0 0", fontSize: "0.875rem", color: "#6b7280" }}>
            {step === 1
              ? "Please set a new password before continuing."
              : "Tell us about your current employment status."}
          </p>
          {/* Step indicator */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: "1rem" }}>
            {[1, 2].map(n => (
              <div key={n} style={{
                width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "0.8rem", fontWeight: 700,
                background: step >= n ? "#2563eb" : "#e5e7eb",
                color: step >= n ? "#fff" : "#9ca3af",
              }}>{n}</div>
            ))}
          </div>
        </div>

        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", borderRadius: 6, padding: "0.6rem 0.75rem", marginBottom: "1rem", fontSize: "0.875rem" }}>
            {error}
          </div>
        )}

        {/* ── Step 1: Change Password ── */}
        {step === 1 && (
          <form onSubmit={handleChangePassword}>
            <div style={fieldStyle}>
              <label style={labelStyle}>New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                style={inputStyle}
                required
              />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your password"
                style={inputStyle}
                required
              />
            </div>
            <button type="submit" style={btnStyle} disabled={loading}>
              {loading ? "Saving…" : "Continue →"}
            </button>
          </form>
        )}

        {/* ── Step 2: Employment Info ── */}
        {step === 2 && (
          <form onSubmit={handleCompleteOnboarding}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Employment Status *</label>
              <select value={empStatus} onChange={e => setEmpStatus(e.target.value)} style={inputStyle} required>
                <option value="">Select status…</option>
                {EMPLOYMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {(empStatus === "Employed" || empStatus === "Self-employed") && (
              <>
                <div style={fieldStyle}>
                  <label style={labelStyle}>{empStatus === "Self-employed" ? "Business Name *" : "Company Name *"}</label>
                  <input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)} style={inputStyle} placeholder="Enter name" required />
                </div>
                {empStatus === "Employed" && (
                  <div style={fieldStyle}>
                    <label style={labelStyle}>Job Title</label>
                    <input type="text" value={jobTitle} onChange={e => setJobTitle(e.target.value)} style={inputStyle} placeholder="e.g. Software Engineer" />
                  </div>
                )}
                <div style={fieldStyle}>
                  <label style={labelStyle}>Industry *</label>
                  <input type="text" value={industry} onChange={e => setIndustry(e.target.value)} style={inputStyle} placeholder="e.g. Information Technology" required />
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Work Location</label>
                  <input type="text" value={workLocation} onChange={e => setWorkLocation(e.target.value)} style={inputStyle} placeholder="e.g. Manila, Philippines" />
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Salary Range</label>
                  <select value={salaryRange} onChange={e => setSalaryRange(e.target.value)} style={inputStyle}>
                    <option value="">Prefer not to say</option>
                    {SALARY_RANGES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Is your job related to your course?</label>
                  <select value={jobRelated} onChange={e => setJobRelated(e.target.value)} style={inputStyle}>
                    <option value="">Not sure / N/A</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Date Employed</label>
                  <input type="date" value={dateEmployed} onChange={e => setDateEmployed(e.target.value)} style={inputStyle} />
                </div>
              </>
            )}

            {empStatus === "Unemployed" && (
              <div style={fieldStyle}>
                <label style={labelStyle}>Reason for Unemployment</label>
                <input type="text" value={reasonUnemployed} onChange={e => setReasonUnemployed(e.target.value)} style={inputStyle} placeholder="Optional" />
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: "0.5rem" }}>
              <button
                type="button"
                onClick={() => { setStep(1); setError(""); }}
                style={{ ...btnStyle, background: "#e5e7eb", color: "#374151", width: "auto", padding: "0.7rem 1.25rem" }}
                disabled={loading}
              >
                ← Back
              </button>
              <button type="submit" style={{ ...btnStyle, flex: 1 }} disabled={loading}>
                {loading ? "Saving…" : "Complete Setup"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
