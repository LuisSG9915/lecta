import type { TtsSnapshot } from "./ttsTypes";

// MediaSession: notificación y controles de pantalla bloqueada. Chrome en Android
// solo la muestra (y mantiene viva la pestaña) si hay un elemento multimedia
// sonando, así que la sesión lleva un <audio> en silencio y en bucle.

export type MediaMeta = { title: string; chapter: string | null; artwork: string };

export type MediaHandlers = {
  play: () => void;
  pause: () => void;
  next: () => void;
  prev: () => void;
  stop: () => void;
};

const ACTIONS = [
  "play",
  "pause",
  "previoustrack",
  "nexttrack",
  "stop",
  "seekbackward",
  "seekforward",
] as const;

let lastKey = "";
let silentEl: HTMLAudioElement | null = null;
let silentUrl: string | null = null;

const session = (): MediaSession | null =>
  typeof navigator !== "undefined" && "mediaSession" in navigator ? navigator.mediaSession : null;

const setHandler = (s: MediaSession, action: (typeof ACTIONS)[number], fn: (() => void) | null) => {
  try {
    s.setActionHandler(action as MediaSessionAction, fn);
  } catch {
    // Acción no soportada por este navegador.
  }
};

export function syncMediaSession(snap: TtsSnapshot, meta: MediaMeta, handlers: MediaHandlers): void {
  const s = session();
  if (!s) return;
  if (snap.status === "idle" || snap.status === "stopping") {
    mediaSessionReset();
    return;
  }
  const key = `${meta.title}|${meta.chapter ?? ""}|${meta.artwork}`;
  if (key !== lastKey && typeof MediaMetadata !== "undefined") {
    lastKey = key;
    s.metadata = new MediaMetadata({
      title: meta.chapter ?? meta.title,
      artist: "Lecta",
      album: meta.title,
      artwork: [{ src: meta.artwork, sizes: "512x512", type: "image/png" }],
    });
  }
  s.playbackState = snap.status === "paused" ? "paused" : "playing";
  setHandler(s, "play", handlers.play);
  setHandler(s, "pause", handlers.pause);
  setHandler(s, "previoustrack", handlers.prev);
  setHandler(s, "nexttrack", handlers.next);
  setHandler(s, "seekbackward", handlers.prev);
  setHandler(s, "seekforward", handlers.next);
  setHandler(s, "stop", handlers.stop);
}

export function mediaSessionReset(): void {
  stopSilentKeepAlive();
  const s = session();
  if (!s) return;
  lastKey = "";
  for (const a of ACTIONS) setHandler(s, a, null);
  s.playbackState = "none";
  s.metadata = null;
}

// ~1 s de silencio PCM 8 bit/8 kHz generado en memoria (sin asset nuevo).
function silentWavUrl(): string {
  const n = 8000;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const str = (o: number, t: string) => {
    for (let i = 0; i < t.length; i += 1) v.setUint8(o + i, t.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + n, true);
  str(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 8000, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  str(36, "data");
  v.setUint32(40, n, true);
  new Uint8Array(buf, 44).fill(128);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

// Llamar dentro de un gesto del lector: el autoplay no deja arrancarlo después.
export function startSilentKeepAlive(): void {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return;
  try {
    if (!silentEl) {
      silentUrl = silentWavUrl();
      silentEl = new Audio(silentUrl);
      silentEl.loop = true;
      silentEl.volume = 0.001;
    }
    void silentEl.play().catch(() => undefined);
  } catch {
    // Sin audio de respaldo la voz sigue, solo sin notificación.
  }
}

export function stopSilentKeepAlive(): void {
  if (!silentEl) return;
  silentEl.pause();
  silentEl = null;
  if (silentUrl) URL.revokeObjectURL(silentUrl);
  silentUrl = null;
}
