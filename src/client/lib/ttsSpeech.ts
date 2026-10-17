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
// Chrome en Android tiene el mismo resume() sordo de iOS: tras una
// pausa la utterance puede no volver jamás (`paused` queda true).
const IS_ANDROID =
  typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
const RESUME_NEEDS_CHECK = IS_IOS || IS_ANDROID;

// Sin señal de arranque en este margen la utterance se da por
// atascada; el controlador decide el reintento (uno) o el cierre.
// El margen es generoso: en Android el motor puede tardar >1 s en
// inicializar la primera utterance.
const STALL_MS = 2_500;
// Tras resume() la voz debe volver en ~350 ms o se re-speak.
const IOS_RESUME_MS = 350;
// speak() en el mismo tick que un cancel() se pierde sin evento en
// Android (y a veces en iOS): la cola se deja asentar un instante.
const SPEAK_SETTLE_MS = 120;

// Ventana de «utterance zombie» ya arrancada: ~11 letras/segundo de
// habla española, con margen amplio y pisos/techos razonables. Si la
// oración excede dos ventanas estimadas sin terminar, está muerta.
const midWatchMs = (text: string, rate: TtsRate) =>
  Math.min(
    60_000,
    Math.max(10_000, ((text.length / 11) * 1000) / rate) * 2 + 4_000,
  );

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

