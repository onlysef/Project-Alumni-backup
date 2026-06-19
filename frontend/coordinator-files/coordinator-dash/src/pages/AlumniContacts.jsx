import React, { useState } from "react";
import Icon from "../SimpleIcon.jsx";
import { initialContacts, blankContact } from "./CoordinatorShared.jsx";

export default function AlumniContacts({ active, showToast }) {
  const [contacts, setContacts] = useState(initialContacts);
  const [form, setForm] = useState(blankContact);
  const [filters, setFilters] = useState({ course: "Course", year: "Year", search: "" });

  const visibleContacts = contacts.filter((contact) => {
    const courseOk = filters.course === "Course" || contact.course === filters.course;
    const yearOk = filters.year === "Year" || contact.year === filters.year;
    const query = filters.search.trim().toLowerCase();
    const searchOk = !query || [contact.name, contact.title, contact.email, contact.phone].some((value) => value.toLowerCase().includes(query));
    return courseOk && yearOk && searchOk;
  });

  function saveContact(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) {
      showToast("Name and email are required.");
      return;
    }
    setContacts((prev) => [{ id: Date.now(), ...form, title: form.title || "Alumni" }, ...prev]);
    setForm(blankContact);
    showToast("Contact saved.");
  }

  function deleteContact(id) {
    setContacts((prev) => prev.filter((contact) => contact.id !== id));
    showToast("Contact removed.");
  }

  return (
    <section className={`content coordinator-content view${active ? " active-view" : ""}`}>
      <form className="coord-contact-form" onSubmit={saveContact}>
        <h3>Update/Add New Contact</h3>
        <div className="coord-contact-grid">
          <input placeholder="Name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
          <input placeholder="Email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
          <input placeholder="Graduation Year" value={form.year} onChange={(e) => setForm((p) => ({ ...p, year: e.target.value }))} />
          <input placeholder="Phone" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
          <input placeholder="Course" value={form.course} onChange={(e) => setForm((p) => ({ ...p, course: e.target.value.toUpperCase() }))} />
          <input placeholder="Position / Title" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} />
        </div>
        <div className="coord-contact-actions">
          <button type="submit">Save</button>
          <button type="button" onClick={() => setForm(blankContact)}>Add</button>
        </div>
      </form>

      <section className="coord-contacts-table">
        <div className="coord-contact-toolbar">
          <h3>Manage Contacts</h3>
          <span>Filter by</span>
          <select value={filters.course} onChange={(e) => setFilters((p) => ({ ...p, course: e.target.value }))}><option>Course</option><option>BSIT</option><option>BSCS</option><option>BSIS</option></select>
          <select value={filters.year} onChange={(e) => setFilters((p) => ({ ...p, year: e.target.value }))}><option>Year</option><option>2022</option><option>2023</option><option>2024</option></select>
          <input placeholder="Search" value={filters.search} onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))} />
        </div>
        <table>
          <thead><tr><th>Name</th><th>Graduation Year</th><th>Course</th><th>Email</th><th>Phone</th><th /></tr></thead>
          <tbody>
            {visibleContacts.map((contact) => (
              <tr key={contact.id}>
                <td><strong>{contact.name}</strong><small>{contact.title}</small></td>
                <td>{contact.year}</td>
                <td>{contact.course}</td>
                <td>{contact.email}</td>
                <td>{contact.phone}</td>
                <td>
                  <button type="button" aria-label={`Edit ${contact.name}`} onClick={() => setForm(contact)}>Edit</button>
                  <button type="button" aria-label={`Delete ${contact.name}`} onClick={() => deleteContact(contact.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </section>
  );
}