import React, { useState, useEffect, useCallback, useRef } from "react";
import { useOutletContext } from "react-router-dom";
import Icon from "../../components/common/Icon.jsx";
import { downloadCsv } from "./CoordinatorShared.jsx";

import { API } from "../../services/api.js";

function apiGet(path, params = {}) {
  const token = localStorage.getItem("auth_token");
  const url = new URL(`${API}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== "" && v !== undefined && v !== null) url.searchParams.set(k, v);
  });
  return fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
}

const EMPTY_VALS = new Set(["N/A", "n/a", "None", "none", "null", "undefined", ""]);
function display(val) {
  return !val || EMPTY_VALS.has(String(val).trim()) ? "—" : val;
}

function timeAgo(date) {
  const diff = (Date.now() - new Date(date)) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min.`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr.`;
  return `${Math.floor(diff / 86400)}d`;
}

export default function CoordinatorEmploymentView() {
  const { showToast } = useOutletContext();
  const [rows, setRows] = useState([]);
  const [activities, setActivities] = useState([]);
  const [course, setCourse] = useState("");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const debounceRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [emp, act] = await Promise.all([
        apiGet("/coordinator/employment", {
          course,
          search: appliedSearch,
          page,
          limit: 10,
        }),
        apiGet("/coordinator/employment/activity", { limit: 10 }),
      ]);
      setRows(emp.records ?? []);
      setPagination(emp.pagination ?? null);
      setActivities(act.activities ?? []);
    } catch {
      showToast?.("Failed to load employment data.");
    } finally {
      setLoading(false);
    }
  }, [course, appliedSearch, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [course, appliedSearch]);

  function handleSearchChange(e) {
    const val = e.target.value;
    setSearch(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setAppliedSearch(val), 400);
  }

  async function handleExport() {
    try {
      const data = await apiGet("/coordinator/employment", {
        course,
        search: appliedSearch,
        page: 1,
        limit: 99999,
      });
      const all = data.records ?? [];
      downloadCsv("coordinator-employment-details.csv", [
        ["Name", "Course", "Company", "Position", "Status"],
        ...all.map((r) => [
          r.name,
          r.course ?? "",
          r.company_name ?? "",
          r.job_title ?? "",
          r.employment_status ?? "",
        ]),
      ]);
      showToast?.("Employment details exported.");
    } catch {
      showToast?.("Export failed.");
    }
  }

  return (
    <section
      className={`content coordinator-content view active-view`}
    >
      <section className="coord-records-card">
        <h3>Employment Details</h3>
        <div className="coord-record-toolbar coord-employ-toolbar">
          <select
            value={course}
            onChange={(e) => setCourse(e.target.value)}
          >
            <option value="">All Courses</option>
            <option value="BSIT">BSIT</option>
            <option value="BSCS">BSCS</option>
            <option value="BSIS">BSIS</option>
          </select>
          <input
            type="search"
            className="coord-employ-search"
            placeholder="Search name or company…"
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
                <th>Course</th>
                <th>Company</th>
                <th>Position</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="coord-employ-empty">
                    No records found.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row._id}>
                    <td>{display(row.name)}</td>
                    <td>{display(row.course)}</td>
                    <td>{display(row.company_name)}</td>
                    <td>{display(row.job_title)}</td>
                    <td>{display(row.employment_status)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}

        {pagination && (
          <div className="coord-employ-pagination">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              ‹ Prev
            </button>
            <span>
              Page {page} of {pagination.pages}
            </span>
            <button
              disabled={page >= pagination.pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next ›
            </button>
          </div>
        )}

        <div className="coord-record-actions">
          <button type="button" onClick={handleExport} className="btn btn-primary">
            <Icon name="icon-export" /> Export
          </button>
        </div>
      </section>

      <section className="coord-card coord-activity">
        <h3>Recent Activities</h3>
        <div className="coord-activity-list">
          {activities.length === 0 ? (
            <p className="coord-employ-empty">No recent activity.</p>
          ) : (
            activities.map((a, i) => (
              <div
                className="coord-activity-row"
                key={`${a._id ?? i}`}
              >
                <span>
                  {a.user_name} {a.action}
                  {a.target_name ? ` — ${a.target_name}` : ""}
                </span>
                <span className="coord-activity-time">
                  {timeAgo(a.createdAt)}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </section>
  );
}
