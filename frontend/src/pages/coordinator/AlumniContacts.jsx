import React, { useState, useEffect, useCallback, useRef } from "react";
import { useOutletContext } from "react-router-dom";
import Icon from "../../components/common/Icon.jsx";
import { downloadCsv } from "./CoordinatorShared.jsx";

import { apiFetch } from "../../services/api.js";

function CourseBadge({ course }) {
  const value = course || "—";
  const cls = String(course || "empty").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return <span className={`coord-course-pill ${cls}`}>{value}</span>;
}

export default function AlumniContacts() {
  const { showToast } = useOutletContext();
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [year, setYear] = useState("");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const debounceRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch("/coordinator/alumni", { params: { year, search: appliedSearch, page, limit: 10 } });
      setContacts(data.contacts ?? []);
      setPagination(data.pagination ?? null);
    } catch {
      showToast?.("Failed to load contacts.");
    } finally {
      setLoading(false);
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
            <option value="2022">2022</option>
            <option value="2023">2023</option>
            <option value="2024">2024</option>
            <option value="2025">2025</option>
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
                  <tr key={String(c._id)}>
                    <td data-label="Name">
                      <strong>{c.name}</strong>
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
    </section>
  );
}
