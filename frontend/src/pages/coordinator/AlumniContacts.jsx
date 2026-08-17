import React, { useState, useEffect, useCallback, useRef } from "react";
import { useOutletContext } from "react-router-dom";
import Icon from "../../components/common/Icon.jsx";
import { Modal } from "../../components/common/Primitives.jsx";
import { downloadCsv } from "./CoordinatorShared.jsx";

import { apiFetch } from "../../services/api.js";

function CourseBadge({ course }) {
  const value = course || "—";
  const cls = String(course || "empty").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return <span className={`coord-course-pill ${cls}`}>{value}</span>;
}

function initials(name = "") {
  return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "A";
}

// Was hardcoded to 2000-2025 — every batch that graduated (or will
// graduate) after that ceiling had no way to be isolated by this filter at
// all, a gap that gets stale by design if left as a fixed number. Deriving
// the ceiling from the current year means it never needs another manual bump.
const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: CURRENT_YEAR - 2000 + 1 }, (_, i) => CURRENT_YEAR - i);

export default function AlumniContacts() {
  const { showToast } = useOutletContext();
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [year, setYear] = useState("");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [selectedContact, setSelectedContact] = useState(null);
  const debounceRef = useRef(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const data = await apiFetch("/coordinator/alumni", { params: { year, search: appliedSearch, page, limit: 10 } });
      if (requestIdRef.current !== requestId) return; // a newer request already landed
      setContacts(data.contacts ?? []);
      setPagination(data.pagination ?? null);
    } catch {
      if (requestIdRef.current !== requestId) return;
      showToast?.("Failed to load contacts.");
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, [year, appliedSearch, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [year, appliedSearch]);

  function handleSearchChange(e) {
    const val = e.target.value;
    setSearch(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setAppliedSearch(val), 400);
  }

  async function handleExport() {
    try {
      const data = await apiFetch("/coordinator/alumni", {
        params: { year, search: appliedSearch, page: 1, limit: 99999 },
      });
      const all = data.contacts ?? [];
      downloadCsv("alumni-contacts.csv", [
        ["Name", "Position", "Graduation Year", "Course", "Email", "Phone"],
        ...all.map((c) => [c.name, c.title, c.year, c.course, c.email, c.phone]),
      ]);
      showToast?.("Contacts exported.");
    } catch {
      showToast?.("Export failed.");
    }
  }

  return (
    <section className={`content coordinator-content view active-view`}>
      <section className="coord-contacts-table">
        <div className="coord-contact-toolbar">
          <h3>Manage Contacts</h3>
          <span>Filter by</span>
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">Year</option>
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <input
            placeholder="Search"
            value={search}
            onChange={handleSearchChange}
          />
        </div>

        {loading ? (
          <p className="coord-employ-empty">Loading…</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Position</th>
                <th>Graduation Year</th>
                <th>Course</th>
                <th>Email</th>
                <th>Phone</th>
              </tr>
            </thead>
            <tbody>
              {contacts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="coord-employ-empty">No contacts found.</td>
                </tr>
              ) : (
                contacts.map((c) => (
                  <tr
                    key={String(c._id)}
                    className="coord-contact-clickable"
                    role="button"
                    tabIndex={0}
                    aria-label={`View ${c.name}'s alumni profile`}
                    onClick={() => setSelectedContact(c)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedContact(c);
                      }
                    }}
                  >
                    <td data-label="Name">
                      <strong>{c.name}</strong>
                      <small className="coord-contact-profile-hint">View profile</small>
                    </td>
                    <td data-label="Position">{c.title || "—"}</td>
                    <td data-label="Graduation Year">{c.year || "—"}</td>
                    <td data-label="Course"><CourseBadge course={c.course} /></td>
                    <td data-label="Email">{c.email}</td>
                    <td data-label="Phone">{c.phone || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}

        {pagination && (
          <div className="coord-employ-pagination">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              ‹ Prev
            </button>
            <span>Page {page} of {pagination.pages}</span>
            <button disabled={page >= pagination.pages} onClick={() => setPage((p) => p + 1)}>
              Next ›
            </button>
          </div>
        )}

        <div className="coord-table-footer">
          <button type="button" className="btn btn-secondary" onClick={handleExport}>
            <Icon name="icon-export" /> Export
          </button>
        </div>
      </section>

      {selectedContact && (
        <Modal open onClose={() => setSelectedContact(null)}>
          <section className="tracer-modal coord-alumni-profile" role="dialog" aria-modal="true" aria-label="Alumni profile">
            <div className="modal-head">
              <h3>Alumni Profile</h3>
              <button type="button" aria-label="Close profile" onClick={() => setSelectedContact(null)}>×</button>
            </div>
            <div className="coord-profile-summary">
              <div className="coord-profile-avatar" aria-hidden="true">
                {selectedContact.avatarUrl ? <img src={selectedContact.avatarUrl} alt="" /> : initials(selectedContact.name)}
              </div>
              <div>
                <strong>{selectedContact.name}</strong>
                <span>{selectedContact.title || "No position provided"}</span>
              </div>
            </div>
            <dl className="coord-profile-details">
              <div><dt>Course</dt><dd><CourseBadge course={selectedContact.course} /></dd></div>
              <div><dt>Graduation Year</dt><dd>{selectedContact.year || "—"}</dd></div>
              <div><dt>Email</dt><dd>{selectedContact.email || "—"}</dd></div>
              <div><dt>Phone</dt><dd>{selectedContact.phone || "—"}</dd></div>
            </dl>
            <div className="modal-actions coord-profile-actions">
              <button type="button" onClick={() => setSelectedContact(null)}>Close</button>
            </div>
          </section>
        </Modal>
      )}
    </section>
  );
}
