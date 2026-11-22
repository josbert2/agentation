"use client";

import { useState, useRef, useEffect, useLayoutEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import styles from "./styles.module.scss";
import { IconTrash } from "../icons";
import { originalSetTimeout } from "../../utils/freeze-animations";
import { MarkEditor } from "../mark-editor";

// =============================================================================
// Helpers
// =============================================================================

/** Focus an element while temporarily blocking focus-trap libraries (e.g. Radix
 *  FocusScope) from reclaiming focus via focusin/focusout handlers. */
function focusBypassingTraps(el: HTMLElement | null) {
  if (!el) return;
  const trap = (e: Event) => e.stopImmediatePropagation();
  document.addEventListener("focusin", trap, true);
  document.addEventListener("focusout", trap, true);
  try {
    el.focus();
  } finally {
    document.removeEventListener("focusin", trap, true);
    document.removeEventListener("focusout", trap, true);
  }
}

// =============================================================================
// Types
// =============================================================================

export interface AnnotationPopupCSSProps {
  /** Element name to display in header */
  element: string;
  /** Optional timestamp display (e.g., "@ 1.23s" for animation feedback) */
  timestamp?: string;
  /** Optional selected/highlighted text */
  selectedText?: string;
  /** Texto cercano/interno del elemento marcado. Se usa para autocompletar
   *  título y descripción del requerimiento al abrir (sin IA). */
  nearbyText?: string;
  /** Título inicial del form de requerimiento. Cuando el marcado viene de
   *  "📍 Marcar" de una ficha, es el título de ESA ficha (tiene prioridad sobre
   *  el autocompletado desde el texto marcado). */
  tituloInicial?: string;
  /** Placeholder text for the textarea */
  placeholder?: string;
  /** Initial value for textarea (for edit mode) */
  initialValue?: string;
  /** Label for submit button (default: "Add") */
  submitLabel?: string;
  /** Called when annotation is submitted with text. En modo requerimiento se
   *  pasa además la captura marcada y los datos del requerimiento (para que el
   *  toolbar los aplique a la anotación que se agrega al panel). */
  onSubmit: (
    text: string,
    extra?: {
      screenshot?: string;
      video?: string;
      videoSeconds?: number;
      req?: { titulo?: string; prioridad?: string; responsable?: string | null };
      /** true = salió por "Enviar MCP" (para el badge de enviado en el panel). */
      mcp?: boolean;
    },
  ) => void;
  /** Called when popup is cancelled/dismissed */
  onCancel: () => void;
  /** Called when delete button is clicked (only shown if provided) */
  onDelete?: () => void;
  /** Position styles (left, top) */
  style?: React.CSSProperties;
  /** Coords en viewport del marcador (el "punto"), para dibujar la línea
   *  conectora tipo n8n desde el panel hasta el punto. */
  anchorX?: number;
  anchorY?: number;
  /** Custom color for submit button and textarea focus (hex) */
  accentColor?: string;
  /** External exit state (parent controls exit animation) */
  isExiting?: boolean;
  /** Light mode styling */
  lightMode?: boolean;
  /** Computed styles for the selected element */
  computedStyles?: Record<string, string>;

  // ---------------------------------------------------------------------------
  // Modo requerimiento (ticket)
  // ---------------------------------------------------------------------------
  /** Si true, el popup muestra el mini-form de requerimiento en vez del
   *  "What should change?" de siempre. */
  requerimientoMode?: boolean;
  /** Opciones de prioridad (chips). El default seleccionado es el value "media". */
  prioridades?: { value: string; label: string; color: string }[];
  /** Responsables asignables (chips). Se puede dejar sin asignar (null). */
  responsables?: { email: string; nombre: string }[];
  /** Data URL del screenshot capturado del elemento (para el thumbnail y el envío). */
  screenshot?: string;
  /** Modo "solo marcar": esconde la sección de captura/marcado del popup (no hay
   *  screenshot). Sólo queda el cuadro de texto para el feedback. */
  soloMarcar?: boolean;
  /** Copia al portapapeles el output agéntico de ESTA anotación (lo que el
   *  módulo genera para el agente). Si está seteado, el footer muestra "Copiar".
   *  Recibe el texto escrito (descripción o, si vacía, el título). */
  onCopy?: (comment: string) => void;
  /** URL de la página (pathname + search + hash) que se guarda en el requerimiento. */
  pageUrl?: string;
  /** Crea el requerimiento. Devuelve true si salió bien. */
  onCreateRequerimiento?: (d: {
    titulo: string;
    prioridad: string;
    responsable: string | null;
    descripcion: string;
    screenshot?: string;
    pageUrl: string;
  }) => Promise<boolean>;
  /** Redacta/mejora la descripción con IA a partir del contexto (modo
   *  requerimiento). Devuelve el texto sugerido, o null si falló. */
  onAssistDescripcion?: (ctx: {
    titulo: string;
    borrador: string;
    elemento: string;
    seleccion: string;
    prioridad: string;
  }) => Promise<string | null>;
}

/** Acento violeta del form de requerimiento. */
const REQ_ACCENT = "#7c5cff";
/** Prioridades por defecto si no vienen por prop. */
const DEFAULT_PRIORIDADES: { value: string; label: string; color: string }[] = [
  { value: "baja", label: "Baja", color: "#22c55e" },
  { value: "media", label: "Media", color: "#eab308" },
  { value: "alta", label: "Alta", color: "#ef4444" },
];

export interface AnnotationPopupCSSHandle {
  /** Shake the popup (e.g., when user clicks outside) */
  shake: () => void;
}

// =============================================================================
// Component
// =============================================================================

export const AnnotationPopupCSS = forwardRef<AnnotationPopupCSSHandle, AnnotationPopupCSSProps>(
  function AnnotationPopupCSS(
    {
      element,
      timestamp,
      selectedText,
      nearbyText,
      tituloInicial,
      placeholder = "What should change?",
      initialValue = "",
      submitLabel = "Add",
      onSubmit,
      onCancel,
      onDelete,
      style,
      anchorX,
      anchorY,
      accentColor = "#3c82f7",
      isExiting = false,
      lightMode = false,
      computedStyles,
      requerimientoMode = false,
      prioridades,
      responsables,
      screenshot,
      soloMarcar = false,
      onCopy,
      pageUrl,
      onCreateRequerimiento,
      onAssistDescripcion,
    },
    ref
  ) {
    const [text, setText] = useState(initialValue);
    const [isShaking, setIsShaking] = useState(false);
    const [animState, setAnimState] = useState<"initial" | "enter" | "entered" | "exit">("initial");
    const [isFocused, setIsFocused] = useState(false);
    const [isStylesExpanded, setIsStylesExpanded] = useState(false); // Computed styles accordion state
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    const cancelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const shakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ---- Estado del modo requerimiento --------------------------------------
    const prioridadesList = prioridades && prioridades.length ? prioridades : DEFAULT_PRIORIDADES;
    const [titulo, setTitulo] = useState(tituloInicial ?? "");
    const [prioridad, setPrioridad] = useState<string>(() => {
      const list = prioridades && prioridades.length ? prioridades : DEFAULT_PRIORIDADES;
      return (list.find((p) => p.value === "media") ?? list[0])?.value ?? "media";
    });
    const [responsable, setResponsable] = useState<string | null>(null);
    const tituloRef = useRef<HTMLInputElement>(null);

    // Autocompletar título + descripción del requerimiento con el texto del
    // elemento marcado (lo seleccionado o el texto cercano). Sin IA, al toque.
    // Solo al montar y solo si los campos están vacíos (no pisa lo que escribas).
    useEffect(() => {
      if (!requerimientoMode) return;
      // getNearbyText mete marcadores de contexto `[before: "..."]`/`[after: "..."]`
      // (útiles para el agente, basura para un título): los sacamos. Preferimos el
      // texto seleccionado, que es lo que el usuario marcó a propósito.
      const limpiar = (s?: string) =>
        (s || "")
          .replace(/\[(?:before|after):\s*"[^"]*"\]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      const fuente = limpiar(selectedText) || limpiar(nearbyText);
      if (!fuente) return;
      const tituloAuto = fuente.split(/(?<=[.!?])\s|\n/)[0].trim().slice(0, 80);
      setTitulo((prev) => (prev.trim() ? prev : tituloAuto));
      setText((prev) => (prev.trim() ? prev : fuente.slice(0, 600)));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Editor de marcado (overlay a pantalla completa, estilo "Marcar la imagen").
    const [markerOpen, setMarkerOpen] = useState(false);
    // Screenshot marcado: si el usuario aplicó marcas, esta versión pisa la
    // captura original en el thumbnail y en el envío del requerimiento.
    const [markedShot, setMarkedShot] = useState<string | undefined>(undefined);
    // Captura efectiva que ve el popup (marcada si existe, si no la original).
    const effectiveShot = markedShot ?? screenshot;

    // Asistente de IA para la descripción: toma lo que hay (borrador + contexto
    // de la pantalla) y reescribe/redacta el requerimiento.
    const [aiLoading, setAiLoading] = useState(false);
    const [aiError, setAiError] = useState(false);
    const handleAssist = useCallback(async () => {
      if (!onAssistDescripcion || aiLoading) return;
      setAiError(false);
      setAiLoading(true);
      try {
        const suggestion = await onAssistDescripcion({
          titulo: titulo.trim(),
          borrador: text.trim(),
          elemento: element,
          seleccion: selectedText ?? "",
          prioridad,
        });
        if (suggestion && suggestion.trim()) {
          setText(suggestion.trim());
        } else {
          setAiError(true);
        }
      } catch {
        setAiError(true);
      } finally {
        setAiLoading(false);
      }
    }, [onAssistDescripcion, aiLoading, titulo, text, element, selectedText, prioridad]);

    // ---- Grabación de pantalla ----------------------------------------------
    // Graba la pantalla (getDisplayMedia + MediaRecorder) para mostrar el bug en
    // movimiento. Mientras graba, escondemos el popup y el backdrop para que la
    // persona pueda reproducir el problema; queda un control flotante "Detener".
    const [recording, setRecording] = useState(false);
    const [videoData, setVideoData] = useState<string | undefined>(undefined);
    const [videoSeconds, setVideoSeconds] = useState(0);
    const [recSeconds, setRecSeconds] = useState(0);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const recChunksRef = useRef<Blob[]>([]);
    const recStreamRef = useRef<MediaStream | null>(null);
    const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const recStartRef = useRef(0);

    const cleanupRec = useCallback(() => {
      if (recTimerRef.current) {
        clearInterval(recTimerRef.current);
        recTimerRef.current = null;
      }
      recStreamRef.current?.getTracks().forEach((t) => t.stop());
      recStreamRef.current = null;
    }, []);

    const stopRec = useCallback(() => {
      const mr = mediaRecorderRef.current;
      if (mr && mr.state !== "inactive") mr.stop();
    }, []);

    const startRec = useCallback(async () => {
      if (recording) return;
      const md = navigator.mediaDevices as MediaDevices & {
        getDisplayMedia?: (c?: MediaStreamConstraints) => Promise<MediaStream>;
      };
      if (!md?.getDisplayMedia || typeof MediaRecorder === "undefined") {
        return; // navegador sin soporte: el botón igual no se muestra
      }
      let stream: MediaStream;
      try {
        stream = await md.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
      } catch {
        return; // el usuario canceló el diálogo de compartir pantalla
      }
      recStreamRef.current = stream;
      const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find(
        (m) => MediaRecorder.isTypeSupported(m),
      );
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      mediaRecorderRef.current = mr;
      recChunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recChunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const secs = Math.max(1, Math.round((Date.now() - recStartRef.current) / 1000));
        cleanupRec();
        setRecording(false);
        const blob = new Blob(recChunksRef.current, { type: mr.mimeType || "video/webm" });
        const reader = new FileReader();
        reader.onload = () => {
          setVideoData(typeof reader.result === "string" ? reader.result : undefined);
          setVideoSeconds(secs);
        };
        reader.readAsDataURL(blob);
      };
      // Si el usuario corta el compartir desde la barra nativa del navegador.
      stream.getVideoTracks().forEach((t) => (t.onended = () => stopRec()));
      recStartRef.current = Date.now();
      setRecSeconds(0);
      recTimerRef.current = setInterval(
        () => setRecSeconds(Math.round((Date.now() - recStartRef.current) / 1000)),
        250,
      );
      mr.start();
      setRecording(true);
    }, [recording, cleanupRec, stopRec]);

    const quitarVideo = useCallback(() => {
      setVideoData(undefined);
      setVideoSeconds(0);
    }, []);

    // Limpieza si el popup se desmonta grabando.
    useEffect(() => () => cleanupRec(), [cleanupRec]);

    // Avisamos al toolbar cuando arranca/para la grabación para que esconda su
    // píldora y el marcador (así no salen en el video). El popup también se
    // esconde; se detiene con el control nativo del navegador ("Dejar de
    // compartir"), que dispara el onended del track.
    useEffect(() => {
      window.dispatchEvent(
        new CustomEvent("agentation:recording", { detail: { recording } }),
      );
    }, [recording]);

    const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

    // Posición arrastrada a mano por el usuario (arrastrando la cabecera). Cuando
    // existe, manda sobre el centrado y el auto-ajuste: el popup se queda donde
    // lo dejó, respetando el marcador.
    const [dragPos, setDragPos] = useState<{ left: number; top: number } | null>(null);
    const draggedRef = useRef(false);
    draggedRef.current = dragPos !== null;

    // Auto-ajuste al viewport. El popup del requerimiento es alto y la posición
    // que le pasa el toolbar no conoce su alto real, así que se salía de la
    // pantalla. En vez de fijar un `top` (que quedaba desfasado apenas la imagen
    // terminaba de cargar o el textarea crecía), fijamos DIRECTO el alto máximo
    // disponible desde el `top` propuesto: el popup ocupa lo que hay hasta el
    // borde inferior y lo que no entra scrollea adentro. Un ResizeObserver lo
    // recalcula cuando cambia el contenido (imagen, texto de IA, error), pero
    // marcar no cambia el alto, así que NO salta al aplicar marcas.
    const [fitStyle, setFitStyle] = useState<React.CSSProperties>({});
    const lastFitRef = useRef<{ top: number; maxHeight: number } | null>(null);
    useLayoutEffect(() => {
      const el = popupRef.current;
      if (!el) return;
      const fit = () => {
        if (draggedRef.current) return; // ya lo ubicó el usuario a mano
        const vh = window.innerHeight;
        const m = 12;
        const r = el.getBoundingClientRect();
        // Alto natural del contenido (sin el cap que ya le pusimos). Restamos el
        // cap actual para no medir el elemento ya recortado.
        const natural = el.scrollHeight;
        // top base = el que propuso el toolbar (o el actual si ya lo movimos).
        const proposedTop = lastFitRef.current ? r.top : r.top;
        const cappedNatural = Math.min(natural, vh - 2 * m);
        const top = Math.max(m, Math.min(proposedTop, vh - m - cappedNatural));
        const maxHeight = vh - top - m;
        const prev = lastFitRef.current;
        // Sólo actualizamos si cambió de verdad (evita el bucle del ResizeObserver).
        if (prev && Math.abs(prev.top - top) < 1 && Math.abs(prev.maxHeight - maxHeight) < 1) {
          return;
        }
        lastFitRef.current = { top, maxHeight };
        setFitStyle({ top, bottom: "auto", maxHeight });
      };
      fit();
      const ro =
        typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
      ro?.observe(el);
      window.addEventListener("resize", fit);
      window.addEventListener("scroll", fit, true);
      return () => {
        ro?.disconnect();
        window.removeEventListener("resize", fit);
        window.removeEventListener("scroll", fit, true);
      };
    }, [requerimientoMode]);

    // Arrastre del popup por la cabecera. Al empezar, fijamos su esquina actual
    // (medida con el centrado ya aplicado) y soltamos el `translateX(-50%)`, así
    // el popup no da un salto al tomarlo. No arranca si el click cae en un
    // control (botón/toggle) de la cabecera.
    // `snapping` activa la transición con overshoot (efecto imán) cuando el panel
    // vuelve a pegarse a su punto de anclaje al soltarlo cerca.
    const [snapping, setSnapping] = useState(false);
    const lastPosRef = useRef<{ left: number; top: number } | null>(null);
    // Distancia (px) dentro de la cual el panel es "magnético" al punto: si lo
    // soltás cerca del ancla, se pega solo.
    const SNAP_DIST = 64;

    const startDrag = useCallback((e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest("button,input,textarea,a,select")) return;
      const el = popupRef.current;
      if (!el) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const ox = e.clientX;
      const oy = e.clientY;
      const sx = r.left; // posición-ancla (junto al marcador)
      const sy = r.top;
      const w = r.width;
      setSnapping(false);
      setDragPos({ left: sx, top: sy });
      lastPosRef.current = { left: sx, top: sy };
      const move = (ev: PointerEvent) => {
        const pos = {
          left: Math.min(Math.max(sx + (ev.clientX - ox), 8 - w + 60), window.innerWidth - 60),
          top: Math.min(Math.max(sy + (ev.clientY - oy), 8), window.innerHeight - 48),
        };
        lastPosRef.current = pos;
        setDragPos(pos);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        // Imán: si soltaste cerca del ancla (el punto), el panel se pega solo con
        // un pequeño overshoot; si te fuiste lejos, se queda donde lo dejaste.
        const last = lastPosRef.current;
        if (last && Math.hypot(last.left - sx, last.top - sy) < SNAP_DIST) {
          setSnapping(true);
          setDragPos({ left: sx, top: sy });
          originalSetTimeout(() => setSnapping(false), 260);
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    }, []);

    // Cuando el usuario ya arrastró, la posición es absoluta (esquina sup-izq) y
    // sin centrado; si no, vale el auto-ajuste. El `transition` con curva de
    // overshoot sólo se aplica en el snap magnético (no durante el arrastre).
    const positionStyle: React.CSSProperties = dragPos
      ? {
          left: dragPos.left,
          top: dragPos.top,
          right: "auto",
          bottom: "auto",
          transform: "none",
          transition: snapping
            ? "left 0.26s cubic-bezier(0.34, 1.56, 0.64, 1), top 0.26s cubic-bezier(0.34, 1.56, 0.64, 1)"
            : "none",
        }
      : fitStyle;

    // Caja del panel en viewport, para trazar la línea conectora al punto. Se
    // re-mide en cada cambio de posición (arrastre incluido) para que la línea
    // siga al panel en vivo, tipo n8n.
    const [popupBox, setPopupBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
    useLayoutEffect(() => {
      const el = popupRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPopupBox((prev) =>
        prev && prev.left === r.left && prev.top === r.top && prev.width === r.width && prev.height === r.height
          ? prev
          : { left: r.left, top: r.top, width: r.width, height: r.height },
      );
    }, [dragPos, fitStyle, snapping, markerOpen, requerimientoMode, effectiveShot, anchorX, anchorY, aiError]);

    // Sync with parent exit state
    useEffect(() => {
      if (isExiting && animState !== "exit") {
        setAnimState("exit");
      }
    }, [isExiting, animState]);

    // Animate in on mount and focus textarea
    useEffect(() => {
      // Start enter animation (use originalSetTimeout to bypass freeze patch)
      originalSetTimeout(() => {
        setAnimState("enter");
      }, 0);
      // Transition to entered state after animation completes
      const enterTimer = originalSetTimeout(() => {
        setAnimState("entered");
      }, 200); // Match animation duration
      const focusTimer = originalSetTimeout(() => {
        if (requerimientoMode) {
          focusBypassingTraps(tituloRef.current);
          return;
        }
        const textarea = textareaRef.current;
        if (textarea) {
          focusBypassingTraps(textarea);
          textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
          textarea.scrollTop = textarea.scrollHeight;
        }
      }, 50);
      return () => {
        clearTimeout(enterTimer);
        clearTimeout(focusTimer);
        if (cancelTimerRef.current) clearTimeout(cancelTimerRef.current);
        if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
      };
    }, []);

    // Shake animation
    const shake = useCallback(() => {
      if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
      setIsShaking(true);
      shakeTimerRef.current = originalSetTimeout(() => {
        setIsShaking(false);
        focusBypassingTraps(textareaRef.current);
      }, 250);
    }, []);

    // Expose shake to parent via ref
    useImperativeHandle(ref, () => ({
      shake,
    }), [shake]);

    // Handle cancel with exit animation
    const handleCancel = useCallback(() => {
      setAnimState("exit");
      cancelTimerRef.current = originalSetTimeout(() => {
        onCancel();
      }, 150); // Match exit animation duration
    }, [onCancel]);

    // Handle submit
    const handleSubmit = useCallback(() => {
      if (!text.trim()) return;
      onSubmit(text.trim());
    }, [text, onSubmit]);

    // El contenido del requerimiento: la descripción manda si hay algo escrito
    // ahí, pero si viene vacía el título alcanza — no hay por qué frenar a
    // alguien que ya dijo de qué se trata en el título y no tiene más para
    // agregar.
    const contenidoReq = text.trim() || titulo.trim();

    // Agregar el frame al Panel de Cambios (modo requerimiento). Ya NO crea el
    // requerimiento al instante: eso ahora se hace en lote desde el panel con
    // "Enviar (N)". Acá solo se agrega la anotación (marcador + frame) llevando
    // la captura marcada y los datos del requerimiento.
    const handleAgregar = useCallback(() => {
      if (!contenidoReq) return;
      onSubmit(contenidoReq, {
        screenshot: effectiveShot,
        video: videoData,
        videoSeconds: videoData ? videoSeconds : undefined,
        req: { titulo: titulo.trim(), prioridad, responsable },
      });
    }, [contenidoReq, effectiveShot, videoData, videoSeconds, titulo, prioridad, responsable, onSubmit]);

    // "Enviar MCP": manda la anotación (texto + captura) al server del MCP SIN
    // crear un requerimiento. Va por el mismo `onSubmit` —el toolbar la sincroniza
    // al endpoint (:4747)— pero sin los datos del ticket (`req`), así queda como
    // una anotación suelta que Claude lee, no como un requerimiento en el panel.
    const handleEnviarMcp = useCallback(() => {
      if (!contenidoReq) return;
      onSubmit(contenidoReq, {
        screenshot: effectiveShot,
        video: videoData,
        videoSeconds: videoData ? videoSeconds : undefined,
        mcp: true,
      });
    }, [contenidoReq, effectiveShot, videoData, videoSeconds, onSubmit]);

    // "Copiar": copia el output agéntico de esta anotación al portapapeles, sin
    // crear ni enviar nada. El texto lo arma el toolbar (tiene el elemento,
    // selector y source de la marca) vía onCopy; acá solo el feedback visual.
    const [copiado, setCopiado] = useState(false);
    const handleCopiar = useCallback(() => {
      if (!contenidoReq || !onCopy) return;
      onCopy(contenidoReq);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 1400);
    }, [contenidoReq, onCopy]);

    // Handle keyboard
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          if (requerimientoMode) handleAgregar();
          else handleSubmit();
        }
        if (e.key === "Escape") {
          handleCancel();
        }
      },
      [handleSubmit, handleAgregar, handleCancel, requerimientoMode]
    );

    const popupClassName = [
      styles.popup,
      requerimientoMode ? styles.reqMode : "",
      lightMode ? styles.light : "",
      animState === "enter" ? styles.enter : "",
      animState === "entered" ? styles.entered : "",
      animState === "exit" ? styles.exit : "",
      isShaking ? styles.shake : "",
    ].filter(Boolean).join(" ");

    return (
      <>
      {/* Backdrop: mientras el form de requerimiento está abierto, tapa la
          página para que un click no dispare botones de abajo (ej. abrir "Nuevo
          artículo"). Transparente, traga los eventos y no cierra el form. Se
          esconde cuando el editor de marcas está abierto (ese ya cubre todo). */}
      {requerimientoMode && !markerOpen && !recording && (
        <div
          className={styles.reqBackdrop}
          data-annotation-popup
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        />
      )}
      {/* Línea conectora tipo n8n: del punto (marcador) al panel. Sigue al panel
          al arrastrarlo. Curva bezier horizontal + nodo en cada extremo. */}
      {requerimientoMode && !markerOpen && !recording &&
        anchorX != null && anchorY != null && popupBox && (() => {
          const px = Math.max(popupBox.left, Math.min(anchorX, popupBox.left + popupBox.width));
          const py = Math.max(popupBox.top, Math.min(anchorY, popupBox.top + popupBox.height));
          const c = Math.max(36, Math.abs(px - anchorX) * 0.5);
          const s = px >= anchorX ? 1 : -1;
          const d = `M ${anchorX} ${anchorY} C ${anchorX + s * c} ${anchorY}, ${px - s * c} ${py}, ${px} ${py}`;
          return (
            <svg className={styles.connector} aria-hidden="true">
              <path className={styles.connectorFlow} d={d} />
              <circle cx={anchorX} cy={anchorY} r={9} className={styles.connectorPulse} />
              <circle cx={anchorX} cy={anchorY} r={4.5} className={styles.connectorNode} />
              <circle cx={px} cy={py} r={3.5} className={styles.connectorNode} />
            </svg>
          );
        })()}
      <div
        ref={popupRef}
        className={popupClassName}
        data-annotation-popup
        style={{ ...style, ...positionStyle, ...(recording ? { visibility: "hidden" as const } : {}) }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={styles.header}
          onPointerDown={startDrag}
          style={{
            cursor: dragPos ? "grabbing" : "grab",
            userSelect: "none",
            WebkitUserSelect: "none",
          }}
          title="Arrastrá para mover el panel"
        >
          {/* Handle de arrastre: señala que el panel se puede reubicar. */}
          <span className={styles.dragGrip} aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <circle cx="3" cy="2.5" r="1.1" />
              <circle cx="9" cy="2.5" r="1.1" />
              <circle cx="3" cy="6" r="1.1" />
              <circle cx="9" cy="6" r="1.1" />
              <circle cx="3" cy="9.5" r="1.1" />
              <circle cx="9" cy="9.5" r="1.1" />
            </svg>
          </span>
          {computedStyles && Object.keys(computedStyles).length > 0 ? (
            <button
              className={styles.headerToggle}
              onClick={() => {
                const wasExpanded = isStylesExpanded;
                setIsStylesExpanded(!isStylesExpanded);
                if (wasExpanded) {
                  // Refocus textarea when closing
                  originalSetTimeout(() => focusBypassingTraps(textareaRef.current), 0);
                }
              }}
              type="button"
            >
              <svg
                className={`${styles.chevron} ${isStylesExpanded ? styles.expanded : ""}`}
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M5.5 10.25L9 7.25L5.75 4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className={styles.element}>{element}</span>
            </button>
          ) : (
            <span className={styles.element}>{element}</span>
          )}
          {timestamp && <span className={styles.timestamp}>{timestamp}</span>}
        </div>

        {/* Collapsible computed styles section - uses grid-template-rows for smooth animation */}
        {computedStyles && Object.keys(computedStyles).length > 0 && (
          <div className={`${styles.stylesWrapper} ${isStylesExpanded ? styles.expanded : ""}`}>
            <div className={styles.stylesInner}>
              <div className={styles.stylesBlock}>
                {Object.entries(computedStyles).map(([key, value]) => (
                  <div key={key} className={styles.styleLine}>
                    <span className={styles.styleProperty}>
                      {key.replace(/([A-Z])/g, "-$1").toLowerCase()}
                    </span>
                    : <span className={styles.styleValue}>{value}</span>;
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {selectedText && (
          <div className={styles.quote}>
            &ldquo;{selectedText.slice(0, 80)}
            {selectedText.length > 80 ? "..." : ""}&rdquo;
          </div>
        )}

        {requerimientoMode ? (
          // -------------------------------------------------------------------
          // Modo requerimiento (ticket)
          // -------------------------------------------------------------------
          <>
            {/* 1. Captura (grande; el "Marcar" va encima y abre el editor).
                En "solo marcar" no hay captura: se esconde toda la sección. */}
            {soloMarcar ? null : effectiveShot ? (
              <div className={styles.reqThumb}>
                <img
                  src={effectiveShot}
                  alt="Captura"
                  className={styles.reqThumbImg}
                  draggable={false}
                />
                {markedShot && <span className={styles.reqThumbBadge}>Marcada</span>}
                <button
                  type="button"
                  className={styles.reqThumbMark}
                  onClick={() => setMarkerOpen(true)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                  {markedShot ? "Editar marcas" : "Marcar"}
                </button>
              </div>
            ) : (
              <div className={styles.reqThumbPlaceholder}>Sin captura</div>
            )}

            {/* 2. Título */}
            <label className={styles.reqLabel}>Título</label>
            <input
              ref={tituloRef}
              className={styles.reqInput}
              type="text"
              value={titulo}
              placeholder="Título del requerimiento"
              onChange={(e) => setTitulo(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  focusBypassingTraps(textareaRef.current);
                }
                if (e.key === "Escape") handleCancel();
              }}
            />

            {/* 3. Prioridad */}
            <label className={styles.reqLabel}>Prioridad</label>
            <div className={styles.reqChips}>
              {prioridadesList.map((p) => {
                const active = p.value === prioridad;
                return (
                  <button
                    key={p.value}
                    type="button"
                    className={`${styles.reqChip} ${active ? styles.reqChipActive : ""}`}
                    style={active ? { backgroundColor: REQ_ACCENT, borderColor: REQ_ACCENT } : undefined}
                    onClick={() => setPrioridad(p.value)}
                  >
                    <span className={styles.reqChipDot} style={{ backgroundColor: p.color }} />
                    {p.label}
                  </button>
                );
              })}
            </div>

            {/* 4. Responsable */}
            <label className={styles.reqLabel}>Responsable</label>
            <div className={styles.reqChips}>
              <button
                type="button"
                className={`${styles.reqChip} ${responsable === null ? styles.reqChipActive : ""}`}
                style={responsable === null ? { backgroundColor: REQ_ACCENT, borderColor: REQ_ACCENT } : undefined}
                onClick={() => setResponsable(null)}
              >
                Sin asignar
              </button>
              {(responsables ?? []).map((r) => {
                const active = r.email === responsable;
                return (
                  <button
                    key={r.email}
                    type="button"
                    className={`${styles.reqChip} ${active ? styles.reqChipActive : ""}`}
                    style={active ? { backgroundColor: REQ_ACCENT, borderColor: REQ_ACCENT } : undefined}
                    onClick={() => setResponsable(r.email)}
                  >
                    {r.nombre}
                  </button>
                );
              })}
            </div>

            {/* 5. Descripción */}
            <div className={styles.reqLabelRow}>
              <label className={styles.reqLabel}>Descripción</label>
              {onAssistDescripcion && (
                <button
                  type="button"
                  className={styles.reqAiButton}
                  onClick={handleAssist}
                  disabled={aiLoading}
                  title="Redactar la descripción con IA usando el contexto"
                >
                  {aiLoading ? (
                    <>
                      <svg className={styles.reqAiSpin} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                      </svg>
                      Redactando…
                    </>
                  ) : (
                    <>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2l1.9 4.8L18.7 8.7 13.9 10.6 12 15.4 10.1 10.6 5.3 8.7 10.1 6.8 12 2zm6.5 10.5l1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1 1-2.6zM5 14l.8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14z" />
                      </svg>
                      {text.trim() ? "Mejorar con IA" : "Redactar con IA"}
                    </>
                  )}
                </button>
              )}
            </div>
            {aiError && (
              <span className={styles.reqAiError}>No se pudo generar. Intenta de nuevo.</span>
            )}
            <textarea
              ref={textareaRef}
              className={styles.textarea}
              style={{ borderColor: isFocused ? REQ_ACCENT : undefined }}
              placeholder="Describe el requerimiento..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              rows={3}
              onKeyDown={handleKeyDown}
            />

            {/* 7. Footer */}
            <div className={styles.reqFooter}>
              {pageUrl && (
                <a
                  className={styles.reqLink}
                  href={pageUrl}
                  onClick={(e) => e.preventDefault()}
                  title={pageUrl}
                >
                  {pageUrl}
                </a>
              )}
              <div className={styles.reqFooterActions}>
                <button className={styles.cancel} onClick={handleCancel} type="button">
                  Cancelar
                </button>
                {onCopy && (
                  <button
                    className={styles.cancel}
                    style={{ opacity: contenidoReq ? 1 : 0.4 }}
                    onClick={handleCopiar}
                    disabled={!contenidoReq}
                    type="button"
                    title="Copia al portapapeles el output agéntico de esta anotación (elemento, selector, source, texto)"
                  >
                    {copiado ? "¡Copiado!" : "Copiar"}
                  </button>
                )}
                <button
                  className={styles.mcp}
                  style={{ opacity: contenidoReq ? 1 : 0.4 }}
                  onClick={handleEnviarMcp}
                  disabled={!contenidoReq}
                  type="button"
                  title="Manda la anotación (texto + captura) a Claude por el MCP, sin crear requerimiento"
                >
                  Enviar MCP
                </button>
                <button
                  className={styles.submit}
                  style={{
                    backgroundColor: REQ_ACCENT,
                    opacity: contenidoReq ? 1 : 0.4,
                  }}
                  onClick={handleAgregar}
                  disabled={!contenidoReq}
                  type="button"
                  title="Crea el requerimiento (queda en el panel para enviarlo a relay)"
                >
                  Agregar
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <textarea
              ref={textareaRef}
              className={styles.textarea}
              style={{ borderColor: isFocused ? accentColor : undefined }}
              placeholder={placeholder}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              rows={2}
              onKeyDown={handleKeyDown}
            />

            <div className={styles.actions}>
              {onDelete && (
                <div className={styles.deleteWrapper}>
                  <button className={styles.deleteButton} onClick={onDelete} type="button">
                    <IconTrash size={22} />
                  </button>
                </div>
              )}
              <button className={styles.cancel} onClick={handleCancel}>
                Cancel
              </button>
              <button
                className={styles.submit}
                style={{
                  backgroundColor: accentColor,
                  opacity: text.trim() ? 1 : 0.4,
                }}
                onClick={handleSubmit}
                disabled={!text.trim()}
              >
                {submitLabel}
              </button>
            </div>
          </>
        )}
      </div>

      {markerOpen && effectiveShot && (
        <MarkEditor
          src={effectiveShot}
          onCancel={() => setMarkerOpen(false)}
          onDone={(dataUrl, marked) => {
            if (marked) setMarkedShot(dataUrl);
            setMarkerOpen(false);
          }}
        />
      )}
      </>
    );
  }
);

export default AnnotationPopupCSS;
