// Preferencias del modo «Leer en voz alta», locales al dispositivo
// (localStorage, no por cuenta): la voz sale del dispositivo y el
// consentimiento habla de este dispositivo concreto.

import { TTS_ALL_RATES, type TtsHighlightMode, type TtsRate } from "./ttsTypes";

const TTS_KEY = "lecta:tts";

export type TtsSettings = {
  // El lector activó la función tras el aviso de privacidad. Sin
  // `consentedAt` el menú lo pide antes de la primera sesión.
  enabled: boolean;
  consentedAt: number | null;
  rate: TtsRate;
  highlight: TtsHighlightMode;
};

export const TTS_SETTINGS_DEFAULTS: TtsSettings = {
  enabled: false,
  consentedAt: null,
  rate: 1,
  highlight: "sentence",
};

const parse = (raw: string | null): TtsSettings => {
  if (!raw) return TTS_SETTINGS_DEFAULTS;
  try {
    const v = JSON.parse(raw) as Partial<TtsSettings>;
    return {
      enabled: v.enabled === true && typeof v.consentedAt === "number",
      consentedAt: typeof v.consentedAt === "number" ? v.consentedAt : null,
      rate: TTS_ALL_RATES.includes(v.rate as TtsRate) ? (v.rate as TtsRate) : 1,
      highlight: "sentence",
    };
  } catch {
    return TTS_SETTINGS_DEFAULTS;
  }
};

const storage = () => (typeof localStorage === "undefined" ? null : localStorage);

export function loadTtsSettings(): TtsSettings {
  return parse(storage()?.getItem(TTS_KEY) ?? null);
}

export function saveTtsSettings(settings: TtsSettings): void {
  try {
    storage()?.setItem(TTS_KEY, JSON.stringify(settings));
  } catch {
    // almacenamiento lleno o bloqueado: queda solo en memoria
  }
}

// Marca el consentimiento del primer uso (epoch ms) y deja la función
// encendida. Es la única vía que activa `enabled`.
export function consentTts(now = Date.now()): TtsSettings {
  const next = { ...loadTtsSettings(), enabled: true, consentedAt: now };
  saveTtsSettings(next);
  return next;
}

// La función existe solo donde hay voces: Web Speech API más el
// segmentador de oraciones (ya exigido por la extracción de palabras).
export function isTtsSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof Intl !== "undefined" &&
    typeof Intl.Segmenter === "function"
  );
}
