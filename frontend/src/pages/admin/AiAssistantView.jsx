import React, { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "../../context/AuthContext.jsx";
import { API } from "../../services/api.js";
import { marked } from "marked";

marked.setOptions({ breaks: true, gfm: true });

const QUICK_PROMPTS = [
  { label: "Alumni records", text: "How many alumni records are there?" },
  { label: "Tracer surveys", text: "Show me tracer survey activity." },
  { label: "Employment status", text: "What's the current employment status?" },
  { label: "Job opportunities", text: "What job opportunities are available?" },
];

function getSuggestions(text) {
  const t = (text || "").toLowerCase();

  if (/employment breakdown|employed|unemployed|employment rate|employment status|self.?employ|never employ/.test(t))
    return [
      "What industries do alumni work in?",
      "Show employment breakdown by program",
      "Show employment by graduation year",
      "Who are the employed alumni?",
      "How many work locally?",
      "How many work abroad?",
      "What is the employment type breakdown?",
    ];

  if (/industr/.test(t))
    return [
      "What is the employment rate?",
      "Who works in the IT industry?",
      "Who works in the education industry?",
      "How many work locally?",
      "How many work abroad?",
      "Show employment breakdown by program",
    ];

  if (/board.?exam|licensure|prc/.test(t))
    return [
      "How many passed the board exam?",
      "What percentage passed the board exam?",
      "Who passed the board exam?",
      "Who failed the board exam?",
      "How many did not take the board exam?",
      "Who did not take the board exam?",
    ];

  if (/competenc|skill|self.?assess/.test(t))
    return [
      "How do alumni rate their technical skills?",
      "How do alumni rate their communication skills?",
      "How do alumni rate their problem-solving skills?",
      "How do alumni rate their teamwork?",
      "How do alumni rate their adaptability?",
      "How do alumni rate their critical thinking?",
    ];

  if (/further (education|studies)|graduate studies|masters|phd|post.?grad/.test(t))
    return [
      "Who pursued further studies?",
      "What percentage pursued further education?",
      "What is the employment rate?",
      "How many took the board exam?",
      "What industries do alumni work in?",
    ];

  if (/program|specialization|course|tsm|bscs|bsit|wma|\bna\b|\bis\b|\bim\b/.test(t))
    return [
      "How many TSM graduates are there?",
      "How many IT graduates are there?",
      "How many BSCS graduates are there?",
      "How many WMA graduates are there?",
      "Show employment breakdown by program",
      "What is the overall employment rate?",
      "Show employment by graduation year",
    ];

  if (/batch|year|graduation|graduated/.test(t))
    return [
      "Show employment by graduation year",
      "Who are the alumni from batch 2020?",
      "How many alumni are from batch 2019?",
      "What is the employment rate?",
      "Show employment breakdown by program",
    ];

  if (/locally|abroad|work location|overseas/.test(t))
    return [
      "How many work locally?",
      "How many work abroad?",
      "What industries do alumni work in?",
      "What is the employment rate?",
      "Show employment breakdown by program",
    ];

  if (/related|relevance|relevant.*course|job.*course/.test(t))
    return [
      "How many have jobs directly related to their course?",
      "How many have jobs somewhat related to their course?",
      "How many have jobs not related to their course?",
      "What is the employment rate?",
      "What industries do alumni work in?",
    ];

  if (/employment type|regular|permanent|contractual|government|private/.test(t))
    return [
      "What is the employment type breakdown?",
      "How many are regular or permanent employees?",
      "How many are contractual?",
      "What is the employment rate?",
      "What industries do alumni work in?",
    ];

  if (/respondents|tracer|survey|overview/.test(t))
    return [
      "What is the employment rate?",
      "What industries do alumni work in?",
      "Show employment breakdown by program",
      "How many took the board exam?",
      "How many pursued further studies?",
      "How do alumni rate their competencies?",
    ];

  return [
    "What is the employment rate?",
    "What industries do alumni work in?",
    "How many took the board exam?",
    "Show employment breakdown by program",
    "How many pursued further studies?",
    "How do alumni rate their competencies?",
  ];
}

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function loadHistory(key) {
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export default function AiAssistantView() {
  const { user } = useAuth();
  const firstName = user?.firstName || "there";
  const historyKey = `acChatHistory_${user?.role || "admin"}`;
  const currentKey = `acCurrentChat_${user?.role || "admin"}`;

  const [messages, setMessages] = useState(() => {
    try {
      const raw = localStorage.getItem(currentKey);
      const arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) return [];
      // Drop empty AC messages left by interrupted streams
      return arr.filter((m) => !(m.role === "ac" && !m.text?.trim()));
    } catch { return []; }
  });   // { id, role: "user"|"ac", text, time }
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const [copiedId, setCopiedId] = useState(null);
  const [suggestions, setSuggestions] = useState([]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState(() => loadHistory(historyKey));
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState(null);
  const [reembedding, setReembedding] = useState(false);
  const fileInputRef = useRef(null);

  const [filesOpen, setFilesOpen] = useState(false);
  const [importedFiles, setImportedFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const scrollRef = useRef(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  const menuRef = useRef(null);
  const filesUploadRef = useRef(null);

  const started = messages.length > 0;

  const scrollToBottom = useCallback(() => {
    if (bottomRef.current) {
      const container = bottomRef.current.closest('.content');
      if (container) {
        container.scrollTop = container.scrollHeight;
      } else {
        bottomRef.current.scrollIntoView({ behavior: 'instant' });
      }
    }
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, thinking, scrollToBottom]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    try { localStorage.setItem(currentKey, JSON.stringify(messages)); } catch { /* ignore */ }
  }, [messages, currentKey]);

  // Close the options menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  function persistHistory(next) {
    setHistory(next);
    try {
      localStorage.setItem(historyKey, JSON.stringify(next));
    } catch { /* ignore */ }
  }

  // Save the current conversation into history (if it has any messages)
  function archiveCurrent() {
    if (messages.length === 0) return;
    const firstUser = messages.find((m) => m.role === "user");
    const title = (firstUser?.text || "Conversation").slice(0, 48);
    const entry = {
      id: `c-${Date.now()}`,
      title,
      savedAt: new Date().toISOString(),
      messages,
    };
    persistHistory([entry, ...history].slice(0, 30));
  }

  function newChat() {
    archiveCurrent();
    setMessages([]);
    setInput("");
    setEditingId(null);
    setThinking(false);
    setMenuOpen(false);
  }

  function clearConversation() {
    setMessages([]);
    setInput("");
    setEditingId(null);
    setThinking(false);
    setMenuOpen(false);
    try { localStorage.removeItem(currentKey); } catch { /* ignore */ }
  }

  function openHistory() {
    setHistory(loadHistory(historyKey));
    setHistoryOpen(true);
    setMenuOpen(false);
  }

  function restoreConversation(entry) {
    archiveCurrent();
    setMessages(entry.messages || []);
    setHistoryOpen(false);
  }

  function deleteHistoryEntry(id) {
    persistHistory(history.filter((h) => h.id !== id));
  }

  function clearAllHistory() {
    persistHistory([]);
  }

  const streamAnswer = useCallback(async (question, currentMessages) => {
    const history = currentMessages
      .filter((m) => m.role === "user" || m.role === "ac")
      .map((m) => ({ role: m.role === "ac" ? "assistant" : "user", content: m.text }));

    const ac = new AbortController();
    abortRef.current = ac;

    const streamingId = `a-${Date.now()}`;
    setMessages((m) => [...m, { id: streamingId, role: "ac", text: "", time: nowTime() }]);

    let fullAnswer = "";
    let serverSuggestions = null;

    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`${API}/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ question, history }),
        signal: ac.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const payload = JSON.parse(line.slice(6));
            if (payload.token) {
              fullAnswer += payload.token;
              setMessages((m) =>
                m.map((msg) =>
                  msg.id === streamingId ? { ...msg, text: msg.text + payload.token } : msg
                )
              );
            } else if (payload.done) {
              const sourceLabels = {
                tracer: "Tracer Study", employment: "Employment Records",
                imported_file: "Historical Files", announcement: "Announcements",
                event: "Events", job: "Job Postings", partnership: "Partnerships", user: "Alumni Records",
              };
              const sources = (payload.sources || []).map((s) => sourceLabels[s] || s);
              if (sources.length) {
                setMessages((m) =>
                  m.map((msg) => msg.id === streamingId ? { ...msg, sources } : msg)
                );
              }
              // Backend-computed suggestions (statistics answers) are context-aware
              // and guaranteed answerable; prefer them over the static local heuristic.
              if (Array.isArray(payload.suggestions) && payload.suggestions.length) {
                serverSuggestions = payload.suggestions;
              }
            } else if (payload.error) {
              setMessages((m) =>
                m.map((msg) =>
                  msg.id === streamingId ? { ...msg, text: payload.error } : msg
                )
              );
            }
          } catch { /* malformed line, skip */ }
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        setMessages((m) =>
          m.map((msg) =>
            msg.id === streamingId
              ? { ...msg, text: err.message || "Sorry, I could not reach the AI server. Make sure Ollama is running." }
              : msg
          )
        );
      }
    } finally {
      setThinking(false);
      // Prefer backend-computed suggestions (context-aware, guaranteed answerable
      // via the same topic dispatch aggregationService just used); fall back to
      // the static local heuristic for RAG-classified (non-statistics) answers.
      setMessages((prev) => {
        const lastAc = [...prev].reverse().find((m) => m.role === "ac");
        if (lastAc?.text) {
          const base = serverSuggestions?.length ? serverSuggestions : getSuggestions(lastAc.text);
          const filtered = base
            .filter((s) => s.toLowerCase() !== fullAnswer.toLowerCase() && s.toLowerCase() !== question.toLowerCase())
            .slice(0, 3);
          setSuggestions(filtered);
        }
        return prev;
      });
    }

  }, []);

  const send = useCallback((raw) => {
    const text = (raw ?? "").trim();
    if (!text || thinking) return;

    setSuggestions([]);
    abortRef.current?.abort();
    const userMsg = { id: `u-${Date.now()}`, role: "user", text, time: nowTime() };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setThinking(true);
    streamAnswer(text, next);
  }, [thinking, messages, streamAnswer]);

  function handleSubmit(e) {
    e.preventDefault();
    send(input);
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  async function copyMessage(id, text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1400);
    } catch { /* ignore */ }
  }

  function startEdit(msg) {
    setEditingId(msg.id);
    setEditText(msg.text);
  }

  function saveEdit(msg) {
    const text = editText.trim();
    if (!text) { setEditingId(null); return; }

    abortRef.current?.abort();
    setEditingId(null);

    const idx = messages.findIndex((x) => x.id === msg.id);
    if (idx === -1) return;
    const trimmed = messages.slice(0, idx + 1);
    trimmed[idx] = { ...trimmed[idx], text, time: nowTime() };
    setMessages(trimmed);
    setThinking(true);
    streamAnswer(text, trimmed);
  }

  async function handleReembed() {
    if (reembedding) return;
    setReembedding(true);
    setMenuOpen(false);
    try {
      const token = localStorage.getItem("auth_token");
      await fetch(`${API}/ai/reembed`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      setUploadMsg({ type: "ok", text: "Re-embedding started — this runs in the background." });
    } catch {
      setUploadMsg({ type: "err", text: "Re-embed failed. Try again." });
    } finally {
      setReembedding(false);
      setTimeout(() => setUploadMsg(null), 4000);
    }
  }

  async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setUploading(true);
    setUploadMsg(null);
    try {
      const token = localStorage.getItem("auth_token");
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${API}/ai/ingest`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Upload failed");
      setUploadMsg({ type: "ok", text: `"${file.name}" is being processed…` });
    } catch (err) {
      setUploadMsg({ type: "err", text: err.message });
    } finally {
      setUploading(false);
      setTimeout(() => setUploadMsg(null), 4000);
    }
  }

  async function fetchImportedFiles() {
    setLoadingFiles(true);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`${API}/ai/sources`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setImportedFiles(data.files || []);
    } catch { setImportedFiles([]); }
    finally { setLoadingFiles(false); }
  }

  async function deleteFile(id) {
    setDeletingId(id);
    try {
      const token = localStorage.getItem("auth_token");
      await fetch(`${API}/ai/sources/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      setImportedFiles((f) => f.filter((x) => x._id !== id));
    } catch { /* ignore */ }
    finally { setDeletingId(null); }
  }

  async function deleteAllFiles() {
    if (!window.confirm(`Delete all ${importedFiles.length} imported files and their embeddings?`)) return;
    for (const f of importedFiles) {
      await deleteFile(f._id);
    }
  }

  function exportChat() {
    const lines = messages.map((m) => {
      const who = m.role === "user" ? "You" : "AC";
      return `[${m.time}] ${who}:\n${m.text}${m.sources?.length ? `\nSources: ${m.sources.join(", ")}` : ""}`;
    });
    const blob = new Blob([lines.join("\n\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `AC-Chat-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function historyDate(iso) {
    try {
      return new Date(iso).toLocaleString([], {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      });
    } catch { return ""; }
  }

  return (
    <section className="content view aiassistant-view active-view">
      <div className="ac-chat">
        {/* Options menu (top-right) */}
        <div className="ac-toolbar">
          {started && (
            <>
              <button
                type="button"
                className="ac-clear-btn"
                onClick={exportChat}
                title="Export chat"
                aria-label="Export chat"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
                  <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Export
              </button>
              <button
                type="button"
                className="ac-clear-btn"
                onClick={clearConversation}
                title="Clear chat"
                aria-label="Clear chat"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
                  <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Clear
              </button>
            </>
          )}
          <div className="ac-menu-wrap" ref={menuRef}>
            <button
              type="button"
              className="ac-menu-trigger"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Chat options"
              onClick={() => setMenuOpen((o) => !o)}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
                <circle cx="5" cy="12" r="2" fill="currentColor" />
                <circle cx="12" cy="12" r="2" fill="currentColor" />
                <circle cx="19" cy="12" r="2" fill="currentColor" />
              </svg>
            </button>
            {menuOpen && (
              <div className="ac-menu" role="menu">
                <button type="button" className="ac-menu-item" role="menuitem" onClick={newChat}>
                  New chat
                </button>
                <button
                  type="button"
                  className="ac-menu-item"
                  role="menuitem"
                  onClick={clearConversation}
                  disabled={!started}
                >
                  Clear conversation
                </button>
                <button type="button" className="ac-menu-item" role="menuitem" onClick={openHistory}>
                  History
                </button>
                {user?.role === "admin" && (
                  <>
                    <button
                      type="button"
                      className="ac-menu-item"
                      role="menuitem"
                      onClick={() => { setMenuOpen(false); setFilesOpen(true); fetchImportedFiles(); }}
                    >
                      Manage files
                    </button>
                    <button
                      type="button"
                      className="ac-menu-item"
                      role="menuitem"
                      onClick={handleReembed}
                      disabled={reembedding}
                    >
                      {reembedding ? "Re-embedding…" : "Re-embed live data"}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {!started ? (
          <div className="ac-welcome">
            <h2 className="ac-welcome-title">Ask away, {firstName}!</h2>
            <p className="ac-welcome-sub">
              I'm AC, your assistant for alumni records, tracer surveys, employment, and more.
            </p>

            <form className="ac-composer ac-composer-center" onSubmit={handleSubmit}>
              <textarea
                ref={inputRef}
                className="ac-input"
                rows={1}
                placeholder="Ask AC…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                aria-label="Message AC"
              />
              <button
                type="submit"
                className="ac-send"
                disabled={!input.trim()}
                aria-label="Send message"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
                  <path d="M4 12l16-8-6 16-2.5-6.5L4 12z" fill="currentColor" />
                </svg>
              </button>
            </form>

            <div className="ac-quick-row">
              {QUICK_PROMPTS.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  className="ac-quick-chip"
                  onClick={() => send(q.text)}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="ac-thread" ref={scrollRef}>
              {messages.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="ac-row ac-row-user">
                    {editingId === m.id ? (
                      <div className="ac-edit-box">
                        <textarea
                          className="ac-input ac-edit-input"
                          rows={2}
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          autoFocus
                        />
                        <div className="ac-edit-actions">
                          <button type="button" className="ac-edit-cancel" onClick={() => setEditingId(null)}>
                            Cancel
                          </button>
                          <button type="button" className="ac-edit-save" onClick={() => saveEdit(m)}>
                            Update
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="ac-bubble ac-bubble-user">{m.text}</div>
                        <div className="ac-msg-tools">
                          <button
                            type="button"
                            className="ac-tool-btn"
                            onClick={() => copyMessage(m.id, m.text)}
                            aria-label="Copy message"
                            title={copiedId === m.id ? "Copied" : "Copy"}
                          >
                            {copiedId === m.id ? "✓" : "⧉"}
                          </button>
                          <button
                            type="button"
                            className="ac-tool-btn"
                            onClick={() => startEdit(m)}
                            aria-label="Edit message"
                            title="Edit"
                          >
                            ✎
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div key={m.id} className="ac-row ac-row-ac">
                    <div
                      className="ac-ac-text ac-markdown"
                      dangerouslySetInnerHTML={{ __html: marked.parse(m.text || "") }}
                    />
                    <div className="ac-msg-tools ac-msg-tools-ac">
                      <button
                        type="button"
                        className="ac-tool-btn"
                        onClick={() => copyMessage(m.id, m.text)}
                        title={copiedId === m.id ? "Copied" : "Copy"}
                        aria-label="Copy response"
                      >
                        {copiedId === m.id ? "✓" : "⧉"}
                      </button>
                    </div>
                  </div>
                )
              )}

              {thinking && (
                <div className="ac-row ac-row-ac">
                  <div className="ac-typing" aria-label="AC is typing">
                    <span /><span /><span />
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {suggestions.length > 0 && !thinking && (
              <div className="ac-suggestions-wrap">
                <span className="ac-suggestions-label">You might also ask:</span>
                <div className="ac-suggestions">
                  {suggestions.map((s) => (
                    <button key={s} type="button" className="ac-suggestion-chip" onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="ac-scroll-top-wrap">
              <button
                type="button"
                className="ac-scroll-top-btn"
                title="Scroll to top"
                onClick={() => scrollRef.current?.closest('.content')?.scrollTo({ top: 0, behavior: 'smooth' })}
              >
                ↑ Top
              </button>
            </div>

            <div className="ac-composer-wrap">
              {uploadMsg && (
                <div className={`ac-upload-toast ${uploadMsg.type === "err" ? "ac-upload-toast-err" : ""}`}>
                  {uploadMsg.text}
                </div>
              )}
              <form className="ac-composer" onSubmit={handleSubmit}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,.docx,.pdf"
                  style={{ display: "none" }}
                  onChange={handleFileUpload}
                />
                <button
                  type="button"
                  className="ac-upload-btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  title="Upload file to knowledge base"
                  aria-label="Upload file"
                >
                  {uploading
                    ? <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="10"/></svg>
                    : <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  }
                </button>
                <textarea
                  ref={inputRef}
                  className="ac-input"
                  rows={1}
                  placeholder="Ask AC…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  aria-label="Message AC"
                />
                <button
                  type="submit"
                  className="ac-send"
                  disabled={!input.trim() || thinking}
                  aria-label="Send message"
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
                    <path d="M4 12l16-8-6 16-2.5-6.5L4 12z" fill="currentColor" />
                  </svg>
                </button>
              </form>
            </div>
          </>
        )}

        {/* History drawer */}
        {historyOpen && (
          <div className="ac-history-overlay" onClick={() => setHistoryOpen(false)}>
            <div
              className="ac-history-panel"
              role="dialog"
              aria-modal="true"
              aria-label="Conversation history"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="ac-history-head">
                <h3>History</h3>
                <button
                  type="button"
                  className="ac-history-close"
                  aria-label="Close history"
                  onClick={() => setHistoryOpen(false)}
                >
                  ×
                </button>
              </div>

              {history.length === 0 ? (
                <p className="ac-history-empty">No saved conversations yet.</p>
              ) : (
                <>
                  <ul className="ac-history-list">
                    {history.map((h) => (
                      <li key={h.id} className="ac-history-item">
                        <button
                          type="button"
                          className="ac-history-open"
                          onClick={() => restoreConversation(h)}
                        >
                          <span className="ac-history-title">{h.title}</span>
                          <span className="ac-history-date">{historyDate(h.savedAt)}</span>
                        </button>
                        <button
                          type="button"
                          className="ac-history-del"
                          aria-label="Delete conversation"
                          title="Delete"
                          onClick={() => deleteHistoryEntry(h.id)}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button type="button" className="ac-history-clear-all" onClick={clearAllHistory}>
                    Clear all history
                  </button>
                </>
              )}
            </div>
          </div>
        )}
        {filesOpen && (
          <div className="ac-files-overlay" onClick={() => setFilesOpen(false)}>
            <div
              className="ac-files-panel"
              role="dialog"
              aria-modal="true"
              aria-label="Manage imported files"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="ac-files-head">
                <div className="ac-files-head-title">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Manage Files
                </div>
                <button type="button" className="ac-files-close" aria-label="Close" onClick={() => setFilesOpen(false)}>×</button>
              </div>

              <div className="ac-files-body">
                {/* Hidden file input */}
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv,.docx,.pdf"
                  style={{ display: "none" }}
                  ref={filesUploadRef}
                  onChange={async (e) => {
                    await handleFileUpload(e);
                    setTimeout(() => fetchImportedFiles(), 1500);
                  }}
                />

                {/* Upload zone */}
                <button
                  type="button"
                  className="ac-files-upload-zone"
                  onClick={() => filesUploadRef.current?.click()}
                  disabled={uploading}
                >
                  <div className="ac-files-upload-icon">
                    {uploading
                      ? <svg viewBox="0 0 24 24" width="20" height="20" fill="none" style={{ animation: "ac-spin 1s linear infinite" }}><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="10"/></svg>
                      : <svg viewBox="0 0 24 24" width="20" height="20" fill="none"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    }
                  </div>
                  <span className="ac-files-upload-label">{uploading ? "Uploading…" : "Click to upload a file"}</span>
                  <span className="ac-files-upload-hint">Excel, PDF, or Word · max 20 MB</span>
                </button>

                {/* Upload feedback */}
                {uploadMsg && (
                  <div className={`ac-files-toast${uploadMsg.type === "err" ? " ac-files-toast-err" : ""}`}>
                    {uploadMsg.text}
                  </div>
                )}

                {/* File list */}
                {loadingFiles ? (
                  <div className="ac-files-loading">
                    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" style={{ animation: "ac-spin 1s linear infinite", color: "var(--muted)" }}>
                      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="10"/>
                    </svg>
                  </div>
                ) : importedFiles.length === 0 ? (
                  <div className="ac-files-empty">
                    <div className="ac-files-empty-icon">
                      <svg viewBox="0 0 24 24" width="26" height="26" fill="none">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        <path d="M14 2v6h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                    </div>
                    <p>No files imported yet.</p>
                    <p>Upload an Excel, PDF, or Word file to add it to AC's knowledge base.</p>
                  </div>
                ) : (
                  <div className="ac-files-list">
                    <p className="ac-files-count">{importedFiles.length} file{importedFiles.length !== 1 ? "s" : ""}</p>
                    {importedFiles.map((f) => {
                      const TYPE_LABEL = { excel: "XLS", pdf: "PDF", docx: "DOC", csv: "CSV" };
                      const typeKey = ["excel", "pdf", "docx", "csv"].includes(f.file_type) ? f.file_type : "unknown";
                      const typeLabel = TYPE_LABEL[f.file_type] || (f.file_type?.toUpperCase() ?? "?");
                      const metaText = f.status === "done"
                        ? `${f.chunk_count ?? 0} chunk${f.chunk_count !== 1 ? "s" : ""}${f.sheet_type ? ` · ${f.sheet_type}` : ""}`
                        : f.status === "failed"
                          ? (f.error_message?.slice(0, 60) ?? "Processing failed")
                          : "Embedding in progress…";
                      const statusLabel = { done: "Ready", processing: "Processing", failed: "Failed" }[f.status] ?? f.status;
                      return (
                        <div key={f._id} className="ac-file-row">
                          <span className={`ac-file-type-badge ac-file-type-${typeKey}`}>{typeLabel}</span>
                          <div className="ac-file-info">
                            <span className="ac-file-name" title={f.file_name}>{f.file_name}</span>
                            <span className="ac-file-meta">{metaText}</span>
                          </div>
                          <span className={`ac-file-status ac-file-status-${f.status ?? "unknown"}`}>{statusLabel}</span>
                          <button
                            type="button"
                            className="ac-file-del"
                            aria-label="Delete file"
                            title="Delete this file"
                            disabled={deletingId === f._id}
                            onClick={() => deleteFile(f._id)}
                          >
                            {deletingId === f._id ? "…" : "×"}
                          </button>
                        </div>
                      );
                    })}
                    <button type="button" className="ac-files-delete-all" onClick={deleteAllFiles}>
                      Delete all files
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}