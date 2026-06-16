import React, { useState, useEffect } from "react";
import Icon from "../Icon.jsx";
import { Dropdown, Modal } from "../Primitives.jsx";
import AdminMenu from "../components/AdminMenu.jsx";
import ActionMenu from "../components/ActionMenu.jsx";
import { accountActionList, actionLabels } from "../data.js";

import { API } from "../shared.js";

function authHeaders() {
  const token = localStorage.getItem("auth_token");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

function capitalize(str = "") {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function mapUser(u) {
  return {
    id:             u._id,
    firstName:      u.firstName,
    lastName:       u.lastName,
    name:           u.role === 'employer' ? (u.company || u.firstName) : `${u.firstName} ${u.lastName}`,
    email:          u.email,
    role:           capitalize(u.role),
    status:         capitalize(u.status),
    college:        u.college        || "",
    course:         u.course         || "",
    track:          u.track          || "",
    graduationYear: u.graduationYear || "",
    company:        u.company        || "",
  };
}

const COLLEGES = ["CPAG", "CCS", "COS", "CIT", "COE", "CBA", "COED", "CASS", "CCJE", "CAFA"];
const CCS_COURSES = ["BSIT", "BSCS", "BSIS"];
const BATCH_YEARS = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i);

export default function AccountsView({ active, showToast, roleFilterFromNav }) {
  const [rows, setRows]               = useState([]);
  const [loading, setLoading]         = useState(true);
  const [roleFilter, setRoleFilter]   = useState("Role");
  const [statusFilter, setStatusFilter] = useState("Status");
  const [entry, setEntry]             = useState(null);
  const [importOpen, setImportOpen]   = useState(false);
  const [openMenuId, setOpenMenuId]   = useState(null);

  useEffect(() => {
    if (!active) return;
    fetchUsers();
  }, [active]);

  useEffect(() => {
    if (active && roleFilterFromNav) {
      setRoleFilter(roleFilterFromNav);
    }
  }, [active, roleFilterFromNav]);

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

    if (action === "resend") {
      try {
        const res  = await fetch(`${API}/admin/users/${row.id}/resend-credentials`, {
          method: "POST", headers: authHeaders(),
        });
        const data = await res.json();
        if (res.ok) {
          setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, status: "Pending" } : r));
          showToast(data.message);
        } else {
          showToast(data.message || "Failed to resend credentials.");
        }
      } catch { showToast("Could not connect to server."); }
      return;
    }

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
          <div className="table-scroll">
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
                    <ActionMenu
                      actions={accountActionList(r.status)}
                      onSelect={(a) => { setOpenMenuId(null); handleAction(r, a); }}
                      isOpen={openMenuId === r.id}
                      onToggle={(v) => setOpenMenuId(typeof v === "function" ? (v(openMenuId === r.id) ? r.id : null) : (v ? r.id : null))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
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
              const payload = {
                firstName: data.firstName,
                lastName:  data.lastName,
                email:     data.email,
                role:      data.role.toLowerCase(),
                status:    data.status.toLowerCase(),
              };
              if (data.role.toLowerCase() === "alumni") {
                if (data.college)        payload.college        = data.college;
                if (data.course)         payload.course         = data.course;
                if (data.graduationYear) payload.graduationYear = Number(data.graduationYear);
                payload.track = data.course === "BSIT" ? (data.track || "") : "";
              }
              const res = await fetch(`${API}/admin/users/${entry.row.id}`, {
                method: "PATCH",
                headers: authHeaders(),
                body: JSON.stringify(payload),
              });
              const json = await res.json();
              if (!res.ok) { showToast(json.message || "Update failed."); return; }
              setRows((prev) => prev.map((r) =>
                r.id === entry.row.id ? mapUser(json.user) : r
              ));
              showToast(json.employmentRemoved
                ? `${data.firstName} ${data.lastName} updated. Employment record removed.`
                : `${data.firstName} ${data.lastName} updated.`);
            } catch { showToast("Could not connect to server."); return; }
          } else {
            try {
              const payload = {
                firstName: data.firstName,
                lastName:  data.lastName,
                email:     data.email,
                role:      data.role.toLowerCase(),
              };
              if (data.role.toLowerCase() === "alumni") {
                if (data.college)        payload.college        = data.college;
                if (data.course)         payload.course         = data.course;
                if (data.graduationYear) payload.graduationYear = Number(data.graduationYear);
                if (data.course === "BSIT" && data.track) payload.track = data.track;
              }
              const res = await fetch(`${API}/admin/users`, {
                method: "POST",
                headers: authHeaders(),
                body: JSON.stringify(payload),
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
          <div style={{ padding: "4px 0 8px" }}>

            {/* Success header */}
            <div style={{ textAlign: "center", padding: "18px 0 14px" }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#6b1a2a" }}>Import Complete</div>
              <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>{result.message}</div>
            </div>

            {/* Divider */}
            <div style={{ borderTop: "1px solid #f0e0e3", margin: "0 0 14px" }} />

            {/* Stat row */}
            <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
              {[
                { count: result.created.length, label: "Created", icon: "✓", numColor: "#276749", iconBg: "#d4f0de", textColor: "#276749" },
                { count: result.skipped.length, label: "Skipped", icon: "⚠", numColor: "#975a16", iconBg: "#fde9c0", textColor: "#975a16" },
                { count: result.failed.length,  label: "Failed",  icon: "✗", numColor: "#c53030", iconBg: "#fdd0d0", textColor: "#c53030" },
              ].map(({ count, label, icon, numColor, iconBg, textColor }) => (
                <div key={label} style={{
                  flex: 1, textAlign: "center",
                  background: "#fafafa", border: "1px solid #eee",
                  borderRadius: 10, padding: "14px 8px",
                }}>
                  <div style={{
                    width: 34, height: 34, borderRadius: "50%",
                    background: iconBg, display: "flex", alignItems: "center",
                    justifyContent: "center", margin: "0 auto 8px",
                    fontSize: 15, fontWeight: 700, color: numColor,
                  }}>{icon}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: numColor, lineHeight: 1 }}>{count}</div>
                  <div style={{ fontSize: 11, color: textColor, marginTop: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
                </div>
              ))}
            </div>

            <div className="modal-actions" style={{ marginTop: 0, padding: "0 16px 8px" }}>
              <button type="button" style={{ background: "var(--maroon)", color: "#fff", borderRadius: 8, padding: "8px 22px" }} onClick={() => { reset(); }}>Import Another</button>
              <button type="button" style={{ background: "var(--maroon)", color: "#fff", borderRadius: 8, padding: "8px 22px" }} onClick={() => { onDone(); reset(); }}>Done</button>
            </div>
          </div>
        )}
      </section>
    </Modal>
  );
}

const BSIT_TRACKS = ["TSM", "WMA", "NA"];

export function AdminEntryModal({ entry, onClose, onSubmit }) {
  const [role,    setRole]    = React.useState(entry?.row?.role    || "Alumni");
  const [college, setCollege] = React.useState(entry?.row?.college || "");

  React.useEffect(() => {
    setRole(entry?.row?.role       || "Alumni");
    setCollege(entry?.row?.college || "");
  }, [entry]);

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
              firstName:      f.firstName.value.trim(),
              lastName:       f.lastName.value.trim(),
              email:          f.email.value.trim(),
              role:           f.role.value,
              status:         f.status        ? f.status.value         : undefined,
              college:        f.college       ? f.college.value        : undefined,
              graduationYear: f.graduationYear ? f.graduationYear.value : undefined,
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
              <select name="role" value={role} onChange={(e) => setRole(e.target.value)}>
                <option>Admin</option>
                <option>Alumni</option>
                <option>Coordinator</option>
                <option>Employer</option>
              </select>
            </label>
            {role === "Alumni" && (
              <>
                <label>College
                  <select name="college" value={college} onChange={(e) => setCollege(e.target.value)}>
                    <option value="">— Select college —</option>
                    {COLLEGES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </label>
                <label>Graduation Year
                  <select name="graduationYear" defaultValue={row?.graduationYear || ""}>
                    <option value="">— Select year —</option>
                    {BATCH_YEARS.map((y) => <option key={y}>{y}</option>)}
                  </select>
                </label>
              </>
            )}
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
