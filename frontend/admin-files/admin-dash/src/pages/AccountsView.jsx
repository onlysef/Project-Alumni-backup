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
  const [entry, setEntry]             = useState(null);
  const [importOpen, setImportOpen]   = useState(false);

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
    const roleMatch   = roleFilter === "Role"   || roleFilter === "All"   || r.role === roleFilter;
    const statusMatch = statusFilter === "Status" || statusFilter === "All" || r.status === statusFilter;
    return roleMatch && statusMatch;
  }

  function applyFilter(choice, which) {
    const newRole   = which === "role"   ? choice : roleFilter;
    const newStatus = which === "status" ? choice : statusFilter;
    if (which === "role")   setRoleFilter(choice);
    else                    setStatusFilter(choice);
    const count = rows.filter((r) => {
      const roleMatch   = newRole === "Role"   || newRole === "All"   || r.role === newRole;
      const statusMatch = newStatus === "Status" || newStatus === "All" || r.status === newStatus;
      return roleMatch && statusMatch;
    }).length;
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

  return (
    <section className={`content admin-view view${active ? " active-view" : ""}`}>
      <div className="admin-kpis">
        <article><strong>{activeCount}</strong><span>Active Accounts</span></article>
        <article><strong>{pendingCount}</strong><span>Pending Activation</span></article>
      </div>
      <section className="admin-card">
        <div className="admin-card-head">
          <h3>Manage Accounts</h3>
          <div className="accounts-controls">
            <AdminMenu menuKey="accounts-role"   label={roleFilter}   onSelect={(c) => applyFilter(c, "role")} />
            <AdminMenu menuKey="accounts-status" label={statusFilter} onSelect={(c) => applyFilter(c, "status")} />
            <button type="button" className="add-button import-button" onClick={() => setImportOpen(true)}>Import</button>
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

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={() => { fetchUsers(); setImportOpen(false); }}
        showToast={showToast}
      />

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
            try {
              const res = await fetch(`${API}/admin/users`, {
                method: "POST",
                headers: authHeaders(),
                body: JSON.stringify({
                  firstName: data.firstName,
                  lastName:  data.lastName,
                  email:     data.email,
                  role:      data.role.toLowerCase(),
                }),
              });
              const text = await res.text();
              let json;
              try { json = JSON.parse(text); } catch { showToast("Server error: " + text.slice(0, 80)); return; }
              if (!res.ok) { showToast(json.message || "Failed to create account."); return; }
              setRows((prev) => [mapUser(json.user), ...prev]);
              showToast(`Account created. Login credentials sent to ${data.email}.`);
            } catch (err) { showToast(err.message || "Could not connect to server."); return; }
          }
          setEntry(null);
        }}
      />
    </section>
  );
}

