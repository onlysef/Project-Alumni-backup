import React, { useState, useEffect, useCallback, useRef } from "react";
import { useOutletContext } from "react-router-dom";
import Icon from "../../components/common/Icon.jsx";
import { Modal } from "../../components/common/Primitives.jsx";
import { downloadCsv } from "./CoordinatorShared.jsx";
import { useAuth } from "../../context/AuthContext.jsx";

import { apiFetch, API, authHeaders } from "../../services/api.js";

const EMPTY_VALS = new Set(["N/A", "n/a", "None", "none", "null", "undefined", ""]);
function display(val) {
  return !val || EMPTY_VALS.has(String(val).trim()) ? "—" : val;
}

function CoordinatorStatusBadge({ status }) {
  const value = display(status);
  const cls = {
    Employed:          "employed",
    Unemployed:        "unemployed",
    "Self-employed":   "self-employed",
    "Not Yet Updated": "not-yet-updated",
  }[value] || "not-yet-updated";
  return <span className={`coord-status-pill coord-employment-status ${cls}`}>{value}</span>;
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
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [activities, setActivities] = useState([]);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [notifying, setNotifying] = useState(false);
  const [confirm, setConfirm] = useState({ open: false, message: "", onConfirm: null });
  const debounceRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [emp, act] = await Promise.all([
        apiFetch("/coordinator/employment", {
          params: { search: appliedSearch, page, limit: 10 },
        }),
        apiFetch("/coordinator/employment/activity", { params: { limit: 10 } }),
      ]);
      setRows(emp.records ?? []);
      setPagination(emp.pagination ?? null);
      setActivities(act.activities ?? []);
    } catch {
      showToast?.("Failed to load employment data.");
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [appliedSearch]);

  function handleNotify() {
    const assignedCollege = user?.college || "";
    const scope = assignedCollege ? `${assignedCollege} alumni` : "all alumni";
    setConfirm({
      open: true,
      message: `Send a reminder to ${scope} to update their employment details for accreditation?`,
      onConfirm: async () => {
        setConfirm(c => ({ ...c, open: false }));
        setNotifying(true);
        try {
          const res  = await fetch(`${API}/coordinator/employment/notify`, {
            method:  "POST",
            headers: authHeaders(),
            body:    JSON.stringify({}),
          });
          const data = await res.json();
          if (!res.ok) { showToast?.(data.message || "Failed to send notifications."); return; }
          showToast?.(data.message);
        } catch {
          showToast?.("Could not connect to server.");
        } finally {
          setNotifying(false);
        }
      },
    });
  }

  function handleSearchChange(e) {
    const val = e.target.value;
    setSearch(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setAppliedSearch(val), 400);
  }

  async function handleExport() {
    try {
      const data = await apiFetch("/coordinator/employment", {
        params: { search: appliedSearch, page: 1, limit: 99999 },
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

        <div className="coord-employ-notify-row">
          <span className="coord-employ-hint">
            Remind alumni to update their employment details during accreditation.
          </span>
          <button
            type="button"
            className="coord-notify-btn"
            onClick={handleNotify}
            disabled={notifying}
          >
            <Icon name="icon-update-white" />
            {notifying ? "Sending…" : "Notify Alumni to Update"}
          </button>
        </div>

        <div className="coord-record-toolbar coord-employ-toolbar">
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
          <div className="coord-table-scroll">
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
                    <td data-label="Name">{display(row.name)}</td>
                    <td data-label="Course">{display(row.course)}</td>
                    <td data-label="Company">{display(row.company_name)}</td>
                    <td data-label="Position">{display(row.job_title)}</td>
                    <td data-label="Status"><CoordinatorStatusBadge status={row.employment_status} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
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

      {confirm.open && (
        <Modal open onClose={() => setConfirm(c => ({ ...c, open: false }))}>
          <div className="confirm-dialog">
            <div className="modal-head">
              <h3>Confirm Action</h3>
              <button type="button" onClick={() => setConfirm(c => ({ ...c, open: false }))}>×</button>
            </div>
            <div className="confirm-dialog-body">{confirm.message}</div>
            <div className="modal-actions" style={{ padding: "0 20px 18px" }}>
              <button type="button" onClick={() => setConfirm(c => ({ ...c, open: false }))}>Cancel</button>
              <button type="button" style={{ background: "var(--maroon)", color: "#fff" }} onClick={confirm.onConfirm}>
                Confirm
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
