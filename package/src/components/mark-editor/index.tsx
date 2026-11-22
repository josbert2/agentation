"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import styles from "./styles.module.scss";

// =============================================================================
// Editor de marcado "Marcar la imagen" (autocontenido en el fork)
// =============================================================================
//
// Overlay a pantalla completa para dibujar sobre una captura. Los trazos se
// guardan como figuras (no como pixeles) en un ref y se re-renderizan sobre un
// canvas de tinta encima de un canvas base con la imagen. Al "Listo" se aplana
// base + tinta en un PNG a resolución natural y se devuelve.
//
// Compartido por el popup de requerimiento y el Panel de Cambios.

export type MarkTool = "pen" | "arrow" | "rect" | "ellipse" | "highlight";
export interface MarkPt {
  x: number;
  y: number;
}
export interface MarkShape {
  tool: MarkTool;
  color: string;
  width: number;
  pts: MarkPt[];
  a: MarkPt;
  b: MarkPt;
}

export const MARK_COLORS = ["#e0322f", "#D97706", "#2563EB", "#16a34a", "#111118", "#ffffff"];
export const MARK_WIDTHS = [3, 5, 9];
export const MARK_TOOLS: { t: MarkTool; label: string; icon: React.ReactNode }[] = [
  {
    t: "pen",
    label: "Lápiz libre",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    ),
  },
  {
    t: "arrow",
    label: "Flecha",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <line x1="5" y1="19" x2="19" y2="5" />
        <polyline points="10 5 19 5 19 14" />
      </svg>
    ),
  },
  {
    t: "rect",
    label: "Rectángulo",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <rect x="4" y="6" width="16" height="12" rx="2" />
      </svg>
    ),
  },
  {
    t: "ellipse",
    label: "Círculo",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <ellipse cx="12" cy="12" rx="8.5" ry="6.5" />
      </svg>
    ),
  },
  {
    t: "highlight",
    label: "Resaltador",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 20h16" />
        <path d="M9 16l-4 1 1-4 8-8 3 3-8 8Z" />
      </svg>
    ),
  },
];