export function ImportModal({ open, onClose, onDone, showToast }) {
  const [file, setFile]         = useState(null);
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState(null);
  const fileRef                 = React.useRef(null);

  function reset() {
    setFile(null);
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!file) return;
    setLoading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const token = localStorage.getItem("auth_token");
      const res   = await fetch(`${API}/admin/users/import`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.message || "Import failed."); return; }
      setResult(data);
    } catch {
      showToast("Could not connect to server.");
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }}>
      <section className="tracer-modal admin-entry-modal" role="dialog" aria-modal="true" style={{ maxWidth: 520 }}>
        <div className="modal-head">
          <h3>Import Alumni Accounts</h3>
          <button type="button" aria-label="Close" onClick={() => { reset(); onClose(); }}>×</button>
        </div>

        {!result ? (
          <form className="admin-entry-form" onSubmit={handleSubmit}>
            <p style={{ color: "var(--text-muted, #666)", fontSize: 13, margin: "0 0 12px" }}>
              Upload an <strong>.xlsx</strong>, <strong>.xls</strong>, or <strong>.csv</strong> file.
              Required columns: <code>firstName</code>, <code>lastName</code>, <code>email</code>.
              Optional: <code>role</code>, <code>course</code>, <code>graduationYear</code>.
            </p>
            <label style={{ display: "block", marginBottom: 16 }}>
              Spreadsheet file
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                style={{ display: "block", marginTop: 6 }}
                onChange={(e) => setFile(e.target.files[0] || null)}
                required
              />
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => { reset(); onClose(); }}>Cancel</button>
              <button type="submit" disabled={loading || !file}>
                {loading ? "Importing…" : "Import"}
              </button>
            </div>
          </form>
        ) : (
          <div style={{ padding: "0 0 8px" }}>
            <p style={{ margin: "0 0 12px", fontWeight: 600 }}>{result.message}</p>

            {(result.employmentCreated > 0 || result.employmentSkipped > 0) && (
              <div style={{ background: "#f0f7ff", border: "1px solid #bee3f8", borderRadius: 6, padding: "8px 12px", marginBottom: 12, fontSize: 13 }}>
                {result.employmentCreated > 0 && (
                  <div style={{ color: "#2b6cb0" }}>
                    📋 {result.employmentCreated} employment record{result.employmentCreated !== 1 ? "s" : ""} auto-created in Alumni Employment Details.
                  </div>
                )}
                {result.employmentSkipped > 0 && (
                  <div style={{ color: "#975a16", marginTop: result.employmentCreated > 0 ? 4 : 0 }}>
                    ⚠ {result.employmentSkipped} employment record{result.employmentSkipped !== 1 ? "s" : ""} skipped (already existed).
                  </div>
                )}
              </div>
            )}

            {result.created.length > 0 && (
              <details open>
                <summary style={{ cursor: "pointer", color: "#276749", fontWeight: 600, marginBottom: 6 }}>
                  ✓ Created ({result.created.length})
                </summary>
                <ul style={{ margin: "4px 0 12px 16px", fontSize: 13, color: "#2d3748" }}>
                  {result.created.map((r) => (
                    <li key={r.email}>
                      {r.name} — {r.email}
                      {r.role === "alumni" && <span style={{ color: "#2b6cb0" }}> (employment record created)</span>}
                      {!r.emailSent && <span style={{ color: "#e53e3e" }}> (email not sent)</span>}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {result.skipped.length > 0 && (
              <details>
                <summary style={{ cursor: "pointer", color: "#975a16", fontWeight: 600, marginBottom: 6 }}>
                  ⚠ Skipped ({result.skipped.length})
                </summary>
                <ul style={{ margin: "4px 0 12px 16px", fontSize: 13, color: "#2d3748" }}>
                  {result.skipped.map((r) => (
                    <li key={r.email}>{r.name || r.email} — {r.reason}</li>
                  ))}
                </ul>
              </details>
            )}

            {result.failed.length > 0 && (
              <details>
                <summary style={{ cursor: "pointer", color: "#c53030", fontWeight: 600, marginBottom: 6 }}>
                  ✗ Failed ({result.failed.length})
                </summary>
                <ul style={{ margin: "4px 0 12px 16px", fontSize: 13, color: "#2d3748" }}>
                  {result.failed.map((r, i) => (
                    <li key={i}>{r.name || r.email} — {r.reason}</li>
                  ))}
                </ul>
              </details>
            )}

            <div className="modal-actions" style={{ marginTop: 12 }}>
              <button type="button" onClick={() => { reset(); }}>Import Another</button>
              <button type="button" onClick={() => { onDone(); reset(); }}>
                Done
              </button>
            </div>
          </div>
        )}
      </section>
    </Modal>
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
          <h3>{isEdit ? "Edit Account" : "Add Account"}</h3>
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
              status:    f.status ? f.status.value : undefined,
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
            {isEdit && (
              <label>Status
                <select name="status" defaultValue={row?.status || "Active"}>
                  <option>Active</option>
                  <option>Pending</option>
                  <option>Suspended</option>
                </select>
              </label>
            )}
          </div>
          <div className="modal-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit">{isEdit ? "Save" : "Create Account"}</button>
          </div>
        </form>
      </section>
    </Modal>
  );
}
