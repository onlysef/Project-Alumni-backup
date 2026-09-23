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

// Estimated dropdown height (item height + gap, roughly matching the CSS in
// admin-mod.css's .action-menu-item/.action-menu-list) — used to decide
// whether there's room to open downward before the menu actually renders
// and has a real height to measure.
const MENU_ITEM_HEIGHT = 38;
const MENU_PADDING = 14;
const MENU_WIDTH = 160; // matches .action-menu-list's min-width in admin-mod.css

export default function ActionMenu({ actions, onSelect, isOpen, onToggle }) {
  const [localOpen, setLocalOpen] = useState(false);
  // Table rows sit inside a shared stacking context, and neighboring rows'
  // own trigger buttons (each just as "positioned" as this one, whether via
  // position:relative or an implicit transform-based context from CSS
  // transitions) can end up painting on top of an open dropdown that's
  // still a normal in-row descendant — no z-index on the dropdown alone can
  // reliably out-rank a sibling row's own content from inside a table. A
  // portal renders the open menu directly under <body>, entirely outside
  // the table, so it's never competing with row content for stacking at
  // all — positioned via fixed coordinates read off the trigger instead of
  // the CSS `top`/`bottom: 100%` anchoring that only worked in-place.
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
    // .action-menu-list's own CSS class sets `top: calc(100% + 6px)` — that
    // only made sense back when the list was positioned in-place inside
    // .action-menu. Now that it's portaled to <body> with fixed coordinates,
    // "up" must explicitly override it back to "auto"; leaving it
    // undefined doesn't clear a class-level rule, it just leaves that CSS
    // in effect (percentages resolve against the viewport for a fixed
    // element with no positioned ancestor, so it rendered far off-screen).
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

  // Reposition (or close, if it scrolled far enough that the trigger isn't
  // where the menu was anchored to anymore) rather than leaving a stale,
  // detached menu floating over the wrong row.
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
