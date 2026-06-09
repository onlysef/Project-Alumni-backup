import React, { useState } from "react";
import { Modal } from "../Primitives.jsx";
import AdminMenu from "../components/AdminMenu.jsx";

export default function JobConnectView({ active, showToast }) {
  // No backend yet — start empty. Replace with fetched data once the API exists:
  //   useEffect(() => { if (active) fetchJobs(); }, [active]);
  const [rows, setRows] = useState([]);
  const [sourceFilter, setSourceFilter] = useState("All");
  const [courseFilter, setCourseFilter] = useState("All");
  const [entry, setEntry] = useState(null);

  function visible(r) {
    const srcMatch = sourceFilter === "All" || r.source === sourceFilter;
    const crsMatch = courseFilter === "All" || r.course === courseFilter;
    return srcMatch && crsMatch;
  }

  function handleAction(row, action) {
    if (action === "View") {
      setEntry(row);
      return;
    }
    if (action === "Deactivate") {
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: "Closed" } : r)));
      showToast(`${row.title}: deactivated.`);
      return;
    }
    if (action === "Activate") {
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: "Open" } : r)));
      showToast(`${row.title}: activated.`);
      return;
    }
  }

  const shown = rows.filter(visible);
  const openCount = rows.filter((r) => r.status === "Open").length;
  const partnerCount = rows.filter((r) => r.source === "TSU Partner").length;
  const apiCount = rows.filter((r) => r.source === "Careerjet").length;

  return (
    <section className={`content admin-view view${active ? " active-view" : ""}`}>
      <div className="admin-kpis">
        <article><strong>{openCount}</strong><span>Open Positions</span></article>
        <article><strong>{partnerCount}</strong><span>From TSU Partners</span></article>
        <article><strong>{apiCount}</strong><span>From Careerjet API</span></article>
      </div>

      <section className="admin-card">
        <div className="admin-card-head">
          <h3>Job Recommendations</h3>
          <div>
            <AdminMenu
              menuKey="job-source"
              label={sourceFilter === "All" ? "Source" : sourceFilter}
              onSelect={setSourceFilter}
            />
            <AdminMenu
              menuKey="job-course"
              label={courseFilter === "All" ? "Course" : courseFilter}
              onSelect={setCourseFilter}
            />
          </div>
        </div>

        <table className="admin-table jobconnect-table">
          <thead>
            <tr>
              <th>Position</th>
              <th>Company</th>
              <th>Location</th>
              <th>Type</th>
              <th>Course</th>
              <th>Match</th>
              <th>Source</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td>{r.title}</td>
                <td>{r.company}</td>
                <td>{r.location}</td>
                <td>{r.type}</td>
                <td>{r.course}</td>
                <td>{r.match}%</td>
                <td>{r.source}</td>
                <td>{r.status}</td>
                <td>
                  <AdminMenu
                    menuKey={r.status === "Open" ? "job-row-open" : "job-row-closed"}
                    label="⋯"
                    onSelect={(action) => handleAction(r, action)}
                  />
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={9} style={{ textAlign: "center", padding: "24px", color: "#777" }}>
                  No job postings yet. Data will appear here once the backend is connected.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <Modal open={!!entry} onClose={() => setEntry(null)}>
        {entry && (
          <section className="tracer-modal admin-entry-modal" role="dialog" aria-modal="true">
            <div className="modal-head">
              <h3>{entry.title}</h3>
              <button type="button" aria-label="Close" onClick={() => setEntry(null)}>×</button>
            </div>
            <div className="record-details">
              <div><strong>Company</strong><span>{entry.company}</span></div>
              <div><strong>Location</strong><span>{entry.location}</span></div>
              <div><strong>Type</strong><span>{entry.type}</span></div>
              <div><strong>Best fit for</strong><span>{entry.course}</span></div>
              <div><strong>Match score</strong><span>{entry.match}%</span></div>
              <div><strong>Source</strong><span>{entry.source}</span></div>
              <div><strong>Status</strong><span>{entry.status}</span></div>
            </div>
            <div className="modal-actions" style={{ padding: "0 20px 20px" }}>
              <button type="button" onClick={() => setEntry(null)}>Close</button>
            </div>
          </section>
        )}
      </Modal>
    </section>
  );
}