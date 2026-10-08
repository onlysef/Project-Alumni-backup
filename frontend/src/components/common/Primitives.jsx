import React, { useState, useRef, useEffect } from "react";
import ReactDOM from "react-dom";

// Click-to-open dropdown. `portal` renders the menu into <body> so scrolling containers can't clip it.
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
      <section className="tracer-modal confirm-dialog" role="alertdialog" aria-modal="true">
        <button type="button" className="confirm-dialog-close" aria-label="Close" onClick={onCancel}>×</button>
        <div className={`confirm-dialog-icon${danger ? " is-danger" : ""}`} aria-hidden="true">
          {danger ? (
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2"/><path d="M12 11v5M12 8h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          )}
        </div>
        <div className="confirm-dialog-body">
          <h3>{danger ? "Are you sure?" : "Confirm"}</h3>
          <p>{message}</p>
        </div>
        <div className="confirm-dialog-actions">
          <button type="button" className="confirm-dialog-cancel" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className={`confirm-dialog-confirm${danger ? " is-danger" : ""}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </Modal>
  );
}
