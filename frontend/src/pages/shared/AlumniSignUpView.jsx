import React, { useState } from "react";
import { Link } from "react-router-dom";
import { API } from "../../services/api.js";
import { COLLEGE_CODES as COLLEGES, COURSES_BY_COLLEGE } from "../../constants/colleges.js";
import { isStrongPassword, PASSWORD_REQUIREMENT_MESSAGE } from "../../utils/passwordValidation.js";

const BSIT_TRACKS = ["TSM", "WMA", "NA"];
const CURRENT_YEAR = new Date().getFullYear();
const BATCH_YEARS = Array.from({ length: 10 }, (_, i) => CURRENT_YEAR - i);

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

export default function AlumniSignUpView() {
  const [form, setForm] = useState({
    firstName: "", middleInitial: "", lastName: "", email: "",
    password: "", confirmPassword: "",
    college: "", course: "", track: "", graduationYear: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  function handleCollegeChange(e) {
    const college = e.target.value;
    setForm((f) => ({ ...f, college, course: "", track: "" }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!form.firstName || !form.lastName || !form.email || !form.password || !form.college || !form.course || !form.graduationYear) {
      setError("Please fill in all required fields.");
      return;
    }
    if (!isStrongPassword(form.password)) {
      setError(PASSWORD_REQUIREMENT_MESSAGE);
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API}/auth/register-alumni`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName,
          middleInitial: form.middleInitial,
          lastName: form.lastName,
          email: form.email,
          password: form.password,
          college: form.college,
          course: form.course,
          track: form.track,
          graduationYear: form.graduationYear,
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
        /* Sign-up-only additions on top of login-style.css. */
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
              <p className="welcome-heading">Join<br /><span className="name">TSU Alumni Portal</span></p>
              <p className="welcome-sub">
                Create your Alumni Portal account. Connect with fellow graduates,
                explore career opportunities, and stay updated with your alma mater.
              </p>
            </div>
          </section>

          <section className="right-shell">
            <div className="right-panel signup-panel">
              <h1 className="login-title">Sign Up</h1>
              <div className="title-underline"></div>

              {error && (
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

              {!success && (
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
                    <label htmlFor="middleinitial">Middle Initial <span className="signup-note">(optional)</span></label>
                    <div className="input-wrap">
                      <svg className="input-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      <input type="text" id="middleinitial" value={form.middleInitial} onChange={update("middleInitial")} placeholder="ex. S" maxLength={2} />
                    </div>
                  </div>

                  <div className="form-group">
                    <label htmlFor="email">Email</label>
                    <div className="input-wrap">
                      <svg className="input-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                      </svg>
                      <input type="email" id="email" value={form.email} onChange={update("email")} placeholder="ex. jl.delacruz@student.tsu.edu.ph" autoComplete="email" />
                    </div>
                  </div>

                  <div className="form-group">
                    <label htmlFor="college">College</label>
                    <div className="input-wrap">
                      <select id="college" value={form.college} onChange={handleCollegeChange} style={{ width: "100%", height: 56, border: 0, borderRadius: 8, padding: "0 40px 0 48px", background: "var(--input-bg)", color: "var(--gray-text)", fontFamily: "Manrope, sans-serif", fontSize: 16 }}>
                        <option value="">— Select college —</option>
                        {COLLEGES.map((c) => <option key={c}>{c}</option>)}
                      </select>
                      <svg className="input-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                    </div>
                  </div>

                  <div className="form-group">
                    <label htmlFor="course">Course</label>
                    <div className="input-wrap">
                      <select
                        id="course"
                        value={form.course}
                        onChange={update("course")}
                        disabled={!form.college}
                        style={{ width: "100%", height: 56, border: 0, borderRadius: 8, padding: "0 40px 0 48px", background: "var(--input-bg)", color: "var(--gray-text)", fontFamily: "Manrope, sans-serif", fontSize: 16 }}
                      >
                        <option value="">{form.college ? "— Select course —" : "Select a college first"}</option>
                        {(COURSES_BY_COLLEGE[form.college] || []).map((c) => <option key={c}>{c}</option>)}
                      </select>
                      <svg className="input-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                    </div>
                  </div>

                  {form.course === "BSIT" && (
                    <div className="form-group">
                      <label htmlFor="track">BSIT Track <span className="signup-note">(optional)</span></label>
                      <div className="input-wrap">
                        <select id="track" value={form.track} onChange={update("track")} style={{ width: "100%", height: 56, border: 0, borderRadius: 8, padding: "0 40px 0 16px", background: "var(--input-bg)", color: "var(--gray-text)", fontFamily: "Manrope, sans-serif", fontSize: 16 }}>
                          <option value="">— Select track —</option>
                          {BSIT_TRACKS.map((t) => <option key={t}>{t}</option>)}
                        </select>
                      </div>
                    </div>
                  )}

                  <div className="form-group">
                    <label htmlFor="gradyear">Graduation Year</label>
                    <div className="input-wrap">
                      <svg className="input-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <select id="gradyear" value={form.graduationYear} onChange={update("graduationYear")} style={{ width: "100%", height: 56, border: 0, borderRadius: 8, padding: "0 40px 0 48px", background: "var(--input-bg)", color: "var(--gray-text)", fontFamily: "Manrope, sans-serif", fontSize: 16 }}>
                        <option value="">— Select year —</option>
                        {BATCH_YEARS.map((y) => <option key={y}>{y}</option>)}
                      </select>
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
