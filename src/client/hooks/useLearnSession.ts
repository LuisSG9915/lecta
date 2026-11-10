// Hook extraído de Vocabulary.tsx (Fase 5, V1): la ficha guiada de «Aprender»
// (primera exposición). Mantiene la tanda activa, decide cada palabra
// («Ya la conozco» / «Quiero aprenderla» / «Pasar por ahora»), rellena el
// significado desde el diccionario, la IA o a mano, y maneja el teclado.
import { useEffect, useRef, useState } from "react";
import {
  captureDbScope,
  fillSavedWordMeaning,
  saveKnowledge,
  saveSessionValue,
  updateSavedWord,
  type KnownWord,
  type SavedWord,
} from "../lib/idb";
import { enrichWord, lookupWord } from "../lib/lexicon";
import {
  LEARN_EXPOSURE_KEY,
  LEARN_SESSION_SIZE,
  withExposure,
  type LearnExposure,
} from "../lib/learn";
import { newCard } from "../lib/fsrs";
import { pushKnowledgeToServer } from "../lib/reading-sync";
import { pushWordsToServer } from "../lib/vocab";
import { recordReview } from "../lib/reviews";
import { applyPreviewKnownSignal, calibrationBankZipf } from "../lib/knowledge";
import { betaFromZipf } from "../lib/profile-models";
import { loadNativeLanguage } from "../lib/settings";
import { triggerHaptic } from "../lib/haptics";

export type LearnState = {
  items: SavedWord[];
  total: number;
  revealed: boolean;
  // Claves que el usuario quiso aprender en esta sesión: el puente a repaso.
  kept: string[];
  // true cuando se sale antes de vaciar la cola («Terminar por
  // ahora»): la pantalla final conserva el puente a repaso.
  done?: boolean;
};

export type UseLearnSessionArgs = {
  /** Pendientes de ficha, en el orden de la lista (ver isLearnPending). */
  learnPending: SavedWord[];
  /** Lo que ofrece el botón «Aprender» (hoy, igual a learnPending). */
  learnable: SavedWord[];
  setWords: React.Dispatch<React.SetStateAction<SavedWord[] | null>>;
  setKnowledge: React.Dispatch<React.SetStateAction<KnownWord[]>>;
  exposure: LearnExposure;
  setExposure: React.Dispatch<React.SetStateAction<LearnExposure>>;
  notifyVocabChange: () => void;
};

