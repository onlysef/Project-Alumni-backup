import { useState, useRef, useEffect, useCallback } from "react";
import { Modal } from "./Primitives.jsx";

// Square JPEG cropper. `inline` skips the built-in modal for callers that swap it into their own open modal.
export default function AvatarCropper({ src, busy, onCancel, onSave, inline = false }) {
  const VIEW = 260;
  const OUTPUT = 320;
  const imgRef = useRef(null);
  const dragRef = useRef(null);
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const base = nat.w && nat.h ? Math.max(VIEW / nat.w, VIEW / nat.h) : 1;
  const dispW = nat.w * base * zoom;
  const dispH = nat.h * base * zoom;

  const clamp = useCallback((p) => {
    const maxX = Math.max(0, (dispW - VIEW) / 2);
    const maxY = Math.max(0, (dispH - VIEW) / 2);
    return { x: Math.min(maxX, Math.max(-maxX, p.x)), y: Math.min(maxY, Math.max(-maxY, p.y)) };
  }, [dispW, dispH]);

  useEffect(() => { setPos((p) => clamp(p)); }, [clamp]);

  function onImgLoad(e) {
    setNat({ w: e.target.naturalWidth, h: e.target.naturalHeight });
    setZoom(1);
    setPos({ x: 0, y: 0 });
  }
  function onPointerDown(e) {
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    if (!dragRef.current) return;
    const d = dragRef.current;
    setPos(clamp({ x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) }));
  }
  function endDrag() { dragRef.current = null; }

  function handleSave() {
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, OUTPUT, OUTPUT);
    const k = OUTPUT / VIEW;
    ctx.drawImage(
      imgRef.current,
      (VIEW / 2 + pos.x - dispW / 2) * k,
      (VIEW / 2 + pos.y - dispH / 2) * k,
      dispW * k,
      dispH * k,
    );
    onSave(canvas.toDataURL("image/jpeg", 0.9));
  }

  const content = (
    <div className="avatar-cropper" role="dialog" aria-modal="true" aria-label="Adjust profile photo">
      <div className="modal-head"><h3>Adjust photo</h3><button type="button" aria-label="Cancel" disabled={busy} onClick={onCancel}>×</button></div>
      <p className="avatar-cropper-hint">Drag to reposition · use the slider to zoom.</p>
      <div
        className="avatar-cropper-stage"
        style={{ width: VIEW, height: VIEW }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <img
          ref={imgRef}
          src={src}
          alt=""
          draggable="false"
          onLoad={onImgLoad}
          style={{ width: dispW || "auto", height: dispH || "auto", transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px)` }}
        />
        <div className="avatar-cropper-ring" />
      </div>
      <input type="range" min="1" max="3" step="0.01" value={zoom} disabled={busy} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" />
      <div className="avatar-cropper-actions">
        <button type="button" className="secondary-employment-btn" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="button" className="primary-employment-btn" disabled={busy || !nat.w} onClick={handleSave}>{busy ? "Saving…" : "Save Photo"}</button>
      </div>
    </div>
  );

  if (inline) return content;

  return (
    <Modal open onClose={busy ? () => {} : onCancel} className="avatar-cropper-modal">
      {content}
    </Modal>
  );
}
