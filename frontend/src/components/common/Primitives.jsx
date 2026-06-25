import React, { useState, useRef, useEffect } from "react";
import ReactDOM from "react-dom";

// Generic "click to open, click outside to close" dropdown.
export function Dropdown({ trigger, className, options, onSelect, active, menuClassName }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("click", onDoc);
    return () => {
      document.removeEventListener("click", onDoc);
    };
  }, [open]);

  return (
    <span ref={ref} style={{ position: "relative" }}>
      {trigger(() => setOpen((o) => !o), open)}
      {open && (
        <div className={menuClassName + " show"} onClick={(e) => e.stopPropagation()}>
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
      )}
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
