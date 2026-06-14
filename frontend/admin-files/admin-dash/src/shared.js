// Shared helpers used across multiple page modules.

let uid = 0;
export const nextId = () => `id-${uid++}`;

export const API = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
