import { createContext, useContext, useState, useEffect } from "react";
import { API } from "../services/api.js";

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

  const [needsTracerUpdate, setNeedsTracerUpdateState] = useState(null);
  const [tracerUpdateChecked, setTracerUpdateChecked] = useState(false);

  // Refetch on load so profile changes made in another session show up.
  useEffect(() => {
    if (!token) return;
    fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.user) updateUser(d.user); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!token || user?.role !== "alumni" || !tracerStudyCompleted) {
      setTracerUpdateChecked(true);
      return;
    }
    let cancelled = false;
    fetch(`${API}/alumni/tracer-study`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setNeedsTracerUpdateState((d.newQuestionsCount || 0) > 0);
        setTracerUpdateChecked(true);
      })
      .catch(() => {
        if (cancelled) return;
        setNeedsTracerUpdateState(false);
        setTracerUpdateChecked(true);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user?.role, tracerStudyCompleted]);

  // Called after a successful tracer-study submit so the alumni isn't
  // immediately routed right back to the same screen they just completed.
  function setTracerUpdateDone() {
    setNeedsTracerUpdateState(false);
  }

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
    // Archive the in-progress AI chat into history on logout (mirrors AiAssistantView's newChat).
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
    <AuthContext.Provider value={{ user, token, firstLogin, setFirstLoginDone, tracerStudyCompleted, setTracerStudyDone, needsTracerUpdate, tracerUpdateChecked, setTracerUpdateDone, updateUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
