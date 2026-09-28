import React, { useState, useEffect } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import Icon from "../../components/common/Icon.jsx";
import { Dropdown, Modal, ConfirmDialog } from "../../components/common/Primitives.jsx";
import AdminMenu from "../../components/admin/AdminMenu.jsx";
import ActionMenu from "../../components/admin/ActionMenu.jsx";
import { accountActionList, actionLabels } from "../../data.js";
import { useAuth } from "../../context/AuthContext.jsx";

import { API, authHeaders } from "../../services/api.js";
import { COLLEGE_CODES as COLLEGES, COLLEGE_NAMES, COURSES_BY_COLLEGE } from "../../constants/colleges.js";

function capitalize(str = "") {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Older edits stacked "X. " into lastName; strip repeatedly.
function splitStoredLastName(value = "") {
  let normalized = String(value).trim();
  let middleInitial = "";
  let match;
  while ((match = normalized.match(/^([A-Za-z])\.?\s+(.+)$/))) {
    middleInitial = match[1].toUpperCase();
    normalized = match[2].trim();
  }
  return { middleInitial, lastName: normalized };
}

function mapUser(u) {
  const parsedLastName = splitStoredLastName(u.lastName);
  const middleInitial = (u.middleInitial || parsedLastName.middleInitial || "").replace(/\./g, "").slice(0, 1).toUpperCase();
  const lastName = parsedLastName.lastName;
  return {
    id:             u._id,
    firstName:      u.firstName,
    middleInitial,
    lastName,
    name:           u.role === 'employer'
      ? (u.company || `${u.firstName} ${middleInitial ? `${middleInitial}. ` : ""}${lastName}`)
      : `${u.firstName} ${middleInitial ? `${middleInitial}. ` : ""}${lastName}`,
    email:          u.email,
    role:           capitalize(u.role),
    status:         capitalize(u.status),
    college:        u.college        || "",
    course:         u.course         || "",
    track:          u.track          || "",
    graduationYear: u.graduationYear || "",
    company:        u.company        || "",
    partnershipId:  u.partnershipId  || "",
  };
}

function AccountStatusBadge({ status }) {
  const cls = {
    Active:    "active",
    Pending:   "pending",
    Suspended: "suspended",
  }[status] || "pending";
  return <span className={`status-badge account-status ${cls}`}>{status}</span>;
}

export default function AccountsView() {
  const { showToast } = useOutletContext();
  const { user: loggedInUser, updateUser } = useAuth();
  const [searchParams] = useSearchParams();
  const roleFilterFromNav = searchParams.get("role") || "Role";
  const [rows, setRows]               = useState([]);
  const [loading, setLoading]         = useState(true);
  const [roleFilter, setRoleFilter]   = useState("Role");
  const [statusFilter, setStatusFilter] = useState("Status");
  const [search, setSearch]           = useState("");
  // Search is debounced; filtering and paging happen server-side.
  const [appliedSearch, setAppliedSearch] = useState("");
  const searchDebounceRef = React.useRef(null);
  const [page, setPage]               = useState(1);
  const [totalPages, setTotalPages]   = useState(1);
  const [activeCount, setActiveCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [entry, setEntry]             = useState(null);
  const [importOpen, setImportOpen]   = useState(false);
  const [openMenuId, setOpenMenuId]   = useState(null);
  const [confirm, setConfirm]         = useState(null);
  const [selected, setSelected]       = useState(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [bulkBusy, setBulkBusy]       = useState(false);
  const [partnerships, setPartnerships] = useState([]);

  useEffect(() => {
      fetch(`${API}/admin/partnerships`, { headers: authHeaders() })
        .then((res) => res.json())
        .then((data) => setPartnerships(data.partnerships ?? []))
        .catch(() => {});
  }, []);

  useEffect(() => {
    if (roleFilterFromNav) {
      setRoleFilter(roleFilterFromNav);
    }
  }, [roleFilterFromNav]);

  function handleSearchChange(value) {
    setSearch(value);
    clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => setAppliedSearch(value), 350);
  }

  useEffect(() => { setPage(1); }, [appliedSearch, roleFilter, statusFilter]);

  useEffect(() => {
    fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, appliedSearch, roleFilter, statusFilter]);

  async function fetchUsers() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", page);
      params.set("limit", "50");
      if (appliedSearch.trim()) params.set("search", appliedSearch.trim());
      if (roleFilter !== "Role" && roleFilter !== "All") params.set("role", roleFilter);
      if (statusFilter !== "Status" && statusFilter !== "All") params.set("status", statusFilter);
      const res  = await fetch(`${API}/admin/users?${params.toString()}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) { showToast(data.message || "Failed to load users."); return; }
      setRows(data.users.map(mapUser));
      setTotalPages(data.totalPages || 1);
      setActiveCount(data.activeCount || 0);
      setPendingCount(data.pendingCount || 0);
    } catch {
      showToast("Could not connect to server.");
    } finally {
      setLoading(false);
    }
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
          setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, status: data.status || "Pending" } : r));
          showToast(data.message);
        } else {
          showToast(data.message || "Failed to resend credentials.");
        }
      } catch { showToast("Could not connect to server."); }
      return;
    }

    if (action === "delete") {
      setConfirm({
        message:      `Delete ${row.name}? This cannot be undone.`,
        confirmLabel: "Delete",
        danger:       true,
        onConfirm:    async () => {
          setConfirm(null);
          try {
            const res = await fetch(`${API}/admin/users/${row.id}`, {
              method: "DELETE", headers: authHeaders(),
            });
            const data = await res.json();
            if (!res.ok) { showToast(data.message || "Delete failed."); return; }
            setRows((prev) => prev.filter((r) => r.id !== row.id));
            showToast(`${row.name} deleted.`);
          } catch { showToast("Could not connect to server."); }
        },
      });
      return;
    }

    const newStatus = (action === "approve" || action === "activate" || action === "unsuspend") ? "active" : "suspended";
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

  function handleBulkAction(action) {
    const label    = action === "activate" ? "activate" : "suspend";
    const status   = action === "activate" ? "active" : "suspended";
    const capLabel = label.charAt(0).toUpperCase() + label.slice(1);

    const ids  = [...selected].filter((id) => {
      const row = rows.find((r) => r.id === id);
      return row && row.status.toLowerCase() !== status;
    });

    if (ids.length === 0) {
      showToast(`All selected accounts are already ${status}.`);
      return;
    }

    const count = ids.length;
    const skipped = selected.size - count;

    setConfirm({
      message:      `Are you sure you want to ${label} ${count} account${count === 1 ? "" : "s"}?${skipped > 0 ? ` (${skipped} already ${status}, skipped)` : ""}`,
      confirmLabel: `${capLabel} ${count}`,
      danger:       action !== "activate",
      onConfirm:    async () => {
        setConfirm(null);
        setBulkBusy(true);
        try {
          const res  = await fetch(`${API}/admin/users/bulk-status`, {
            method:  "PATCH",
            headers: authHeaders(),
            body:    JSON.stringify({ ids, status }),
          });
          const data = await res.json();
          if (!res.ok) { showToast(data.message || "Bulk update failed."); return; }

          const updatedSet = new Set(data.updated || ids);
          setRows((prev) => prev.map((r) =>
            updatedSet.has(r.id) ? { ...r, status: capitalize(status) } : r
          ));
          setSelected(new Set());

          const failed = ids.length - (data.modified ?? updatedSet.size);
          if (failed > 0) {
            showToast(`${data.modified ?? updatedSet.size} updated, ${failed} failed.`);
          } else {
            showToast(data.message || `${count} account${count === 1 ? "" : "s"} ${label}d.`);
          }
        } catch {
          showToast("Could not connect to server.");
        } finally {
          setBulkBusy(false);
        }
      },
    });
  }

  const allVisSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someSelected   = rows.some((r) => selected.has(r.id));

  function toggleRow(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allVisSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        rows.forEach((r) => next.delete(r.id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        rows.forEach((r) => next.add(r.id));
        return next;
      });
    }
  }

  return (
    <section className={`content admin-view view active-view`}>
      <div className="admin-kpis">
        <article>
          <div>
            <strong>{activeCount}</strong>
            <span>All Active Accounts</span>
          </div>
          <span className="admin-kpi-icon" aria-hidden="true"><Icon name="icon-11" /></span>
        </article>
        <article>
          <div>
            <strong>{pendingCount}</strong>
            <span>All Pending Activation</span>
          </div>
          <span className="admin-kpi-icon" aria-hidden="true"><Icon name="icon-13" /></span>
        </article>
      </div>
      <section className="admin-card">
        <div className="admin-card-head">
          <h3>Manage Accounts</h3>
          <div className={`accounts-controls${filtersOpen ? " filters-open" : ""}`}>
            <div className={`accounts-search-field${search ? " has-value" : ""}`}>
              <svg className="accounts-search-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="11" cy="11" r="6.5" />
                <path d="m16 16 4 4" />
              </svg>
              <input
                className="admin-search"
                type="search"
                name="accounts-search"
                placeholder="Search accounts…"
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                aria-label="Search accounts by name or email"
                autoComplete="off"
              />
              {search && (
                <button type="button" className="accounts-search-clear" onClick={() => { clearTimeout(searchDebounceRef.current); setSearch(""); setAppliedSearch(""); }} aria-label="Clear account search">
                  ×
                </button>
              )}
            </div>
            <button
              type="button"
              className={`accounts-filter-toggle${filtersOpen ? " active" : ""}`}
              aria-expanded={filtersOpen}
              aria-label={filtersOpen ? "Close account filters" : "Open account filters"}
              title={filtersOpen ? "Close filters" : "Filter accounts"}
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 6h16M7 12h10M10 18h4" />
                <circle cx="7" cy="6" r="1.5" />
                <circle cx="15" cy="12" r="1.5" />
                <circle cx="12" cy="18" r="1.5" />
              </svg>
              <span className="sr-only">Filter accounts</span>
            </button>
            {filtersOpen && (
              <>
                <AdminMenu menuKey="accounts-role" label={roleFilter} onSelect={setRoleFilter} />
                <AdminMenu menuKey="accounts-status" label={statusFilter} onSelect={setStatusFilter} />
              </>
            )}
            <button
              type="button"
              className={`add-button account-toolbar-action account-select-toggle${selectionMode ? " active" : ""}`}
              aria-pressed={selectionMode}
              onClick={() => {
                setSelectionMode((active) => {
                  if (active) setSelected(new Set());
                  return !active;
                });
              }}
            >
              <span aria-hidden="true">{selectionMode ? "✓" : "☑"}</span>
              <span>{selectionMode ? "Done" : "Select"}</span>
            </button>
            <button type="button" className="add-button import-button account-toolbar-action" onClick={() => setImportOpen(true)}>
              <span aria-hidden="true">⇩</span>
              <span>Import</span>
            </button>
            <button type="button" className="add-button account-toolbar-action" onClick={() => setEntry({})}>
              <span aria-hidden="true">+</span>
              <span>Add Account</span>
            </button>
          </div>
        </div>

        {selected.size > 0 && (
          <div className="bulk-toolbar">
            <span className="bulk-count">{selected.size} selected</span>
            <button
              type="button"
              className="bulk-btn bulk-activate"
              disabled={bulkBusy}
              onClick={() => handleBulkAction("activate")}
            >
              Activate Selected
            </button>
            <button
              type="button"
              className="bulk-btn bulk-suspend"
              disabled={bulkBusy}
              onClick={() => handleBulkAction("suspend")}
            >
              Suspend Selected
            </button>
            <button
              type="button"
              className="bulk-btn bulk-clear"
              disabled={bulkBusy}
              onClick={() => setSelected(new Set())}
            >
              Clear
            </button>
          </div>
        )}

        {loading ? (
          <p style={{ padding: "1.5rem", textAlign: "center", color: "var(--text-muted, #888)" }}>
            Loading accounts…
          </p>
        ) : (
          <div className="table-scroll">
          <table className="admin-table account-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  {selectionMode && (
                    <input
                      type="checkbox"
                      className="bulk-checkbox"
                      checked={allVisSelected}
                      ref={(el) => { if (el) el.indeterminate = someSelected && !allVisSelected; }}
                      onChange={toggleAll}
                      aria-label="Select all"
                    />
                  )}
                </th>
                <th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan="6" style={{ textAlign: "center", padding: "1.5rem" }}>No accounts found.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className={selected.has(r.id) ? "row-selected" : ""}>
                  <td>
                    {selectionMode && (
                      <input
                        type="checkbox"
                        className="bulk-checkbox account-row-selector"
                        checked={selected.has(r.id)}
                        onChange={() => toggleRow(r.id)}
                        aria-label={`Select ${r.name}`}
                      />
                    )}
                  </td>
                  <td>{r.name}</td>
                  <td>{r.email}</td>
                  <td>{r.role}</td>
                  <td><AccountStatusBadge status={r.status} /></td>
                  <td>
                    <ActionMenu
                      actions={accountActionList(r.status, r.role)}
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
        {totalPages > 1 && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, padding: "12px 0" }}>
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #ccc", cursor: page <= 1 ? "not-allowed" : "pointer", opacity: page <= 1 ? 0.4 : 1 }}
            >
              ‹ Prev
            </button>
            <span style={{ fontSize: 13, color: "#76656a" }}>Page {page} of {totalPages}</span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #ccc", cursor: page >= totalPages ? "not-allowed" : "pointer", opacity: page >= totalPages ? 0.4 : 1 }}
            >
              Next ›
            </button>
          </div>
        )}
      </section>

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={() => { fetchUsers(); setImportOpen(false); }}
        showToast={showToast}
      />

      <ConfirmDialog
        open={!!confirm}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel}
        danger={confirm?.danger}
        onConfirm={confirm?.onConfirm}
        onCancel={() => setConfirm(null)}
      />

      <AdminEntryModal
        entry={entry}
        partnerships={partnerships}
        onClose={() => setEntry(null)}
        onSubmit={async (data) => {
          if (entry.row) {
            try {
              const payload = {
                firstName:     data.firstName,
                middleInitial: data.middleInitial,
                lastName:      data.lastName,
                email:         data.email,
                role:          data.role.toLowerCase(),
                status:        data.status.toLowerCase(),
              };
              if (data.role.toLowerCase() === "coordinator") {
                payload.college = data.college || "";
              }
              if (data.role.toLowerCase() === "alumni") {
                if (data.college)        payload.college        = data.college;
                if (data.course)         payload.course         = data.course;
                if (data.graduationYear) payload.graduationYear = Number(data.graduationYear);
                payload.track = data.course === "BSIT" ? (data.track || "") : "";
              }
              if (data.role.toLowerCase() === "employer") {
                payload.partnershipId = data.partnershipId || "";
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
              // Refresh the cached session profile when editing your own account.
              if (loggedInUser?.id === entry.row.id) {
                updateUser({
                  firstName: json.user.firstName,
                  lastName:  json.user.lastName,
                  email:     json.user.email,
                });
              }
              const displayName = `${data.firstName} ${data.middleInitial ? `${data.middleInitial}. ` : ""}${data.lastName}`;
              showToast(json.employmentRemoved
                ? `${displayName} updated. Employment record removed.`
                : `${displayName} updated.`);
            } catch { showToast("Could not connect to server."); return; }
          } else {
            try {
              const payload = {
                firstName:     data.firstName,
                middleInitial: data.middleInitial,
                lastName:      data.lastName,
                email:         data.email,
                role:          data.role.toLowerCase(),
              };
              if (data.role.toLowerCase() === "coordinator") {
                payload.college = data.college || "";
              }
              if (data.role.toLowerCase() === "alumni") {
                if (data.college)        payload.college        = data.college;
                if (data.course)         payload.course         = data.course;
                if (data.graduationYear) payload.graduationYear = Number(data.graduationYear);
                if (data.course === "BSIT" && data.track) payload.track = data.track;
              }
              if (data.role.toLowerCase() === "employer") {
                payload.partnershipId = data.partnershipId || "";
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
            <p style={{ color: "var(--text-muted, #666)", fontSize: 13, margin: "0 0 8px" }}>
              Upload an <strong>.xlsx</strong>, <strong>.xls</strong>, or <strong>.csv</strong> file
              with the following columns:
            </p>
            <table style={{ fontSize: 12, borderCollapse: "collapse", width: "100%", marginBottom: 12 }}>
              <thead>
                <tr style={{ background: "#f5eaed" }}>
                  <th style={{ padding: "4px 8px", textAlign: "left", borderBottom: "1px solid #e0c8cc" }}>Column</th>
                  <th style={{ padding: "4px 8px", textAlign: "left", borderBottom: "1px solid #e0c8cc" }}>Required?</th>
                  <th style={{ padding: "4px 8px", textAlign: "left", borderBottom: "1px solid #e0c8cc" }}>Example</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["firstName",      "Required", "Juan"],
                  ["lastName",       "Required", "dela Cruz"],
                  ["email",          "Required", "juan@email.com"],
                  ["college",        "Required for alumni & coordinator", "CCS"],
                  ["course",         "Required for alumni", "BSIT"],
                  ["graduationYear", "Required for alumni", "2024"],
                  ["role",           "Optional", "alumni (default)"],
                ].map(([col, req, ex]) => (
                  <tr key={col}>
                    <td style={{ padding: "3px 8px" }}><code>{col}</code></td>
                    <td style={{ padding: "3px 8px", color: req === "Optional" ? "#888" : "#c53030" }}>{req}</td>
                    <td style={{ padding: "3px 8px", color: "#555" }}>{ex}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ color: "var(--text-muted, #666)", fontSize: 12, margin: "-6px 0 12px" }}>
              College is used to scope everything from tracer study forms to what a coordinator can see — rows
              missing it for an alumni or coordinator role will be skipped and listed under "Failed" below.
            </p>
            <button
              type="button"
              style={{ fontSize: 12, marginBottom: 14, color: "#6b1a2a", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}
              onClick={() => {
                const header = "firstName,lastName,email,college,course,graduationYear,role";
                const sample = "Juan,dela Cruz,juan@email.com,CCS,BSIT,2024,alumni";
                const blob = new Blob([header + "\n" + sample], { type: "text/csv" });
                const url  = URL.createObjectURL(blob);
                const a    = document.createElement("a");
                a.href = url; a.download = "alumni-import-template.csv"; a.click();
                URL.revokeObjectURL(url);
              }}
            >
              ↓ Download CSV Template
            </button>
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

export function AdminEntryModal({ entry, onClose, onSubmit, partnerships = [] }) {
  const [role,    setRole]    = React.useState(entry?.row?.role    || "Alumni");
  const [college, setCollege] = React.useState(entry?.row?.college || "");
  const [course,  setCourse]  = React.useState(entry?.row?.course  || "");
  const [partnershipId, setPartnershipId] = React.useState(entry?.row?.partnershipId || "");

  React.useEffect(() => {
    setRole(entry?.row?.role       || "Alumni");
    setCollege(entry?.row?.college || "");
    setCourse(entry?.row?.course   || "");
    setPartnershipId(entry?.row?.partnershipId || "");
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
              middleInitial:  f.middleInitial.value.trim(),
              lastName:       f.lastName.value.trim(),
              email:          f.email.value.trim(),
              role:           f.role.value,
              status:         f.status        ? f.status.value         : undefined,
              college:        f.college       ? f.college.value        : undefined,
              course:         f.course        ? f.course.value         : undefined,
              track:          f.track         ? f.track.value          : undefined,
              graduationYear: f.graduationYear ? f.graduationYear.value : undefined,
              partnershipId:  f.partnershipId ? f.partnershipId.value  : undefined,
            });
          }}
        >
          <div className="admin-entry-fields">
            <label><span className="field-label">First Name<span className="required-asterisk">*</span></span>
              <input type="text" name="firstName" defaultValue={row?.firstName || ""} required />
            </label>
            <label>Middle Initial
              <input
                type="text"
                name="middleInitial"
                defaultValue={row?.middleInitial || ""}
                maxLength={1}
                inputMode="text"
                aria-label="Middle initial"
                placeholder="e.g. A"
                // Single letter; the period is added on display.
                onChange={(e) => { e.target.value = e.target.value.replace(/[^A-Za-z]/g, "").slice(0, 1).toUpperCase(); }}
              />
            </label>
            <label><span className="field-label">Last Name<span className="required-asterisk">*</span></span>
              <input
                type="text"
                name="lastName"
                defaultValue={row?.lastName || ""}
                required
                onChange={(e) => { e.target.value = e.target.value.replace(/\./g, ""); }}
              />
            </label>
            <label><span className="field-label">Email<span className="required-asterisk">*</span></span>
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
            {(role === "Alumni" || role === "Coordinator") && (
              <label><span className="field-label">College<span className="required-asterisk">*</span></span>
                <select name="college" value={college} onChange={(e) => { setCollege(e.target.value); setCourse(""); }} required>
                  <option value="">Select College</option>
                  {COLLEGES.map((c) => <option key={c} value={c}>{COLLEGE_NAMES[c]}</option>)}
                </select>
              </label>
            )}
            {role === "Employer" && (
              <label>Partner Company
                <select name="partnershipId" value={partnershipId} onChange={(e) => setPartnershipId(e.target.value)}>
                  <option value="">Not linked to a partnership</option>
                  {partnerships.map((p) => <option key={p._id || p.id} value={p._id || p.id}>{p.name}</option>)}
                </select>
              </label>
            )}
            {role === "Alumni" && (
              <label><span className="field-label">Course<span className="required-asterisk">*</span></span>
                <select name="course" value={course} onChange={(e) => setCourse(e.target.value)} required>
                  <option value="">Select Course</option>
                  {(COURSES_BY_COLLEGE[college] || []).map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
            )}
            {role === "Alumni" && course === "BSIT" && (
              <label>BSIT Track
                <select name="track" defaultValue={row?.track || ""}>
                  <option value="">Select Track</option>
                  {BSIT_TRACKS.map((t) => <option key={t}>{t}</option>)}
                </select>
              </label>
            )}
            {role === "Alumni" && (
              <label><span className="field-label">Graduation Year<span className="required-asterisk">*</span></span>
                <input
                  type="number"
                  name="graduationYear"
                  defaultValue={row?.graduationYear || ""}
                  placeholder="e.g. 2024"
                  min="1900"
                  max="2100"
                  step="1"
                  required
                />
              </label>
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
