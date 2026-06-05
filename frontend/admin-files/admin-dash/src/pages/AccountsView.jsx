import React, { useState, useEffect } from "react";
import Icon from "../Icon.jsx";
import { Dropdown, Modal } from "../Primitives.jsx";
import AdminMenu from "../components/AdminMenu.jsx";
import { accountActionList, actionLabels } from "../data.js";

const API = "http://localhost:5000/api";

function authHeaders() {
  const token = localStorage.getItem("auth_token");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

function capitalize(str = "") {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function mapUser(u) {
  return {
    id:        u._id,
    firstName: u.firstName,
    lastName:  u.lastName,
    name:      `${u.firstName} ${u.lastName}`,
    email:     u.email,
    role:      capitalize(u.role),
    status:    capitalize(u.status),
  };
}

export default function AccountsView({ active, showToast }) {
  const [rows, setRows]               = useState([]);
  const [loading, setLoading]         = useState(true);
  const [roleFilter, setRoleFilter]   = useState("Role");
  const [statusFilter, setStatusFilter] = useState("Status");
  const [activeFilter, setActiveFilter] = useState("All");
  const [entry, setEntry]             = useState(null);

  useEffect(() => {
    if (!active) return;
    fetchUsers();
  }, [active]);

  async function fetchUsers() {
    setLoading(true);
    try {
      const res  = await fetch(`${API}/admin/users`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) { showToast(data.message || "Failed to load users."); return; }
      setRows(data.users.map(mapUser));
    } catch {
      showToast("Could not connect to server.");
    } finally {
      setLoading(false);
    }
  }

  function visible(r) {
    if (activeFilter === "All") return true;
    return [r.name, r.email, r.role, r.status].join(" ").toLowerCase()
      .includes(activeFilter.toLowerCase());
  }

  function applyFilter(choice, which) {
    if (which === "role")   setRoleFilter(choice);
    else                    setStatusFilter(choice);
    setActiveFilter(choice);
    const count = rows.filter((r) =>
      choice === "All" || [r.name, r.email, r.role, r.status].join(" ")
        .toLowerCase().includes(choice.toLowerCase())
    ).length;
    showToast(`${count} item${count === 1 ? "" : "s"} shown.`);
  }

  async function handleAction(row, action) {
    if (action === "edit") { setEntry({ row }); return; }

    if (action === "delete") {
      try {
        const res = await fetch(`${API}/admin/users/${row.id}`, {
          method: "DELETE", headers: authHeaders(),
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.message || "Delete failed."); return; }
        setRows((prev) => prev.filter((r) => r.id !== row.id));
        showToast(`${row.name} deleted.`);
      } catch { showToast("Could not connect to server."); }
      return;
    }

    const newStatus = (action === "approve" || action === "activate") ? "active" : "suspended";
    try {
      const res = await fetch(`${API}/admin/users/${row.id}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.message || "Update failed."); return; }
      setRows((prev) => prev.map((r) =>
        r.id === row.id ? { ...r, status: capitalize(newStatus) } : r
      ));
      showToast(`${row.name}: ${action} applied.`);
    } catch { showToast("Could not connect to server."); }
  }

  const activeCount    = rows.filter((r) => r.status === "Active").length;
  const pendingCount   = rows.filter((r) => r.status === "Pending").length;
  const adminCount     = rows.filter((r) => r.role === "Admin").length;

  return (
    <section className={`content admin-view view${active ? " active-view" : ""}`}>
      <div className="admin-kpis">
        <article><strong>{activeCount}</strong><span>Active Accounts</span></article>
        <article><strong>{pendingCount}</strong><span>Pending Review</span></article>
        <article><strong>{adminCount}</strong><span>Admin Users</span></article>
      </div>
      <section className="admin-card">
        <div className="admin-card-head">
          <h3>Manage Accounts</h3>
          <div>
            <AdminMenu menuKey="accounts-role"   label={roleFilter}   onSelect={(c) => applyFilter(c, "role")} />
            <AdminMenu menuKey="accounts-status" label={statusFilter} onSelect={(c) => applyFilter(c, "status")} />
            <button type="button" className="add-button" onClick={() => setEntry({})}>Add Account</button>
          </div>
        </div>

        {loading ? (
          <p style={{ padding: "1.5rem", textAlign: "center", color: "var(--text-muted, #888)" }}>
            Loading accounts…
          </p>
        ) : (
          <table className="admin-table account-table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan="5" style={{ textAlign: "center", padding: "1.5rem" }}>No accounts found.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className={visible(r) ? "" : "is-hidden"}>
                  <td>{r.name}</td>
                  <td>{r.email}</td>
                  <td>{r.role}</td>
                  <td>{r.status}</td>
                  <td>
                    {accountActionList(r.status).map((a) => (
                      <button key={a} type="button" onClick={() => handleAction(r, a)}>
                        {actionLabels[a]}
                      </button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <AdminEntryModal
        entry={entry}
        onClose={() => setEntry(null)}
        onSubmit={async (data) => {
          if (entry.row) {
            try {
              const res = await fetch(`${API}/admin/users/${entry.row.id}`, {
                method: "PATCH",
                headers: authHeaders(),
                body: JSON.stringify({
                  firstName: data.firstName,
                  lastName:  data.lastName,
                  email:     data.email,
                  role:      data.role.toLowerCase(),
                  status:    data.status.toLowerCase(),
                }),
              });
              const json = await res.json();
              if (!res.ok) { showToast(json.message || "Update failed."); return; }
              setRows((prev) => prev.map((r) =>
                r.id === entry.row.id ? mapUser(json.user) : r
              ));
              showToast(`${data.firstName} ${data.lastName} updated.`);
            } catch { showToast("Could not connect to server."); return; }
          } else {
            showToast("To add accounts, register through the signup page.");
          }
          setEntry(null);
        }}
      />
    </section>
  );
}

export function AdminEntryModal({ entry, onClose, onSubmit }) {
  if (!entry) return null;
  const row    = entry.row;
  const isEdit = !!row;

  return (
    <Modal open={!!entry} onClose={onClose}>
      <section className="tracer-modal admin-entry-modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{isEdit ? "Edit Account" : "Account Info"}</h3>
          <button type="button" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <form
          className="admin-entry-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = e.currentTarget.elements;
            onSubmit({
              firstName: f.firstName.value.trim(),
              lastName:  f.lastName.value.trim(),
              email:     f.email.value.trim(),
              role:      f.role.value,
              status:    f.status.value,
            });
          }}
        >
          <div className="admin-entry-fields">
            <label>First Name
              <input type="text" name="firstName" defaultValue={row?.firstName || ""} required />
            </label>
            <label>Last Name
              <input type="text" name="lastName" defaultValue={row?.lastName || ""} required />
            </label>
            <label>Email
              <input type="email" name="email" defaultValue={row?.email || ""} required />
            </label>
            <label>Role
              <select name="role" defaultValue={row?.role || "Alumni"}>
                <option>Admin</option>
                <option>Alumni</option>
                <option>Coordinator</option>
                <option>Employer</option>
              </select>
            </label>
            <label>Status
              <select name="status" defaultValue={row?.status || "Active"}>
                <option>Active</option>
                <option>Pending</option>
                <option>Suspended</option>
              </select>
            </label>
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
