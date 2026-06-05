import React, { useState } from "react";
import Icon from "../Icon.jsx";
import { Dropdown, Modal } from "../Primitives.jsx";

const employmentSeed = [
  { name: "Juan Dela Cruz", course: "BSIT", company: "IT SERVICES ASSO.", status: "EMPLOYED", updated: "02/11/26", extra: false },
  { name: "Maria Gloria Garcia", course: "BSCS", company: "N/A", status: "UNEMPLOYED", updated: "04/21/26", extra: false },
  { name: "Josefina Manalo", course: "BSIS", company: "AGRITECH SOLUTIONS", status: "EMPLOYED", updated: "02/11/26", extra: false },
  { name: "Ryan Reynolds", course: "BSIS", company: "AGRITECH SOLUTIONS", status: "EMPLOYED", updated: "02/11/26", extra: false },
  { name: "Michael Jay Garcia", course: "BSCS", company: "N/A", status: "UNEMPLOYED", updated: "04/21/26", extra: false },
  { name: "Angela Santos", course: "BSIT", company: "TECHNOVA CORP.", status: "EMPLOYED", updated: "05/10/26", extra: true },
  { name: "Paolo Rivera", course: "BSIS", company: "N/A", status: "UNEMPLOYED", updated: "05/18/26", extra: true },
];

const recentActivitiesSeed = [
  { name: "Maria Gloria Garcia", text: "updated their employment status", time: "1 hr ago", group: "now" },
  { name: "Juan Dela Cruz", text: "updated their personal information", time: "1 hr ago", group: "now" },
  { name: "Juan Dela Cruz", text: "updated their employment status", time: "1 month ago", group: "month" },
  { name: "Juan Dela Cruz", text: "added achievements", time: "1 month ago", group: "month" },
  { name: "Angela Santos", text: "submitted updated company details", time: "1 month ago", group: "month", extra: true },
  { name: "Paolo Rivera", text: "updated availability for follow-up", time: "1 month ago", group: "month", extra: true },
];

