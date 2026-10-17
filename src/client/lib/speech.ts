// Utilidad bilingüe inteligente para pronunciar palabras individuales con
// síntesis de voz: KittenTTS neural a 24kHz para inglés si está listo, o selección
// explícita de voz por idioma en speechSynthesis (evitando fonética española en inglés).

import { ensureVoices, pickVoiceForLanguage } from "./ttsSpeech";
import { kittenTtsEngine } from "./kittenTtsEngine";
import { loadTtsSettings } from "./ttsSettings";

export function isSpeechAvailable(): boolean {
  return (
    (typeof window !== "undefined" &&
      "speechSynthesis" in window &&
      typeof window.SpeechSynthesisUtterance !== "undefined") ||
    kittenTtsEngine.isSupported()
  );
}

export async function speakWord(
  word: string,
  language = "es",
): Promise<void> {
  const trimmed = word.trim();
  if (!trimmed || !isSpeechAvailable()) return;

  const isEn = language.toLowerCase().startsWith("en");

  // 1. Si es inglés y KittenTTS está disponible/listo, pronunciar con voz neural a 24kHz
  if (isEn && kittenTtsEngine.isReady()) {
    try {
      kittenTtsEngine.stop();
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      const settings = loadTtsSettings();
      const buffer = await kittenTtsEngine.synthesize(trimmed, settings.kittenVoice, 0.9);
      return await new Promise<void>((resolve) => {
        kittenTtsEngine.play(buffer, 0.9, () => resolve());
      });
    } catch {
      // Degradar limpiamente al fallback de speechSynthesis
    }
  }

  // 2. Fallback de window.speechSynthesis con selección rigurosa de voz bilingüe
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

  const synth = window.speechSynthesis;
  try {
    synth.cancel();
  } catch {
    /* ignorar fallo de cancelación */
  }

  const voices = await ensureVoices(500);
  const { voice, defaultLangTag } = pickVoiceForLanguage(voices, isEn ? "en" : "es");

  return new Promise<void>((resolve) => {
    const utterance = new SpeechSynthesisUtterance(trimmed);
    utterance.lang = voice?.lang ?? (isEn ? "en-US" : defaultLangTag);
    if (voice) utterance.voice = voice;
    // Tasa ligeramente reducida para dicción clara en aprendizaje de idiomas
    utterance.rate = 0.9;
    utterance.volume = 1;

    let settled = false;
    const settle = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    utterance.onend = settle;
    utterance.onerror = settle;

    // Red de seguridad por si onend se pierde en plataformas móviles
    setTimeout(settle, 4_000);

    try {
      synth.speak(utterance);
    } catch {
      settle();
    }
  });
}
