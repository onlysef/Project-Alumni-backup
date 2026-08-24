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
    // The AC AI Assistant keeps its in-progress conversation in localStorage
    // (acCurrentChat_<role>_<user>) so a refresh doesn't lose it — but
    // logging out should still start the next session fresh instead of
    // resuming whatever was left open. Archive it into that account's
    // history (acChatHistory_<role>_<user>) first, mirroring
    // AiAssistantView's own buildArchivedHistory/newChat logic, so the
    // conversation is still reachable from History next login instead of
    // being silently discarded.
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith("acCurrentChat_")) continue;

        try {
          const messages = JSON.parse(localStorage.getItem(key));
          if (Array.isArray(messages) && messages.length > 0) {
            const historyKey = key.replace("acCurrentChat_", "acChatHistory_");
            const firstUser = messages.find((m) => m.role === "user");
            const title = (firstUser?.text || "Conversation").slice(0, 48);
            const entry = { id: `c-${Date.now()}`, title, savedAt: new Date().toISOString(), messages };

            const existing = JSON.parse(localStorage.getItem(historyKey) || "[]");
            const nextHistory = [entry, ...(Array.isArray(existing) ? existing : [])].slice(0, 30);
            localStorage.setItem(historyKey, JSON.stringify(nextHistory));
          }
        } catch { /* ignore malformed entries, still remove the current-chat key below */ }

        localStorage.removeItem(key);
      }
    } catch {}
    window.location.href = LOGIN_URL;
  }

  return (
    <AuthContext.Provider value={{ user, token, firstLogin, setFirstLoginDone, tracerStudyCompleted, setTracerStudyDone, updateUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