export default function EmploymentView({ active, showToast }) {
  const [rows] = useState(employmentSeed);
  const [filter, setFilter] = useState("All");
  const [expandedTable, setExpandedTable] = useState(false);
  const [expandedRecent, setExpandedRecent] = useState(false);
  const [tracerOpen, setTracerOpen] = useState(false);
  const [record, setRecord] = useState(null);

  const filterOptions = ["All", "Employed", "Unemployed", "BSIT", "BSCS", "BSIS", "Recently Updated"];

  function rowVisible(r) {
    return (
      filter === "All" ||
      filter.toUpperCase() === r.status ||
      filter === r.course ||
      (filter === "Recently Updated" && r.updated === "02/11/26")
    );
  }

  const visibleRows = rows.filter(rowVisible);

  function printRecord(r) {
    const w = window.open("", "_blank");
    if (!w) {
      showToast(`${r.name} record is ready to print.`);
      return;
    }
    w.document.write(`<h1>Employment Record</h1><table border="1" cellpadding="6"><tbody>
      <tr><th>Name</th><td>${r.name}</td></tr>
      <tr><th>Course</th><td>${r.course}</td></tr>
      <tr><th>Company</th><td>${r.company}</td></tr>
      <tr><th>Status</th><td>${r.status}</td></tr>
      <tr><th>Last Updated</th><td>${r.updated}</td></tr></tbody></table>`);
    w.document.close();
    w.print();
    showToast(`${r.name} record is ready to print.`);
  }

  function exportCsv() {
    const headers = ["Name", "Course", "Company", "Status", "Last Updated"];
    const csvRows = [headers, ...visibleRows.map((r) => [r.name, r.course, r.company, r.status, r.updated])];
    const csv = csvRows.map((row) => row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "employment-details.csv";
    link.click();
    URL.revokeObjectURL(url);
    showToast(`${visibleRows.length} employment record${visibleRows.length === 1 ? "" : "s"} exported.`);
  }

  return (
    <section className={`content employment-view view${active ? " active-view" : ""}`}>
      <div className="employment-toolbar">
        <div className="section-title">
          <h3>Employment Details</h3>
          <span />
        </div>
        <div className="employment-actions">
          <button type="button" className="maroon-action" onClick={exportCsv}>
            <span><Icon name="icon-17" /></span>
            <span>Export List</span>
          </button>
          <button type="button" className="maroon-action" onClick={() => setTracerOpen(true)}>
            <span><Icon name="icon-18" /></span>
            <span>Edit Tracer Form</span>
          </button>
        </div>
      </div>

      <section className={`employment-card${expandedTable ? " is-expanded" : ""}`}>
        <Dropdown
          menuClassName="table-filter-menu"
          options={filterOptions}
          active={filter}
          onSelect={(label) => {
            setFilter(label);
            const count = rows.filter((r) =>
              label === "All" ||
              label.toUpperCase() === r.status ||
              label === r.course ||
              (label === "Recently Updated" && r.updated === "02/11/26")
            ).length;
            showToast(`${count} employment record${count === 1 ? "" : "s"} shown.`);
          }}
          trigger={(toggle) => (
            <button type="button" className="table-filter" onClick={toggle}>
              {filter === "All" ? "Filter by" : `${filter} ▾`}
            </button>
          )}
        />
        <div className="employment-table-wrap">
          <table className="employment-table">
            <thead>
              <tr>
                <th>Name</th><th>Course</th><th>Company</th><th>Status</th><th>Last Updated</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={`${r.extra ? "extra-row" : ""}${rowVisible(r) ? "" : " is-hidden"}`}>
                  <td>{r.name}</td>
                  <td>{r.course}</td>
                  <td>{r.company}</td>
                  <td>{r.status}</td>
                  <td>{r.updated}</td>
                  <td>
                    <button type="button" className="table-icon table-print" aria-label="Print record" onClick={() => printRecord(r)}>
                      <span><Icon name="icon-19" /></span>
                    </button>
                    <button type="button" className="table-icon table-view" aria-label="View record" onClick={() => setRecord(r)}>
                      <span><Icon name="icon-20" /></span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="see-toggle" onClick={() => setExpandedTable((e) => !e)}>
          {expandedTable ? "Hide" : "See More"}
        </button>
      </section>

      <section className={`recent-card${expandedRecent ? " is-expanded" : ""}`}>
        <h3>Recent Activities</h3>
        {recentActivitiesSeed.filter((a) => a.group === "now").map((a, i) => (
          <div className="recent-row" key={`n${i}`}>
            <span>{a.name}</span><span>{a.text}</span><time>{a.time}</time>
          </div>
        ))}
        <h4>1 month ago</h4>
        {recentActivitiesSeed.filter((a) => a.group === "month").map((a, i) => (
          <div className={`recent-row${a.extra ? " extra-row" : ""}`} key={`m${i}`}>
            <span>{a.name}</span><span>{a.text}</span><time>{a.time}</time>
          </div>
        ))}
        <button type="button" className="see-toggle" onClick={() => setExpandedRecent((e) => !e)}>
          {expandedRecent ? "Hide" : "See More"}
        </button>
      </section>

      <Modal open={tracerOpen} onClose={() => setTracerOpen(false)}>
        <section className="tracer-modal" role="dialog" aria-modal="true">
          <div className="modal-head">
            <h3>Edit Tracer Form</h3>
            <button type="button" aria-label="Close tracer form" onClick={() => setTracerOpen(false)}>×</button>
          </div>
          <form
            className="tracer-form"
            onSubmit={(e) => {
              e.preventDefault();
              setTracerOpen(false);
              showToast("Tracer form changes saved.");
            }}
          >
            <label>Form Title<input type="text" defaultValue="Alumni Employment Tracer Survey" /></label>
            <label>Employment Question<textarea rows="3" defaultValue="What is your current employment status and company?" /></label>
            <label>Course Alignment Question<textarea rows="3" defaultValue="How aligned is your current career with your completed course?" /></label>
            <label>Deadline<input type="date" defaultValue="2026-06-30" /></label>
            <div className="modal-actions">
              <button type="button" onClick={() => setTracerOpen(false)}>Cancel</button>
              <button type="submit">Save Changes</button>
            </div>
          </form>
        </section>
      </Modal>

      <Modal open={!!record} onClose={() => setRecord(null)}>
        <section className="tracer-modal record-modal" role="dialog" aria-modal="true">
          <div className="modal-head">
            <h3>Employment Record</h3>
            <button type="button" aria-label="Close employment record" onClick={() => setRecord(null)}>×</button>
          </div>
          <div className="record-details">
            <div><strong>Name</strong><span>{record?.name}</span></div>
            <div><strong>Course</strong><span>{record?.course}</span></div>
            <div><strong>Company</strong><span>{record?.company}</span></div>
            <div><strong>Status</strong><span>{record?.status}</span></div>
            <div><strong>Last Updated</strong><span>{record?.updated}</span></div>
          </div>
          <div className="modal-actions record-actions">
            <button type="button" onClick={() => setRecord(null)}>Close</button>
            <button type="button" onClick={() => record && printRecord(record)}>Print Record</button>
          </div>
        </section>
      </Modal>
    </section>
  );
}
