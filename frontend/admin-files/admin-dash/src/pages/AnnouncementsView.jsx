import React, { useState, useEffect } from "react";
import { nextId } from "../shared.js";
import Icon from "../Icon.jsx";
import { Dropdown, Modal } from "../Primitives.jsx";
import AdminMenu from "../components/AdminMenu.jsx";
import { adminMenuChoices } from "../data.js";

const announcementsSeed = [
  { title: "System Upgrade Enhances Alumni Tracer Capabilities", description: "A major system upgrade has been implemented in the Alumni Tracer System to improve data collection and reporting..." },
  { title: "University Strengthens Industry Linkages with New Partnerships", description: "The university has recently established new partnerships with several leading companies to expand career opportunities..." },
  { title: "Career Development Webinar Attracts Hundreds of Alumni", description: "Hundreds of alumni participated in the recent career development webinar organized by the university..." },
];

const recentPostsSeed = [
  { art: "Alumni Reunion", artClass: "", likes: 100, comments: 45, shares: 12 },
  { art: "Online Webinar", artClass: "webinar", likes: 100, comments: 45, shares: 12 },
];

export default function AnnouncementsView({ active, showToast }) {
  const [rows, setRows] = useState(announcementsSeed.map((r) => ({ ...r, id: nextId() })));
  const [recentPosts, setRecentPosts] = useState(recentPostsSeed.map((p) => ({ ...p, id: nextId() })));
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("Date");
  const [typeFilter, setTypeFilter] = useState("Type");
  const [composer, setComposer] = useState(null); // null | {} (new) | {row}
  const [category, setCategory] = useState("News");

  const filtered = rows.filter(
    (r) => !search || `${r.title} ${r.description}`.toLowerCase().includes(search.toLowerCase())
  );

  function handlePost(data) {
    if (composer.row) {
      setRows((prev) => prev.map((r) => (r.id === composer.row.id ? { ...r, ...data } : r)));
      showToast("Announcement updated.");
    } else {
      setRows((prev) => [{ id: nextId(), ...data }, ...prev]);
      setRecentPosts((prev) => [...prev, { id: nextId(), art: data.title, artClass: "", likes: 0, comments: 0, shares: 0 }]);
      showToast("Announcement posted.");
    }
    setComposer(null);
  }

  function bumpSocial(id, key) {
    setRecentPosts((prev) => prev.map((p) => (p.id === id ? { ...p, [key]: p[key] + 1 } : p)));
    const word = { likes: "Like", comments: "Comment", shares: "Share" }[key];
    showToast(`${word} added.`);
  }

  return (
    <section className={`content admin-view announcements-view view${active ? " active-view" : ""}`}>
      <section className="admin-card">
        <div className="admin-card-head">
          <h3>Posted Announcements</h3>
          <div>
            <AdminMenu menuKey="announcement-date" label={dateFilter} onSelect={setDateFilter} />
            <AdminMenu menuKey="announcement-type" label={typeFilter} onSelect={setTypeFilter} />
            <input
              className="admin-search"
              type="search"
              placeholder="Search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                const q = e.target.value.trim().toLowerCase();
                const count = rows.filter((r) => !q || `${r.title} ${r.description}`.toLowerCase().includes(q)).length;
                showToast(`${count} post${count === 1 ? "" : "s"} shown.`);
              }}
            />
          </div>
        </div>
        <table className="admin-table announcement-table">
          <thead><tr><th>Post Title</th><th>Description</th><th>Actions</th></tr></thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td>{r.title}</td>
                <td>{r.description}</td>
                <td>
                  <button type="button" onClick={() => { setComposer({ row: r }); showToast("Post loaded in composer."); }}>Edit</button>
                  <button
                    type="button"
                    onClick={() => {
                      setRows((prev) => prev.filter((x) => x.id !== r.id));
                      showToast(`${r.title} deleted.`);
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
          <button type="button" className="post-launcher" onClick={() => setComposer({})}>
            What's new for alumni?
          </button>
          <div className="composer-tools">
            <button type="button" className="composer-tool-btn" onClick={() => setComposer({})}>
              <span><Icon name="icon-21" /></span>
              <span>Add image</span>
            </button>
            <button type="button" className="post-submit" onClick={() => setComposer({})}>Create</button>
          </div>
        </section>

        <aside className="recent-posts">
          <h3>Recent Posts</h3>
          {recentPosts.map((p) => (
            <article key={p.id}>
              <div className={`post-art${p.artClass ? " " + p.artClass : ""}`}>{p.art}</div>
              <div className="post-actions">
                <button type="button" onClick={() => bumpSocial(p.id, "likes")}>
                  <span><Icon name="icon-25" /></span><span>{p.likes} Like</span>
                </button>
                <button type="button" onClick={() => bumpSocial(p.id, "comments")}>
                  <span><Icon name="icon-26" /></span><span>{p.comments} Comment</span>
                </button>
                <button type="button" onClick={() => bumpSocial(p.id, "shares")}>
                  <span><Icon name="icon-27" /></span><span>{p.shares} Share</span>
                </button>
              </div>
            </article>
          ))}
        </aside>
      </div>

      <PostComposerModal
        composer={composer}
        category={category}
        setCategory={setCategory}
        onClose={() => setComposer(null)}
        onSubmit={handlePost}
        showToast={showToast}
      />
    </section>
  );
}

function PostComposerModal({ composer, category, setCategory, onClose, onSubmit, showToast }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [catOpen, setCatOpen] = useState(false);

  useEffect(() => {
    if (composer?.row) {
      setTitle(composer.row.title);
      setDescription(composer.row.description);
    } else {
      setTitle("");
      setDescription("");
    }
  }, [composer]);

  useEffect(() => {
    if (!catOpen) return;
    const onDoc = () => setCatOpen(false);
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [catOpen]);

  if (!composer) return null;

  return (
    <Modal open={!!composer} onClose={onClose}>
      <section className="tracer-modal create-post-modal" role="dialog" aria-modal="true">
        <div className="create-post-head">
          <h3>Create Announcement</h3>
          <button type="button" aria-label="Close create announcement" onClick={onClose}>×</button>
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
            rows="7"
            placeholder="What's new for alumni?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="create-post-options">
          <strong>Add to your announcement</strong>
          <label className="composer-icon-action" title="Add image">
            <span><Icon name="icon-21" /></span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const name = e.target.files[0]?.name;
                showToast(name ? `${name} attached.` : "Image removed.");
              }}
            />
          </label>
          <button type="button" className="composer-icon-action" title="Feeling"><span><Icon name="icon-22" /></span></button>
          <button type="button" className="composer-icon-action" title="Location"><span><Icon name="icon-23" /></span></button>
          <button type="button" className="composer-icon-action" title="More options"><span><Icon name="icon-24" /></span></button>
        </div>
        <button
          type="button"
          className="post-submit create-post-submit"
          onClick={() =>
            onSubmit({
              title: title.trim() || "Untitled Announcement",
              description: description.trim() || "No description provided yet.",
            })
          }
        >
          {composer.row ? "Update" : "Post"}
        </button>
      </section>
    </Modal>
  );
}