export function useLearnSession({
  learnPending,
  learnable,
  setWords,
  setKnowledge,
  exposure,
  setExposure,
  notifyVocabChange,
}: UseLearnSessionArgs) {
  // Palabras a las que se les dio «Pasar por ahora» en este montaje.
  const learnPassedRef = useRef<Set<string>>(new Set());
  const [learn, setLearn] = useState<LearnState | null>(null);
  const [learnBusy, setLearnBusy] = useState<"" | "action" | "enrich">("");
  const [learnError, setLearnError] = useState("");
  // Significado escrito a mano en la ficha cuando la IA no aplica.
  // Se guarda junto a la clave del ítem: al pasar a otra palabra el
  // borrador se lee vacío sin necesidad de un efecto de reseteo.
  const [learnDraftFor, setLearnDraftFor] = useState<{
    key: string;
    text: string;
  }>({ key: "", text: "" });
  const learnItemKey = learn?.items[0]?.key ?? "";
  const learnDraft =
    learnDraftFor.key === learnItemKey ? learnDraftFor.text : "";
  const setLearnDraft = (text: string) =>
    setLearnDraftFor({ key: learnItemKey, text });

  // ---------- Aprender (primera exposición guiada) ----------
  // La ficha no califica ni agenda: solo muestra la palabra y su
  // significado, y la decisión explícita la registra en
  // learnExposure:v1. «Ya la conozco» escribe evidencia declared;
  // «Quiero aprenderla» crea la card FSRS que la trae al repaso hoy.

  const startLearn = (first?: SavedWord) => {
    // Tandas de LEARN_SESSION_SIZE: aprender de a 5 cierra el ciclo
    // enseñar→practicar antes de perder el hilo; el resto espera en
    // learnPending para «Seguir aprendiendo».
    // Las que ya se pasaron «por ahora» o no tienen significado van al final:
    // si no, volverían al frente de cada tanda y taparían a las demás.
    const rank = (word: SavedWord) =>
      learnPassedRef.current.has(word.key) ? 2 : word.meaning ? 0 : 1;
    const rest = (
      first ? learnPending.filter((word) => word.key !== first.key) : learnable
    )
      .map((word, index) => ({ word, index }))
      .sort((a, b) => rank(a.word) - rank(b.word) || a.index - b.index)
      .map(({ word }) => word);
    const items = (first ? [first, ...rest] : rest).slice(0, LEARN_SESSION_SIZE);
    if (!items.length) return;
    setLearnError("");
    setLearnBusy("");
    setLearnDraft("");
    setLearn({ items, total: items.length, revealed: false, kept: [] });
  };

  // «Pasar por ahora» no escribe exposición: se recuerda aquí para que la
  // palabra no vuelva al frente de la siguiente tanda en esta sesión.
  const passLearn = () => {
    const key = learn?.items[0]?.key;
    if (key) learnPassedRef.current.add(key);
    advanceLearn();
  };

  const advanceLearn = () =>
    setLearn((current) =>
      current ? { ...current, items: current.items.slice(1), revealed: false } : current,
    );

  const persistExposure = async (
    key: string,
    verdict: "known" | "learn",
    scope: ReturnType<typeof captureDbScope>,
  ) => {
    const next = withExposure(exposure, key, verdict, Date.now());
    setExposure(next);
    await saveSessionValue(LEARN_EXPOSURE_KEY, JSON.stringify(next), scope);
  };

  const learnKnown = async () => {
    const item = learn?.items[0];
    if (!item || learnBusy) return;
    setLearnBusy("action");
    setLearnError("");
    try {
      const scope = captureDbScope();
      const row = await saveKnowledge(
        {
          language: item.language || "es",
          lemma: (item.lemma ?? item.form).toLowerCase(),
          known: true,
          source: "declared",
          status: "known",
        },
        scope,
      );
      setKnowledge((list) => [
        ...list.filter((entry) => entry.key !== row.key),
        row,
      ]);
      void pushKnowledgeToServer([row], scope);
      // Misma señal que «✓ Ya la sé» del lector: la palabra declarada
      // conocida sube theta del idioma y queda en el historial.
      void recordReview(
        {
          language: item.language || "es",
          form: item.form,
          kind: "declared",
          rating: "known",
        },
        scope,
        { award: false },
      ).catch(() => {});
      applyPreviewKnownSignal(
        item.language || "es",
        betaFromZipf(
          calibrationBankZipf(
            (item.lemma ?? item.form).toLowerCase(),
            item.language || "es",
          ),
        ),
      );
      await persistExposure(item.key, "known", scope);
      triggerHaptic(12);
      notifyVocabChange();
      advanceLearn();
    } catch {
      setLearnError("No se pudo guardar. Intenta de nuevo.");
    } finally {
      setLearnBusy("");
    }
  };

  const learnKeep = async () => {
    const item = learn?.items[0];
    if (!item || learnBusy) return;
    setLearnBusy("action");
    setLearnError("");
    try {
      const scope = captureDbScope();
      // `presentedAt` viaja con la palabra: en otro dispositivo la ficha no
      // se repite antes del primer repaso.
      const stored = await updateSavedWord(
        { ...item, card: newCard(), presentedAt: Date.now() },
        scope,
      );
      void pushWordsToServer([stored], scope);
      setWords((list) =>
        list?.map((word) => (word.key === stored.key ? stored : word)) ?? list,
      );
      notifyVocabChange();
      await persistExposure(item.key, "learn", scope);
      triggerHaptic(12);
      // Avanza y anota la palabra para el puente «Repasar estas N palabras».
      setLearn((current) =>
        current
          ? {
              ...current,
              kept: [...current.kept, item.key],
              items: current.items.slice(1),
              revealed: false,
            }
          : current,
      );
    } catch {
      setLearnError("No se pudo guardar. Intenta de nuevo.");
    } finally {
      setLearnBusy("");
    }
  };

  // Sin significado guardado: primero el diccionario (capas locales
  // y catálogo, sin gastar IA) y si no hay ficha, la IA define la
  // palabra en el momento. El relleno respeta el compare-and-set por
  // sello — un repaso o borrado concurrente gana.
  const learnEnrich = async () => {
    const item = learn?.items[0];
    if (!item || learnBusy) return;
    setLearnBusy("enrich");
    setLearnError("");
    try {
      const scope = captureDbScope();
      const applyFill = async (
        fill: Pick<
          SavedWord,
          "meaning" | "lemma" | "pos" | "senseEntryId" | "senseOrder"
        >,
      ) => {
        const stored = await fillSavedWordMeaning(
          item.key,
          item.updatedAt,
          fill,
          scope,
        );
        if (stored) {
          void pushWordsToServer([stored], scope);
          setWords((list) =>
            list?.map((word) => (word.key === stored.key ? stored : word)) ?? list,
          );
          notifyVocabChange();
          setLearn((current) =>
            current
              ? {
                  ...current,
                  items: current.items.map((word) =>
                    word.key === stored.key ? stored : word,
                  ),
                }
              : current,
          );
          return true;
        }
        return false;
      };

      // 1. Diccionario: memoria, caché, paquete descargable y catálogo.
      const looked = await lookupWord(
        item.form,
        item.language || "es",
        scope,
      ).catch(() => null);
      const lookedEntry = looked?.ok ? looked.entries[0] : undefined;
      const lookedSense = lookedEntry?.senses[0];
      if (lookedEntry && lookedSense?.definition) {
        const filled = await applyFill({
          meaning: lookedSense.definition,
          lemma: lookedEntry.lemma ?? undefined,
          pos: lookedEntry.pos ?? undefined,
          senseEntryId: lookedEntry.entryId ?? undefined,
          senseOrder: lookedSense.senseOrder ?? undefined,
        });
        if (filled) return;
        setLearnError("La palabra cambió mientras tanto; inténtalo de nuevo.");
        return;
      }

      // 2. IA: misma consulta que la ficha del lector.
      const result = await enrichWord(
        item.form,
        item.language || "es",
        item.context,
        scope,
        loadNativeLanguage(),
      );
      if (!result.ok) {
        setLearnError(result.error);
        return;
      }
      const entry = result.entries[0];
      const sense = entry?.senses[0];
      if (!entry || !sense) {
        setLearnError("La IA no devolvió una definición. Intenta de nuevo.");
        return;
      }
      const filled = await applyFill({
        meaning: sense.definition,
        lemma: entry.lemma,
        pos: entry.pos ?? undefined,
        senseEntryId: entry.entryId ?? undefined,
        senseOrder: sense.senseOrder ?? undefined,
      });
      if (!filled) {
        setLearnError("La palabra cambió mientras tanto; inténtalo de nuevo.");
      }
    } catch {
      setLearnError("Sin conexión con el catálogo.");
    } finally {
      setLearnBusy("");
    }
  };

  // Significado escrito a mano: la palabra sin ficha de diccionario ni
  // IA no queda bloqueada — el lector la define y «Quiero aprenderla»
  // se habilita igual que tras el relleno automático.
  const learnSaveMeaning = async () => {
    const item = learn?.items[0];
    const meaning = learnDraft.trim();
    if (!item || !meaning || learnBusy) return;
    setLearnBusy("action");
    setLearnError("");
    try {
      const scope = captureDbScope();
      const stored = await fillSavedWordMeaning(
        item.key,
        item.updatedAt,
        { meaning },
        scope,
      );
      if (!stored) {
        setLearnError("La palabra cambió mientras escribías; inténtalo de nuevo.");
        return;
      }
      void pushWordsToServer([stored], scope);
      setWords((list) =>
        list?.map((word) => (word.key === stored.key ? stored : word)) ?? list,
      );
      notifyVocabChange();
      setLearnDraft("");
      setLearn((current) =>
        current
          ? {
              ...current,
              items: current.items.map((word) =>
                word.key === stored.key ? stored : word,
              ),
            }
          : current,
      );
    } catch {
      setLearnError("No se pudo guardar el significado. Intenta de nuevo.");
    } finally {
      setLearnBusy("");
    }
  };

  // Teclado de la ficha de «Aprender»: Espacio muestra el significado;
  // ya revelada, 1 = «Ya la conozco» y 2 = «Quiero aprenderla». Se
  // ignora mientras se escribe el significado a mano.
  useEffect(() => {
    if (!learn || learn.done || learn.items.length === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable]")
      )
        return;
      if (event.key === " " && !learn.revealed) {
        event.preventDefault();
        setLearn((current) =>
          current && !current.revealed ? { ...current, revealed: true } : current,
        );
        return;
      }
      if (!learn.revealed) return;
      if (event.key === "1") {
        event.preventDefault();
        void learnKnown();
      } else if (event.key === "2") {
        event.preventDefault();
        void learnKeep();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // learnKnown/learnKeep leen el estado fresco por closure del render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learn, learnBusy]);

  return {
    learn,
    setLearn,
    learnBusy,
    learnError,
    learnDraft,
    setLearnDraft,
    startLearn,
    passLearn,
    advanceLearn,
    learnKnown,
    learnKeep,
    learnEnrich,
    learnSaveMeaning,
  };
}

export type UseLearnSessionResult = ReturnType<typeof useLearnSession>;
