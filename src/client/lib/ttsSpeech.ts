// Wrapper de speechSynthesis para «Leer en voz alta»: una utterance
// por oración (mitiga el corte ~15 s de Chrome desktop y simplifica
// el resaltado), oraciones largas partidas en trozos por puntuación,
// watchdog ante estados inconsistentes y la treta de iOS — su
// pause()/resume() no es confiable: tras un resume sin señal de voz
// se cancela y el controlador re-speak la oración activa.
//
// La voz es la del dispositivo: preferencia es-MX > es-US > es-* >
// default, con utterance.lang fijado siempre a «es-MX».

import type { TtsRate } from "./ttsTypes";

// Techo por utterance: oraciones más largas se parten en puntuación
// interna; mismo sentenceIndex, misma marca, un solo conteo afuera.
export const TTS_CHUNK_MAX = 240;

// iOS/iPadOS: pause+resume deja la cola muda con frecuencia.
const IS_IOS =
  typeof navigator !== "undefined" &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

// Sin señal de arranque en este margen la utterance se da por
// atascada; el controlador decide el reintento (uno) o el cierre.
const STALL_MS = 1_200;
// Tras resume() en iOS, la voz debe volver en ~350 ms o se re-speak.
const IOS_RESUME_MS = 350;

const normalizeLang = (tag: string) => tag.toLowerCase().replace("_", "-");

// es-MX > es-US > es-* > null (null = voz por defecto del sistema).
export function pickSpanishVoice(
  voices: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | null {
  const exact = (tag: string) =>
    voices.find((v) => normalizeLang(v.lang) === tag) ?? null;
  return (
    exact("es-mx") ??
    exact("es-us") ??
    voices.find((v) => normalizeLang(v.lang).startsWith("es")) ??
    null
  );
}

// getVoices() puede llegar vacío al primer uso: se espera un solo
// voiceschanged con tope corto antes de rendirse a la voz default.
export function ensureVoices(timeoutMs = 1_000): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === "undefined" || !("speechSynthesis" in window))
    return Promise.resolve([]);
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      synth.removeEventListener("voiceschanged", onVoices);
      resolve(synth.getVoices());
    }, timeoutMs);
    const onVoices = () => {
      window.clearTimeout(timer);
      synth.removeEventListener("voiceschanged", onVoices);
      resolve(synth.getVoices());
    };
    synth.addEventListener("voiceschanged", onVoices);
  });
}

// Parte la oración en trozos hablables: corta en la última puntuación
// interna antes del tope; sin puntuación útil, en el último espacio.
export function splitForSpeech(text: string, max = TTS_CHUNK_MAX): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const head = rest.slice(0, max);
    let cut = -1;
    for (const sep of [". ", "; ", ": ", "? ", "! ", "— ", ", "]) {
      const at = head.lastIndexOf(sep);
      if (at > cut) cut = at;
    }
    if (cut < max * 0.4) cut = head.lastIndexOf(" ");
    if (cut <= 0) cut = max;
    chunks.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) chunks.push(rest);
  return chunks.filter(Boolean);
}

export type SpeechStall = "start" | "mid" | "resume";

export type TtsSpeaker = {
  // Encola la oración (partida en trozos si excede el techo) y habla.
  speak(text: string, rate: TtsRate): void;
  pause(): void;
  // En iOS un resume sin señal de voz en IOS_RESUME_MS avisa
  // «stalled: resume» para que el controlador re-speak la oración.
  resume(): void;
  cancel(): void;
  speakingNow(): boolean;
  setRate(rate: TtsRate): void;
};

export function createSpeaker(events: {
  // La oración completa terminó de sonar (todos sus trozos).
  onEnded(): void;
  // Estado inconsistente: utterance que no arranca, error en medio o
  // resume mudo en iOS. El controlador decide reintentar o cerrar.
  onStalled(kind: SpeechStall): void;
}): TtsSpeaker {
  const synth = () => window.speechSynthesis;
  let voice: SpeechSynthesisVoice | null = null;
  let rate: TtsRate = 1;
  let chunks: string[] = [];
  let chunkIndex = 0;
  let cancelled = false;
  let watchdog = 0;
  let generation = 0;

  void ensureVoices().then((voices) => {
    voice = pickSpanishVoice(voices);
  });

  const clearWatchdog = () => {
    if (watchdog) {
      window.clearTimeout(watchdog);
      watchdog = 0;
    }
  };

  const armWatchdog = (gen: number) => {
    clearWatchdog();
    watchdog = window.setTimeout(() => {
      watchdog = 0;
      if (cancelled || gen !== generation) return;
      const s = synth();
      // Ni hablando ni encolada y sin haber terminado: la utterance
      // se perdió — típico de Chrome con colas largas.
      if (!s.speaking && !s.pending) events.onStalled("start");
    }, STALL_MS);
  };

  const speakChunk = (gen: number) => {
    if (cancelled || chunkIndex >= chunks.length) return;
    const text = chunks[chunkIndex];
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "es-MX";
    if (voice) utterance.voice = voice;
    utterance.rate = rate;
    utterance.onend = () => {
      if (cancelled || gen !== generation) return;
      clearWatchdog();
      chunkIndex += 1;
      if (chunkIndex < chunks.length) speakChunk(gen);
      else events.onEnded();
    };
    utterance.onerror = (event) => {
      if (cancelled || gen !== generation) return;
      clearWatchdog();
      // «interrupted»/«canceled» llegan al cancelar en pause iOS:
      // no es fallo — el controlador ya re-speak por su cuenta.
      if (event.error === "interrupted" || event.error === "canceled") return;
      events.onStalled("mid");
    };
    armWatchdog(gen);
    synth().speak(utterance);
  };

  return {
    speak(text, nextRate) {
      rate = nextRate;
      cancelled = false;
      generation += 1;
      chunks = splitForSpeech(text);
      chunkIndex = 0;
      speakChunk(generation);
    },
    pause() {
      clearWatchdog();
      try {
        synth().pause();
      } catch {
        /* motores sin pause real: el controlador cancela si hace falta */
      }
    },
    resume() {
      const gen = generation;
      try {
        synth().resume();
      } catch {
        /* mismo criterio */
      }
      if (!IS_IOS) return;
      window.setTimeout(() => {
        if (cancelled || gen !== generation) return;
        const s = synth();
        if (!s.speaking && !s.pending) events.onStalled("resume");
      }, IOS_RESUME_MS);
    },
    cancel() {
      cancelled = true;
      generation += 1;
      clearWatchdog();
      chunks = [];
      try {
        synth().cancel();
      } catch {
        /* el cierre de la sesión no falla por el sintetizador */
      }
    },
    speakingNow() {
      try {
        const s = synth();
        return s.speaking || s.pending;
      } catch {
        return false;
      }
    },
    setRate(next) {
      rate = next;
    },
  };
}
