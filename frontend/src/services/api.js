let uid = 0;
export const nextId = () => `id-${uid++}`;
export const API = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

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
