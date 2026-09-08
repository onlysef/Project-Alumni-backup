import React, { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "../../context/AuthContext.jsx";
import { API } from "../../services/api.js";
import { MiniDonut, DistributionBars } from "../../components/common/Charts.jsx";

// Renders the chart data the backend attaches to breakdown-style answers
// ("how many are male?", employment status, industry, etc.) — dispatches by
// chart.type onto the same chart primitives the admin Dashboard uses, so a
// chatbot answer and the dashboard read as one consistent visual system.
function AcChart({ chart }) {
  if (!chart || !chart.rows?.length) return null;
  const Chart = chart.type === "bars" ? DistributionBars : MiniDonut;
  return (
    <div className="ac-chart-block">
      {chart.title && <div className="ac-chart-title">{chart.title}</div>}
      <Chart rows={chart.rows} />
    </div>
  );
}

const QUICK_PROMPTS = [
  { label: "Alumni records", text: "How many alumni records are there?" },
  { label: "Tracer surveys", text: "Show me tracer survey activity." },
  { label: "Employment status", text: "What's the current employment status?" },
];

const FLAG_TYPE_LABEL = { injection: "Injection", fabrication: "Fabrication", unanswered: "Unanswered" };

function readableParagraphs(text = "") {
  return String(text)
    .split(/\n+/)
    .flatMap((block) => {
      const clean = block.trim();
      if (!clean) return [];
      if (clean.length <= 220) return [clean];
      const sentences = clean.split(/(?<=[.!?])\s+(?=[A-Z])/);
      const groups = [];
      let current = "";
      sentences.forEach((sentence) => {
        const next = current ? `${current} ${sentence}` : sentence;
        if (next.length > 240 && current) {
          groups.push(current);
          current = sentence;
        } else {
          current = next;
        }
      });
      if (current) groups.push(current);
      return groups;
    });
}

// The per-word reveal used a FIXED 24ms step with a flat 1800ms cap — fine
// for a short sentence (a couple dozen words), but a names list or a long
// breakdown easily runs past 75 words (75 * 24ms = 1800ms), and every word
// after that shared the exact same capped delay — instead of continuing to
// stagger in, the whole tail of the list popped in simultaneously the
// moment the cap was hit, which is exactly the "not smooth" jump reported
// for list/bullet answers. WORD_REVEAL_TARGET_MS is the total time the
// animation now aims to finish within regardless of length; the actual
// per-word step scales down for longer text so nothing hits a hard wall,
// bounded by a floor (still visibly sequential, just fast) and a ceiling
// (keeps a short answer's original, more leisurely pace).
const WORD_REVEAL_TARGET_MS = 1800;
const WORD_REVEAL_MIN_STEP  = 3;
const WORD_REVEAL_MAX_STEP  = 24;
const WORD_REVEAL_HARD_CAP  = 3000;

function animatedWords(text = "", keyPrefix = "word", cursor = { value: 0 }, stepMs = WORD_REVEAL_MAX_STEP) {
  return String(text).split(/(\s+)/).filter(Boolean).map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (/^\s+$/.test(part)) return <React.Fragment key={key}>{part}</React.Fragment>;

    const wordIndex = cursor.value;
    cursor.value += 1;
    return (
      <span
        key={key}
        className="ac-word"
        style={{ "--ac-word-delay": `${Math.min(wordIndex * stepMs, WORD_REVEAL_HARD_CAP)}ms` }}
      >
        {part}
      </span>
    );
  });
}

