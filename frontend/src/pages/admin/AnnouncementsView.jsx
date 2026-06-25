import React, { useState, useEffect } from "react";
import { useOutletContext, useLocation, useNavigate } from "react-router-dom";
import Icon from "../../components/common/Icon.jsx";
import { Modal, ConfirmDialog } from "../../components/common/Primitives.jsx";
import AdminMenu from "../../components/admin/AdminMenu.jsx";
import { adminMenuChoices } from "../../data.js";

import { API, authHeaders } from "../../services/api.js";
const TYPE_ART_CLASS = { News: "", Event: "event", Career: "career", Scholarship: "scholarship" };

async function safeJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { message: `Server error (${res.status})` }; }
}

function currentUserId() {
  return JSON.parse(localStorage.getItem("auth_user") || "{}").id || "";
}

function mapRow(a) {
  const uid      = currentUserId();
  const likedBy  = (a.likedBy  || []).map(String);
  const sharedBy = (a.sharedBy || []).map(String);
  return {
    id:            String(a._id),
    title:         a.title,
    description:   a.description,
    type:          a.type,
    imageUrl:      a.imageUrl || "",
    likedBy,
    liked:         likedBy.includes(uid),
    likesCount:    a.likesCount  ?? likedBy.length,
    commentsCount: a.commentsCount ?? (Array.isArray(a.comments) ? a.comments.length : 0),
    sharedBy,
    shared:        sharedBy.includes(uid),
    sharesCount:   a.sharesCount ?? sharedBy.length,
    date:          a.createdAt,
  };
}

