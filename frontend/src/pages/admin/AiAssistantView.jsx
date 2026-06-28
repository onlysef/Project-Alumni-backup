import React, { useState, useRef, useEffect, useCallback } from "react";
import { assistantReply } from "../../data.js";
import { useAuth } from "../../context/AuthContext.jsx";

const QUICK_PROMPTS = [
  { label: "Alumni records", text: "How many alumni records are there?" },
  { label: "Tracer surveys", text: "Show me tracer survey activity." },
  { label: "Employment status", text: "What's the current employment status?" },
  { label: "Job opportunities", text: "What job opportunities are available?" },
];

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

  const [messages, setMessages] = useState([]);   // { id, role: "user"|"ac", text, time }
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const [copiedId, setCopiedId] = useState(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState(() => loadHistory(historyKey));

  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const replyTimer = useRef(null);
  const menuRef = useRef(null);

  const started = messages.length > 0;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, thinking]);

  useEffect(() => () => clearTimeout(replyTimer.current), []);

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

  const send = useCallback((raw) => {
    const text = (raw ?? "").trim();
    if (!text || thinking) return;

    const userMsg = { id: `u-${Date.now()}`, role: "user", text, time: nowTime() };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setThinking(true);

    replyTimer.current = setTimeout(() => {
      const reply = assistantReply(text);
      setMessages((m) => [
        ...m,
        { id: `a-${Date.now()}`, role: "ac", text: reply, time: nowTime() },
      ]);
      setThinking(false);
    }, 750);
  }, [thinking]);

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

    setMessages((m) => {
      const idx = m.findIndex((x) => x.id === msg.id);
      if (idx === -1) return m;
      const trimmed = m.slice(0, idx + 1);
      trimmed[idx] = { ...trimmed[idx], text, time: nowTime() };
      return trimmed;
    });
    setEditingId(null);
    setThinking(true);
    clearTimeout(replyTimer.current);
    replyTimer.current = setTimeout(() => {
      const reply = assistantReply(text);
      setMessages((m) => [
        ...m,
        { id: `a-${Date.now()}`, role: "ac", text: reply, time: nowTime() },
      ]);
      setThinking(false);
    }, 750);
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
                    <div className="ac-ac-text">
                      {m.text.split("\n").map((line, i) => (
                        <p key={i}>{line}</p>
                      ))}
                    </div>
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
            </div>

            <div className="ac-composer-wrap">
              <form className="ac-composer" onSubmit={handleSubmit}>
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
              <p className="ac-disclaimer">AC is under development.</p>
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
      </div>
    </section>
  );
}