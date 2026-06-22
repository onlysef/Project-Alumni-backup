import React, { useState, useEffect } from "react";
import Icon from "../SimpleIcon.jsx";
import { initialContacts, blankContact, downloadCsv } from "./CoordinatorShared.jsx";

export default function AlumniContacts({ active, showToast }) {
  const [contacts, setContacts] = useState(initialContacts);
  const [form, setForm] = useState(blankContact);
  const [editingId, setEditingId] = useState(null);   // id being edited, or "new"
  const [openMenuId, setOpenMenuId] = useState(null);  // row whose 3-dot menu is open
  const [filters, setFilters] = useState({ course: "Course", year: "Year", search: "" });

  const showForm = editingId !== null;

  // close the action menu when clicking anywhere else
  useEffect(() => {
    if (openMenuId === null) return;
    const close = () => setOpenMenuId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [openMenuId]);

  const visibleContacts = contacts.filter((contact) => {
    const courseOk = filters.course === "Course" || contact.course === filters.course;
    const yearOk = filters.year === "Year" || contact.year === filters.year;
    const query = filters.search.trim().toLowerCase();
    const searchOk = !query || [contact.name, contact.title, contact.email, contact.phone].some((value) => value.toLowerCase().includes(query));
    return courseOk && yearOk && searchOk;
  });

  function startAdd() {
    setForm(blankContact);
    setEditingId("new");
  }
  function startEdit(contact) {
    setForm(contact);
    setEditingId(contact.id);
    setOpenMenuId(null);
  }
  function cancelEdit() {
    setForm(blankContact);
    setEditingId(null);
  }

  function saveContact(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) {
      showToast("Name and email are required.");
      return;
    }
    if (editingId === "new") {
      setContacts((prev) => [{ id: Date.now(), ...form, title: form.title || "Alumni" }, ...prev]);
      showToast("Contact added.");
    } else {
      setContacts((prev) => prev.map((c) => (c.id === editingId ? { ...form, id: editingId } : c)));
      showToast("Contact updated.");
    }
    cancelEdit();
  }

  function deleteContact(id) {
    setContacts((prev) => prev.filter((contact) => contact.id !== id));
    setOpenMenuId(null);
    if (editingId === id) cancelEdit();
    showToast("Contact removed.");
  }

  return (
    <section className={`content coordinator-content view${active ? " active-view" : ""}`}>
      {showForm && (
        <form className="coord-contact-form" onSubmit={saveContact}>
          <h3>{editingId === "new" ? "Add New Contact" : "Update Contact"}</h3>
          <div className="coord-contact-grid">
            <label className="coord-field"><span>Name</span><input placeholder="Name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} /></label>
            <label className="coord-field"><span>Email</span><input placeholder="Email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} /></label>
            <label className="coord-field"><span>Graduation Year</span><input placeholder="Graduation Year" value={form.year} onChange={(e) => setForm((p) => ({ ...p, year: e.target.value }))} /></label>
            <label className="coord-field"><span>Phone</span><input placeholder="Phone" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} /></label>
            <label className="coord-field"><span>Course</span><input placeholder="Course" value={form.course} onChange={(e) => setForm((p) => ({ ...p, course: e.target.value.toUpperCase() }))} /></label>
            <label className="coord-field"><span>Position / Title</span><input placeholder="Position / Title" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} /></label>
          </div>
          <div className="coord-contact-actions">
            <button type="submit" className="btn btn-primary"><Icon name={editingId === "new" ? "icon-add" : "icon-update"} /> {editingId === "new" ? "Add" : "Update"}</button>
            <button type="button" className="btn btn-secondary" onClick={cancelEdit}><Icon name="icon-cancel" /> Cancel</button>
          </div>
        </form>
      )}

      <section className="coord-contacts-table">
        <div className="coord-contact-toolbar">
          <h3>Manage Contacts</h3>
          <span>Filter by</span>
          <select value={filters.course} onChange={(e) => setFilters((p) => ({ ...p, course: e.target.value }))}><option>Course</option><option>BSIT</option><option>BSCS</option><option>BSIS</option></select>
          <select value={filters.year} onChange={(e) => setFilters((p) => ({ ...p, year: e.target.value }))}><option>Year</option><option>2022</option><option>2023</option><option>2024</option></select>
          <input placeholder="Search" value={filters.search} onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))} />
        </div>
        <table>
          <thead><tr><th>Name</th><th>Graduation Year</th><th>Course</th><th>Email</th><th>Phone</th><th>Actions</th></tr></thead>
          <tbody>
            {visibleContacts.map((contact) => (
              <tr key={contact.id}>
                <td><strong>{contact.name}</strong><small>{contact.title}</small></td>
                <td>{contact.year}</td>
                <td>{contact.course}</td>
                <td>{contact.email}</td>
                <td>{contact.phone}</td>
                <td>
                  <div className="coord-action-menu">
                    <button
                      type="button"
                      className="coord-kebab"
                      aria-label={`Actions for ${contact.name}`}
                      onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === contact.id ? null : contact.id); }}
                    >
                      &#8942;
                    </button>
                    {openMenuId === contact.id && (
                      <div className="coord-action-dropdown" onClick={(e) => e.stopPropagation()}>
                        <button type="button" onClick={() => startEdit(contact)}><Icon name="icon-edit" /> Edit</button>
                        <button type="button" className="coord-action-delete" onClick={() => deleteContact(contact.id)}><Icon name="icon-delete" /> Delete</button>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="coord-table-footer">
          <button type="button" className="btn btn-primary" onClick={startAdd}><Icon name="icon-add" /> Add Contact</button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              downloadCsv("alumni-contacts.csv", [
                ["Name", "Title", "Graduation Year", "Course", "Email", "Phone"],
                ...visibleContacts.map((c) => [c.name, c.title, c.year, c.course, c.email, c.phone]),
              ]);
              showToast("Contacts exported.");
            }}
          >
            <Icon name="icon-export" /> Export
          </button>
        </div>
      </section>
    </section>
  );
}