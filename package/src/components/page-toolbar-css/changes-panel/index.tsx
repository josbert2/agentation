"use client";

import { useState } from "react";
import type { Annotation } from "../../../types";
import type { OutputDetailLevel } from "../index";
import { IconFrames, IconTrashAlt, IconCopyAlt, IconCheck } from "../../icons";
import { MarkEditor } from "../../mark-editor";
import styles from "./styles.module.scss";

/** Formatos de copia (mismo set que el copiar del toolbar). */
const FORMATS: { value: OutputDetailLevel; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "standard", label: "Standard" },
  { value: "detailed", label: "Detailed" },
  { value: "forensic", label: "Forensic" },
];

/** Acento violeta del modo requerimiento. */
const REQ_ACCENT = "#7c5cff";
/** Prioridades por defecto si no vienen por prop. */
const DEFAULT_PRIORIDADES: { value: string; label: string; color: string }[] = [
  { value: "baja", label: "Baja", color: "#22c55e" },
  { value: "media", label: "Media", color: "#eab308" },
  { value: "alta", label: "Alta", color: "#ef4444" },
];

export type ChangesPanelProps = {
  annotations: Annotation[];
  onDelete: (id: string) => void;

  /** Copia los frames como markdown estructurado en el formato dado. Devuelve
   *  true si copió. */
  onCopyFrames: (detail: OutputDetailLevel) => Promise<boolean>;

  /** Copia UN solo frame (el seleccionado) en el formato dado. Es lo que usa el
   *  botón "Copiar" del panel: cada pantalla se copia individual, no todas
   *  juntas. Si no viene, cae en onCopyFrames (todos). */
  onCopyFrame?: (frame: Annotation, detail: OutputDetailLevel) => Promise<boolean>;

  /** Devuelve el markdown (sin copiar) para previsualizarlo en el modal "Ver". */
  getOutput?: (detail: OutputDetailLevel) => string;

  /** Copy en markdown de UN frame (para guardarlo con el requerimiento). */
  frameCopy?: (frame: Annotation) => string;

  /** Cierra el panel de Cambios (lo llama tras enviar en lote con éxito). */
  onClose?: () => void;

  /** Whether the panel is mounted (controls enter/exit class) */
  isVisible: boolean;

  /** Position override: show panel below toolbar when toolbar is near bottom */
  toolbarNearBottom: boolean;

  // ---------------------------------------------------------------------------
  // Modo requerimiento (edición por frame + envío en lote)
  // ---------------------------------------------------------------------------
  /** Opciones de prioridad (chips) para editar el frame. */
  prioridades?: { value: string; label: string; color: string }[];
  /** Responsables asignables (chips) para editar el frame. */
  responsables?: { email: string; nombre: string }[];
  /** Aplica un patch al frame (comment / screenshot marcado / datos req). */
  onUpdateFrame?: (
    id: string,
    patch: {
      comment?: string;
      screenshot?: string;
      req?: { titulo?: string; prioridad?: string; responsable?: string | null };
    },
  ) => void;
  /** Envía en lote los requerimientos armados. Devuelve ok/fail. */
  onEnviarRequerimientos?: (
    items: {
      titulo?: string;
      prioridad?: string;
      responsable?: string | null;
      descripcion: string;
      screenshot?: string;
      video?: string;
      pageUrl?: string;
      agentationCopy?: string;
    }[],
  ) => Promise<{ ok: number; fail: number }>;
};

/** Format a timestamp as a short relative time in neutral Spanish. */
function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return "ahora";
  const min = Math.floor(sec / 60);
  if (min < 60) return `hace ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `hace ${hr} h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `hace ${day} d`;
  return new Date(timestamp).toLocaleDateString();
}

/** Pick a component/element label for a frame (e.g. "<LoginView>"). */
function elementLabel(annotation: Annotation): string {
  if (annotation.reactComponents && annotation.reactComponents.trim()) {
    // reactComponents looks like "<App> <Dashboard> <Button>" — use the
    // deepest (last) component, which is the most specific one.
    const parts = annotation.reactComponents.trim().split(/\s+/);
    return parts[parts.length - 1];
  }
  return annotation.element;
}

