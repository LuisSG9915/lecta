// Hook extraído de Vocabulary.tsx (Fase 5, V1): carga y estado de los datos
// del Cuaderno — palabras guardadas, preferencia «Usar IA», conocimiento
// declarado y primeras exposiciones — y el aviso al padre de cada cambio.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  captureDbScope,
  listKnowledge,
  listSavedWords,
  loadSessionValue,
  type KnownWord,
  type SavedWord,
} from "../lib/idb";
import { loadUseAi } from "../lib/ai-pref";
import {
  emptyLearnExposure,
  LEARN_EXPOSURE_KEY,
  parseLearnExposure,
  type LearnExposure,
} from "../lib/learn";
import { backfillWordMeanings } from "../lib/word-meanings";

export type UseNotebookDataResult = {
  /** null mientras carga. */
  words: SavedWord[] | null;
  setWords: React.Dispatch<React.SetStateAction<SavedWord[] | null>>;
  /** Copia al día de `words` para los manejadores asíncronos (calificar). */
  wordsRef: React.RefObject<SavedWord[] | null>;
  loadError: boolean;
  /** Preferencia «Usar IA» (Cuenta): una lectura al abrir el cuaderno. */
  useAi: boolean;
  knowledge: KnownWord[];
  setKnowledge: React.Dispatch<React.SetStateAction<KnownWord[]>>;
  exposure: LearnExposure;
  setExposure: React.Dispatch<React.SetStateAction<LearnExposure>>;
  /** Avisa al padre tras cada mutación local para que el globo de pendientes se actualice. */
  notifyVocabChange: () => void;
};

export function useNotebookData({
  vocabVersion,
  onVocabChange,
}: {
  vocabVersion?: number;
  onVocabChange?: () => void;
}): UseNotebookDataResult {
  const [words, setWords] = useState<SavedWord[] | null>(null);
  // Copia al día de `words` para los manejadores asíncronos (calificar):
  // la cola guarda la palabra de cuando se armó y no debe pisar lo posterior.
  const wordsRef = useRef<SavedWord[] | null>(null);
  useEffect(() => {
    wordsRef.current = words;
  }, [words]);
  const [loadError, setLoadError] = useState(false);
  // Apagada, los modos que llaman al generador (contexto, oración nueva) lo
  // avisan y la corrección de «escribir» no se ofrece.
  const [useAi, setUseAi] = useState(true);
  // Conocimiento vigente (excluye lo ya conocido de la cola y del repaso) y
  // exposiciones registradas.
  const [knowledge, setKnowledge] = useState<KnownWord[]>([]);
  const [exposure, setExposure] = useState<LearnExposure>(emptyLearnExposure());

  const notifyVocabChange = useCallback(() => {
    onVocabChange?.();
  }, [onVocabChange]);

  useEffect(() => {
    let cancelled = false;
    const scope = captureDbScope();
    void listSavedWords(undefined, scope)
      .then(async (list) => {
        const sorted = list.sort((a, b) => b.savedAt - a.savedAt);
        if (cancelled) return;
        setWords(sorted);
        // Guardadas sin significado: el catálogo puede tener ficha
        // ya (Wikcionario o una definición IA posterior al guardado);
        // rellenarlas habilita los repasos por significado.
        const merged = await backfillWordMeanings(sorted, {}, scope).catch(
          () => null,
        );
        if (!cancelled && merged) {
          // El relleno trabaja sobre la lista de cuando empezó: si mientras
          // tanto se calificó o editó una palabra, gana la fila más nueva.
          const byKey = new Map(merged.map((w) => [w.key, w]));
          setWords((prev) =>
            prev
              ? prev.map((w) => {
                  const m = byKey.get(w.key);
                  return m && (m.updatedAt ?? 0) >= (w.updatedAt ?? 0) ? m : w;
                })
              : merged,
          );
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    void loadUseAi(scope).then((on) => {
      if (!cancelled) setUseAi(on);
    });
    void listKnowledge(undefined, scope).then((list) => {
      if (!cancelled) setKnowledge(list);
    }).catch(() => {
      /* sin evidencia cargada la cola de Aprender no excluye nada */
    });
    void loadSessionValue(LEARN_EXPOSURE_KEY, scope).then((raw) => {
      if (!cancelled) setExposure(parseLearnExposure(raw));
    }).catch(() => {
      /* sin registro previo: cola completa */
    });
    return () => {
      cancelled = true;
    };
    // vocabVersion: el padre avisa cuando el vocabulario cambia fuera
    // (lector, sync, calibración) y el cuaderno abierto se recarga.
  }, [vocabVersion]);

  return {
    words,
    setWords,
    wordsRef,
    loadError,
    useAi,
    knowledge,
    setKnowledge,
    exposure,
    setExposure,
    notifyVocabChange,
  };
}
