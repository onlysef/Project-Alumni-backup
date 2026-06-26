import React, { useState, useEffect, useCallback, useRef } from "react";
import { useOutletContext } from "react-router-dom";
import Icon from "../../components/common/Icon.jsx";
import { downloadCsv } from "./CoordinatorShared.jsx";

import { apiFetch } from "../../services/api.js";

export default function AlumniContacts() {
  const { showToast } = useOutletContext();
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [course, setCourse] = useState("");
  const [year, setYear] = useState("");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const debounceRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch("/coordinator/alumni", { params: { course, year, search: appliedSearch, page, limit: 10 } });
      setContacts(data.contacts ?? []);
      setPagination(data.pagination ?? null);
    } catch {
      showToast?.("Failed to load contacts.");
    } finally {
      setLoading(false);
    }
  }, [course, year, appliedSearch, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [course, year, appliedSearch]);

  function handleSearchChange(e) {
    const val = e.target.value;
    setSearch(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setAppliedSearch(val), 400);
  }

  async function handleExport() {
    try {
      const data = await apiFetch("/coordinator/alumni", {
        params: { course, year, search: appliedSearch, page: 1, limit: 99999 },
      });
      const all = data.contacts ?? [];
      downloadCsv("alumni-contacts.csv", [
        ["Name", "Title", "Graduation Year", "Course", "Email", "Phone"],
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
          <select value={course} onChange={(e) => setCourse(e.target.value)}>
            <option value="">Course</option>
            <option value="BSIT">BSIT</option>
            <option value="BSCS">BSCS</option>
            <option value="BSIS">BSIS</option>
          </select>
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
                <th>Graduation Year</th>
                <th>Course</th>
                <th>Email</th>
                <th>Phone</th>
              </tr>
            </thead>
            <tbody>
              {contacts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="coord-employ-empty">No contacts found.</td>
                </tr>
              ) : (
                contacts.map((c) => (
                  <tr key={String(c._id)}>
                    <td data-label="Name">
                      <strong>{c.name}</strong>
                      {c.title && <small>{c.title}</small>}
                    </td>
                    <td data-label="Graduation Year">{c.year || "—"}</td>
                    <td data-label="Course">{c.course || "—"}</td>
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