/** Dibuja una figura sobre el contexto 2D (compartido por preview y aplanado). */
export function drawMarkShape(ctx: CanvasRenderingContext2D, s: MarkShape): void {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  if (s.tool === "highlight") {
    ctx.globalAlpha = 0.32;
    ctx.lineWidth = s.width * 3.2;
  } else {
    ctx.globalAlpha = 1;
    ctx.lineWidth = s.width;
  }

  if (s.tool === "pen" || s.tool === "highlight") {
    ctx.beginPath();
    s.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
  } else if (s.tool === "rect") {
    ctx.strokeRect(
      Math.min(s.a.x, s.b.x),
      Math.min(s.a.y, s.b.y),
      Math.abs(s.b.x - s.a.x),
      Math.abs(s.b.y - s.a.y)
    );
  } else if (s.tool === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(
      (s.a.x + s.b.x) / 2,
      (s.a.y + s.b.y) / 2,
      Math.abs(s.b.x - s.a.x) / 2,
      Math.abs(s.b.y - s.a.y) / 2,
      0,
      0,
      Math.PI * 2
    );
    ctx.stroke();
  } else if (s.tool === "arrow") {
    const { a, b } = s;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const head = Math.max(11, s.width * 3);
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - head * Math.cos(ang - 0.4), b.y - head * Math.sin(ang - 0.4));
    ctx.lineTo(b.x - head * Math.cos(ang + 0.4), b.y - head * Math.sin(ang + 0.4));
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export interface MarkEditorProps {
  /** Data URL de la captura a marcar. */
  src: string;
  /** Devuelve el PNG aplanado (base + trazos) y si hubo marcas. */
  onDone: (dataUrl: string, marked: boolean) => void;
  /** Cierra sin aplicar. */
  onCancel: () => void;
}

export function MarkEditor({ src, onDone, onCancel }: MarkEditorProps) {
  const baseRef = useRef<HTMLCanvasElement>(null);
  const inkRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const shapesRef = useRef<MarkShape[]>([]);
  const draftRef = useRef<MarkShape | null>(null);
  const drawingRef = useRef(false);

  const [tool, setTool] = useState<MarkTool>("pen");
  const [color, setColor] = useState(MARK_COLORS[0]);
  const [width, setWidth] = useState(5);
  const [count, setCount] = useState(0);

  // refs espejo — los usa el listener de puntero sin re-suscribirse
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const colorRef = useRef(color);
  colorRef.current = color;
  const widthRef = useRef(width);
  widthRef.current = width;

  const redraw = useCallback(() => {
    const ink = inkRef.current;
    if (!ink) return;
    const ctx = ink.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, ink.width, ink.height);
    for (const s of shapesRef.current) drawMarkShape(ctx, s);
    if (draftRef.current) drawMarkShape(ctx, draftRef.current);
  }, []);

  // Carga la imagen y dimensiona ambos canvas (escalada para caber en pantalla).
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const base = baseRef.current,
        ink = inkRef.current,
        wrap = wrapRef.current;
      if (!base || !ink || !wrap) return;
      const maxW = Math.min(820, window.innerWidth - 96);
      const maxH = window.innerHeight - 300;
      const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1.5);
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      base.width = ink.width = w;
      base.height = ink.height = h;
      wrap.style.width = `${w}px`;
      wrap.style.height = `${h}px`;
      const bctx = base.getContext("2d");
      if (!bctx) return;
      bctx.clearRect(0, 0, w, h);
      bctx.drawImage(img, 0, 0, w, h);
      redraw();
    };
    img.src = src;
  }, [src, redraw]);

  // Dibujo con Pointer Events (mouse + touch).
  useEffect(() => {
    const ink = inkRef.current;
    if (!ink) return;
    const posOf = (e: PointerEvent): MarkPt => {
      const r = ink.getBoundingClientRect();
      return {
        x: (e.clientX - r.left) * (ink.width / r.width),
        y: (e.clientY - r.top) * (ink.height / r.height),
      };
    };
    const down = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      drawingRef.current = true;
      try {
        ink.setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      const p = posOf(e);
      draftRef.current = {
        tool: toolRef.current,
        color: colorRef.current,
        width: widthRef.current,
        pts: [p],
        a: p,
        b: p,
      };
    };
    const move = (e: PointerEvent) => {
      if (!drawingRef.current || !draftRef.current) return;
      e.preventDefault();
      const p = posOf(e);
      const d = draftRef.current;
      if (d.tool === "pen" || d.tool === "highlight") d.pts.push(p);
      else d.b = p;
      redraw();
    };
    const up = () => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      const d = draftRef.current;
      draftRef.current = null;
      if (d) {
        const moved =
          d.tool === "pen" || d.tool === "highlight"
            ? d.pts.length > 1
            : Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y) > 3;
        if (moved) {
          shapesRef.current.push(d);
          setCount(shapesRef.current.length);
        }
      }
      redraw();
    };
    ink.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      ink.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [redraw]);

  // Escape → cancelar (captura + stop para no cerrar también el popup de atrás).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  const undo = () => {
    shapesRef.current.pop();
    setCount(shapesRef.current.length);
    redraw();
  };
  const clearAll = () => {
    shapesRef.current = [];
    setCount(0);
    redraw();
  };
  const done = () => {
    const base = baseRef.current;
    if (!base) {
      onCancel();
      return;
    }
    const out = document.createElement("canvas");
    out.width = base.width;
    out.height = base.height;
    const octx = out.getContext("2d");
    if (!octx) {
      onCancel();
      return;
    }
    octx.drawImage(base, 0, 0);
    if (inkRef.current) octx.drawImage(inkRef.current, 0, 0);
    onDone(out.toDataURL("image/png"), shapesRef.current.length > 0);
  };

  return (
    <div
      className={styles.meOverlay}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className={styles.meCard}>
        {/* Header */}
        <div className={styles.meHeader}>
          <span className={styles.meTitle}>Marcar la imagen</span>
          <span className={styles.meSubtitle}>Dibuja encima para señalar exactamente qué cambiar</span>
          <button type="button" className={styles.meClose} onClick={onCancel} aria-label="Cerrar">
            ✕
          </button>
        </div>

        {/* Toolbar */}
        <div className={styles.meToolbar}>
          <div className={styles.meGroup}>
            <span className={styles.meGroupLabel}>Herr.</span>
            {MARK_TOOLS.map(({ t, label, icon }) => (
              <button
                key={t}
                type="button"
                title={label}
                onClick={() => setTool(t)}
                className={`${styles.meToolBtn} ${tool === t ? styles.meToolBtnActive : ""}`}
              >
                {icon}
              </button>
            ))}
          </div>

          <div className={styles.meGroup}>
            <span className={styles.meGroupLabel}>Color</span>
            {MARK_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                onClick={() => setColor(c)}
                style={{ background: c }}
                className={`${styles.meColor} ${color === c ? styles.meColorActive : ""}`}
              />
            ))}
          </div>

          <div className={styles.meGroup}>
            <span className={styles.meGroupLabel}>Grosor</span>
            {MARK_WIDTHS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWidth(w)}
                className={`${styles.meWidthBtn} ${width === w ? styles.meWidthBtnActive : ""}`}
              >
                <span className={styles.meWidthDot} style={{ width: w + 2, height: w + 2 }} />
              </button>
            ))}
          </div>

          <div className={styles.meToolbarActions}>
            <button type="button" onClick={undo} disabled={count === 0} className={styles.meGhostBtn}>
              ↶ Deshacer
            </button>
            <button type="button" onClick={clearAll} disabled={count === 0} className={styles.meGhostBtn}>
              Limpiar
            </button>
          </div>
        </div>

        {/* Stage */}
        <div className={styles.meStage}>
          <div ref={wrapRef} className={styles.meCanvasWrap}>
            <canvas ref={baseRef} className={styles.meBaseCanvas} />
            <canvas ref={inkRef} className={styles.meInkCanvas} />
          </div>
        </div>

        {/* Footer */}
        <div className={styles.meFooter}>
          <span className={styles.meCount}>
            {count === 0 ? "Sin marcas todavía" : count === 1 ? "1 marca" : `${count} marcas`}
          </span>
          <div className={styles.meFooterActions}>
            <button type="button" onClick={onCancel} className={styles.meGhostBtn}>
              Cancelar
            </button>
            <button type="button" onClick={done} className={styles.mePrimaryBtn}>
              Listo
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default MarkEditor;
