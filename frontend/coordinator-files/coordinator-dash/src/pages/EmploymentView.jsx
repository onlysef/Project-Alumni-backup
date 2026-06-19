import React, { useState } from "react";
import Icon from "../SimpleIcon.jsx";
import { downloadCsv } from "./CoordinatorShared.jsx";

export default function EmploymentView({ active, showToast }) {
  const rows = [
    { name: "Maria Santos", course: "BSIS", company: "DataWorks PH", position: "Data Scientist", status: "Employed" },
    { name: "Katie Salazar", course: "BSIT", company: "CloudBridge", position: "Web Developer", status: "Employed" },
    { name: "Whitney Flores", course: "BSIT", company: "Northbyte", position: "Junior Developer", status: "Employed" },
    { name: "John Ocampo", course: "BSIT", company: "TSU Support Desk", position: "Tech Support", status: "Employed" },
  ];

  return (
    <section className={`content coordinator-content view${active ? " active-view" : ""}`}>
      <section className="coord-records-card">
        <h3>Alumni Employment Details</h3>
        <div className="coord-record-toolbar">
          <select onChange={(event) => showToast?.(`Employment filter: ${event.target.value}`)}>
            <option>All Courses</option>
            <option>BSIT</option>
            <option>BSCS</option>
            <option>BSIS</option>
          </select>
        </div>
        <table>
          <thead>
            <tr><th>Name</th><th>Course</th><th>Company</th><th>Position</th><th>Status</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.name}-${row.company}`}>
                <td>{row.name}</td>
                <td>{row.course}</td>
                <td>{row.company}</td>
                <td>{row.position}</td>
                <td>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="coord-record-actions">
          <button type="button" onClick={() => {
            downloadCsv("coordinator-employment-details.csv", [
              ["Name", "Course", "Company", "Position", "Status"],
              ...rows.map((row) => [row.name, row.course, row.company, row.position, row.status]),
            ]);
            showToast?.("Employment details exported.");
          }}>Export Employment</button>
        </div>
      </section>
    </section>
  );
}