/** Iniciales para el avatar del responsable ("Juan Pérez" → "JP"). */
function initials(nombre: string): string {
  const parts = nombre.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function ChangesPanel({
  annotations,
  onDelete,
  onCopyFrames,
  onCopyFrame,
  isVisible,
  toolbarNearBottom,
  prioridades,
  responsables,
  onUpdateFrame,
  onEnviarRequerimientos,
  getOutput,
  frameCopy,
  onClose,
}: ChangesPanelProps) {
  // Only list feedback annotations (with a written comment). Placement and
  // rearrange annotations don't represent a captured change/frame.
  const frames = annotations.filter(
    (a) => (a.kind === undefined || a.kind === "feedback") && a.comment,
  );

  // Modo requerimiento: hay envío en lote y edición por frame.
  const reqMode = !!onEnviarRequerimientos;
  const prioridadesList =
    prioridades && prioridades.length ? prioridades : DEFAULT_PRIORIDADES;

  // Frame en pantalla grande. El elegido, o el último capturado por defecto —
  // así apenas anotás algo, el centro te muestra eso.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    frames.find((f) => f.id === selectedId) ?? frames[frames.length - 1] ?? null;

  // Formato de copia (como el del toolbar) + flash de "Copiado".
  const [format, setFormat] = useState<OutputDetailLevel>("detailed");
  const [copied, setCopied] = useState(false);

  // Editor de marcado por frame.
  const [markerOpen, setMarkerOpen] = useState(false);

  // Modal de preview del markdown ("Ver").
  const [previewOpen, setPreviewOpen] = useState(false);

  // Envío en lote + feedback de éxito ("Se enviaron N requerimientos").
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: number; fail: number } | null>(null);
  const [enviado, setEnviado] = useState<number | null>(null);

  const handleCopy = async () => {
    // Copia SÓLO el frame seleccionado (la pantalla que se está viendo), no
    // todos. Cada captura se copia individual. Enviar (N) sí manda todas.
    const ok = selected && onCopyFrame
      ? await onCopyFrame(selected, format)
      : await onCopyFrames(format);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const handleEnviar = async () => {
    if (!onEnviarRequerimientos || sending || frames.length === 0) return;
    setSending(true);
    setSendResult(null);
    const pageUrl =
      typeof window !== "undefined"
        ? window.location.pathname + window.location.search + window.location.hash
        : undefined;
    const sentIds = frames.map((f) => f.id);
    const items = frames.map((f) => ({
      titulo: f.req?.titulo,
      prioridad: f.req?.prioridad ?? "media",
      responsable: f.req?.responsable ?? null,
      descripcion: f.comment,
      screenshot: f.screenshot,
      video: f.video,
      pageUrl,
      agentationCopy: frameCopy?.(f),
    }));
    try {
      const res = await onEnviarRequerimientos(items);
      if (res.ok > 0 && res.fail === 0) {
        // Éxito total: sacamos los frames enviados, mostramos el feedback
        // "Se enviaron N requerimientos" y a los 3s se cierra el panel.
        sentIds.forEach((id) => onDelete(id));
        setEnviado(res.ok);
        setTimeout(() => {
          setEnviado(null);
          onClose?.();
        }, 3000);
      } else {
        // Fallos (parciales o total): lo dejamos a la vista para reintentar.
        setSendResult(res);
      }
    } catch {
      setSendResult({ ok: 0, fail: frames.length });
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className={`${styles.changesPanel} ${isVisible ? styles.enter : styles.exit}`}
      style={
        toolbarNearBottom
          ? { bottom: "auto", top: "calc(100% + 0.5rem)" }
          : undefined
      }
      data-agentation-changes-panel
    >
      <div className={styles.header}>
        <span className={styles.title}>Cambios</span>
        {frames.length > 0 && (
          <span className={styles.count}>{frames.length}</span>
        )}
      </div>

      {frames.length === 0 ? (
        <div className={styles.empty}>
          <IconFrames size={28} />
          <span className={styles.emptyText}>Sin capturas todavía</span>
        </div>
      ) : (
        <>
          <div className={styles.workspace}>
            {/* Aside: las "diapositivas" (frames) numeradas, como el navegador
                de slides de PowerPoint. Click = pasa al centro. */}
            <div className={styles.rail}>
              {frames.map((frame, i) => {
                const active = selected?.id === frame.id;
                return (
                  <div className={styles.railItemWrap} key={frame.id}>
                    <button
                      type="button"
                      className={`${styles.railItem} ${active ? styles.railItemActive : ""}`}
                      onClick={() => setSelectedId(frame.id)}
                    >
                      <span className={styles.railNum}>{i + 1}</span>
                      <div className={styles.railThumb}>
                        {frame.screenshot ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            className={styles.railThumbImg}
                            src={frame.screenshot}
                            alt={frame.comment}
                          />
                        ) : (
                          <div className={styles.railThumbPlaceholder}>
                            <IconFrames size={16} />
                          </div>
                        )}
                      </div>
                    </button>
                    <button
                      type="button"
                      className={styles.railDelete}
                      title="Borrar"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(frame.id);
                      }}
                    >
                      <IconTrashAlt size={12} />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Stage: la foto grande + (en modo requerimiento) campos editables. */}
            {selected && (
              <div className={styles.stage}>
                <div className={`${styles.stagePreview} ${reqMode ? styles.stagePreviewReq : ""}`}>
                  {selected.screenshot ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      className={styles.stageImg}
                      src={selected.screenshot}
                      alt={selected.comment}
                    />
                  ) : (
                    <div className={styles.stagePlaceholder}>
                      <IconFrames size={40} />
                    </div>
                  )}
                </div>

                {reqMode ? (
                  // ---- Editor del frame (modo requerimiento) ----------------
                  <div className={`${styles.stageInfo} ${styles.stageInfoReq}`} key={selected.id}>
                    <div className={styles.stageTop}>
                      <span className={styles.stageElement} title={selected.element}>
                        {elementLabel(selected)}
                      </span>
                      <div className={styles.stageTopActions}>
                        {selected.screenshot && (
                          <button
                            type="button"
                            className={styles.markButton}
                            onClick={() => setMarkerOpen(true)}
                            title="Marcar la imagen"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 20h9" />
                              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                            </svg>
                            Marcar
                          </button>
                        )}
                        <button
                          className={styles.deleteButton}
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(selected.id);
                          }}
                          title="Borrar"
                          type="button"
                        >
                          <IconTrashAlt size={18} />
                        </button>
                      </div>
                    </div>

                    <label className={styles.fieldLabel}>Título</label>
                    <input
                      className={styles.fieldInput}
                      type="text"
                      value={selected.req?.titulo ?? ""}
                      placeholder="Título del requerimiento"
                      onChange={(e) =>
                        onUpdateFrame?.(selected.id, { req: { titulo: e.target.value } })
                      }
                    />

                    <label className={styles.fieldLabel}>Prioridad</label>
                    <div className={styles.chips}>
                      {prioridadesList.map((p) => {
                        const current = selected.req?.prioridad ?? "media";
                        const active = p.value === current;
                        return (
                          <button
                            key={p.value}
                            type="button"
                            className={`${styles.chip} ${active ? styles.chipActive : ""}`}
                            style={active ? { backgroundColor: REQ_ACCENT, borderColor: REQ_ACCENT } : undefined}
                            onClick={() =>
                              onUpdateFrame?.(selected.id, { req: { prioridad: p.value } })
                            }
                          >
                            <span className={styles.chipDot} style={{ backgroundColor: p.color }} />
                            {p.label}
                          </button>
                        );
                      })}
                    </div>

                    <label className={styles.fieldLabel}>Responsable</label>
                    <div className={styles.chips}>
                      <button
                        type="button"
                        className={`${styles.chip} ${(selected.req?.responsable ?? null) === null ? styles.chipActive : ""}`}
                        style={(selected.req?.responsable ?? null) === null ? { backgroundColor: REQ_ACCENT, borderColor: REQ_ACCENT } : undefined}
                        onClick={() =>
                          onUpdateFrame?.(selected.id, { req: { responsable: null } })
                        }
                      >
                        Sin asignar
                      </button>
                      {(responsables ?? []).map((r) => {
                        const active = r.email === selected.req?.responsable;
                        return (
                          <button
                            key={r.email}
                            type="button"
                            className={`${styles.chip} ${active ? styles.chipActive : ""}`}
                            style={active ? { backgroundColor: REQ_ACCENT, borderColor: REQ_ACCENT } : undefined}
                            onClick={() =>
                              onUpdateFrame?.(selected.id, { req: { responsable: r.email } })
                            }
                          >
                            <span className={styles.chipAvatar}>{initials(r.nombre)}</span>
                            {r.nombre}
                          </button>
                        );
                      })}
                    </div>

                    <label className={styles.fieldLabel}>Descripción</label>
                    <textarea
                      className={styles.fieldTextarea}
                      value={selected.comment}
                      placeholder="Describe el requerimiento..."
                      rows={3}
                      onChange={(e) =>
                        onUpdateFrame?.(selected.id, { comment: e.target.value })
                      }
                    />
                  </div>
                ) : (
                  // ---- Vista de solo lectura (modo normal) ------------------
                  <div className={styles.stageInfo}>
                    <div className={styles.stageTop}>
                      <span className={styles.stageElement} title={selected.element}>
                        {elementLabel(selected)}
                      </span>
                      <button
                        className={styles.deleteButton}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(selected.id);
                        }}
                        title="Borrar"
                        type="button"
                      >
                        <IconTrashAlt size={18} />
                      </button>
                    </div>
                    <div className={styles.stageComment}>{selected.comment}</div>
                    <div className={styles.stageTime}>
                      {formatRelativeTime(selected.timestamp)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer: formato de copia + Copiar, y (en modo requerimiento) Enviar. */}
          <div className={styles.footer}>
            <div className={styles.formatTabs}>
              {FORMATS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  className={`${styles.tab} ${format === f.value ? styles.tabActive : ""}`}
                  onClick={() => setFormat(f.value)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {getOutput && (
              <button
                type="button"
                className={styles.verButton}
                onClick={() => setPreviewOpen(true)}
                title="Ver cómo queda lo que vas a copiar"
              >
                Ver
              </button>
            )}
            <div className={styles.footerActions}>
              {sendResult && (
                <span className={styles.sendResult}>
                  {sendResult.ok} creados
                  {sendResult.fail > 0 ? ` · ${sendResult.fail} fallaron` : ""}
                </span>
              )}
              <button
                type="button"
                className={styles.copyButton}
                onClick={handleCopy}
              >
                {copied ? <IconCheck size={15} /> : <IconCopyAlt size={15} />}
                <span>{copied ? "Copiado" : "Copiar"}</span>
              </button>
              {reqMode && (
                <button
                  type="button"
                  className={styles.sendButton}
                  onClick={handleEnviar}
                  disabled={sending}
                >
                  {sending ? "Enviando…" : `Enviar (${frames.length})`}
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {markerOpen && selected?.screenshot && (
        <MarkEditor
          src={selected.screenshot}
          onCancel={() => setMarkerOpen(false)}
          onDone={(dataUrl, marked) => {
            if (marked) onUpdateFrame?.(selected.id, { screenshot: dataUrl });
            setMarkerOpen(false);
          }}
        />
      )}

      {/* Feedback de envío en lote: aparece, y a los 3s se cierra el panel. */}
      {enviado !== null && (
        <div className={styles.enviadoOverlay}>
          <div className={styles.enviadoCard}>
            <IconCheck size={24} />
            <span>
              Se {enviado === 1 ? "envió" : "enviaron"} {enviado} requerimiento
              {enviado === 1 ? "" : "s"}
            </span>
          </div>
        </div>
      )}

      {/* Modal "Ver": preview del markdown que se va a copiar, en el formato elegido. */}
      {previewOpen && getOutput && (
        <div
          className={styles.previewOverlay}
          onClick={() => setPreviewOpen(false)}
        >
          <div
            className={styles.previewModal}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.previewHead}>
              <span className={styles.previewTitle}>Vista previa · {format}</span>
              <button
                type="button"
                className={styles.previewClose}
                onClick={() => setPreviewOpen(false)}
                aria-label="Cerrar"
              >
                ✕
              </button>
            </div>
            <pre className={styles.previewBody}>
              {getOutput(format) || "Sin contenido"}
            </pre>
            <div className={styles.previewFoot}>
              <button
                type="button"
                className={styles.copyButton}
                onClick={handleCopy}
              >
                {copied ? <IconCheck size={15} /> : <IconCopyAlt size={15} />}
                <span>{copied ? "Copiado" : "Copiar"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
