let uid = 0;
export const nextId = () => `id-${uid++}`;

// VITE_API_URL (set at build time, e.g. on Vercel) always wins. Otherwise,
// resolve at runtime from the browser's own location — this is the piece
// that was missing for VS Code dev-tunnel testing: without it, "localhost"
// in the hardcoded fallback below means the VIEWER's own machine, not the
// tunnel host, so every request from a teammate's browser failed outright
// with no backend to answer it. Mirrors public/config.js's logic, which
// only covers the static (non-React) login/2FA/reset-password pages.
function resolveApiBase() {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host.endsWith(".devtunnels.ms")) return `${window.location.origin}/api`;
    if (!["localhost", "127.0.0.1"].includes(host)) return "https://alumni-backend-production-a303.up.railway.app/api";
  }
  return "http://localhost:5000/api";
}

export const API = resolveApiBase();

export function authHeaders() {
  const token = localStorage.getItem("auth_token");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

export async function apiFetch(path, { method = "GET", body, params } = {}) {
  const url = new URL(`${API}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== "" && v !== undefined && v !== null) url.searchParams.set(k, v);
    });
  }
  const init = { method, headers: authHeaders() };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(url, init);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Request failed (${res.status})`);
  }
  return res.json();
}
