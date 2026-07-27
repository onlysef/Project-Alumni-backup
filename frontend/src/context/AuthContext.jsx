import { createContext, useContext, useState } from "react";

const AuthContext = createContext(null);

const LOGIN_URL = "/alumni-login.html";

function readAuthFromHash() {
  try {
    const hash = window.location.hash;
    if (!hash.startsWith("#auth=")) return null;
    const payload = JSON.parse(decodeURIComponent(hash.slice(6)));
    if (payload.token && payload.user) {
      localStorage.setItem("auth_token", payload.token);
      localStorage.setItem("auth_user", JSON.stringify(payload.user));
      localStorage.setItem("auth_first_login", String(payload.firstLogin === true));
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
  const [token] = useState(() => localStorage.getItem("auth_token"));
  const [firstLogin, setFirstLoginState] = useState(
    () => localStorage.getItem("auth_first_login") === "true"
  );
  const [tracerStudyCompleted, setTracerStudyCompletedState] = useState(() => {
    try {
      const u = JSON.parse(localStorage.getItem("auth_user"));
      return u?.tracerStudyCompleted === true;
    } catch { return false; }
  });

  function setFirstLoginDone() {
    localStorage.setItem("auth_first_login", "false");
    setFirstLoginState(false);
  }

  function setTracerStudyDone() {
    try {
      const u = JSON.parse(localStorage.getItem("auth_user")) || {};
      u.tracerStudyCompleted = true;
      localStorage.setItem("auth_user", JSON.stringify(u));
    } catch {}
    setTracerStudyCompletedState(true);
  }

  // Patches the logged-in user's own cached profile (name, email, etc.) after
  // a self-edit — without this, `user` stays frozen at whatever it was at
  // login until the next full sign-in, so a changed name keeps showing the
  // old value everywhere it's read from this context (e.g. the AC assistant
  // greeting) even though the database was updated successfully.
  function updateUser(patch) {
    setUser((prev) => {
      const next = { ...(prev || {}), ...patch };
      try { localStorage.setItem("auth_user", JSON.stringify(next)); } catch {}
      return next;
    });
  }

  function logout() {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    localStorage.removeItem("auth_first_login");
    window.location.href = LOGIN_URL;
  }

  return (
    <AuthContext.Provider value={{ user, token, firstLogin, setFirstLoginDone, tracerStudyCompleted, setTracerStudyDone, updateUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