function renderInlineText(text = "", keyPrefix = "inline", cursor = { value: 0 }, stepMs = WORD_REVEAL_MAX_STEP) {
  const parts = String(text).split(/(\*\*[^*\n]+?\*\*|__[^_\n]+?__|`[^`\n]+?`|\*[^*\n]+?\*)/g);

  return parts.filter(Boolean).map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if ((part.startsWith("**") && part.endsWith("**")) ||
        (part.startsWith("__") && part.endsWith("__"))) {
      return <strong key={key}>{animatedWords(part.slice(2, -2), key, cursor, stepMs)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={key}>{animatedWords(part.slice(1, -1), key, cursor, stepMs)}</code>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={key}>{animatedWords(part.slice(1, -1), key, cursor, stepMs)}</em>;
    }
    return <React.Fragment key={key}>{animatedWords(part, key, cursor, stepMs)}</React.Fragment>;
  });
}

function tableCells(line = "") {
  return String(line)
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableDivider(line = "") {
  const cells = tableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function beginsStructuredBlock(lines, index) {
  const line = (lines[index] || "").trim();
  const next = (lines[index + 1] || "").trim();
  if (!line) return true;
  if (/^#{1,4}\s+/.test(line)) return true;
  if (/^[-*+•]\s+/.test(line) || /^\d+[.)]\s+/.test(line)) return true;
  if (/^>\s?/.test(line) || /^-{3,}$/.test(line)) return true;
  return line.includes("|") && next.includes("|");
}

function parseAssistantBlocks(text = "") {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }

    const unordered = line.match(/^[-*+•]\s+(.+)$/);
    if (unordered) {
      const items = [];
      while (index < lines.length) {
        const match = lines[index].trim().match(/^[-*+•]\s+(.+)$/);
        if (!match) break;
        items.push(match[1].trim());
        index += 1;
      }
      blocks.push({ type: "list", ordered: false, items });
      continue;
    }

    const ordered = line.match(/^(\d+)[.)]\s+(.+)$/);
    if (ordered) {
      const items = [];
      const start = Number(ordered[1]) || 1;
      while (index < lines.length) {
        const match = lines[index].trim().match(/^(\d+)[.)]\s+(.+)$/);
        if (!match) break;
        items.push(match[2].trim());
        index += 1;
      }
      blocks.push({ type: "list", ordered: true, start, items });
      continue;
    }

    const nextLine = (lines[index + 1] || "").trim();
    if (line.includes("|") && nextLine.includes("|")) {
      const header = tableCells(line);
      const alignments = isTableDivider(nextLine)
        ? tableCells(nextLine).map((cell) => cell.endsWith(":") ? "right" : cell.startsWith(":") ? "left" : "left")
        : header.map(() => "left");
      index += isTableDivider(nextLine) ? 2 : 1;
      const rows = [];
      while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
        if (!isTableDivider(lines[index])) rows.push(tableCells(lines[index]));
        index += 1;
      }
      blocks.push({ type: "table", header, alignments, rows });
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines = [];
      while (index < lines.length) {
        const match = lines[index].trim().match(/^>\s?(.*)$/);
        if (!match) break;
        quoteLines.push(match[1]);
        index += 1;
      }
      blocks.push({ type: "quote", text: quoteLines.join(" ") });
      continue;
    }

    if (/^-{3,}$/.test(line)) {
      blocks.push({ type: "divider" });
      index += 1;
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !beginsStructuredBlock(lines, index)) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    readableParagraphs(paragraphLines.join(" ")).forEach((paragraph) => {
      blocks.push({ type: "paragraph", text: paragraph });
    });
  }

  return blocks;
}

function AssistantResponse({ text, messageId }) {
  const blocks = parseAssistantBlocks(text);
  const wordCursor = { value: 0 };
  // See WORD_REVEAL_TARGET_MS's comment above — a long list needs a smaller
  // per-word step than a short answer so the whole thing keeps staggering
  // smoothly instead of hitting a flat delay cap partway through.
  const totalWords = (text.match(/\S+/g) || []).length;
  const wordStepMs = totalWords > 0
    ? Math.max(WORD_REVEAL_MIN_STEP, Math.min(WORD_REVEAL_MAX_STEP, WORD_REVEAL_TARGET_MS / totalWords))
    : WORD_REVEAL_MAX_STEP;

  return (
    <div className="ac-response-content">
      {blocks.map((block, blockIndex) => {
        const key = `${messageId}-block-${blockIndex}`;

        if (block.type === "heading") {
          const Heading = block.level <= 2 ? "h3" : "h4";
          return <Heading key={key}>{renderInlineText(block.text, key, wordCursor, wordStepMs)}</Heading>;
        }

        if (block.type === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List key={key} start={block.ordered ? block.start : undefined}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-item-${itemIndex}`}>{renderInlineText(item, `${key}-item-${itemIndex}`, wordCursor, wordStepMs)}</li>
              ))}
            </List>
          );
        }

        if (block.type === "table") {
          return (
            <div className="ac-table-scroll" key={key} role="region" aria-label="AI response table" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    {block.header.map((cell, cellIndex) => (
                      <th key={`${key}-head-${cellIndex}`} scope="col" style={{ textAlign: block.alignments[cellIndex] || "left" }}>
                        {renderInlineText(cell, `${key}-head-${cellIndex}`, wordCursor, wordStepMs)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={`${key}-row-${rowIndex}`}>
                      {block.header.map((_, cellIndex) => (
                        <td key={`${key}-cell-${rowIndex}-${cellIndex}`} style={{ textAlign: block.alignments[cellIndex] || "left" }}>
                          {renderInlineText(row[cellIndex] || "", `${key}-cell-${rowIndex}-${cellIndex}`, wordCursor, wordStepMs)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        if (block.type === "quote") {
          return <blockquote key={key}>{renderInlineText(block.text, key, wordCursor, wordStepMs)}</blockquote>;
        }

        if (block.type === "divider") return <hr key={key} />;

        const plainText = block.text.replace(/[*_`]/g, "");
        const className = /^The Bachelor|^Bachelor/i.test(plainText) ? "ac-answer-program" : undefined;
        return <p key={key} className={className}>{renderInlineText(block.text, key, wordCursor, wordStepMs)}</p>;
      })}
    </div>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 1 3 6.7" />
      <path d="M3 21v-6h6" />
    </svg>
  );
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
  // Keyed by role ALONE, not by which specific account is logged in — every
  // coordinator sharing a browser/device saw each other's chat history, and
  // a coordinator whose assigned college changed kept seeing their OLD
  // college's cached conversation (e.g. real CCS employment numbers) even
  // after being reassigned, since nothing about the stored key changed.
  // Keying by account id + college means a college reassignment always
  // starts a fresh, correctly-scoped conversation instead of showing
  // leftover answers from a scope the account no longer has.
  const acctKey    = `${user?.id || "anon"}_${user?.college || ""}`;
  const historyKey = `acChatHistory_${user?.role || "admin"}_${acctKey}`;
  const currentKey = `acCurrentChat_${user?.role || "admin"}_${acctKey}`;

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

  const [filesOpen, setFilesOpen] = useState(false);
  const [importedFiles, setImportedFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const [flagsOpen, setFlagsOpen] = useState(false);
  const [flags, setFlags] = useState([]);
  const [flagCounts, setFlagCounts] = useState({});
  const [flagTypeFilter, setFlagTypeFilter] = useState(null);
  const [loadingFlags, setLoadingFlags] = useState(false);
  const [resolvingFlagId, setResolvingFlagId] = useState(null);
  // Keyed by flag id — an optional note typed before resolving a flag (what
  // was actually wrong, or that it's a false positive). Local-only draft
  // state; only sent to the server at the moment that flag is resolved.
  const [flagNotes, setFlagNotes] = useState({});
  // A note input shown on every one of 35+ rows at once (rather than only
  // the rows someone actually wants to annotate) roughly doubled the list's
  // height and read as cluttered — collapsed by default, toggled open per
  // row on demand instead.
  const [noteOpenIds, setNoteOpenIds] = useState(() => new Set());

  const scrollRef = useRef(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  const menuRef = useRef(null);
  const filesUploadRef = useRef(null);

  const started = messages.length > 0;

  // .content (the outer <section>) is NOT the scrollable element here — the
  // "AC — AI ASSISTANT" CSS block sets .aiassistant-view { overflow: hidden },
  // which wins the cascade over .content's own overflow-y: auto (same
  // specificity, declared later). The actual scroll container is .ac-thread
  // (scrollRef below), nested inside via its own overflow-y: auto — .content
  // has essentially no scroll range of its own, so setting its scrollTop was
  // a near no-op. Scroll scrollRef directly instead of hunting for an
  // ancestor.
  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    } else if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'instant' });
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

  // Builds the history list with the current conversation archived onto it
  // (if non-empty) and, optionally, a specific entry removed — lets
  // restoreConversation drop the entry it's restoring FROM history in the
  // same state update as archiving what's currently on screen, so restoring
  // an old conversation and later hitting "New chat" again doesn't leave a
  // duplicate of it sitting in history (once under its original timestamp,
  // once re-archived under a new one).
  function buildArchivedHistory(excludeId) {
    let next = excludeId ? history.filter((h) => h.id !== excludeId) : history;
    if (messages.length > 0) {
      const firstUser = messages.find((m) => m.role === "user");
      const title = (firstUser?.text || "Conversation").slice(0, 48);
      const entry = {
        id: `c-${Date.now()}`,
        title,
        savedAt: new Date().toISOString(),
        messages,
      };
      next = [entry, ...next];
    }
    return next.slice(0, 30);
  }

  // Save the current conversation into history (if it has any messages)
  function archiveCurrent() {
    if (messages.length === 0) return;
    persistHistory(buildArchivedHistory());
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
    persistHistory(buildArchivedHistory(entry.id));
    setMessages(entry.messages || []);
    setHistoryOpen(false);
  }

  function deleteHistoryEntry(id) {
    persistHistory(history.filter((h) => h.id !== id));
  }

  function clearAllHistory() {
    persistHistory([]);
  }

  const streamAnswer = useCallback(async (question, currentMessages, { reuseId } = {}) => {
    const history = currentMessages
      .filter((m) => m.role === "user" || m.role === "ac")
      .map((m) => ({ role: m.role === "ac" ? "assistant" : "user", content: m.text }));

    const ac = new AbortController();
    abortRef.current = ac;

    // A retry reuses the failed message's own id/slot in place (its fields
    // were already reset by the caller) instead of appending a fresh
    // bubble — keeps the transcript from growing a duplicate AC row every
    // time the user retries the same question.
    const streamingId = reuseId || `a-${Date.now()}`;
    if (!reuseId) {
      setMessages((m) => [...m, { id: streamingId, role: "ac", text: "", time: nowTime() }]);
    }

    let fullAnswer = "";
    let serverSuggestions = null;
    let hadError = false;

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
            if (payload.reset) {
              // The server discarded a partial answer and is retrying from
              // scratch (e.g. after a rate-limit mid-stream) — clear what's
              // shown so far instead of letting the retry's tokens pile
              // onto it as a garbled, doubled-up answer.
              fullAnswer = "";
              setMessages((m) =>
                m.map((msg) => (msg.id === streamingId ? { ...msg, text: "" } : msg))
              );
            } else if (payload.token) {
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
              // Chart data (breakdown questions like "how many are male?")
              // renders an inline graph below the text answer.
              if (payload.chart) {
                setMessages((m) =>
                  m.map((msg) => msg.id === streamingId ? { ...msg, chart: payload.chart } : msg)
                );
              }
            } else if (payload.error) {
              hadError = true;
              setMessages((m) =>
                m.map((msg) =>
                  msg.id === streamingId ? { ...msg, text: payload.error, error: true } : msg
                )
              );
            }
          } catch { /* malformed line, skip */ }
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        hadError = true;
        setMessages((m) =>
          m.map((msg) =>
            msg.id === streamingId
              ? { ...msg, text: err.message || "Sorry, I could not reach the AI server. Please try again in a moment.", error: true }
              : msg
          )
        );
      }
    } finally {
      setThinking(false);
      // Prefer backend-computed suggestions (context-aware, guaranteed answerable
      // via the same topic dispatch aggregationService just used). RAG-classified
      // (non-statistics) answers don't get topic-driven suggestions from the
      // backend, so fall back to the fixed QUICK_PROMPTS set instead of a
      // separately-maintained keyword heuristic that drifts out of sync with
      // whatever topics aggregationService actually supports (e.g. it had no
      // awareness of the events/attendance topic added later).
      // Skip entirely when the answer failed — suggestion chips for a
      // question the assistant couldn't even answer are misleading.
      setMessages((prev) => {
        const lastAc = [...prev].reverse().find((m) => m.role === "ac");
        if (lastAc?.text && !hadError) {
          const base = serverSuggestions?.length ? serverSuggestions : QUICK_PROMPTS.map((q) => q.text);
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

  // Re-runs the question behind a failed AC answer, reusing that same
  // message's id/slot (via streamAnswer's reuseId) instead of appending a
  // duplicate user bubble + a second AC answer. historyBefore excludes the
  // failed turn itself so its error text never gets sent back to the
  // backend as prior "assistant" context.
  function retryMessage(acMsg) {
    const idx = messages.findIndex((m) => m.id === acMsg.id);
    if (idx === -1) return;
    let userText = null;
    for (let j = idx - 1; j >= 0; j--) {
      if (messages[j].role === "user") { userText = messages[j].text; break; }
    }
    if (!userText) return;

    abortRef.current?.abort();
    const historyBefore = messages.slice(0, idx);
    setMessages((m) =>
      m.map((msg) =>
        msg.id === acMsg.id ? { ...msg, text: "", error: false, sources: undefined, chart: undefined } : msg
      )
    );
    setThinking(true);
    streamAnswer(userText, historyBefore, { reuseId: acMsg.id });
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

  async function fetchFlags(type) {
    setLoadingFlags(true);
    setFlagTypeFilter(type || null);
    try {
      const token = localStorage.getItem("auth_token");
      const qs = `?reviewed=false${type ? `&type=${encodeURIComponent(type)}` : ""}`;
      const res = await fetch(`${API}/ai/flags${qs}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setFlags(data.flags || []);
      setFlagCounts(data.counts || {});
    } catch { setFlags([]); }
    finally { setLoadingFlags(false); }
  }

  async function resolveFlag(id) {
    setResolvingFlagId(id);
    try {
      const token = localStorage.getItem("auth_token");
      const note = (flagNotes[id] || "").trim();
      await fetch(`${API}/ai/flags/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(note ? { note } : {}),
      });
      setFlags((f) => f.filter((x) => x._id !== id));
      setFlagCounts((c) => {
        const flag = flags.find((x) => x._id === id);
        if (!flag || !c[flag.type]) return c;
        return { ...c, [flag.type]: c[flag.type] - 1 };
      });
      setFlagNotes((n) => {
        if (!(id in n)) return n;
        const next = { ...n };
        delete next[id];
        return next;
      });
    } catch { /* ignore */ }
    finally { setResolvingFlagId(null); }
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
                    {/* "Flagged items" menu entry hidden per explicit request —
                        the modal, fetchFlags/resolveFlag, and the whole
                        backend flagging pipeline are all still intact; this
                        is the one line that made it reachable from the UI. */}
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
              I'm AC, your assistant for alumni records, tracer surveys, and employment outcomes.
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
                            {copiedId === m.id ? <CheckIcon /> : <CopyIcon />}
                          </button>
                          <button
                            type="button"
                            className="ac-tool-btn"
                            onClick={() => startEdit(m)}
                            aria-label="Edit message"
                            title="Edit"
                          >
                            <EditIcon />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div key={m.id} className="ac-row ac-row-ac">
                    <div className="ac-ac-text">
                      <AssistantResponse text={m.text} messageId={m.id} />
                    </div>
                    <AcChart chart={m.chart} />
                    <div className="ac-msg-tools ac-msg-tools-ac">
                      <button
                        type="button"
                        className="ac-tool-btn"
                        onClick={() => copyMessage(m.id, m.text)}
                        title={copiedId === m.id ? "Copied" : "Copy"}
                        aria-label="Copy response"
                      >
                        {copiedId === m.id ? <CheckIcon /> : <CopyIcon />}
                      </button>
                      {m.error && (
                        <button
                          type="button"
                          className="ac-tool-btn"
                          onClick={() => retryMessage(m)}
                          title="Retry"
                          aria-label="Retry this question"
                        >
                          <RetryIcon />
                        </button>
                      )}
                    </div>
                  </div>
                )
              )}

              {thinking && (
                <div className="ac-row ac-row-ac">
                  <div className="ac-typing" aria-label="AC is thinking">
                    <span className="ac-typing-text">AC is thinking</span>
                    <span className="ac-typing-dots">
                      <span /><span /><span />
                    </span>
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
                onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
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

        {flagsOpen && (
          <div className="ac-files-overlay" onClick={() => setFlagsOpen(false)}>
            <div
              className="ac-files-panel"
              role="dialog"
              aria-modal="true"
              aria-label="Flagged items"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="ac-files-head">
                <div className="ac-files-head-title">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
                    <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Flagged Items
                </div>
                <button type="button" className="ac-files-close" aria-label="Close" onClick={() => setFlagsOpen(false)}>×</button>
              </div>

              <div className="ac-flag-filter-row">
                <button
                  type="button"
                  className={`ac-flag-filter-pill${!flagTypeFilter ? " active" : ""}`}
                  onClick={() => fetchFlags()}
                >
                  All ({Object.values(flagCounts).reduce((s, n) => s + n, 0)})
                </button>
                {Object.keys(FLAG_TYPE_LABEL).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`ac-flag-filter-pill${flagTypeFilter === t ? " active" : ""}`}
                    onClick={() => fetchFlags(t)}
                  >
                    {FLAG_TYPE_LABEL[t]} ({flagCounts[t] || 0})
                  </button>
                ))}
              </div>

              <div className="ac-files-body">
                {loadingFlags ? (
                  <div className="ac-files-loading">
                    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" style={{ animation: "ac-spin 1s linear infinite", color: "var(--muted)" }}>
                      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="10"/>
                    </svg>
                  </div>
                ) : flags.length === 0 ? (
                  <div className="ac-files-empty">
                    <p>No unreviewed flags.</p>
                    <p>Prompt-injection attempts, possible RAG fabrications, and questions AC couldn't answer all land here.</p>
                  </div>
                ) : (
                  <div className="ac-files-list">
                    <p className="ac-files-count">{flags.length} unreviewed</p>
                    {flags.map((fl) => (
                      <div key={fl._id} className="ac-flag-item">
                        <div className="ac-file-row">
                          <span className={`ac-file-type-badge ac-flag-type-${fl.type}`}>{FLAG_TYPE_LABEL[fl.type] || fl.type}</span>
                          <div className="ac-file-info">
                            {fl.question && <span className="ac-file-name" title={fl.question}>{fl.question}</span>}
                            {fl.detail && <span className="ac-file-meta" title={fl.detail}>{fl.detail}</span>}
                          </div>
                          <span className="ac-file-status">{fl.sourceType}</span>
                          <div className="ac-flag-actions">
                            <button
                              type="button"
                              className="ac-flag-note-toggle"
                              aria-label={noteOpenIds.has(fl._id) ? "Hide note" : "Add a note"}
                              title={noteOpenIds.has(fl._id) ? "Hide note" : "Add a note"}
                              onClick={() => setNoteOpenIds((s) => {
                                const next = new Set(s);
                                if (next.has(fl._id)) next.delete(fl._id); else next.add(fl._id);
                                return next;
                              })}
                            >
                              <EditIcon />
                            </button>
                            <button
                              type="button"
                              className="ac-file-del"
                              aria-label="Mark reviewed"
                              title="Mark reviewed"
                              disabled={resolvingFlagId === fl._id}
                              onClick={() => resolveFlag(fl._id)}
                            >
                              {resolvingFlagId === fl._id ? "…" : "✓"}
                            </button>
                          </div>
                        </div>
                        {noteOpenIds.has(fl._id) && (
                          <input
                            type="text"
                            className="ac-flag-note-input"
                            placeholder="Add a note (optional)"
                            autoFocus
                            value={flagNotes[fl._id] || ""}
                            onChange={(e) => setFlagNotes((n) => ({ ...n, [fl._id]: e.target.value }))}
                            disabled={resolvingFlagId === fl._id}
                          />
                        )}
                      </div>
                    ))}
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
