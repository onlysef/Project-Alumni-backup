let uid = 0;
export const nextId = () => `id-${uid++}`;
export const API = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

export function authHeaders() {
  const token = localStorage.getItem("auth_token");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}
