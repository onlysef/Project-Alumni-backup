import { createContext, useContext, useState } from "react";

const AuthContext = createContext(null);

const LOGIN_URL = "http://127.0.0.1:5500/frontend/pages/alumni-login.html";

function readAuthFromHash() {
  try {
    const hash = window.location.hash;
    if (!hash.startsWith("#auth=")) return null;
    const payload = JSON.parse(decodeURIComponent(hash.slice(6)));
    if (payload.token && payload.user) {
      localStorage.setItem("auth_token", payload.token);
      localStorage.setItem("auth_user", JSON.stringify(payload.user));
      // Clean the hash so it doesn't stay in the URL
      window.history.replaceState(null, "", window.location.pathname);
      return payload;
    }
  } catch {}
  return null;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const fromHash = readAuthFromHash();
    if (fromHash) return fromHash.user;
    try { return JSON.parse(localStorage.getItem("auth_user")); } catch { return null; }
  });
  const [token, setToken] = useState(() => {
    return localStorage.getItem("auth_token");
  });

  function logout() {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    setUser(null);
    setToken(null);
    window.location.href = LOGIN_URL;
  }

  return (
    <AuthContext.Provider value={{ user, token, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
