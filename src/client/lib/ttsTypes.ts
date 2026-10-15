// Tipos del modo «Leer en voz alta»: lectura bimodal voluntaria con
// las voces del dispositivo (Web Speech API). Diseño y decisiones:
// plan-tts-readalong + docs/concentracion-y-lectura.md. Sin IA, sin
// texto hacia servidores — los eventos solo llevan identificadores.

export type TtsRate = 0.8 | 0.9 | 1 | 1.15 | 1.2 | 1.3;
export const TTS_RATES: TtsRate[] = [0.8, 1, 1.2];
export const TTS_PLAYER_RATES: TtsRate[] = [0.9, 1, 1.15, 1.3];
export const TTS_ALL_RATES: TtsRate[] = [0.8, 0.9, 1, 1.15, 1.2, 1.3];

// Resaltado del MVP: oración. `line_focus` queda como fase opcional
// posterior (gated por foco + regla activos).
export type TtsHighlightMode = "sentence";

export type TtsStatus = "idle" | "preparing" | "speaking" | "paused" | "stopping";

export type TtsPauseReason =
  | "user"
  | "word_lookup"
  | "panel_opened"
  | "fatigue"
  | "visibility"
  | "render_change"
  | "error";

export type TtsEndReason =
  | "user"
  | "navigation"
  | "chapter_end"
  | "fatigue"
  | "visibility"
  | "render_change"
  | "error";

// Territorio de la sesión: el target (capítulo) que la contiene.
// El TTS avanza entre secciones físicas dentro de [startSection,
// endSection) y termina con «chapter_end» al alcanzar endSection.
export type TtsTargetContext = {
  bookHash: string;
  targetId: string;
  startSection: number;
  endSection: number; // exclusivo
  sectionIndex: number;
};

// Índices de childNodes desde la raíz de la sección.
export type NodePath = number[];

// Una oración del mapa de la sección. Guarda path+offsets+fingerprint
// para re-anclar tras un re-render — nunca un Range vivo (partir
// nodos de texto al marcar invalidaría los rangos materializados).
// `start`/`end` son offsets absolutos sobre el texto concatenado de
// la sección: es la ancla robusta, porque envolver en <mark> cambia
// la estructura de nodos pero jamás el texto concatenado.
export type SentenceLayoutItem = {
  sectionIndex: number;
  sentenceIndex: number;
  // Ruta del primer nodo de texto cubierto — verificación tras
  // re-render junto con `fingerprint`.
  nodePath: NodePath;
  start: number;
  end: number;
  // normalizedFirstChars + ":" + lengthBucket — solo verifica
  // identidad, no describe contenido.
  fingerprint: string;
  // Texto de la oración para la utterance (memoria sola: jamás va a
  // eventos ni a red).
  text: string;
};

// Lo que la UI expone: estado de la máquina más el contexto de la
// sesión en curso (para el chip y los eventos).
export type TtsSnapshot = {
  status: TtsStatus;
  sessionId: string | null;
  rate: TtsRate;
  highlight: TtsHighlightMode;
  // Razón de la última pausa (para mensajes y telemetría).
  pauseReason: TtsPauseReason | null;
};

export const TTS_IDLE: TtsSnapshot = {
  status: "idle",
  sessionId: null,
  rate: 1,
  highlight: "sentence",
  pauseReason: null,
};
