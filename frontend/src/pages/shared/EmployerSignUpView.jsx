import React, { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { API } from "../../services/api.js";

const CURRENT_YEAR = new Date().getFullYear();

const PARTNER_TYPES = [
  "Information Technology & BPO", "Manufacturing", "Banking & Finance",
  "Healthcare", "Retail & Trade", "Education", "Government",
  "Construction & Engineering", "Hospitality & Tourism", "Agriculture", "Others",
];

function EyeIcon({ open }) {
  return open ? (
    <svg className="eye-open" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg className="eye-closed" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M10.6 10.6a3 3 0 004.2 4.2M9.4 5.7A9.3 9.3 0 0112 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 01-3 3.6M6.1 6.6A16 16 0 002.5 12S6 18.5 12 18.5a9 9 0 003.4-.65" />
    </svg>
  );
}

export default function EmployerSignUpView() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";

  const [tokenState, setTokenState] = useState("checking"); // checking | valid | invalid
  const [tokenError, setTokenError] = useState("");
  const [lockedEmail, setLockedEmail] = useState("");

  const [form, setForm] = useState({
    firstName: "", lastName: "", company: "", partnerType: "",
    password: "", confirmPassword: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) { setTokenState("invalid"); setTokenError("This invite link is missing its token."); return; }
    fetch(`${API}/auth/employer-invite/${token}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) { setTokenState("invalid"); setTokenError(data.message || "This invite link is invalid."); return; }
        setLockedEmail(data.email || "");
        setTokenState("valid");
      })
      .catch(() => { setTokenState("invalid"); setTokenError("Could not connect to server."); });
  }, [token]);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!form.firstName || !form.lastName || !form.company || !form.partnerType || !form.password) {
      setError("Please fill in all required fields.");
      return;
    }
    if (form.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API}/auth/register-partner`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          firstName: form.firstName,
          lastName: form.lastName,
          company: form.company,
          partnerType: form.partnerType,
          email: lockedEmail,
          password: form.password,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || "Registration failed. Please try again.");
        return;
      }
      setSuccess(data.message || "Account created successfully! You can now log in.");
    } catch {
      setError("Could not connect to server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Noto+Serif:ital,wght@0,400;0,700;1,400;1,700&display=swap" rel="stylesheet" />
      <link rel="stylesheet" href="/assets/css/login-style.css" />
      <style>{`
        .right-panel.signup-panel { max-height: min(84vh, 760px); overflow-y: auto; }
        .signup-note { font-size: 11px; color: var(--gray-text); margin-top: -4px; }
      `}</style>

      <main className="page">
        <div className="card">
          <section className="left-panel">
            <div className="welcome-copy">
              <div className="welcome-wave" aria-hidden="true">
                <span className="wave-hand-image"></span>
              </div>
              <p className="welcome-heading">Partner with<br /><span className="name">TSU Alumni Portal</span></p>
              <p className="welcome-sub">
                Create your employer account to post job opportunities
                and connect with TSU alumni graduates.
              </p>
            </div>
          </section>

          <section className="right-shell">
            <div className="right-panel signup-panel">
              <h1 className="login-title">Employer Sign Up</h1>
              <div className="title-underline"></div>

              {tokenState === "checking" && (
                <div className="form-group">
                  <div style={{ padding: "10px 14px", borderRadius: 8, fontSize: 13, textAlign: "center", background: "#f7fafc", color: "#4a5568", border: "1px solid #e2e8f0" }}>
                    Checking invite link…
                  </div>
                </div>
              )}

              {tokenState === "invalid" && (
                <div className="form-group">
                  <div style={{ padding: "10px 14px", borderRadius: 8, fontSize: 13, textAlign: "center", background: "#fff5f5", color: "#c53030", border: "1px solid #fc8181" }}>
                    {tokenError} Please contact the TSU Alumni Office for a new invite link.
                  </div>
                </div>
              )}

              {tokenState === "valid" && error && (
                <div className="form-group">
                  <div style={{ padding: "10px 14px", borderRadius: 8, fontSize: 13, textAlign: "center", background: "#fff5f5", color: "#c53030", border: "1px solid #fc8181" }}>
                    {error}
                  </div>
                </div>
              )}
              {success && (
                <div className="form-group">
                  <div style={{ padding: "10px 14px", borderRadius: 8, fontSize: 13, textAlign: "center", background: "#f0fff4", color: "#276749", border: "1px solid #68d391" }}>
                    {success} <Link to="/" style={{ color: "#1a4731", fontWeight: 700 }}>Go to Login</Link>
                  </div>
                </div>
              )}

              {tokenState === "valid" && !success && (
                <form onSubmit={handleSubmit} noValidate style={{ width: "100%", display: "flex", flexDirection: "column", gap: 14 }}>
                  <div className="form-group">
                    <label htmlFor="firstname">First Name</label>
                    <div className="input-wrap">
                      <svg className="input-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      <input type="text" id="firstname" value={form.firstName} onChange={update("firstName")} placeholder="ex. Juan" autoComplete="given-name" />
                    </div>
                  </div>

                  <div className="form-group">
                    <label htmlFor="lastname">Last Name</label>
                    <div className="input-wrap">
                      <svg className="input-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      <input type="text" id="lastname" value={form.lastName} onChange={update("lastName")} placeholder="ex. dela Cruz" autoComplete="family-name" />
                    </div>
                  </div>

                  <div className="form-group">
                    <label htmlFor="email">Email <span className="signup-note">(from your invite)</span></label>
                    <div className="input-wrap">
                      <svg className="input-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                      </svg>
                      <input type="email" id="email" value={lockedEmail} readOnly disabled />
                    </div>
                  </div>

                  <div className="form-group">
                    <label htmlFor="company">Company Name</label>
                    <div className="input-wrap">
                      <svg className="input-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1m-1 4h1m4-4h1m-1 4h1M9 21v-4h6v4" />
                      </svg>
                      <input type="text" id="company" value={form.company} onChange={update("company")} placeholder="ex. Acme Corporation" autoComplete="organization" />
                    </div>
                  </div>

                  <div className="form-group">
                    <label htmlFor="partnerType">Industry Type</label>
                    <div className="input-wrap">
                      <select id="partnerType" value={form.partnerType} onChange={update("partnerType")} style={{ width: "100%", height: 56, border: 0, borderRadius: 8, padding: "0 40px 0 48px", background: "var(--input-bg)", color: "var(--gray-text)", fontFamily: "Manrope, sans-serif", fontSize: 16 }}>
                        <option value="">— Select industry —</option>
                        {PARTNER_TYPES.map((t) => <option key={t}>{t}</option>)}
                      </select>
                      <svg className="input-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                    </div>
                  </div>

                  <div className="form-group password-group">
                    <label htmlFor="password">Password</label>
                    <div className="input-wrap">
                      <svg className="input-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                      <input type={showPassword ? "text" : "password"} id="password" value={form.password} onChange={update("password")} placeholder="Create a strong password" autoComplete="new-password" />
                      <button type="button" className="toggle-password" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((s) => !s)}>
                        <EyeIcon open={showPassword} />
                      </button>
                    </div>
                  </div>

                  <div className="form-group password-group">
                    <label htmlFor="confirmpassword">Confirm Password</label>
                    <div className="input-wrap">
                      <svg className="input-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                      <input type={showConfirm ? "text" : "password"} id="confirmpassword" value={form.confirmPassword} onChange={update("confirmPassword")} placeholder="Re-enter your password" autoComplete="new-password" />
                      <button type="button" className="toggle-password" aria-label={showConfirm ? "Hide password" : "Show password"} onClick={() => setShowConfirm((s) => !s)}>
                        <EyeIcon open={showConfirm} />
                      </button>
                    </div>
                  </div>

                  <button className="btn-signin" type="submit" disabled={submitting}>
                    {submitting ? "Creating account…" : "Create Account"}
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  </button>

                  <p className="login-link-row">
                    Already have an account? <Link to="/">Log in</Link>
                  </p>
                </form>
              )}
            </div>
          </section>
        </div>
      </main>
      <footer className="login-footer">&copy; {CURRENT_YEAR} Alumni Portal &middot; Tarlac State University | College of Computer Studies</footer>
    </>
  );
}
