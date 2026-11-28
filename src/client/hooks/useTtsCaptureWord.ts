// Captura la palabra clave de la frase actual del TTS y la guarda en el
// Cuaderno (junto con su conocimiento). Extraído de Reader.tsx (B7).
import { useCallback, type RefObject } from "react";
import { captureDbScope, saveWordWithKnowledge, type SavedWord } from "../lib/idb";
import { extractKeyWordFromSentence } from "../lib/section-words";
import { triggerHaptic } from "../lib/haptics";

type TtsController = {
  getCurrentSentence: () => string | null;
};

type Deps = {
  language: string;
  bookHash: string;
  ttsRef: RefObject<TtsController | null>;
  onWordSaved: (word: SavedWord) => void;
  setTtsCapturedToast: (value: string | null) => void;
  onWordCaptured?: (form: string) => void;
};

export function useTtsCaptureWord(deps: Deps): () => Promise<void> {
  const { language, bookHash, ttsRef, onWordSaved, setTtsCapturedToast, onWordCaptured } = deps;

  return useCallback(async () => {
    const ctl = ttsRef.current;
    if (!ctl) return;
    const currentSentence = ctl.getCurrentSentence();
    if (!currentSentence) return;

    const keyWord = extractKeyWordFromSentence(currentSentence, language);
    if (!keyWord || !keyWord.form) return;

    triggerHaptic("selection");
    const scope = captureDbScope();
    try {
      const { word: savedWord } = await saveWordWithKnowledge(
        {
          word: {
            form: keyWord.form,
            lemma: keyWord.lemma || keyWord.form.toLowerCase(),
            pos: keyWord.pos,
            language,
            context: currentSentence,
            bookHash,
          },
          knowledge: {
            language,
            lemma: (keyWord.lemma || keyWord.form).toLowerCase(),
            known: false,
            source: "saved",
            status: "unknown",
          },
        },
        scope,
      );
      onWordSaved(savedWord);
      onWordCaptured?.(keyWord.form);
      setTtsCapturedToast(keyWord.form);
      setTimeout(() => setTtsCapturedToast(null), 2500);
    } catch {
      // fallback silencioso
    }
  }, [language, bookHash, ttsRef, onWordSaved, setTtsCapturedToast, onWordCaptured]);
}