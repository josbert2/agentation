// =============================================================================
// Shared Types
// =============================================================================

export type Annotation = {
  id: string;
  x: number; // % of viewport width
  y: number; // px from top of document (absolute) OR viewport (if isFixed)
  comment: string;
  element: string;
  elementPath: string;
  timestamp: number;
  selectedText?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
  nearbyText?: string;
  screenshot?: string; // Data URL of a captured screenshot of the annotated region
  screenshotUrl?: string; // Public URL of the uploaded screenshot (e.g. S3), for copy references
  video?: string; // Data URL (video/webm) of a screen recording of the bug/interaction
  videoSeconds?: number; // Duration of the recording, for the UI label
  cssClasses?: string;
  nearbyElements?: string;
  computedStyles?: string;
  fullPath?: string;
  accessibility?: string;
  isMultiSelect?: boolean; // true if created via drag selection
  isFixed?: boolean; // true if element has fixed/sticky positioning (marker stays fixed)
  reactComponents?: string; // React component hierarchy (e.g. "<App> <Dashboard> <Button>")
  sourceFile?: string; // Source file path from React _debugSource (dev mode only, e.g. "src/Button.tsx:42")
  drawingIndex?: number; // Index of linked draw stroke (if any)
  elementBoundingBoxes?: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>; // Individual bounding boxes for multi-select hover highlighting

  // Datos del requerimiento por frame (modo requerimiento). Se llenan al
  // "Agregar" desde el popup y se editan en el Panel de Cambios; el envío en
  // lote ("Enviar N") los usa para crear cada requerimiento.
  req?: { titulo?: string; prioridad?: string; responsable?: string | null };

  // true si la anotación se mandó al MCP con el botón "Enviar MCP" (para pintar
  // el badge de "enviado" en el frame del Panel de Cambios).
  mcpSent?: boolean;

  // Annotation kind (defaults to "feedback" when undefined — backward compat)
  kind?: "feedback" | "placement" | "rearrange";

  // Structured data for placement annotations
  placement?: {
    componentType: string;
    width: number;
    height: number;
    scrollY: number;
    text?: string;
  };

  // Structured data for rearrange annotations
  rearrange?: {
    selector: string;
    label: string;
    tagName: string;
    originalRect: { x: number; y: number; width: number; height: number };
    currentRect: { x: number; y: number; width: number; height: number };
  };

  // Protocol fields (added when syncing to server)
  sessionId?: string;
  url?: string;
  intent?: AnnotationIntent;
  severity?: AnnotationSeverity;
  status?: AnnotationStatus;
  thread?: ThreadMessage[];
  createdAt?: string;
  updatedAt?: string;
  resolvedAt?: string;
  resolvedBy?: "human" | "agent";
  authorId?: string;

  // Local-only sync tracking (not sent to server)
  _syncedTo?: string; // Session ID this annotation was synced to
  /** El humano aprobó el arreglo tras probarlo (paso posterior a que el agente
   *  la marque resuelta). Local, no viaja al server. */
  aprobada?: boolean;
};

// -----------------------------------------------------------------------------
// Annotation Enums
// -----------------------------------------------------------------------------

export type AnnotationIntent = "fix" | "change" | "question" | "approve";
export type AnnotationSeverity = "blocking" | "important" | "suggestion";
export type AnnotationStatus = "pending" | "acknowledged" | "resolved" | "dismissed";

// -----------------------------------------------------------------------------
// Session
// -----------------------------------------------------------------------------

export type Session = {
  id: string;
  url: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt?: string;
  projectId?: string;
  metadata?: Record<string, unknown>;
};

export type SessionStatus = "active" | "approved" | "closed";

export type SessionWithAnnotations = Session & {
  annotations: Annotation[];
};

// -----------------------------------------------------------------------------
// Thread Messages
// -----------------------------------------------------------------------------

export type ThreadMessage = {
  id: string;
  role: "human" | "agent";
  content: string;
  timestamp: number;
};

