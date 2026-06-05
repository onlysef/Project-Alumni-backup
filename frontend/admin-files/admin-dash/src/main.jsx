import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./admin-mod.css";
import "./icon-overrides.css";

// Auth guard: kung walang login token, balik sa login page
const token = localStorage.getItem("auth_token");
if (!token) {
  window.location.href = "http://127.0.0.1:5500/frontend/pages/alumni-login.html";
} else {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}