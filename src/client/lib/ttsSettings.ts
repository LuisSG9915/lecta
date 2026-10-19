// Preferencias del modo «Leer en voz alta», locales al dispositivo
// (localStorage, no por cuenta): la voz sale del dispositivo y el
// consentimiento habla de este dispositivo concreto.

import {
  TTS_ALL_RATES,
  KITTEN_VOICES,
  type KittenVoiceId,
  type TtsEngineMode,
  type TtsHighlightMode,
  type TtsRate,
} from "./ttsTypes";

const TTS_KEY = "lecta:tts";

export type TtsSettings = {
  // El lector activó la función tras el aviso de privacidad. Sin
  // `consentedAt` el menú lo pide antes de la primera sesión.
  enabled: boolean;
  consentedAt: number | null;
  rate: TtsRate;
  highlight: TtsHighlightMode;
  engine: TtsEngineMode;
  kittenVoice: KittenVoiceId;
  voiceURI?: string | null;
};

export const TTS_SETTINGS_DEFAULTS: TtsSettings = {
  enabled: false,
  consentedAt: null,
  rate: 1,
  highlight: "sentence",
  engine: "auto",
  kittenVoice: "expr-voice-2-f",
  voiceURI: null,
};

const VALID_ENGINES: readonly TtsEngineMode[] = ["auto", "kitten-neural", "browser"];
const VALID_KITTEN_VOICES = new Set<string>(KITTEN_VOICES.map((v) => v.id));

const parse = (raw: string | null): TtsSettings => {
  if (!raw) return TTS_SETTINGS_DEFAULTS;
  try {
    const v = JSON.parse(raw) as Partial<TtsSettings>;
    const engine: TtsEngineMode =
      v.engine && VALID_ENGINES.includes(v.engine) ? v.engine : "auto";
    const kittenVoice: KittenVoiceId =
      v.kittenVoice && VALID_KITTEN_VOICES.has(v.kittenVoice)
        ? (v.kittenVoice as KittenVoiceId)
        : "expr-voice-2-f";

    return {
      enabled: v.enabled === true && typeof v.consentedAt === "number",
      consentedAt: typeof v.consentedAt === "number" ? v.consentedAt : null,
      rate: TTS_ALL_RATES.includes(v.rate as TtsRate) ? (v.rate as TtsRate) : 1,
      highlight: "sentence",
      engine,
      kittenVoice,
      voiceURI: typeof v.voiceURI === "string" ? v.voiceURI : null,
    };
  } catch {
    return TTS_SETTINGS_DEFAULTS;
  }
};

const storage = () => (typeof localStorage === "undefined" ? null : localStorage);

export function loadTtsSettings(): TtsSettings {
  return parse(storage()?.getItem(TTS_KEY) ?? null);
}

export function saveTtsSettings(settings: Partial<TtsSettings>): void {
  try {
    const current = loadTtsSettings();
    const next = { ...current, ...settings };
    storage()?.setItem(TTS_KEY, JSON.stringify(next));
  } catch {
    // almacenamiento lleno o bloqueado: queda solo en memoria
  }
}

// Marca el consentimiento del primer uso (epoch ms) y deja la función
// encendida. Es la única vía que activa `enabled`.
export function consentTts(
  now = Date.now(),
  overrides?: Partial<Pick<TtsSettings, "engine" | "kittenVoice" | "rate">>,
): TtsSettings {
  const current = loadTtsSettings();
  const next: TtsSettings = {
    ...current,
    ...overrides,
    enabled: true,
    consentedAt: now,
  };
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

const KITTEN_CONSENT_KEY = "lecta:kitten-tts-consent";

export function hasKittenConsent(): boolean {
  try {
    return storage()?.getItem(KITTEN_CONSENT_KEY) === "1";
  } catch {
    return false;
  }
}

export function setKittenConsent(consented: boolean): void {
  try {
    if (consented) {
      storage()?.setItem(KITTEN_CONSENT_KEY, "1");
    } else {
      storage()?.removeItem(KITTEN_CONSENT_KEY);
    }
  } catch {
    // ignore
  }
}

export function isKittenVoiceURI(uri: string): boolean {
  return uri.startsWith("kitten:") || uri.includes("kitten");
}
