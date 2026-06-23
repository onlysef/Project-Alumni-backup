import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./coordinator-dashboard.css";

const LOGIN_URL = "http://localhost:5173/alumni-login.html";

// Read auth payload from URL hash (set by login page)
const hash = window.location.hash;
if (hash.startsWith("#auth=")) {
  try {
    const payload = JSON.parse(decodeURIComponent(hash.slice(6)));
    if (payload.token && payload.user) {
      localStorage.setItem("auth_token", payload.token);
      localStorage.setItem("auth_user", JSON.stringify(payload.user));
      window.history.replaceState(null, "", window.location.pathname);
    }
  } catch {}
}

// Guard: must be logged in as coordinator
const token = localStorage.getItem("auth_token");
let user = null;
try { user = JSON.parse(localStorage.getItem("auth_user")); } catch {}

if (!token || !user || user.role !== "coordinator") {
  localStorage.removeItem("auth_token");
  localStorage.removeItem("auth_user");
  window.location.replace(LOGIN_URL);
} else {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
