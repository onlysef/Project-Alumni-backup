import React from "react";
import { Dropdown } from "../common/Primitives.jsx";
import { adminMenuChoices } from "../../data.js";

export default function AdminMenu({ menuKey, label, onSelect }) {
  return (
    <Dropdown
      menuClassName="admin-menu"
      options={adminMenuChoices[menuKey] || ["All"]}
      onSelect={onSelect}
      active={label}
      trigger={(toggle) => (
        <button type="button" className="admin-choice" onClick={toggle}>{label}</button>
      )}
    />
  );
}
