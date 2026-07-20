import React, { useState, useEffect } from "react";
import { useOutletContext } from "react-router-dom";
import Icon from "../../components/common/Icon.jsx";
import { Modal, ConfirmDialog } from "../../components/common/Primitives.jsx";
import AdminMenu from "../../components/admin/AdminMenu.jsx";
import ActionMenu from "../../components/admin/ActionMenu.jsx";
import { partnerActionList, actionLabels } from "../../data.js";

import { API, authHeaders } from "../../services/api.js";

function mapPartnership(p) {
  return {
    id:          p._id,
    partner:     p.name,
    type:        p.type,
    contact:     p.contact,
    status:      p.status,
    description: p.description ?? "",
  };
}

export default function PartnershipsView() {
  const { showToast } = useOutletContext();
  const [rows, setRows]             = useState([]);
  const [stats, setStats]           = useState({ active: 0, pending: 0, jobOpportunities: 0 });
  const [loading, setLoading]       = useState(true);
  const [typeFilter, setTypeFilter] = useState("Type");
  const [statusFilter, setStatusFilter] = useState("Status");
  const [activeFilter, setActiveFilter] = useState("All");
  const [entry, setEntry]           = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [confirm, setConfirm]       = useState(null);

  useEffect(() => {
      fetchPartnerships();
  }, []);

  async function fetchPartnerships() {
    setLoading(true);
    try {
      const res  = await fetch(`${API}/admin/partnerships`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) { showToast(data.message || "Failed to load partnerships."); return; }
      setRows(data.partnerships.map(mapPartnership));
      setStats(data.stats);
    } catch {
      showToast("Could not connect to server.");
    } finally {
      setLoading(false);
    }
  }

  function visible(r) {
    const typeMatch   = typeFilter === "Type"   || typeFilter === "All" || r.type === typeFilter;
    const statusMatch = statusFilter === "Status" || statusFilter === "All" || r.status === statusFilter;
    const filterMatch = activeFilter === "All"
      || [r.partner, r.type, r.contact, r.status].join(" ").includes(activeFilter);
    return typeMatch && statusMatch && filterMatch;
  }

  function applyFilter(choice, which) {
    if (which === "type")   setTypeFilter(choice);
    else                    setStatusFilter(choice);
    setActiveFilter(choice);
    const count = rows.filter((r) =>
      choice === "All" || [r.partner, r.type, r.contact, r.status].join(" ").includes(choice)
    ).length;
    showToast(`${count} item${count === 1 ? "" : "s"} shown.`);
  }

  async function handleAction(row, action) {
    if (action === "view") {
      setEntry({ row, mode: "view" });
      return;
    }
    if (action === "edit") {
      setEntry({ row, mode: "edit" });
      return;
    }
    if (action === "delete") {
      setConfirm({
        message:      `Delete "${row.partner}"? This cannot be undone.`,
        confirmLabel: "Delete",
        danger:       true,
        onConfirm:    async () => {
          setConfirm(null);
          try {
            const res = await fetch(`${API}/admin/partnerships/${row.id}`, {
              method: "DELETE", headers: authHeaders(),
            });
            if (!res.ok) { showToast("Failed to delete."); return; }
            setRows((prev) => prev.filter((r) => r.id !== row.id));
            showToast(`${row.partner} deleted.`);
            refreshStats();
          } catch { showToast("Could not connect to server."); }
        },
      });
      return;
    }
    const newStatus = action === "approve" || action === "activate" ? "Active" : "Archived";
    try {
      const res = await fetch(`${API}/admin/partnerships/${row.id}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.message || "Update failed."); return; }
      setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, status: newStatus } : r));
      showToast(`${row.partner}: ${actionLabels[action]} applied.`);
      refreshStats();
    } catch { showToast("Could not connect to server."); }
  }

  async function refreshStats() {
    try {
      const res  = await fetch(`${API}/admin/partnerships`, { headers: authHeaders() });
      const data = await res.json();
      if (res.ok) setStats(data.stats);
    } catch { /* ignore */ }
  }

  return (
    <section className={`content admin-view view active-view`}>
      <div className="admin-kpis">
        <article><strong>{stats.active}</strong><span>Active Partners</span></article>
        <article><strong>{stats.pending}</strong><span>Pending MOUs</span></article>
        <article><strong>{stats.jobOpportunities}</strong><span>Job Opportunities</span></article>
      </div>
      <section className="admin-card">
        <div className="admin-card-head">
          <h3>Partnerships</h3>
          <div>
            <AdminMenu menuKey="partner-type" label={typeFilter} onSelect={(c) => applyFilter(c, "type")} />
            <AdminMenu menuKey="partner-status" label={statusFilter} onSelect={(c) => applyFilter(c, "status")} />
            <button type="button" className="add-button" onClick={() => setEntry({})}>Add</button>
          </div>
        </div>
        {loading ? (
          <p style={{ padding: "1rem" }}>Loading...</p>
        ) : (
          <div className="table-scroll">
          <table className="admin-table partnership-table">
            <thead><tr><th>Partner</th><th>Type</th><th>Contact</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={visible(r) ? "" : "is-hidden"}>
                  <td>{r.partner}</td><td>{r.type}</td><td>{r.contact}</td><td>{r.status}</td>
                  <td>
                    <ActionMenu
                      actions={partnerActionList(r.status)}
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

      <PartnershipModal
        entry={entry}
        onClose={() => setEntry(null)}
        onSubmit={async (data) => {
          const isEdit = !!entry?.row;
          try {
            const url    = isEdit ? `${API}/admin/partnerships/${entry.row.id}` : `${API}/admin/partnerships`;
            const method = isEdit ? "PATCH" : "POST";
            const res    = await fetch(url, {
              method,
              headers: authHeaders(),
              body: JSON.stringify(data),
            });
            const json = await res.json();
            if (!res.ok) { showToast(json.message || "Save failed."); return; }
            if (isEdit) {
              setRows((prev) => prev.map((r) => r.id === entry.row.id ? mapPartnership(json.partnership) : r));
            } else {
              setRows((prev) => [mapPartnership(json.partnership), ...prev]);
            }
            showToast(`${data.name} saved.`);
            setEntry(null);
            refreshStats();
          } catch { showToast("Could not connect to server."); }
        }}
      />

      <ConfirmDialog
        open={!!confirm}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel}
        danger={confirm?.danger}
        onConfirm={confirm?.onConfirm}
        onCancel={() => setConfirm(null)}
      />
    </section>
  );
}

function PartnershipModal({ entry, onClose, onSubmit }) {
  if (!entry) return null;
  const row     = entry.row;
  const mode    = entry.mode || (row ? "edit" : "add");
  const isView  = mode === "view";
  const title   = isView ? "View Partnership" : row ? "Edit Partnership" : "Add Partnership";

  if (isView) {
    return (
      <Modal open={!!entry} onClose={onClose}>
        <section className="tracer-modal admin-entry-modal" role="dialog" aria-modal="true">
          <div className="modal-head">
            <h3>{title}</h3>
            <button type="button" aria-label="Close" onClick={onClose}>×</button>
          </div>
          <div className="record-details">
            <div><strong>Partner Name</strong><span>{row.partner}</span></div>
            <div><strong>Type</strong><span>{row.type}</span></div>
            <div><strong>Contact Email</strong><span>{row.contact}</span></div>
            <div><strong>Status</strong><span>{row.status}</span></div>
            <div><strong>Description</strong><span>{row.description || "—"}</span></div>
          </div>
          <div className="modal-actions" style={{ padding: "0 20px 20px" }}>
            <button type="button" onClick={onClose}>Close</button>
          </div>
        </section>
      </Modal>
    );
  }

  return (
    <Modal open={!!entry} onClose={onClose}>
      <section className="tracer-modal admin-entry-modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <form
          className="admin-entry-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = e.currentTarget.elements;
            onSubmit({
              name:        f.name.value.trim(),
              type:        f.type.value,
              contact:     f.contact.value.trim(),
              status:      f.status.value,
              description: f.description.value.trim(),
            });
          }}
        >
          <div className="admin-entry-fields">
            <label>Partner Name
              <input type="text" name="name" defaultValue={row?.partner || ""} required />
            </label>
            <label>Type
              <select name="type" defaultValue={row?.type || "Information Technology & BPO"}>
                <option>Information Technology & BPO</option>
                <option>Manufacturing</option>
                <option>Banking & Finance</option>
                <option>Healthcare</option>
                <option>Retail & Trade</option>
                <option>Education</option>
                <option>Government</option>
                <option>Construction & Engineering</option>
                <option>Hospitality & Tourism</option>
                <option>Agriculture</option>
                <option>Others</option>
              </select>
            </label>
            <label>Contact Email
              <input type="email" name="contact" defaultValue={row?.contact || ""} required />
            </label>
            <label>Status
              <select name="status" defaultValue={row?.status || "Pending"}>
                <option>Active</option>
                <option>Pending</option>
                <option>Archived</option>
              </select>
            </label>
            <label>Description
              <input type="text" name="description" defaultValue={row?.description || ""} />
            </label>
          </div>
          <div className="modal-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit">{row ? "Save" : "Add Partnership"}</button>
          </div>
        </form>
      </section>
    </Modal>
  );
}
