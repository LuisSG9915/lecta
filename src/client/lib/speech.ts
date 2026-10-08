// Utilidad ligera para pronunciar palabras individuales con síntesis de voz,
// orientada al aprendizaje de idiomas (vocabulario y panel de palabras).

import { ensureVoices, pickVoiceForLanguage } from "./ttsSpeech";

export function isSpeechAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance !== "undefined"
  );
}

export async function speakWord(
  word: string,
  language = "es",
): Promise<void> {
  const trimmed = word.trim();
  if (!trimmed || !isSpeechAvailable()) return;

  const synth = window.speechSynthesis;
  // Detener cualquier reproducción previa para evitar superposiciones
  try {
    synth.cancel();
  } catch {
    /* ignorar fallo de cancelación */
  }

  const voices = await ensureVoices(500);
  const { voice, defaultLangTag } = pickVoiceForLanguage(voices, language);

  return new Promise<void>((resolve) => {
    const utterance = new SpeechSynthesisUtterance(trimmed);
    utterance.lang = voice?.lang ?? defaultLangTag;
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
