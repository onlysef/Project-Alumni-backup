import React, { useState, useRef, useEffect } from "react";
import ReactDOM from "react-dom";

// Generic "click to open, click outside to close" dropdown.
//
// `portal`: render the menu into document.body with fixed positioning
// computed from the trigger's own screen position, instead of the normal
// absolutely-positioned-within-the-trigger approach. Every admin/coordinator
// page body (`.content`) scrolls internally via `overflow-y: auto` with a
// fixed height — a long option list opening from a trigger near the top of a
// short page has no room to render within that box, so its tail end gets
// clipped with no way to scroll to it, regardless of z-index. Escaping to
// body sidesteps that clipping entirely. Only opt in where this has actually
// bitten (AdminMenu) — other menu variants have their own bespoke
// up/down-opening CSS that a blanket switch would fight with.
export function Dropdown({ trigger, className, options, onSelect, active, menuClassName, portal = false }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (
        ref.current && !ref.current.contains(e.target) &&
        !(menuRef.current && menuRef.current.contains(e.target))
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("click", onDoc);
    return () => {
      document.removeEventListener("click", onDoc);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !portal || !ref.current) return;
    const compute = () => {
      const r = ref.current.getBoundingClientRect();
      setPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
    };
    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [open, portal]);

  const menu = open && (
    <div
      ref={menuRef}
      className={menuClassName + " show"}
      style={portal ? { position: "fixed", top: pos?.top ?? 0, right: pos?.right ?? 0, visibility: pos ? "visible" : "hidden" } : undefined}
      onClick={(e) => e.stopPropagation()}
    >
      {options.map((label) => (
        <button
          key={label}
          type="button"
          className={label === active ? "active" : undefined}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(false);
            onSelect(label);
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <span ref={ref} style={{ position: "relative" }}>
      {trigger(() => setOpen((o) => !o), open)}
      {menu && (portal ? ReactDOM.createPortal(menu, document.body) : menu)}
    </span>
  );
}

export function Modal({ open, onClose, className, children }) {
  if (!open) return null;
  return ReactDOM.createPortal(
    <div
      className={`modal-backdrop show${className ? " " + className : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {children}
    </div>,
    document.body
  );
}

export function ConfirmDialog({ open, message, confirmLabel = "Confirm", danger = false, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <Modal open={open} onClose={onCancel}>
      <section className="tracer-modal" role="dialog" aria-modal="true" style={{ maxWidth: 380 }}>
        <div className="modal-head">
          <h3>Confirm</h3>
          <button type="button" aria-label="Close" onClick={onCancel}>×</button>
        </div>
        <div className="modal-body">
          <p style={{ margin: 0, paddingBottom: 18, fontSize: 14, lineHeight: 1.6 }}>{message}</p>
          <div className="modal-actions">
            <button type="button" onClick={onCancel}>Cancel</button>
            <button
              type="button"
              className="modal-confirm"
              onClick={onConfirm}
              style={danger ? { background: "#c53030", color: "#fff" } : undefined}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </section>
    </Modal>
  );
}
