import React, { useState } from "react";
import { nextId } from "../shared.js";
import Icon from "../Icon.jsx";
import { Dropdown } from "../Primitives.jsx";
import AdminMenu from "../components/AdminMenu.jsx";
import { AdminEntryModal } from "./AccountsView.jsx";
import { partnerActionList, actionLabels } from "../data.js";

const partnershipsSeed = [
  { partner: "AGRITECH SOLUTIONS", type: "Industry", contact: "careers@agritech.com", status: "Active" },
  { partner: "IT SERVICES ASSO.", type: "Industry", contact: "hr@itservices.ph", status: "Active" },
  { partner: "Scholarship Program", type: "Academe", contact: "partners@scholar.org", status: "Pending" },
];

export default function PartnershipsView({ active, showToast }) {
  const [rows, setRows] = useState(partnershipsSeed.map((r) => ({ ...r, id: nextId() })));
  const [typeFilter, setTypeFilter] = useState("Type");
  const [statusFilter, setStatusFilter] = useState("Status");
  const [activeFilter, setActiveFilter] = useState("All");
  const [entry, setEntry] = useState(null);

  function visible(r) {
    return activeFilter === "All" || [r.partner, r.type, r.contact, r.status].join(" ").includes(activeFilter);
  }
  function applyFilter(choice, which) {
    if (which === "type") setTypeFilter(choice);
    else setStatusFilter(choice);
    setActiveFilter(choice);
    const count = rows.filter((r) =>
      choice === "All" || [r.partner, r.type, r.contact, r.status].join(" ").includes(choice)
    ).length;
    showToast(`${count} item${count === 1 ? "" : "s"} shown.`);
  }
  function handleAction(row, action) {
    if (action === "view" || action === "edit") return setEntry({ row });
    if (action === "delete") {
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      return showToast(`${row.partner} partnership deleted.`);
    }
    const status = action === "approve" || action === "activate" ? "Active" : "Archived";
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status } : r)));
    showToast(`${row.partner}: ${action} action applied.`);
  }

  return (
    <section className={`content admin-view view${active ? " active-view" : ""}`}>
      <div className="admin-kpis">
        <article><strong>18</strong><span>Active Partners</span></article>
        <article><strong>5</strong><span>Pending MOUs</span></article>
        <article><strong>42</strong><span>Job Opportunities</span></article>
      </div>
      <section className="admin-card">
        <div className="admin-card-head">
          <h3>Partnerships</h3>
          <div>
            <AdminMenu menuKey="partner-type" label={typeFilter} onSelect={(c) => applyFilter(c, "type")} />
            <AdminMenu menuKey="partner-status" label={statusFilter} onSelect={(c) => applyFilter(c, "status")} />
            <button type="button" className="add-button" onClick={() => setEntry({})}>Add Partnership</button>
          </div>
        </div>
        <table className="admin-table partnership-table">
          <thead><tr><th>Partner</th><th>Type</th><th>Contact</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={visible(r) ? "" : "is-hidden"}>
                <td>{r.partner}</td><td>{r.type}</td><td>{r.contact}</td><td>{r.status}</td>
                <td>
                  {partnerActionList(r.status).map((a) => (
                    <button key={a} type="button" onClick={() => handleAction(r, a)}>{actionLabels[a]}</button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <AdminEntryModal
        mode="partnership"
        entry={entry}
        onClose={() => setEntry(null)}
        onSubmit={(data) => {
          if (entry.row) {
            setRows((prev) => prev.map((r) => (r.id === entry.row.id ? { ...r, ...data } : r)));
          } else {
            setRows((prev) => [{ id: nextId(), ...data }, ...prev]);
          }
          showToast(`${data.partner} partnership saved.`);
          setEntry(null);
        }}
      />
    </section>
  );
}
