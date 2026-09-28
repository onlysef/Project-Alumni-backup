import React, { useState, useRef, useEffect, useId } from "react";
import { createPortal } from "react-dom";
import Icon from "../common/Icon.jsx";
import { actionLabels } from "../../data.js";

// maps each action key to an icon from iconData.js
const ACTION_ICONS = {
  view:     "icon-20",
  edit:     "icon-18",
  delete:   "icon-delete",
  print:    "icon-download",
  approve:  "icon-13",
  reject:   "icon-9",
  complete: "icon-13",
  cancel:   "icon-9",
  suspend:  "icon-9",
  activate: "icon-13",
  unsuspend: "icon-13",
  archive:  "icon-26",
  resend:   "icon-15",
};

// Broadcast opens so other menus close; a trigger's stopPropagation keeps their outside-click listener from firing.
const openListeners = new Set();
function broadcastOpen(id) {
  openListeners.forEach((fn) => fn(id));
}

// Estimated height (matches the .action-menu-item CSS) to decide whether to open upward.
const MENU_ITEM_HEIGHT = 38;
const MENU_PADDING = 14;
const MENU_WIDTH = 160; // matches .action-menu-list's min-width in admin-mod.css

export default function ActionMenu({ actions, onSelect, isOpen, onToggle }) {
  const [localOpen, setLocalOpen] = useState(false);
  // Portaled to <body> so neighboring table rows can't paint over the open menu.
  const [menuPos, setMenuPos] = useState(null); // { top, left, direction } | null
  const ref = useRef(null);
  const menuRef = useRef(null);
  const id = useId();

  const controlled = isOpen !== undefined;

  // Support both controlled (isOpen/onToggle) and uncontrolled modes
  const open     = controlled ? isOpen   : localOpen;
  const setOpen  = controlled ? onToggle : setLocalOpen;

  function computeMenuPos() {
    if (!ref.current) return null;
    const rect = ref.current.getBoundingClientRect();
    const estimatedHeight = actions.length * MENU_ITEM_HEIGHT + MENU_PADDING;
    const spaceBelow = window.innerHeight - rect.bottom;
    const direction = spaceBelow < estimatedHeight ? "up" : "down";
    const left = Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 6);
    // Reset `top` explicitly: the class's calc(100% + 6px) breaks once the menu is portaled.
    return {
      left: Math.max(6, left),
      top:    direction === "down" ? rect.bottom + 6 : "auto",
      bottom: direction === "up"   ? window.innerHeight - rect.top + 6 : "auto",
    };
  }

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [open, setOpen]);

  useEffect(() => {
    if (!open) return;
    function reposition() { setMenuPos(computeMenuPos()); }
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (controlled) return; // parent already coordinates single-open itself
    const listener = (openId) => { if (openId !== id) setLocalOpen(false); };
    openListeners.add(listener);
    return () => openListeners.delete(listener);
  }, [controlled, id]);

  function handleTriggerClick(e) {
    e.stopPropagation();
    if (!open) setMenuPos(computeMenuPos()); // about to open — anchor to the trigger's current position
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
      {open && menuPos && createPortal(
        <div
          className="action-menu-list action-menu-list-portal"
          ref={menuRef}
          style={{ position: "fixed", left: menuPos.left, right: "auto", top: menuPos.top, bottom: menuPos.bottom }}
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
        </div>,
        document.body
      )}
    </span>
  );
}
