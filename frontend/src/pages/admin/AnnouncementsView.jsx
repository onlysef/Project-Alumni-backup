import React, { useState, useEffect, useRef } from "react";
import { useOutletContext, useLocation, useNavigate } from "react-router-dom";
import Icon from "../../components/common/Icon.jsx";
import { Modal, ConfirmDialog } from "../../components/common/Primitives.jsx";
import AdminMenu from "../../components/admin/AdminMenu.jsx";
import ActionMenu from "../../components/admin/ActionMenu.jsx";
import { adminMenuChoices } from "../../data.js";
import alumniLogo from "../../assets/images/alumni-removebg.png";
import { useAuth } from "../../context/AuthContext.jsx";

import { API, authHeaders } from "../../services/api.js";
import { isJunkText } from "../../utils/textQuality.js";

const JOB_JUNK_FIELD_RULES = {
  title:               { requireWord: true,  minLength: 3, blockAtSymbol: true },
  jobDescription:      { requireWord: true,  minLength: 15, requireMultiWord: true },
  keyResponsibilities: { requireWord: true,  requireMultiWord: true },
  qualifications:      { requireWord: true,  requireMultiWord: true },
  preferredSkills:     { requireWord: true,  requireMultiWord: true },
  location:            { requireWord: true,  blockAtSymbol: true, blockLongDigitRun: true },
  salaryRange:         { requireWord: false, requireDigitOrPhrase: true },
};
const JOB_JUNK_FIELD_MESSAGES = {
  title: "That doesn't look like a real job title.",
  jobDescription: "The job description looks like random text. Please write an actual description of the role.",
  keyResponsibilities: "Key responsibilities looks like random text. Please list the actual duties for this role.",
  qualifications: "Qualifications & requirements looks like random text. Please list the actual qualifications needed.",
  preferredSkills: "Preferred skills looks like random text. Please list actual skills.",
  location: "That doesn't look like a real location.",
  salaryRange: "That doesn't look like a real salary range.",
};
// Matches the modal's visual top-to-bottom field order, used to pick which
// field to scroll into view when more than one has an error.
const JOB_FIELD_ORDER = ["title", "location", "salaryRange", "jobDescription", "keyResponsibilities", "qualifications", "preferredSkills"];

// Returns every invalid field at once (not just the first) so each one can
// show its own message under its own box instead of one banner the admin
// has to match back to whichever field it's actually about.
function validateJobFields(fields) {
  const errors = {};
  if (!fields.title.trim()) errors.title = "Job title is required.";
  else if (isJunkText(fields.title, JOB_JUNK_FIELD_RULES.title)) errors.title = JOB_JUNK_FIELD_MESSAGES.title;

  if (!fields.jobDescription.trim()) errors.jobDescription = "A job description is required.";
  else if (isJunkText(fields.jobDescription, JOB_JUNK_FIELD_RULES.jobDescription)) errors.jobDescription = JOB_JUNK_FIELD_MESSAGES.jobDescription;

  ["keyResponsibilities", "qualifications", "preferredSkills", "location", "salaryRange"].forEach((f) => {
    if (fields[f] && isJunkText(fields[f], JOB_JUNK_FIELD_RULES[f])) errors[f] = JOB_JUNK_FIELD_MESSAGES[f];
  });
  return errors;
}
const TYPE_ART_CLASS = { News: "" };
const COMMENT_EMOJIS = ["😀", "😂", "😍", "👍", "❤️", "🎉"];

async function safeJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { message: `Server error (${res.status})` }; }
}

