import React, { useState } from "react";
import { nextId } from "../shared.js";
import Icon from "../Icon.jsx";
import { Dropdown, Modal } from "../Primitives.jsx";
import AdminMenu from "../components/AdminMenu.jsx";
import { accountActionList, actionLabels } from "../data.js";

const accountsSeed = [
  { name: "Maria Gloria Garcia", email: "maria.garcia@tsu.edu.ph", role: "Alumni", status: "Active" },
  { name: "Jose Mari Chan", email: "jose.chan@tsu.edu.ph", role: "Staff", status: "Active" },
  { name: "Danica Macapagal", email: "danica.macapagal@tsu.edu.ph", role: "Alumni", status: "Pending" },
];

export default function AccountsView({ active, showToast }) {
  const [rows, setRows] = useState(accountsSeed.map((r) => ({ ...r, id: nextId() })));
  const [roleFilter, setRoleFilter] = useState("Role");
  const [statusFilter, setStatusFilter] = useState("Status");
  const [activeFilter, setActiveFilter] = useState("All");
  const [entry, setEntry] = useState(null); // {row} or {} for add

  function visible(r) {
    return activeFilter === "All" || [r.name, r.email, r.role, r.status].join(" ").includes(activeFilter);
  }

  function applyFilter(choice, which) {
    if (which === "role") setRoleFilter(choice);
    else setStatusFilter(choice);
    setActiveFilter(choice);
    const count = rows.filter((r) =>
      choice === "All" || [r.name, r.email, r.role, r.status].join(" ").includes(choice)
    ).length;
    showToast(`${count} item${count === 1 ? "" : "s"} shown.`);
  }

  function handleAction(row, action) {
    if (action === "edit") return setEntry({ row });
    if (action === "delete") {
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      return showToast(`${row.name} account deleted.`);
    }
    const status = action === "approve" || action === "activate" ? "Active" : "Suspended";
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status } : r)));
    showToast(`${row.name}: ${action} action applied.`);
  }

  return (
    <section className={`content admin-view view${active ? " active-view" : ""}`}>
      <div className="admin-kpis">
        <article><strong>124</strong><span>Active Accounts</span></article>
        <article><strong>8</strong><span>Pending Review</span></article>
        <article><strong>3</strong><span>Admin Users</span></article>
      </div>
      <section className="admin-card">
        <div className="admin-card-head">
          <h3>Manage Accounts</h3>
          <div>
            <AdminMenu menuKey="accounts-role" label={roleFilter} onSelect={(c) => applyFilter(c, "role")} />
            <AdminMenu menuKey="accounts-status" label={statusFilter} onSelect={(c) => applyFilter(c, "status")} />
            <button type="button" className="add-button" onClick={() => setEntry({})}>Add Account</button>
          </div>
        </div>
        <table className="admin-table account-table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={visible(r) ? "" : "is-hidden"}>
                <td>{r.name}</td><td>{r.email}</td><td>{r.role}</td><td>{r.status}</td>
                <td>
                  {accountActionList(r.status).map((a) => (
                    <button key={a} type="button" onClick={() => handleAction(r, a)}>{actionLabels[a]}</button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <AdminEntryModal
        mode="account"
        entry={entry}
        onClose={() => setEntry(null)}
        onSubmit={(data) => {
          if (entry.row) {
            setRows((prev) => prev.map((r) => (r.id === entry.row.id ? { ...r, ...data } : r)));
          } else {
            setRows((prev) => [{ id: nextId(), ...data }, ...prev]);
          }
          showToast(`${data.name} account saved.`);
          setEntry(null);
        }}
      />
    </section>
  );
}

export function AdminEntryModal({ mode, entry, onClose, onSubmit }) {
  if (!entry) return null;
  const row = entry.row;
  const isEdit = !!row;

  const title =
    mode === "account"
      ? isEdit ? "Edit Account" : "Add Account"
      : isEdit ? "Edit Partnership" : "Add Partnership";

  return (
    <Modal open={!!entry} onClose={onClose}>
      <section className="tracer-modal admin-entry-modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" aria-label="Close entry form" onClick={onClose}>×</button>
        </div>
        <form
          className="admin-entry-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = e.currentTarget.elements;
            if (mode === "account") {
              onSubmit({
                name: f.name.value.trim(),
                email: f.email.value.trim(),
                role: f.role.value,
                status: f.status.value,
              });
            } else {
              onSubmit({
                partner: f.partner.value.trim(),
                type: f.type.value,
                contact: f.contact.value.trim(),
                status: f.status.value,
              });
            }
          }}
        >
          <div className="admin-entry-fields">
            {mode === "account" ? (
              <>
                <label>Name<input type="text" name="name" defaultValue={row?.name || ""} required /></label>
                <label>Email<input type="email" name="email" defaultValue={row?.email || ""} required /></label>
                <label>
                  Role
                  <select name="role" defaultValue={row?.role || "Alumni"}>
                    <option>Admin</option><option>Staff</option><option>Alumni</option>
                  </select>
                </label>
                <label>
                  Status
                  <select name="status" defaultValue={row?.status || "Active"}>
                    <option>Active</option><option>Pending</option><option>Suspended</option>
                  </select>
                </label>
              </>
            ) : (
              <>
                <label>Partner<input type="text" name="partner" defaultValue={row?.partner || ""} required /></label>
                <label>
                  Type
                  <select name="type" defaultValue={row?.type || "Industry"}>
                    <option>Industry</option><option>Academe</option><option>Government</option>
                  </select>
                </label>
                <label>Contact<input type="email" name="contact" defaultValue={row?.contact || ""} required /></label>
                <label>
                  Status
                  <select name="status" defaultValue={row?.status || "Active"}>
                    <option>Active</option><option>Pending</option><option>Archived</option>
                  </select>
                </label>
              </>
            )}
          </div>
          <div className="modal-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit">Save</button>
          </div>
        </form>
      </section>
    </Modal>
  );
}
