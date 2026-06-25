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
