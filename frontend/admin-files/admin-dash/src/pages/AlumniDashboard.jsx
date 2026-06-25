import React from "react";

export default function AlumniDashboard() {
  function handleLogout() {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    window.location.replace("/alumni-login.html");
  }

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", flexDirection: "column", gap: "1rem", fontFamily: "sans-serif" }}>
      <img src="/alumni-removebg.png" alt="TSU Logo" style={{ height: 72, opacity: 0.7 }} />
      <h2 style={{ margin: 0 }}>Alumni Dashboard</h2>
      <p style={{ color: "#888", margin: 0 }}>This section is under development.</p>
      <button onClick={handleLogout} style={{ marginTop: "0.5rem", padding: "0.5rem 1.5rem", cursor: "pointer" }}>
        Log out
      </button>
    </div>
  );
}
