import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { API } from "../../services/api.js";

export default function AlumniOnboarding() {
  const { user, token, firstLogin, setFirstLoginDone } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [newPassword, setNewPassword]         = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

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

      // Mark onboarding complete with default employment status
      await fetch(`${API}/alumni/complete-onboarding`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ employment_status: "Not Yet Updated" }),
      });

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
    borderRadius: "6px", fontSize: "0.95rem", boxSizing: "border-box", outline: "none",
  };
  const labelStyle = { display: "block", fontSize: "0.875rem", fontWeight: 600, marginBottom: "4px", color: "#374151" };
  const fieldStyle = { marginBottom: "1rem" };

  return (
    <div style={{ minHeight: "100vh", background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "sans-serif" }}>
      <div style={{ background: "#fff", borderRadius: "12px", boxShadow: "0 4px 24px rgba(0,0,0,0.10)", padding: "2.5rem", width: "100%", maxWidth: "420px" }}>

        <div style={{ marginBottom: "1.75rem", textAlign: "center" }}>
          <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 52, height: 52, background: "#eff6ff", borderRadius: "50%", marginBottom: "0.75rem" }}>
            <span style={{ fontSize: "1.5rem" }}>🎓</span>
          </div>
          <h1 style={{ margin: 0, fontSize: "1.4rem", fontWeight: 700, color: "#111827" }}>
            Welcome, {user?.firstName}!
          </h1>
          <p style={{ margin: "0.35rem 0 0", fontSize: "0.875rem", color: "#6b7280" }}>
            Please set a new password before continuing.
          </p>
        </div>

        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", borderRadius: 6, padding: "0.6rem 0.75rem", marginBottom: "1rem", fontSize: "0.875rem" }}>
            {error}
          </div>
        )}

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
          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%", padding: "0.7rem", background: "#7b1a2e", color: "#fff",
              border: "none", borderRadius: "6px", fontSize: "1rem", fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Saving…" : "Continue →"}
          </button>
        </form>
      </div>
    </div>
  );
}