export default function AnnouncementsView() {
  const { showToast } = useOutletContext();
  const location = useLocation();
  const navigate = useNavigate();
  const openPostId = location.state?.postId ?? null;
  function onPostOpened() { navigate(".", { state: null, replace: true }); }
  const [rows, setRows]             = useState([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState("");
  const [dateFilter, setDateFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("All");
  const [composer, setComposer]     = useState(null);
  const [commentTarget, setCommentTarget] = useState(null);
  const [confirm, setConfirm]       = useState(null);

  // Inline quick composer state
  const [quickTitle, setQuickTitle]       = useState("");
  const [quickDesc, setQuickDesc]         = useState("");
  const [quickCategory, setQuickCategory] = useState("News");
  const [quickSaving, setQuickSaving]     = useState(false);

  useEffect(() => {
      fetchAnnouncements();
  }, []);

  useEffect(() => {
    if (!openPostId || rows.length === 0) return;
    const target = rows.find((r) => r.id === String(openPostId) || r.id === openPostId);
    if (target) {
      setCommentTarget(target);
      onPostOpened?.();
    }
  }, [openPostId, rows]);

  async function fetchAnnouncements() {
    setLoading(true);
    try {
      const res  = await fetch(`${API}/admin/announcements`, { headers: authHeaders() });
      const data = await safeJson(res);
      if (!res.ok) { showToast(data.message || "Failed to load announcements."); return; }
      setRows(data.announcements.map(mapRow));
    } catch {
      showToast("Could not connect to server.");
    } finally {
      setLoading(false);
    }
  }

  function matchesDate(r) {
    if (dateFilter === "All") return true;
    const today = new Date();
    const d = new Date(r.date);
    if (dateFilter === "Today")      return d.toDateString() === today.toDateString();
    if (dateFilter === "This Month") return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth();
    if (dateFilter === "This Year")  return d.getFullYear() === today.getFullYear();
    return true;
  }

  const filtered = rows.filter(
    (r) =>
      (!search || `${r.title} ${r.description}`.toLowerCase().includes(search.toLowerCase())) &&
      matchesDate(r) &&
      (typeFilter === "All" || r.type === typeFilter)
  );

  const recentPosts = rows.slice(0, 5);

  async function handlePost(data, editId) {
    try {
      const isEdit = !!editId;
      const url    = isEdit ? `${API}/admin/announcements/${editId}` : `${API}/admin/announcements`;
      const method = isEdit ? "PATCH" : "POST";
      const res    = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(data) });
      const json   = await safeJson(res);
      if (!res.ok) { showToast(json.message || "Failed to save announcement."); return; }
      if (isEdit) {
        setRows((prev) => prev.map((r) => (r.id === editId ? mapRow(json.announcement) : r)));
        showToast("Announcement updated.");
      } else {
        setRows((prev) => [mapRow(json.announcement), ...prev]);
        showToast("Announcement posted.");
      }
      setComposer(null);
    } catch {
      showToast("Could not connect to server.");
    }
  }

  function handleDelete(row) {
    setConfirm({
      message:      `Delete "${row.title}"? This cannot be undone.`,
      confirmLabel: "Delete",
      danger:       true,
      onConfirm:    async () => {
        setConfirm(null);
        try {
          const res  = await fetch(`${API}/admin/announcements/${row.id}`, { method: "DELETE", headers: authHeaders() });
          const json = await safeJson(res);
          if (!res.ok) { showToast(json.message || "Failed to delete."); return; }
          setRows((prev) => prev.filter((r) => r.id !== row.id));
          showToast(`${row.title} deleted.`);
        } catch {
          showToast("Could not connect to server.");
        }
      },
    });
  }

  async function handleLike(id) {
    const prev = rows.find(r => r.id === id);
    if (!prev) return;
    const uid      = currentUserId();
    const nowLiked = !prev.liked;

    // Optimistic update
    setRows(rs => rs.map(r => r.id === id ? {
      ...r,
      liked:      nowLiked,
      likesCount: nowLiked ? r.likesCount + 1 : r.likesCount - 1,
      likedBy:    nowLiked ? [...r.likedBy, uid] : r.likedBy.filter(x => x !== uid),
    } : r));

    try {
      const res  = await fetch(`${API}/admin/announcements/${id}/like`, { method: "POST", headers: authHeaders() });
      const json = await safeJson(res);
      if (!res.ok) {
        setRows(rs => rs.map(r => r.id === id ? prev : r)); // revert
        showToast(json.message || "Failed to update like.");
        return;
      }
      setRows(rs => rs.map(r => r.id === id ? {
        ...r,
        liked:      json.liked,
        likesCount: json.likesCount,
        likedBy:    (json.likedBy || []).map(String),
      } : r));
    } catch {
      setRows(rs => rs.map(r => r.id === id ? prev : r));
      showToast("Could not connect to server.");
    }
  }

  async function handleShare(id) {
    const post = rows.find(r => r.id === id);
    if (!post) return;

    // Always copy to clipboard regardless of share status
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?post=${id}`);
    } catch { /* clipboard unavailable */ }

    if (post.shared) {
      showToast("Link copied! (Already shared)");
      return;
    }

    // Optimistic update
    const uid = currentUserId();
    setRows(rs => rs.map(r => r.id === id ? {
      ...r,
      shared:      true,
      sharesCount: r.sharesCount + 1,
      sharedBy:    [...r.sharedBy, uid],
    } : r));

    try {
      const res  = await fetch(`${API}/admin/announcements/${id}/share`, { method: "POST", headers: authHeaders() });
      const json = await safeJson(res);
      if (!res.ok) {
        showToast(json.message || "Failed to track share.");
        return;
      }
      setRows(rs => rs.map(r => r.id === id ? {
        ...r,
        shared:      json.shared,
        sharesCount: json.sharesCount,
        sharedBy:    (json.sharedBy || []).map(String),
      } : r));
      showToast("Link copied and share tracked!");
    } catch {
      showToast("Link copied.");
    }
  }

  async function handleQuickPost() {
    const desc = quickDesc.trim();
    if (!desc) { showToast("Please write something first."); return; }
    setQuickSaving(true);
    const title = quickTitle.trim() || desc.slice(0, 60) + (desc.length > 60 ? "…" : "");
    await handlePost({ title, description: desc, type: quickCategory, imageUrl: "" }, null);
    setQuickTitle("");
    setQuickDesc("");
    setQuickCategory("News");
    setQuickSaving(false);
  }

  return (
    <section className={`content admin-view announcements-view view active-view`}>
      <section className="admin-card">
        <div className="admin-card-head">
          <h3>Posted Announcements</h3>
          <div>
            <AdminMenu menuKey="announcement-date" label={dateFilter} onSelect={setDateFilter} />
            <AdminMenu menuKey="announcement-type" label={typeFilter} onSelect={setTypeFilter} />
            <input
              className="admin-search"
              type="text"
              placeholder="Search announcements..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="table-scroll">
        <table className="admin-table announcement-table">
          <thead>
            <tr>
              <th>Post Title</th>
              <th>Type</th>
              <th>Description</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan="4" style={{ textAlign: "center", color: "#999", padding: "28px 0" }}>
                  Loading…
                </td>
              </tr>
            )}
            {!loading && filtered.map((r) => (
              <tr key={r.id}>
                <td>{r.title}</td>
                <td>{r.type}</td>
                <td>{r.description}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => { setComposer({ row: r }); showToast("Post loaded in composer."); }}
                  >
                    Edit
                  </button>
                  <button type="button" onClick={() => handleDelete(r)}>Delete</button>
                </td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan="4" style={{ textAlign: "center", color: "#999", padding: "28px 0" }}>
                  No announcements match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </section>

      <div className="announcement-grid">
        <section className="post-form-card post-launcher-card">
          <div className="post-composer-head">
            <div className="composer-avatar">TSU</div>
            <div>
              <h3>Create Announcement</h3>
              <span>TSU Alumni Office</span>
            </div>
          </div>
          <input
            className="composer-title"
            type="text"
            placeholder="Title (optional — auto-filled from content)"
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
          />
          <textarea
            className="composer-body"
            rows="3"
            placeholder="What's new for alumni?"
            value={quickDesc}
            onChange={(e) => setQuickDesc(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleQuickPost(); }}
          />
          <div className="composer-tools" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <select
              value={quickCategory}
              onChange={(e) => setQuickCategory(e.target.value)}
              style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #ccc", fontSize: 13 }}
            >
              {["News","Event","Career","Scholarship"].map(c => <option key={c}>{c}</option>)}
            </select>
            <button type="button" className="post-submit" disabled={quickSaving} onClick={handleQuickPost}>
              {quickSaving ? "Posting…" : "Post"}
            </button>
            <button
              type="button"
              style={{ fontSize: 12, color: "#fff", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
              onClick={() => setComposer({})}
            >
              More options
            </button>
          </div>
        </section>

        <aside className="recent-posts">
          <h3>Recent Posts</h3>
          {recentPosts.map((p) => (
            <article key={p.id}>
              <div
                className="post-open"
                role="button"
                tabIndex={0}
                onClick={() => setCommentTarget(p)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCommentTarget(p); } }}
              >
                {p.imageUrl ? (
                  <img className="post-art-img" src={p.imageUrl} alt={p.title} />
                ) : (
                  <div className={`post-art${TYPE_ART_CLASS[p.type] ? " " + TYPE_ART_CLASS[p.type] : ""}`}>
                    {p.title}
                  </div>
                )}
                <div className="post-meta">
                  <span className="post-meta-title">{p.title}</span>
                  {p.type && <span className="post-meta-type">{p.type}</span>}
                </div>
              </div>
              <div className="post-actions">
                <button
                  type="button"
                  className={p.liked ? "liked" : ""}
                  onClick={() => handleLike(p.id)}
                >
                  <span><Icon name="icon-25" /></span>
                  <span>{p.likesCount} {p.liked ? "Liked" : "Like"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCommentTarget(p)}
                >
                  <span><Icon name="icon-26" /></span>
                  <span>{p.commentsCount} Comment</span>
                </button>
                <button
                  type="button"
                  className={p.shared ? "shared" : ""}
                  onClick={() => handleShare(p.id)}
                >
                  <span><Icon name="icon-27" /></span>
                  <span>{p.sharesCount} {p.shared ? "Shared" : "Share"}</span>
                </button>
              </div>
            </article>
          ))}
          {!loading && recentPosts.length === 0 && (
            <p style={{ color: "#999", fontSize: 13, textAlign: "center" }}>No posts yet.</p>
          )}
        </aside>
      </div>

      <PostComposerModal
        composer={composer}
        onClose={() => setComposer(null)}
        onSubmit={handlePost}
        showToast={showToast}
      />

       <CommentModal
        post={commentTarget}
        onClose={() => setCommentTarget(null)}
        showToast={showToast}
        onLike={handleLike}
        onShare={handleShare}
        onCommentAdded={(postId, count) =>
          setRows(rs => rs.map(r => r.id === postId ? { ...r, commentsCount: count } : r))
        }
      />

      <ConfirmDialog
        open={!!confirm}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel}
        danger={confirm?.danger}
        onConfirm={confirm?.onConfirm}
        onCancel={() => setConfirm(null)}
      />
    </section>
  );
}

// ─── Comment Modal ────────────────────────────────────────────────────────────

function CommentModal({ post, onClose, showToast, onCommentAdded, onLike, onShare }) {
  const postId = post?.id;
  const [comments, setComments] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [text, setText]         = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!postId) return;
    setComments([]);
    setText("");
    setLoading(true);
    fetch(`${API}/admin/announcements/${postId}/comments`, { headers: authHeaders() })
      .then(safeJson)
      .then(data => { setComments(data.comments || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [postId]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setSubmitting(true);
    try {
      const res  = await fetch(`${API}/admin/announcements/${postId}/comment`, {
        method: "POST", headers: authHeaders(), body: JSON.stringify({ text }),
      });
      const json = await safeJson(res);
      if (!res.ok) { showToast(json.message || "Failed to post comment."); return; }
      setComments(prev => [...prev, json.comment]);
      setText("");
      onCommentAdded?.(postId, json.commentsCount);
      showToast("Comment posted.");
    } catch {
      showToast("Could not connect to server.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!postId) return null;

  return (
    <Modal open={!!postId} onClose={onClose}>
      <section className="tracer-modal post-viewer" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{post.title || "Post"}</h3>
          <button type="button" aria-label="Close" onClick={onClose}>×</button>
        </div>

        <div className="post-viewer-scroll">
          <div className="post-viewer-body">
            {post.type && <span className="post-meta-type">{post.type}</span>}
            {post.imageUrl && (
              <img className="post-viewer-img" src={post.imageUrl} alt={post.title} />
            )}
            {post.description && <p className="post-viewer-text">{post.description}</p>}
          </div>

          <div className="post-viewer-actions">
            <button type="button" className={post.liked ? "liked" : ""} onClick={() => onLike?.(post.id)}>
              <span><Icon name="icon-25" /></span>
              <span>{post.likesCount} {post.liked ? "Liked" : "Like"}</span>
            </button>
            <button type="button">
              <span><Icon name="icon-26" /></span>
              <span>{comments.length} Comment{comments.length === 1 ? "" : "s"}</span>
            </button>
            <button type="button" className={post.shared ? "shared" : ""} onClick={() => onShare?.(post.id)}>
              <span><Icon name="icon-27" /></span>
              <span>{post.sharesCount} {post.shared ? "Shared" : "Share"}</span>
            </button>
          </div>

          <div className="comment-list">
            {loading && <p className="comment-empty">Loading…</p>}
            {!loading && comments.length === 0 && (
              <p className="comment-empty">No comments yet. Be the first!</p>
            )}
            {comments.map((c, i) => (
              <div key={c._id || i} className="comment-item">
                <div className="comment-avatar">{c.userName?.charAt(0)?.toUpperCase() || "?"}</div>
                <div className="comment-bubble">
                  <strong>{c.userName}</strong>
                  <p>{c.text}</p>
                  <time>{new Date(c.createdAt).toLocaleString()}</time>
                </div>
              </div>
            ))}
          </div>
        </div>

        <form className="comment-form" onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Write a comment…"
            value={text}
            onChange={e => setText(e.target.value)}
            autoFocus
          />
          <button type="submit" disabled={submitting || !text.trim()}>
            {submitting ? "…" : "Post"}
          </button>
        </form>
      </section>
    </Modal>
  );
}

// ─── Post Composer Modal ──────────────────────────────────────────────────────

const QUICK_EMOJIS = [
  "😊","👍","🎉","❤️","📢","🏫","🎓","💼","📅","🌟",
  "🤝","📣","✅","🔔","💡","🏆","📝","🌍","👏","🙌",
];

function PostComposerModal({ composer, onClose, onSubmit, showToast }) {
  const [title, setTitle]               = useState("");
  const [description, setDescription]   = useState("");
  const [imageUrl, setImageUrl]         = useState("");
  const [category, setCategory]         = useState("News");
  const [saving, setSaving]             = useState(false);
  const [catOpen, setCatOpen]           = useState(false);
  const [emojiOpen, setEmojiOpen]       = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [location, setLocation]         = useState("");

  useEffect(() => {
    if (composer?.row) {
      setTitle(composer.row.title);
      setDescription(composer.row.description);
      setImageUrl(composer.row.imageUrl || "");
      setCategory(composer.row.type || "News");
    } else {
      setTitle("");
      setDescription("");
      setImageUrl(composer?.initialImage || "");
      setCategory("News");
    }
    setCatOpen(false);
    setEmojiOpen(false);
    setLocationOpen(false);
    setLocation("");
    setSaving(false);
  }, [composer]);

  useEffect(() => {
    if (!catOpen && !emojiOpen) return;
    const onDoc = () => { setCatOpen(false); setEmojiOpen(false); };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [catOpen, emojiOpen]);

  function handleImageChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setImageUrl(ev.target.result);
      showToast(`${file.name} attached.`);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function insertEmoji(emoji) {
    setDescription((prev) => prev + emoji);
    setEmojiOpen(false);
  }

  async function handleSubmit() {
    setSaving(true);
    const body = description.trim() || "No description provided yet.";
    const withLocation = location.trim() ? `${body}\n\n📍 ${location.trim()}` : body;
    await onSubmit(
      {
        title:       title.trim() || "Untitled Announcement",
        description: withLocation,
        type:        category,
        imageUrl,
      },
      composer.row?.id
    );
    setSaving(false);
  }

  if (!composer) return null;

  return (
    <Modal open={!!composer} onClose={onClose}>
      <section className="tracer-modal create-post-modal" role="dialog" aria-modal="true">
        <div className="create-post-head">
          <h3>{composer.row ? "Edit Announcement" : "Create Announcement"}</h3>
          <button type="button" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="create-post-profile">
          <div className="composer-avatar">TSU</div>
          <div>
            <strong>TSU Alumni Office</strong>
            <span style={{ position: "relative" }}>
              <button
                type="button"
                className="admin-choice composer-category"
                onClick={(e) => { e.stopPropagation(); setCatOpen((o) => !o); }}
              >
                {category}
              </button>
              {catOpen && (
                <div className="admin-menu show" onClick={(e) => e.stopPropagation()}>
                  {adminMenuChoices["post-category"].map((c) => (
                    <button key={c} type="button" onClick={() => { setCategory(c); setCatOpen(false); }}>{c}</button>
                  ))}
                </div>
              )}
            </span>
          </div>
        </div>
        <div className="create-post-body">
          <input
            className="composer-title"
            type="text"
            placeholder="Announcement title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className="composer-body"
            rows="5"
            placeholder="What's new for alumni?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          {imageUrl && (
            <div className="post-image-preview">
              <img src={imageUrl} alt="Preview" />
              <button type="button" className="post-image-remove" onClick={() => setImageUrl("")}>×</button>
            </div>
          )}
        </div>
        {locationOpen && (
          <div className="location-row">
            <span style={{ fontSize: 16 }}>📍</span>
            <input
              type="text"
              placeholder="Add a location…"
              value={location}
              autoFocus
              onChange={(e) => setLocation(e.target.value)}
            />
            {location && (
              <button type="button" className="location-clear" onClick={() => setLocation("")}>×</button>
            )}
          </div>
        )}
        <div className="create-post-options">
          <strong>Add to your announcement</strong>
          <label className="composer-icon-action" title="Add photo" style={{ cursor: "pointer" }}>
            <span><Icon name="icon-21" /></span>
            <input type="file" accept="image/*" onChange={handleImageChange} />
          </label>
          <span style={{ position: "relative" }}>
            <button
              type="button"
              className="composer-icon-action"
              title="Add emoji"
              onClick={(e) => { e.stopPropagation(); setEmojiOpen((o) => !o); }}
            >
              <span><Icon name="icon-22" /></span>
            </button>
            {emojiOpen && (
              <div className="emoji-popover" onClick={(e) => e.stopPropagation()}>
                {QUICK_EMOJIS.map((em) => (
                  <button key={em} type="button" onClick={() => insertEmoji(em)}>{em}</button>
                ))}
              </div>
            )}
          </span>
          <button
            type="button"
            className="composer-icon-action"
            title={locationOpen ? "Hide location" : "Add location"}
            onClick={() => setLocationOpen((o) => !o)}
            style={{ opacity: locationOpen ? 1 : undefined }}
          >
            <span><Icon name="icon-23" /></span>
          </button>
          <button
            type="button"
            className="composer-icon-action"
            title="Clear all"
            onClick={() => {
              setTitle(""); setDescription(""); setImageUrl("");
              setLocation(""); setLocationOpen(false);
              showToast("Composer cleared.");
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22" aria-hidden="true">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6"/>
              <path d="M14 11v6"/>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>
        </div>
        <button
          type="button"
          className="post-submit create-post-submit"
          disabled={saving}
          onClick={handleSubmit}
        >
          {saving ? "Saving…" : composer.row ? "Update" : "Post"}
        </button>
      </section>
    </Modal>
  );
}
