import React, { useState, useRef, useEffect, useId } from "react";
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

// Uncontrolled instances (no isOpen/onToggle passed) each track their own
// open state, so nothing stops two rows' menus being open at once. Clicking
// a different row's trigger calls stopPropagation() before the click can
// bubble to `document`, so the previously-open menu's own outside-click
// listener never fires. Broadcasting every open here lets sibling menus
// close themselves directly instead of relying on that bubble.
const openListeners = new Set();
function broadcastOpen(id) {
  openListeners.forEach((fn) => fn(id));
}

export default function ActionMenu({ actions, onSelect, isOpen, onToggle }) {
  const [localOpen, setLocalOpen] = useState(false);
  const ref = useRef(null);
  const id = useId();

  const controlled = isOpen !== undefined;

  // Support both controlled (isOpen/onToggle) and uncontrolled modes
  const open     = controlled ? isOpen   : localOpen;
  const setOpen  = controlled ? onToggle : setLocalOpen;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [open, setOpen]);

  useEffect(() => {
    if (controlled) return; // parent already coordinates single-open itself
    const listener = (openId) => { if (openId !== id) setLocalOpen(false); };
    openListeners.add(listener);
    return () => openListeners.delete(listener);
  }, [controlled, id]);

  function handleTriggerClick(e) {
    e.stopPropagation();
    if (controlled) {
      setOpen((o) => !o);
      return;
    }
    setLocalOpen((o) => {
      const next = !o;
      if (next) broadcastOpen(id);
      return next;
    });
  }

  return (
    <span className="action-menu" ref={ref}>
      <button
        type="button"
        className="action-menu-trigger"
        aria-label="Actions"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={handleTriggerClick}
      >
        <Icon name="icon-24" />
      </button>
      {open && (
        <div
          className="action-menu-list"
          style={{ top: "auto", bottom: "calc(100% + 6px)" }}
          onClick={(e) => e.stopPropagation()}
        >
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