// Display-only title case; keeps acronyms and never changes the stored value.
function toTitleCase(str = "") {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

const DESCRIPTION_PREVIEW_CHARS = 160;

function ExpandableText({ text = "" }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return "—";
  const isLong = text.length > DESCRIPTION_PREVIEW_CHARS;
  return (
    <div className="expandable-text">
      <p className={isLong && !expanded ? "is-clamped" : ""}>{text}</p>
      {isLong && (
        <button type="button" className="expandable-text-toggle" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>
          {expanded ? "See less" : "See more"}
        </button>
      )}
    </div>
  );
}

// datetime-local needs local time; toISOString() is UTC.
function toDatetimeLocal(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

// The past-date check applies only when the start is being changed.
function validateEventDates(startStr, endStr, previousStartStr) {
  if (!startStr) return "";
  const start = new Date(startStr);
  if (isNaN(start.getTime())) return "Invalid start date & time.";
  const startIsChanging = previousStartStr === undefined || startStr !== previousStartStr;
  if (startIsChanging && start < new Date()) return "Event date & time cannot be in the past.";
  if (endStr) {
    const end = new Date(endStr);
    if (isNaN(end.getTime())) return "Invalid end date & time.";
    if (end <= start) return "End date & time must be after the start date & time.";
  }
  return "";
}

// Relative time for the Recent Activity feed — "3h ago" reads faster than a
// full timestamp in a short activity row, same convention social feeds use.
function timeAgo(value) {
  if (!value) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(value).toLocaleDateString();
}


function mapRow(a) {
  return {
    id:            String(a._id),
    title:         a.title,
    description:   a.description,
    jobDescription:      a.jobDescription || "",
    keyResponsibilities: a.keyResponsibilities || "",
    qualifications:      a.qualifications || "",
    preferredSkills:     a.preferredSkills || "",
    salaryRange:         a.salaryRange || "",
    type:          a.type,
    imageUrl:      a.imageUrl || "",
    location:      a.location || "",
    hasImage:      a.hasImage ?? !!a.imageUrl,
    liked:         a.isLikedByMe ?? false,
    likesCount:    a.likesCount  ?? 0,
    commentsCount: a.commentsCount ?? 0,
    shared:        a.isSharedByMe ?? false,
    sharesCount:   a.sharesCount  ?? 0,
    date:          a.createdAt,
    source:         a.source || "announcement",
    posterName:     a.posterName || "",
    eventDatetime:  a.event_datetime || "",
    endDatetime:    a.end_datetime || "",
    capacity:       a.capacity ?? "",
    jobType:        a.jobType || "",
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
  const [page, setPage]             = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [recentPosts, setRecentPosts] = useState([]);
  const [activities, setActivities]   = useState([]);
  const [activitiesLoading, setActivitiesLoading] = useState(true);
  const [search, setSearch]         = useState("");
  const [dateFilter, setDateFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("All");
  const [composer, setComposer]     = useState(null);
  const [eventEdit, setEventEdit]   = useState(null);
  const [jobEdit, setJobEdit]       = useState(null);
  const [commentTarget, setCommentTarget] = useState(null);
  const [confirm, setConfirm]       = useState(null);
  const likingPosts = React.useRef(new Set());

  // Resolve the viewer against current list state so the modal and card
  // always show the same interaction counts.
  const activeCommentPost = commentTarget
    ? rows.find(r => r.id === commentTarget.id)
      || recentPosts.find(r => r.id === commentTarget.id)
      || commentTarget
    : null;

  // Inline quick composer state
  const [quickTitle, setQuickTitle]       = useState("");
  const [quickDesc, setQuickDesc]         = useState("");
  const [quickCategory, setQuickCategory] = useState("News");
  const [quickSaving, setQuickSaving]     = useState(false);

  useEffect(() => {
    fetchAnnouncements(page);
  }, [page]);

  useEffect(() => {
    fetch(`${API}/admin/announcements/recent?limit=5`, { headers: authHeaders() })
      .then(safeJson)
      .then(data => { if (data.announcements) setRecentPosts(data.announcements.map(mapRow)); })
      .catch(() => {});
  }, []);

  // hours=all: the default 24h window is usually empty.
  useEffect(() => {
    fetch(`${API}/admin/announcements/activity?limit=8&hours=all`, { headers: authHeaders() })
      .then(safeJson)
      .then(data => setActivities(data.activities || []))
      .catch(() => setActivities([]))
      .finally(() => setActivitiesLoading(false));
  }, []);

  useEffect(() => {
    if (!openPostId) return;
    onPostOpened();
    fetch(`${API}/admin/announcements/${openPostId}`, { headers: authHeaders() })
      .then(safeJson)
      .then(data => {
        if (data.announcement) {
          setCommentTarget(mapRow(data.announcement));
        } else {
          showToast("This announcement is no longer available.");
        }
      })
      .catch(() => showToast("This announcement is no longer available."));
  }, [openPostId]);

  async function fetchAnnouncements(p = 1) {
    setLoading(true);
    try {
      const res  = await fetch(`${API}/admin/announcements?page=${p}&limit=10`, { headers: authHeaders() });
      const data = await safeJson(res);
      if (!res.ok) { showToast(data.message || "Failed to load announcements."); return; }
      setRows(data.announcements.map(mapRow));
      setTotalPages(data.pages ?? 1);
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
        showToast("Announcement posted.");
        setPage(1);
        fetchAnnouncements(1);
      }
      setComposer(null);
    } catch {
      showToast("Could not connect to server.");
    }
  }

  // Event/Job updates return the raw document, so merge into the existing row instead of mapRow().
  async function handleEventSave(data) {
    try {
      const res  = await fetch(`${API}/admin/announcements/events/${eventEdit.id}`, {
        method: "PATCH", headers: authHeaders(), body: JSON.stringify(data),
      });
      const json = await safeJson(res);
      if (!res.ok) { showToast(json.message || "Failed to save event."); return; }
      const e = json.event;
      setRows((prev) => prev.map((r) => r.id === eventEdit.id ? {
        ...r,
        title: e.title, description: e.description, location: e.location || "",
        eventDatetime: e.event_datetime || "", endDatetime: e.end_datetime || "",
        capacity: e.capacity ?? "",
      } : r));
      showToast("Event updated.");
      setEventEdit(null);
    } catch {
      showToast("Could not connect to server.");
    }
  }

  // Returns an error message string on failure (so JobEditModal can show it
  // inline, scrolled into view) or null on success — a thrown/toasted error
  // alone left the modal open with no visible reason why, same issue fixed
  // on the employer's own Create/Edit modal.
  async function handleJobSave(data) {
    try {
      const res  = await fetch(`${API}/admin/announcements/jobs/${jobEdit.id}`, {
        method: "PATCH", headers: authHeaders(), body: JSON.stringify(data),
      });
      const json = await safeJson(res);
      if (!res.ok) return json.message || "Failed to save job.";
      const j = json.job;
      setRows((prev) => prev.map((r) => r.id === jobEdit.id ? {
        ...r,
        title: j.title, location: j.location || "", jobType: j.jobType || "",
        jobDescription: j.jobDescription || "", keyResponsibilities: j.keyResponsibilities || "",
        qualifications: j.qualifications || "", preferredSkills: j.preferredSkills || "",
        salaryRange: j.salaryRange || "",
      } : r));
      showToast("Job updated.");
      setJobEdit(null);
      return null;
    } catch {
      return "Could not connect to server.";
    }
  }

  function handleDelete(row) {
    const url = row.source === "event" ? `${API}/admin/announcements/events/${row.id}`
      : row.source === "job" ? `${API}/admin/announcements/jobs/${row.id}`
      : `${API}/admin/announcements/${row.id}`;
    setConfirm({
      message:      `Delete "${row.title}"? This cannot be undone.`,
      confirmLabel: "Delete",
      danger:       true,
      onConfirm:    async () => {
        setConfirm(null);
        try {
          const res  = await fetch(url, { method: "DELETE", headers: authHeaders() });
          const json = await safeJson(res);
          if (!res.ok) { showToast(json.message || "Failed to delete."); return; }
          setRows((prev) => prev.filter((r) => r.id !== row.id));
          setRecentPosts((prev) => prev.filter((r) => r.id !== row.id));
          showToast(`${row.title} deleted.`);
        } catch {
          showToast("Could not connect to server.");
        }
      },
    });
  }

  async function handleLike(id) {
    if (likingPosts.current.has(id)) return;
    const prev = rows.find(r => r.id === id)
      || recentPosts.find(r => r.id === id)
      || (commentTarget?.id === id ? commentTarget : null);
    if (!prev) return;
    likingPosts.current.add(id);
    const nowLiked = !prev.liked;
    const optimisticCount = Math.max(0, prev.likesCount + (nowLiked ? 1 : -1));

    const patchLike = (rs, liked, count) => rs.map(r => r.id === id ? { ...r, liked, likesCount: count } : r);
    const patchTarget = (liked, count) =>
      setCommentTarget(r => r?.id === id ? { ...r, liked, likesCount: count } : r);
    setRows(rs => patchLike(rs, nowLiked, optimisticCount));
    setRecentPosts(rs => patchLike(rs, nowLiked, optimisticCount));
    patchTarget(nowLiked, optimisticCount);

    try {
      const res  = await fetch(`${API}/admin/announcements/${id}/like`, { method: "POST", headers: authHeaders() });
      const json = await safeJson(res);
      if (!res.ok) {
        setRows(rs => rs.map(r => r.id === id ? prev : r));
        setRecentPosts(rs => rs.map(r => r.id === id ? prev : r));
        setCommentTarget(r => r?.id === id ? prev : r);
        showToast(json.message || "Failed to update like.");
        return;
      }
      setRows(rs => patchLike(rs, json.liked, json.likesCount));
      setRecentPosts(rs => patchLike(rs, json.liked, json.likesCount));
      patchTarget(json.liked, json.likesCount);
    } catch {
      setRows(rs => rs.map(r => r.id === id ? prev : r));
      setRecentPosts(rs => rs.map(r => r.id === id ? prev : r));
      setCommentTarget(r => r?.id === id ? prev : r);
      showToast("Could not connect to server.");
    } finally {
      likingPosts.current.delete(id);
    }
  }

  async function handleShare(id) {
    const post = rows.find(r => r.id === id);
    if (!post) return;

    const shareUrl  = `${window.location.origin}${window.location.pathname}?post=${id}`;
    const shareText = `${post.title}\n\n${post.description}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: post.title, text: shareText, url: shareUrl });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        showToast("Link copied to clipboard!");
      } else {
        showToast("Could not share — copy this link manually: " + shareUrl);
      }
    } catch (err) {
      if (err?.name === "AbortError") return; // user cancelled the native share sheet — don't count it
      showToast("Could not share this post.");
      return;
    }

    if (post.shared) return; // already tracked before, don't double count

    const patchShare = (rs, shared, count) => rs.map(r => r.id === id ? { ...r, shared, sharesCount: count } : r);
    setRows(rs => patchShare(rs, true, post.sharesCount + 1));
    setRecentPosts(rs => patchShare(rs, true, post.sharesCount + 1));

    try {
      const res  = await fetch(`${API}/admin/announcements/${id}/share`, { method: "POST", headers: authHeaders() });
      const json = await safeJson(res);
      if (!res.ok) {
        showToast(json.message || "Failed to track share.");
        return;
      }
      setRows(rs => patchShare(rs, json.shared, json.sharesCount));
      setRecentPosts(rs => patchShare(rs, json.shared, json.sharesCount));
    } catch { /* keep optimistic state on network failure */ }
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
      <div className="announcement-grid">
        <div className="announcement-left-col">
          <section
            className="post-launcher-card"
            role="button"
            tabIndex={0}
            aria-label="Create announcement"
            onClick={() => setComposer({})}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setComposer({});
              }
            }}
          >
            <div className="composer-avatar"><img src={alumniLogo} alt="Alumni Association" /></div>
            <span className="post-launcher-prompt">What's new for alumni?</span>
            <span className="post-launcher-icon" title="Write announcement"><Icon name="icon-edit" /></span>
          </section>

          <section className="recent-activity-card">
            <h3>Recent Activity</h3>
            {activitiesLoading && <p className="recent-activity-empty">Loading…</p>}
            {!activitiesLoading && activities.length === 0 && (
              <p className="recent-activity-empty">No likes, comments, or shares yet.</p>
            )}
            {!activitiesLoading && activities.map((a) => (
              <div key={a._id} className="recent-activity-row">
                <span className="recent-activity-icon">
                  <Icon name={a.action === "liked" ? "icon-25" : a.action === "shared" ? "icon-27" : "icon-26"} />
                </span>
                <p className="recent-activity-text">
                  <strong>{a.user_name}</strong> {a.action}{" "}
                  <span
                    className="recent-activity-link"
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(".", { state: { postId: a.announcement_id } })}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(".", { state: { postId: a.announcement_id } }); } }}
                  >
                    "{toTitleCase(a.announcement_title || "a post")}"
                  </span>
                  <span className="recent-activity-time"> · {timeAgo(a.createdAt)}</span>
                </p>
              </div>
            ))}
          </section>

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
                  <th>Description</th>
                  <th>Type</th>
                  <th>Posted By</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan="5" style={{ textAlign: "center", color: "#999", padding: "28px 0" }}>
                      Loading…
                    </td>
                  </tr>
                )}
                {!loading && filtered.map((r) => (
                  <tr key={r.id}>
                    <td>{toTitleCase(r.title)}</td>
                    <td><ExpandableText text={r.description ?? r.jobDescription} /></td>
                    <td>{r.type}</td>
                    <td>{r.posterName || "—"}</td>
                    <td>
                      <div className="announcement-action-menu">
                        <ActionMenu
                          actions={["edit", "delete"]}
                          onSelect={(action) => {
                            if (action === "edit") {
                              if (r.source === "event") { setEventEdit(r); return; }
                              if (r.source === "job") { setJobEdit(r); return; }
                              setComposer({ row: r });
                              showToast("Post loaded in composer.");
                            } else {
                              handleDelete(r);
                            }
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan="5" style={{ textAlign: "center", color: "#999", padding: "28px 0" }}>
                      No announcements match the current filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
            {totalPages > 1 && (
              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, padding: "12px 0" }}>
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage(p => p - 1)}
                  style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #ccc", cursor: page <= 1 ? "not-allowed" : "pointer", opacity: page <= 1 ? 0.4 : 1 }}
                >
                  ‹ Prev
                </button>
                <span style={{ fontSize: 13, color: "#76656a" }}>Page {page} of {totalPages}</span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => p + 1)}
                  style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #ccc", cursor: page >= totalPages ? "not-allowed" : "pointer", opacity: page >= totalPages ? 0.4 : 1 }}
                >
                  Next ›
                </button>
              </div>
            )}
          </section>
        </div>

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
                    {toTitleCase(p.title)}
                  </div>
                )}
                <div className="post-meta">
                  {p.imageUrl && <span className="post-meta-title">{toTitleCase(p.title)}</span>}
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

      <EventEditModal
        row={eventEdit}
        onClose={() => setEventEdit(null)}
        onSubmit={handleEventSave}
      />

      <JobEditModal
        row={jobEdit}
        onClose={() => setJobEdit(null)}
        onSubmit={handleJobSave}
      />

       <CommentModal
        post={activeCommentPost}
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
  const { user } = useAuth();
  const postId = post?.id;
  const [fullPost, setFullPost]   = useState(null);
  const [comments, setComments]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [notFound, setNotFound]   = useState(false);
  const [text, setText]           = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [editing, setEditing]     = useState(null); // { id, text, saving }

  useEffect(() => {
    if (!postId) return;
    setFullPost(null);
    setComments([]);
    setText("");
    setEditing(null);
    setLoading(true);
    setNotFound(false);
    fetch(`${API}/admin/announcements/${postId}`, { headers: authHeaders() })
      .then(async res => {
        const data = await safeJson(res);
        if (!res.ok) { setNotFound(true); setLoading(false); return; }
        if (data.announcement) {
          setFullPost(data.announcement);
          setComments(data.announcement.comments || []);
        }
        setLoading(false);
      })
      .catch(() => { setNotFound(true); setLoading(false); });
  }, [postId]);

  const display = fullPost ? { ...post, imageUrl: fullPost.imageUrl || "", description: fullPost.description } : post;

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

  async function handleSaveEdit() {
    if (!editing?.text.trim() || editing.saving) return;
    const { id, text: newText } = editing;
    setEditing(ed => ({ ...ed, saving: true }));
    try {
      const res  = await fetch(`${API}/admin/announcements/${postId}/comment/${id}`, {
        method: "PUT", headers: authHeaders(), body: JSON.stringify({ text: newText }),
      });
      const json = await safeJson(res);
      if (!res.ok) { showToast(json.message || "Failed to update comment."); setEditing(ed => ed && { ...ed, saving: false }); return; }
      setComments(prev => prev.map(c => c._id === id ? { ...c, ...json.comment } : c));
      setEditing(null);
      showToast("Comment updated.");
    } catch {
      showToast("Could not connect to server.");
      setEditing(ed => ed && { ...ed, saving: false });
    }
  }

  function handleDeleteComment(comment) {
    setDeleteConfirm({
      message: "Delete this comment? This cannot be undone.",
      onConfirm: async () => {
        setDeleteConfirm(null);
        try {
          const res  = await fetch(`${API}/admin/announcements/${postId}/comment/${comment._id}`, {
            method: "DELETE", headers: authHeaders(),
          });
          const json = await safeJson(res);
          if (!res.ok) { showToast(json.message || "Failed to delete comment."); return; }
          setComments(prev => prev.filter(c => c._id !== comment._id));
          onCommentAdded?.(postId, json.commentsCount);
          showToast("Comment deleted.");
        } catch {
          showToast("Could not connect to server.");
        }
      },
    });
  }

  if (!postId) return null;

  return (
    <>
    <Modal open={!!postId} onClose={onClose}>
      <section className="tracer-modal post-viewer" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{display.title ? toTitleCase(display.title) : "Post"}</h3>
          <button type="button" aria-label="Close" onClick={onClose}>×</button>
        </div>

        <div className="post-viewer-scroll">
          {notFound ? (
            <p className="comment-empty" style={{ padding: "32px 16px", textAlign: "center" }}>
              This announcement is no longer available.
            </p>
          ) : (
            <>
              <div className="post-viewer-body">
                {display.type && <span className="post-meta-type">{display.type}</span>}
                {display.location && (
                  <p className="post-viewer-location">
                    <span aria-hidden="true">📍</span> {display.location}
                  </p>
                )}
                {display.imageUrl && (
                  <img className="post-viewer-img" src={display.imageUrl} alt={display.title} />
                )}
                {display.description && <p className="post-viewer-text">{display.description}</p>}
              </div>

              <div className="post-viewer-actions">
                <button type="button" className={display.liked ? "liked" : ""} onClick={() => onLike?.(display.id)}>
                  <span><Icon name="icon-25" /></span>
                  <span>{display.likesCount} {display.liked ? "Liked" : "Like"}</span>
                </button>
                <button type="button">
                  <span><Icon name="icon-26" /></span>
                  <span>{comments.length} Comment{comments.length === 1 ? "" : "s"}</span>
                </button>
                <button type="button" className={display.shared ? "shared" : ""} onClick={() => onShare?.(display.id)}>
                  <span><Icon name="icon-27" /></span>
                  <span>{display.sharesCount} {display.shared ? "Shared" : "Share"}</span>
                </button>
              </div>

              <div className="comment-list">
                {loading && <p className="comment-empty">Loading…</p>}
                {!loading && comments.length === 0 && (
                  <p className="comment-empty">No comments yet. Be the first!</p>
                )}
                {comments.map((c, i) => {
                  const isMine    = !!user?.id && String(c.user?._id || c.user || "") === String(user.id);
                  const isEditing = editing?.id === c._id;
                  return (
                    <div key={c._id || i} className="comment-item">
                      {c.avatarUrl ? (
                        <img className="comment-avatar" src={c.avatarUrl} alt={c.userName || "Commenter"} />
                      ) : (
                        <div className="comment-avatar comment-avatar-fallback">{c.userName?.charAt(0)?.toUpperCase() || "?"}</div>
                      )}
                      <div className="comment-bubble">
                        <strong>{c.userName}</strong>
                        {isEditing ? (
                          <div className="comment-edit">
                            <textarea
                              rows={2}
                              value={editing.text}
                              onChange={e => setEditing(ed => ({ ...ed, text: e.target.value }))}
                              onKeyDown={e => {
                                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSaveEdit(); }
                                if (e.key === "Escape") { e.stopPropagation(); setEditing(null); }
                              }}
                              autoFocus
                            />
                            <div className="comment-edit-actions">
                              <button type="button" onClick={() => setEditing(null)}>Cancel</button>
                              <button type="button" className="primary" disabled={editing.saving || !editing.text.trim()} onClick={handleSaveEdit}>
                                {editing.saving ? "Saving…" : "Save"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p>{c.text}</p>
                        )}
                        <div className="comment-meta">
                          <time>{new Date(c.createdAt).toLocaleString()}</time>
                          {c.editedAt && <span className="comment-edited">· Edited</span>}
                          {!isEditing && isMine && (
                            <button type="button" className="comment-action" onClick={() => setEditing({ id: c._id, text: c.text, saving: false })}>Edit</button>
                          )}
                          {/* Admins moderate, so Delete shows on every comment, not just their own. */}
                          {!isEditing && (
                            <button type="button" className="comment-action danger" onClick={() => handleDeleteComment(c)}>Delete</button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {!notFound && (
          <form className="comment-form" onSubmit={handleSubmit}>
            <div className="comment-emoji-picker" aria-label="Add emoji">
              {COMMENT_EMOJIS.map(emoji => (
                <button type="button" key={emoji} aria-label={`Add ${emoji}`} onClick={() => setText(current => current + emoji)}>
                  {emoji}
                </button>
              ))}
            </div>
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
        )}
      </section>
    </Modal>
    <ConfirmDialog
      open={!!deleteConfirm}
      message={deleteConfirm?.message}
      confirmLabel="Delete"
      danger
      onConfirm={deleteConfirm?.onConfirm}
      onCancel={() => setDeleteConfirm(null)}
    />
    </>
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
  const [saving, setSaving]             = useState(false);
  const [emojiOpen, setEmojiOpen]       = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [location, setLocation]         = useState("");
  const [titleError, setTitleError]     = useState("");
  const [descError, setDescError]       = useState("");
  const [category, setCategory]         = useState("News");

  useEffect(() => {
    if (composer?.row) {
      setTitle(composer.row.title);
      setDescription(composer.row.description);
      setImageUrl(composer.row.imageUrl || "");
      setLocation(composer.row.location || "");
      setCategory(composer.row.type || "News");
    } else {
      setTitle("");
      setDescription("");
      setImageUrl(composer?.initialImage || "");
      setLocation("");
      setCategory("News");
    }
    setEmojiOpen(false);
    setLocationOpen(false);
    setSaving(false);
    setTitleError("");
    setDescError("");
  }, [composer]);

  useEffect(() => {
    if (!emojiOpen) return;
    const onDoc = () => setEmojiOpen(false);
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [emojiOpen]);

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
    const tErr = title.trim() ? "" : "Please enter a title.";
    const dErr = description.trim() ? "" : "Please write something for this announcement.";
    if (tErr || dErr) {
      setTitleError(tErr);
      setDescError(dErr);
      return;
    }
    setSaving(true);
    await onSubmit(
      {
        title:       title.trim(),
        description: description.trim(),
        type:        category,
        imageUrl,
        location:    location.trim(),
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
          <div className="composer-avatar"><img src={alumniLogo} alt="Alumni Association" /></div>
          <div>
            <strong>TSU Alumni Office</strong>
            <span className="admin-choice composer-category" aria-hidden="false">{category}</span>
          </div>
        </div>
        <div className="create-post-body">
          <input
            className="composer-title"
            type="text"
            placeholder="Announcement title"
            value={title}
            onChange={(e) => { setTitle(e.target.value); if (titleError) setTitleError(""); }}
          />
          {titleError && <span className="field-error">{titleError}</span>}
          <textarea
            className="composer-body"
            rows="5"
            placeholder="What's new for alumni?"
            value={description}
            onChange={(e) => { setDescription(e.target.value); if (descError) setDescError(""); }}
          />
          {descError && <span className="field-error">{descError}</span>}
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
              setTitle(""); setDescription(""); setImageUrl(""); setCategory("News");
              setLocation(""); setLocationOpen(false);
              showToast("Composer cleared.");
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24" aria-hidden="true">
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

// ─── Event Edit Modal (admin editing a Coordinator's Event) ───────────────────

function EventEditModal({ row, onClose, onSubmit }) {
  const [title, setTitle]             = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation]       = useState("");
  const [eventDatetime, setEventDatetime] = useState("");
  const [endDatetime, setEndDatetime] = useState("");
  const [capacity, setCapacity]       = useState("");
  const [saving, setSaving]           = useState(false);
  const [dateError, setDateError]     = useState("");

  useEffect(() => {
    if (!row) return;
    setTitle(row.title || "");
    setDescription(row.description || "");
    setLocation(row.location || "");
    setEventDatetime(toDatetimeLocal(row.eventDatetime));
    setEndDatetime(toDatetimeLocal(row.endDatetime));
    setCapacity(row.capacity ?? "");
    setSaving(false);
    setDateError("");
  }, [row]);

  if (!row) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    const err = validateEventDates(eventDatetime, endDatetime, toDatetimeLocal(row.eventDatetime));
    if (err) { setDateError(err); return; }
    setDateError("");
    setSaving(true);
    await onSubmit({
      title: title.trim(),
      description: description.trim(),
      location: location.trim(),
      event_datetime: eventDatetime ? new Date(eventDatetime).toISOString() : undefined,
      end_datetime: endDatetime ? new Date(endDatetime).toISOString() : "",
      capacity: capacity === "" ? undefined : Number(capacity),
    });
    setSaving(false);
  }

  return (
    <Modal open={!!row} onClose={onClose}>
      <section className="tracer-modal admin-entry-modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>Edit Event</h3>
          <button type="button" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <form className="admin-entry-form" onSubmit={handleSubmit}>
          <div className="admin-entry-fields">
            <label>Title
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </label>
            <label>Description
              <textarea rows="4" value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
            <label>Location
              <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} />
            </label>
            <label>Capacity
              <input type="number" min="0" placeholder="e.g. 100" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
            </label>
            <label>Start Date &amp; Time
              <input type="datetime-local" value={eventDatetime} onChange={(e) => { setEventDatetime(e.target.value); setDateError(""); }} />
            </label>
            <label>End Date &amp; Time
              <input type="datetime-local" value={endDatetime} onChange={(e) => { setEndDatetime(e.target.value); setDateError(""); }} />
            </label>
            {dateError && <span className="field-error">{dateError}</span>}
          </div>
          <div className="modal-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" disabled={saving || !title.trim()}>{saving ? "Saving…" : "Save"}</button>
          </div>
        </form>
      </section>
    </Modal>
  );
}

// ─── Job Edit Modal (admin editing an Employer's Job posting) ─────────────────

const JOB_TYPES = ["Full-time", "Part-time", "Internship", "Contract"];

function JobEditModal({ row, onClose, onSubmit }) {
  const [title, setTitle]                             = useState("");
  const [jobDescription, setJobDescription]           = useState("");
  const [keyResponsibilities, setKeyResponsibilities] = useState("");
  const [qualifications, setQualifications]           = useState("");
  const [preferredSkills, setPreferredSkills]         = useState("");
  const [salaryRange, setSalaryRange]                 = useState("");
  const [location, setLocation]                       = useState("");
  const [jobType, setJobType]                         = useState("Full-time");
  const [saving, setSaving]                           = useState(false);
  const [error, setError]                             = useState("");
  const [fieldErrors, setFieldErrors]                 = useState({});
  const modalRef = useRef(null);
  const fieldRefs = useRef({});

  // Same reasoning as the employer's own Create/Edit modal: the form body
  // scrolls independently, so an error on a field the admin has scrolled
  // past can render off-screen unless it's scrolled into view.
  function reportError(message) {
    setError(message);
    modalRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  function scrollToField(name) {
    fieldRefs.current[name]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const setters = {
    title: setTitle, jobDescription: setJobDescription, keyResponsibilities: setKeyResponsibilities,
    qualifications: setQualifications, preferredSkills: setPreferredSkills, salaryRange: setSalaryRange,
    location: setLocation,
  };
  function updateField(field, value) {
    setters[field](value);
    setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  }

  useEffect(() => {
    if (!row) return;
    setTitle(row.title || "");
    setJobDescription(row.jobDescription || "");
    setKeyResponsibilities(row.keyResponsibilities || "");
    setQualifications(row.qualifications || "");
    setPreferredSkills(row.preferredSkills || "");
    setSalaryRange(row.salaryRange || "");
    setLocation(row.location || "");
    setJobType(row.jobType || "Full-time");
    setSaving(false);
    setError("");
    setFieldErrors({});
  }, [row]);

  if (!row) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    const fields = { title, jobDescription, keyResponsibilities, qualifications, preferredSkills, salaryRange, location };
    const errors = validateJobFields(fields);
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      scrollToField(JOB_FIELD_ORDER.find((f) => errors[f]));
      return;
    }
    setFieldErrors({});
    setError("");
    setSaving(true);
    const failMessage = await onSubmit({
      title: title.trim(),
      jobDescription: jobDescription.trim(),
      keyResponsibilities: keyResponsibilities.trim(),
      qualifications: qualifications.trim(),
      preferredSkills: preferredSkills.trim(),
      salaryRange: salaryRange.trim(),
      location: location.trim(),
      jobType,
    });
    setSaving(false);
    if (failMessage) reportError(failMessage);
  }

  return (
    <Modal open={!!row} onClose={onClose}>
      <section className="tracer-modal admin-entry-modal" role="dialog" aria-modal="true" ref={modalRef}>
        <div className="modal-head">
          <h3>Edit Job Posting</h3>
          <button type="button" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <form className="admin-entry-form" onSubmit={handleSubmit}>
          {error && <p className="field-error">{error}</p>}
          <div className="admin-entry-fields">
            <label ref={(el) => (fieldRefs.current.title = el)}>Job Title
              <input type="text" value={title} onChange={(e) => updateField("title", e.target.value)} />
              {fieldErrors.title && <span className="field-error">{fieldErrors.title}</span>}
            </label>
            <label>Employment Type
              <select value={jobType} onChange={(e) => setJobType(e.target.value)}>
                {JOB_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label ref={(el) => (fieldRefs.current.location = el)}>Location
              <input type="text" value={location} onChange={(e) => updateField("location", e.target.value)} placeholder="City, hybrid, or remote" />
              {fieldErrors.location && <span className="field-error">{fieldErrors.location}</span>}
            </label>
            <label ref={(el) => (fieldRefs.current.salaryRange = el)}>Salary Range
              <input type="text" value={salaryRange} onChange={(e) => updateField("salaryRange", e.target.value)} placeholder="e.g. ₱25,000 - ₱35,000 /month" />
              {fieldErrors.salaryRange && <span className="field-error">{fieldErrors.salaryRange}</span>}
            </label>
            <label ref={(el) => (fieldRefs.current.jobDescription = el)}>Job Description
              <textarea rows="4" value={jobDescription} onChange={(e) => updateField("jobDescription", e.target.value)} />
              {fieldErrors.jobDescription && <span className="field-error">{fieldErrors.jobDescription}</span>}
            </label>
            <label ref={(el) => (fieldRefs.current.keyResponsibilities = el)}>Key Responsibilities
              <textarea rows="4" value={keyResponsibilities} onChange={(e) => updateField("keyResponsibilities", e.target.value)} />
              {fieldErrors.keyResponsibilities && <span className="field-error">{fieldErrors.keyResponsibilities}</span>}
            </label>
            <label ref={(el) => (fieldRefs.current.qualifications = el)}>Qualifications &amp; Requirements
              <textarea rows="4" value={qualifications} onChange={(e) => updateField("qualifications", e.target.value)} />
              {fieldErrors.qualifications && <span className="field-error">{fieldErrors.qualifications}</span>}
            </label>
            <label ref={(el) => (fieldRefs.current.preferredSkills = el)}>Preferred Skills (Plus)
              <textarea rows="3" value={preferredSkills} onChange={(e) => updateField("preferredSkills", e.target.value)} />
              {fieldErrors.preferredSkills && <span className="field-error">{fieldErrors.preferredSkills}</span>}
            </label>
          </div>
          <div className="modal-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" disabled={saving || !title.trim() || !jobDescription.trim()}>{saving ? "Saving…" : "Save"}</button>
          </div>
        </form>
      </section>
    </Modal>
  );
}
