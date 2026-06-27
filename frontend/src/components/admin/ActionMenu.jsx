import React, { useState, useRef, useEffect } from "react";
import Icon from "../common/Icon.jsx";
import { actionLabels } from "../../data.js";

// maps each action key to an icon from iconData.js
const ACTION_ICONS = {
  view:     "icon-20",
  edit:     "icon-18",
  delete:   "icon-delete",
  print:    "icon-19",
  approve:  "icon-13",
  reject:   "icon-9",
  complete: "icon-13",
  cancel:   "icon-9",
  suspend:  "icon-9",
  activate: "icon-13",
  archive:  "icon-26",
  resend:   "icon-15",
};

export default function ActionMenu({ actions, onSelect, isOpen, onToggle }) {
  const [localOpen, setLocalOpen] = useState(false);
  const ref = useRef(null);

  // Support both controlled (isOpen/onToggle) and uncontrolled modes
  const open     = isOpen    !== undefined ? isOpen    : localOpen;
  const setOpen  = onToggle  !== undefined ? onToggle  : setLocalOpen;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [open, setOpen]);

  return (
    <span className="action-menu" ref={ref}>
      <button
        type="button"
        className="action-menu-trigger"
        aria-label="Actions"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      >
        <Icon name="icon-24" />
      </button>
      {open && (
        <div className="action-menu-list" onClick={(e) => e.stopPropagation()}>
          {actions.map((a) => (
            <button
              key={a}
              type="button"
              className={`action-menu-item action-${a}`}
              onClick={() => { setOpen(false); onSelect(a); }}
            >
              <span className="action-menu-icon"><Icon name={ACTION_ICONS[a]} /></span>
              <span>{actionLabels[a]}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