// en-US > en-GB > en-* > null.
export function pickEnglishVoice(
  voices: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | null {
  const exact = (tag: string) =>
    voices.find((v) => normalizeLang(v.lang) === tag) ?? null;
  return (
    exact("en-us") ??
    exact("en-gb") ??
    voices.find((v) => normalizeLang(v.lang).startsWith("en")) ??
    null
  );
}

export function defaultSpanishLangTag(): string {
  if (typeof navigator !== "undefined" && navigator.language) {
    const nav = normalizeLang(navigator.language);
    if (nav.startsWith("es")) return nav;
  }
  return "es-MX";
}

// Resuelve la voz y tag BCP 47 idóneo para el idioma especificado.
export function pickVoiceForLanguage(
  voices: SpeechSynthesisVoice[],
  language = "es",
): { voice: SpeechSynthesisVoice | null; defaultLangTag: string } {
  const isEn = language.toLowerCase().startsWith("en");
  if (isEn) {
    return {
      voice: pickEnglishVoice(voices),
      defaultLangTag: "en-US",
    };
  }
  return {
    voice: pickSpanishVoice(voices),
    defaultLangTag: defaultSpanishLangTag(),
  };
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

export function createSpeaker(
  events: {
    // La oración completa terminó de sonar (todos sus trozos).
    onEnded(): void;
    // Estado inconsistente: utterance que no arranca, error en medio o
    // resume mudo en iOS. El controlador decide reintentar o cerrar.
    onStalled(kind: SpeechStall): void;
  },
  options?: { language?: string },
): TtsSpeaker {
  const synth = () => window.speechSynthesis;
  const targetLanguage = options?.language ?? "es";
  let voice: SpeechSynthesisVoice | null = null;
  let rate: TtsRate = 1;
  let chunks: string[] = [];
  let chunkIndex = 0;
  let cancelled = false;
  // Pausa pedida por el lector: con ella, ni onstart tardío ni el
  // vigilante de mitad pueden «despausar» la cola por su cuenta.
  let pausedFlag = false;
  let watchdog = 0;
  let generation = 0;

  void ensureVoices().then((voices) => {
    voice = pickVoiceForLanguage(voices, targetLanguage).voice;
  });

  const clearWatchdog = () => {
    if (watchdog) {
      window.clearTimeout(watchdog);
      watchdog = 0;
    }
  };

  const isIdle = () => {
    const s = synth();
    return !s.speaking && !s.pending;
  };

  // Vigilante de arranque: si en STALL_MS el motor no reporta ni
  // hablando ni encolada, la utterance se perdió (motores sin voz,
  // colas muertas). En algunos Android `speaking` llega tarde — por
  // eso también aceptamos `onstart` como prueba de vida.
  const armStartWatchdog = (gen: number, started: () => boolean) => {
    clearWatchdog();
    watchdog = window.setTimeout(() => {
      watchdog = 0;
      if (cancelled || gen !== generation || pausedFlag || started()) return;
      if (isIdle()) events.onStalled("start");
      else armMidWatchdog(gen, chunks[chunkIndex] ?? "");
    }, STALL_MS);
  };

  // Vigilante de mitad: la utterance arrancó pero onend no llega —
  // Chrome corta motores a los ~15 s, Android puede morir callado.
  // `paused` en la ventana significa que el propio Chrome aparcó la
  // cola: se le da un resume() de cortesía antes de rendirse.
  const armMidWatchdog = (gen: number, text: string, recheck = false) => {
    clearWatchdog();
    watchdog = window.setTimeout(() => {
      watchdog = 0;
      if (cancelled || gen !== generation || pausedFlag) return;
      const s = synth();
      if (s.paused) {
        try {
          s.resume();
        } catch {
          /* motores sin resume real */
        }
        if (!recheck) {
          armMidWatchdog(gen, text, true);
          return;
        }
      }
      if (isIdle()) {
        events.onStalled("mid");
        return;
      }
      // El motor insiste en que sigue hablando: se le cree una vez;
      // una utterance viva más de dos ventanas estimadas está zombie.
      if (!recheck) armMidWatchdog(gen, text, true);
      else events.onStalled("mid");
    }, midWatchMs(text, rate));
  };

  const speakChunk = (gen: number) => {
    if (cancelled || chunkIndex >= chunks.length) return;
    const text = chunks[chunkIndex];
    const utterance = new SpeechSynthesisUtterance(text);
    let started = false;
    // La voz se elige al momento de hablar (getVoices es síncrono y ya
    // pobló tras ensureVoices): sin `voice` explícita, varios motores
    // Android no resuelven el locale y tragan la utterance en silencio.
    const selection = pickVoiceForLanguage(synth().getVoices(), targetLanguage);
    if (!voice) voice = selection.voice;
    utterance.lang = voice?.lang ?? selection.defaultLangTag;
    if (voice) utterance.voice = voice;
    utterance.rate = rate;
    utterance.volume = 1;
    utterance.pitch = 1;
    utterance.onstart = () => {
      if (cancelled || gen !== generation || pausedFlag) return;
      started = true;
      // Ya habla: el vigilante cambia a «debe terminar a tiempo».
      armMidWatchdog(gen, text);
    };
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
    armStartWatchdog(gen, () => started);
    try {
      synth().resume();
    } catch {
      /* motores sin resume */
    }
    try {
      synth().speak(utterance);
    } catch {
      // Un speak() que truena al instante es una utterance que nunca
      // arrancó: mismo camino que el arranque mudo.
      clearWatchdog();
      events.onStalled("start");
      return;
    }
    // Pausa pedida mientras la utterance esperaba el asentamiento:
    // se encola ya pausada para no soltar la voz a media pausa.
    if (pausedFlag) {
      try {
        synth().pause();
      } catch {
        /* motores sin pause real */
      }
    }
  };

  return {
    speak(text, nextRate) {
      rate = nextRate;
      cancelled = false;
      pausedFlag = false;
      generation += 1;
      chunks = splitForSpeech(text);
      chunkIndex = 0;
      const gen = generation;
      const s = synth();
      // Si la cola estaba inactiva (arranque por pulsación del usuario),
      // hablamos en el mismo tick para no perder el token de activación
      // de usuario (Brave y Chromium en Android silencian audio si se demora
      // en un timeout fuera del gesto).
      if (isIdle()) {
        speakChunk(gen);
        return;
      }
      try {
        // Limpia la cola: una utterance zombie del speaker anterior
        // puede dejar el motor «hablando» sin sonido en Android.
        s.cancel();
      } catch {
        /* la cola ya estaba limpia o el motor no existe */
      }
      window.setTimeout(() => {
        if (cancelled || gen !== generation) return;
        speakChunk(gen);
      }, SPEAK_SETTLE_MS);
    },
    pause() {
      pausedFlag = true;
      clearWatchdog();
      try {
        synth().pause();
      } catch {
        /* motores sin pause real: el controlador cancela si hace falta */
      }
    },
    resume() {
      pausedFlag = false;
      const gen = generation;
      try {
        synth().resume();
      } catch {
        /* mismo criterio */
      }
      // Re-arma el vigilante sobre el trozo en vuelo: si la utterance
      // reanudada muere a mitad, la sesión no se queda esperando.
      if (!cancelled && chunkIndex < chunks.length)
        armMidWatchdog(gen, chunks[chunkIndex]);
      if (!RESUME_NEEDS_CHECK) return;
      window.setTimeout(() => {
        if (cancelled || gen !== generation) return;
        const s = synth();
        // `paused` que no baja tras resume() = motor sordo (iOS y
        // Chrome/Android); cola vacía = el motor soltó la utterance.
        // Ambos piden re-speak de la oración activa.
        if (s.paused || (!s.speaking && !s.pending))
          events.onStalled("resume");
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

export function stopSystemVoice(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
  }
}

export async function speakWithSystemVoice(
  text: string,
  options?: { voiceId?: string; rate?: number; language?: string },
): Promise<void> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return;
  }
  const synth = window.speechSynthesis;
  try {
    synth.cancel();
  } catch {
    // ignore
  }

  const voices = await ensureVoices(500);
  const { voice, defaultLangTag } = pickVoiceForLanguage(voices, options?.language ?? "es");

  return new Promise<void>((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = voice?.lang ?? defaultLangTag;
    if (voice) utterance.voice = voice;
    if (options?.rate) utterance.rate = options.rate;

    let settled = false;
    const settle = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    utterance.onend = settle;
    utterance.onerror = settle;
    setTimeout(settle, 10_000);

    try {
      synth.speak(utterance);
    } catch {
      settle();
    }
  });
}
