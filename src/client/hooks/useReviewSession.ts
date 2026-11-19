// Hook extraído de Vocabulary.tsx (Fase 5, V1): la sesión de repaso y los
// modos libres — armar la cola, mostrar y calificar cada ejercicio (FSRS +
// historial), «escribir» con revisión de IA, parejas, pistas del gato, el
// rescate tras fallar y el cierre de sesión. Pregunta solo por palabras de
// reviewWords (ya presentadas y vencidas).
import { useEffect, useRef, useState } from "react";
import {
  Rating,
  scheduleReview,
  type Card,
  type Grade,
} from "../lib/fsrs";
import {
  captureDbScope,
  updateSavedWord,
  type SavedWord,
} from "../lib/idb";
import {
  answerItem,
  batchLookup,
  explainInContext,
  fetchItems,
  verifySentence,
} from "../lib/lexicon";
import {
  REVIEW_SESSION_SIZE,
} from "../lib/learn";
import { pushWordsToServer } from "../lib/vocab";
import { recordReview } from "../lib/reviews";
import {
  findEpisodicHighlightRange,
  renderHighlightedContext,
} from "../lib/word-highlight";
import {
  blankWordInContext,
  buildAdaptivePracticeQueue,
  conciseMeaning,
  EXERCISE_RATING,
  pickDistractors,
  ratingToCorrect,
  rescueChallenge,
  shuffleStable,
} from "../lib/practice";
import {
  type PracticeMode,
  type QueueItem,
  EXERCISE_MODES,
  MATCH_TANDA,
  mapMode,
  ratingString,
  seedFor,
  GRADES,
  clozeTextFor,
  isEligible,
  isPlusOnlyMode,
  VERIFY_PLAN_REQUIRED,
} from "../lib/notebook-model";


// consumen por esta vía histórica.
export { findEpisodicHighlightRange, renderHighlightedContext };
export { getStabilitySegments, safeStability } from "../lib/notebook-model";
import { formatInterval } from "../lib/relative-time";
import { triggerHaptic, triggerPurrHaptic } from "../lib/haptics";
import { playCompanionSound } from "../lib/companion-audio";
import { loadNativeLanguage } from "../lib/settings";

import type { UsePracticeCompanionResult } from "./usePracticeCompanion";
import type { CompanionPose } from "../components/Companion";

// Modos con opciones: el resultado se ve al tocar una opción (answerOption) y
// la pose de resultado se mantiene hasta el cambio de reto.
const OPTION_MODES: ReadonlySet<PracticeMode> = new Set(["choose", "sense", "context"]);
// Modos donde `grade` es el que muestra el resultado: autocalificación y
// «Escribir». En el resto (opciones, parejas, minijuegos) la racha, la pose y
// la frase ya las puso quien mostró el resultado, y `grade` no las repite.
const GRADE_REACTS: ReadonlySet<PracticeMode> = new Set([
  "meaning",
  "form",
  "cloze",
  "clozeNew",
  "write",
]);
const PET_PHRASES = ["Prrr…", "¡Mrrau!", "Aquí sigo contigo."];
import { useUserPlan } from "../lib/account-plan";

export type UseReviewSessionArgs = {
  /** Cola de repaso: ya presentadas, vencidas y no conocidas (ver reviewQueue). */
  reviewWords: SavedWord[];
  scopedWords: SavedWord[];
  /** Todas las palabras (para distractores). */
  all: SavedWord[];
  retentionCheckCandidates: SavedWord[];
  useAi: boolean;
  /** Hay sesión + «Usar IA»: se ofrece la pista del gato. */
  canHint: boolean;
  setWords: React.Dispatch<React.SetStateAction<SavedWord[] | null>>;
  wordsRef: React.RefObject<SavedWord[] | null>;
  notifyVocabChange: () => void;
  setSaveError: (message: string) => void;
  practiceCompanion: UsePracticeCompanionResult;
};

export function useReviewSession({
  reviewWords,
  scopedWords,
  all,
  retentionCheckCandidates,
  useAi,
  canHint,
  setWords,
  wordsRef,
  notifyVocabChange,
  setSaveError,
  practiceCompanion,
}: UseReviewSessionArgs) {
  const {
    combo,
    setCatPose,
    setCatSpeech,
    setCombo,
    settleCatAfter,
    resultPose,
    setResultPose,
    resetCat,
  } = practiceCompanion;
  const [queue, setQueue] = useState<{ total: number; items: QueueItem[] } | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [previews, setPreviews] = useState<string[] | null>(null);
  const [grading, setGrading] = useState(false);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  // Ejercicios con opciones: la opción tocada y si fue acierto.
  const [answered, setAnswered] = useState<{ picked: string; correct: boolean } | null>(null);
  // «Escribir»: el texto del usuario, el veredicto de la IA (si hay
  // sesión) y la autocalificación elegida o precargada por la IA.
  const [writeText, setWriteText] = useState("");
  const [writePick, setWritePick] = useState<"good" | "again" | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{
    correct: boolean;
    feedback: string;
  } | null>(null);
  const [verifyError, setVerifyError] = useState("");
  // Tarjeta a la que pertenece la revisión IA en vuelo: si la cola
  // avanzó o se cerró antes de la respuesta, el veredicto se descarta.
  const writeItemRef = useRef<QueueItem | null>(null);
  // Parejas: forma seleccionada, pares resueltos y fallos por forma.
  const [matchSel, setMatchSel] = useState<string | null>(null);
  const [matchDone, setMatchDone] = useState<Set<string>>(new Set());
  const [matchFails, setMatchFails] = useState<Record<string, number>>({});
  const [matchFlash, setMatchFlash] = useState<string | null>(null);
  // Aviso suave cuando un modo no puede armar su cola (p. ej. acepciones sin conexión).
  const [practiceNote, setPracticeNote] = useState("");
  const userPlan = useUserPlan();
  // La tarjeta candidata de cada calificación se calcula una sola vez al
  // revelar: el botón guarda exactamente lo que su intervalo anuncia.
  const candidates = useRef<Map<Grade, Card> | null>(null);
  const gradingRef = useRef(false);
  const matchFlashTimer = useRef<number | undefined>(undefined);
  const revealButtonRef = useRef<HTMLButtonElement>(null);
  const firstGradeRef = useRef<HTMLButtonElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const writeAreaRef = useRef<HTMLTextAreaElement>(null);
  const [hintText, setHintText] = useState<string | null>(null);
  const [hintBusy, setHintBusy] = useState(false);
  // Palabra a la que pertenece la pista en vuelo (si la cola avanza antes de
  // la respuesta, se descarta) y pistas pedidas en la tarjeta actual: viajan
  // al historial como `hints` del repaso.
  const hintForRef = useRef<string | null>(null);
  const hintsUsedRef = useRef(0);
  // Espejo de hintsUsedRef para pintar: el botón «💡 Pista» se oculta cuando
  // el reto actual ya pidió su pista (una por reto).
  const [hintUsed, setHintUsed] = useState(false);
  // Un fallo en el reto actual (también antes de un rescate a un modo más
  // fácil): el acierto posterior ya no es recuperación y se califica Again.
  const missedRef = useRef(false);
  const petIndexRef = useRef(0);

  const resetExercise = () => {
    setRevealed(false);
    setPreviews(null);
    setSaveError("");
    setAnswered(null);
    setHintText(null);
    setHintBusy(false);
    hintForRef.current = null;
    hintsUsedRef.current = 0;
    missedRef.current = false;
    setHintUsed(false);
    setMatchSel(null);
    setMatchDone(new Set());
    setMatchFails({});
    setMatchFlash(null);
    setWriteText("");
    setWritePick(null);
    setVerifyResult(null);
    setVerifyError("");
    setVerifying(false);
    writeItemRef.current = null;
    candidates.current = null;
  };

  const beginQueue = (items: QueueItem[]) => {
    setQueue({ total: items.length, items });
    setFinishedAt(null);
    resetExercise();
  };

  // «Terminar por hoy» pasa por el mismo cierre que vaciar la cola: si ya se
  // repasó algo se muestra «Terminado por hoy.» con la próxima fecha y la
  // racha; si no se hizo nada, vuelve al cuaderno sin pantalla de cierre.
  // `extra` cuenta el reto que exitSession acaba de calificar: la cola de este
  // render todavía no refleja que grade lo quitó.
  const endSessionForToday = (now: number, extra = 0) => {
    const reviewed = (queue ? queue.total - queue.items.length : 0) + extra;
    resetCat();
    if (reviewed <= 0) {
      setQueue(null);
      return;
    }
    setQueue({ total: reviewed, items: [] });
    setFinishedAt(now);
    resetExercise();
  };

  // «Acepción» necesita la ficha completa de cada palabra guardada
  // con acepción; sin conexión o con menos de dos acepciones la
  // palabra no entra en la cola (elegibilidad honesta, no error).
  const buildSenseItems = async (): Promise<QueueItem[]> => {
    const candidates = reviewWords.filter((word) => word.senseEntryId != null);
    if (!candidates.length) return [];
    const languages = [...new Set(candidates.map((word) => word.language || "es"))];
    const results = await Promise.all(
      languages.map((lang) =>
        batchLookup(
          candidates
            .filter((word) => (word.language || "es") === lang)
            .map((word) => word.form),
          lang,
        ),
      ),
    );
    const items: QueueItem[] = [];
    results.forEach((result, index) => {
      if (!result.ok) return;
      const lang = languages[index];
      for (const word of candidates) {
        if ((word.language || "es") !== lang) continue;
        // El catálogo clavea por la forma en minúsculas.
        const entries =
          result.entries[word.form.toLowerCase()] ?? result.entries[word.form] ?? [];
        // senseEntryId ya viaja como string; String() cubre las filas
        // locales viejas que lo guardaron como number truncado.
        const entry = entries.find(
          (item) => item.entryId != null && item.entryId === String(word.senseEntryId),
        );
        if (!entry || entry.senses.length < 2) continue;
        // La acepción correcta se reconoce por senseOrder; si falta en
        // alguno de los dos lados se iguala por la definición guardada.
        const correctIndex = entry.senses.findIndex((sense) => {
          if (word.senseOrder != null && sense.senseOrder != null)
            return sense.senseOrder === word.senseOrder;
          return word.meaning != null && sense.definition === word.meaning;
        });
        if (correctIndex < 0) continue;
        items.push({ word, mode: "sense", entry, correctIndex });
      }
    });
    return items;
  };

  // «Contexto» y «oración nueva» (modos B) ejercitan la acepción
  // guardada con un ítem del catálogo: una oración nueva con opciones,
  // generada con IA. fetchItems sirve los que ya existen y manda a
  // generar los que falten (hasta 8 por llamada), así que una cola
  // vacía suele significar «aún no están listos» más que un error.
  const buildItemItems = async (mode: "context" | "clozeNew"): Promise<QueueItem[]> => {
    const candidates = reviewWords.filter(
      (word) => word.senseEntryId != null && word.senseOrder != null,
    );
    if (!candidates.length) return [];
    // Refs únicas: varias palabras pueden apuntar a la misma acepción.
    const refs = [
      ...new Map(
        candidates.map((word) => [
          `${word.senseEntryId}:${word.senseOrder}`,
          { entryId: String(word.senseEntryId), senseOrder: word.senseOrder! },
        ]),
      ).values(),
    ];
    const result = await fetchItems(refs, captureDbScope());
    if (!result.ok) return [];
    const itemByRef = new Map(
      result.items.map((item) => [`${item.entryId}:${item.senseOrder}`, item]),
    );
    const items: QueueItem[] = [];
    for (const word of candidates) {
      const item = itemByRef.get(`${word.senseEntryId}:${word.senseOrder}`);
      if (!item) continue;
      // En «oración nueva» el hueco se abre sobre la forma literal: si
      // la IA conjugó la palabra de otra manera no se puede ejercitar.
      if (
        mode === "clozeNew" &&
        !blankWordInContext(item.sentence, word.form, word.language)
      )
        continue;
      items.push({ word, mode, item });
    }
    return items;
  };

  const startPractice = async (chosen: PracticeMode) => {
    setPracticeNote("");
    // Lecta+ (docs/designs/2026-11-12-planes-y-landing.md): en free solo Acepción,
    // Contexto y Oración nueva quedan fuera; «Repasar» no pasa por aquí.
    if (userPlan?.plan === "free" && isPlusOnlyMode(chosen)) {
      setPracticeNote("Este modo es de Lecta+.");
      return;
    }
    // Con la IA apagada estos modos no pueden armar cola (fetchItems
    // sirve ítems generados con IA): se avisa y no se llama.
    if ((chosen === "context" || chosen === "clozeNew") && !useAi) {
      setPracticeNote(
        "Los ejercicios Contexto y Oración nueva usan IA; actívala en Cuenta.",
      );
      return;
    }
    const items =
      chosen === "sense"
        ? await buildSenseItems()
        : chosen === "context" || chosen === "clozeNew"
          ? await buildItemItems(chosen)
          : reviewWords
              .filter((word) => isEligible(word, chosen))
              .map((word) => ({ word, mode: chosen }));
    if (!items.length) {
      if (chosen === "sense")
        setPracticeNote(
          "Ahora no se pudieron cargar las acepciones. Prueba otro modo o intenta más tarde.",
        );
      else if (chosen === "context" || chosen === "clozeNew")
        setPracticeNote(
          "No hay ejercicios de este tipo todavía; se generan con IA y tardan un poco. Vuelve a intentarlo.",
        );
      return;
    }
    let queueItems = items;
    if (chosen === "match") {
      // Una tanda de parejas pide al menos dos: con una sola palabra el par
      // se resolvería solo y contaría como acierto.
      if (items.length < 2) {
        setPracticeNote("Parejas necesita al menos dos palabras con significado.");
        return;
      }
      // La cola va en tandas de MATCH_TANDA: si sobraría una suelta, se deja
      // fuera de esta ronda en vez de convertirla en una tanda de una.
      if (items.length % MATCH_TANDA === 1) queueItems = items.slice(0, -1);
    }
    beginQueue(queueItems);
  };


  // `onlyKeys` sirve al puente «Repasar estas N palabras» de la ficha.
  const startAdaptiveFlow = (onlyKeys?: ReadonlySet<string>) => {
    setPracticeNote("");
    const pool = onlyKeys
      ? reviewWords.filter((word) => onlyKeys.has(word.key))
      : reviewWords;
    const candidates = pool.slice(0, REVIEW_SESSION_SIZE);
    if (!candidates.length) {
      if (onlyKeys) setPracticeNote("Esas palabras todavía no toca repasarlas.");
      return;
    }

    const challenges = buildAdaptivePracticeQueue(candidates, {
      pool: scopedWords,
      useAi,
      hasConnection: typeof navigator !== "undefined" ? navigator.onLine : true,
    });

    const queueItems: QueueItem[] = [];
    for (const ch of challenges) {
      let mode: PracticeMode;
      switch (ch.mechanic) {
        case "contextual_cloze":
          mode = "choose";
          break;
        case "syllable_scramble":
          mode = "scramble";
          break;
        case "phrase_weaver":
          mode = "syntax";
          break;
        case "grammar_nuance":
          mode = "grammar";
          break;
        case "ai_sentence_craft":
          mode = "write";
          break;
        default:
          mode = "choose";
      }
      // La mecánica se elige por estabilidad, no por datos disponibles: una
      // palabra sin oración no puede ir a choose (sería adivinar al 25 %) y
      // una sin significado no puede ir a los modos que la piden.
      if (!isEligible(ch.word, mode)) {
        if (isEligible(ch.word, "choose")) mode = "choose";
        else if (ch.word.meaning) mode = "meaning";
        else continue;
      }
      queueItems.push({ word: ch.word, mode, adaptiveChallenge: ch });
    }

    if (!queueItems.length) {
      setPracticeNote(
        "Estas palabras necesitan una oración o un significado para repasarse.",
      );
      return;
    }
    beginQueue(queueItems);
  };

  // «Partida rápida» pregunta igual que la sesión: solo palabras vencidas que
  // ya pasaron por la ficha, y el modo que la palabra puede cumplir.
  const handleQuickGame = (targetWord: SavedWord) => {
    triggerHaptic("selection");
    setPracticeNote("");
    setSaveError("");
    // Sin oración ni significado no hay nada que mostrar: «Palabra» pintaría
    // una tarjeta en blanco, así que no se arma la partida.
    if (!isEligible(targetWord, "choose") && !targetWord.meaning) {
      setSaveError("Esta palabra necesita un significado o una oración para repasarse.");
      return;
    }
    const targetMode: PracticeMode = isEligible(targetWord, "choose")
      ? "choose"
      : "meaning";
    const others = reviewWords
      .filter((w) => w.key !== targetWord.key && isEligible(w, targetMode))
      .slice(0, 4);
    const items: QueueItem[] = [
      { word: targetWord, mode: targetMode },
      ...others.map((w) => ({ word: w, mode: targetMode })),
    ];
    beginQueue(items);
  };

  // El Reto del Escritor del taller IA: superar la oración cuenta como
  // repaso real de la palabra (tarjeta FSRS + historial), no como
  // juego suelto. Solo palabras ya expuestas pueden llegar aquí: el
  // taller se alimenta de reviewWords.
  const startRetentionCheck30d = () => {
    if (!retentionCheckCandidates.length) return;
    setPracticeNote("");
    setSaveError("");
    // Cada palabra entra con un modo que puede cumplir; sin oración ni
    // significado no hay tarjeta que mostrar y se omite.
    const items: QueueItem[] = retentionCheckCandidates.flatMap((word) => {
      const mode: PracticeMode | null = isEligible(word, "cloze")
        ? "cloze"
        : isEligible(word, "choose")
          ? "choose"
          : word.meaning
            ? "form"
            : null;
      return mode ? [{ word, mode }] : [];
    });
    if (!items.length) {
      setSaveError("Esas palabras necesitan un significado o una oración para repasarse.");
      return;
    }
    beginQueue(items);
  };


  const reveal = () => {
    const current = queue?.items[0];
    if (!current) return;
    const now = new Date();
    candidates.current = new Map(
      GRADES.map(({ rating }) => [rating, scheduleReview(current.word.card, rating, now)]),
    );
    setPreviews(
      GRADES.map(({ rating }) =>
        formatInterval(
          Math.max(0, (candidates.current?.get(rating)?.due.getTime() ?? 0) - now.getTime()),
        ),
      ),
    );
    setRevealed(true);
  };

  // Devuelve true si guardó la calificación; false si otra calificación estaba
  // en curso o si el guardado falló (saveError ya lo explica).
  const grade = async (item: QueueItem, requested: Grade): Promise<boolean> => {
    // Bloqueo inmediato: un doble clic o dos teclas no avanzan dos tarjetas.
    if (gradingRef.current) return false;
    const rating: Grade = missedRef.current ? Rating.Again : requested;
    gradingRef.current = true;
    setGrading(true);
    setSaveError("");
    try {
      const scope = captureDbScope();
      const { word: queued } = item;
      // La cola guarda la copia de cuando se armó: si entre tanto llegó un
      // significado (relleno del catálogo) o el taller acreditó la palabra,
      // se guarda sobre la versión vigente y no se pisa con la vieja.
      const word =
        wordsRef.current?.find((w) => w.key === queued.key && !w.deleted) ?? queued;
      const card = candidates.current?.get(rating) ?? scheduleReview(word.card, rating);
      const stored = await updateSavedWord({ ...word, card }, scope);
      void pushWordsToServer([stored], scope);
      // El repaso queda en el historial anexable: qué modo se hizo y
      // cómo se calificó. No bloquea el avance de la cola.
      void recordReview(
        {
          language: word.language,
          form: word.form,
          kind: mapMode(item.mode),
          rating: ratingString(rating),
          hints: hintsUsedRef.current,
        },
        scope,
      ).catch(() => {
        /* el historial es auxiliar; no deshace la calificación */
      });
      // «Oración nueva» se autocalifica con la escala completa, pero al
      // ítem del catálogo solo le importa el acierto: Again es fallo y
      // el resto (difícil/bien/fácil) cuenta como acierto.
      if (item.mode === "clozeNew" && item.item)
        void answerItem(item.item.id, ratingToCorrect(rating), scope);

      if (GRADE_REACTS.has(item.mode)) {
        if (ratingToCorrect(rating)) {
          const next = combo + 1;
          setCombo(next);
          setCatPose(next >= 3 ? "playful_hop" : "celebrate");
          setCatSpeech(
            next >= 3
              ? `¡Imparable! Racha de ${next} aciertos`
              : rating === Rating.Easy
                ? "¡Excelente trabajo!"
                : "¡Muy bien!",
          );
          triggerHaptic("success");
          triggerPurrHaptic();
          playCompanionSound("purr");
        } else {
          setCombo(0);
          setCatPose("pet");
          setCatSpeech(`Era «${item.word.form}».`);
          triggerHaptic(rating === Rating.Again ? 8 : 12);
        }
        settleCatAfter(2200);
      } else if (OPTION_MODES.has(item.mode)) {
        // La pose de resultado duraba lo que el reto: al avanzar se limpia.
        resetCat();
      }

      setWords((list) => list?.map((w) => (w.key === word.key ? stored : w)) ?? list);
      notifyVocabChange();
      setQueue((current) => {
        if (!current) return current;
        if (current.items.length === 1) setFinishedAt(Date.now());
        return { ...current, items: current.items.slice(1) };
      });
      setRevealed(false);
      setPreviews(null);
      setAnswered(null);
      setHintText(null);
      setHintBusy(false);
      hintForRef.current = null;
      hintsUsedRef.current = 0;
      missedRef.current = false;
      setHintUsed(false);
      setWriteText("");
      setWritePick(null);
      setVerifyResult(null);
      setVerifyError("");
      writeItemRef.current = null;
      candidates.current = null;
      return true;
    } catch {
      setSaveError("No se pudo guardar la calificación. Intenta de nuevo.");
      return false;
    } finally {
      gradingRef.current = false;
      setGrading(false);
    }
  };

  // Frase del gato al fallar una opción: nombra la respuesta correcta.
  const wrongAnswerSpeech = (item: QueueItem): string => {
    if (item.mode === "choose") return `Era «${item.word.form}». La próxima la tienes.`;
    const options =
      item.mode === "context"
        ? (item.item?.options ?? [])
        : (item.entry?.senses ?? []).map((sense) => sense.definition);
    const answer = item.mode === "context" ? item.item?.answerIndex : item.correctIndex;
    const text = answer != null ? options[answer] : undefined;
    return text ? `Era «${conciseMeaning(text, 60)}».` : "¡Ánimo! Vamos con la siguiente.";
  };

  // Ejercicios con opciones («elegir palabra», «acepción», «contexto»):
  // al tocar una opción se anota el resultado y se muestra cuál era
  // correcta; «Continuar» aplica la calificación (acierto = Hard,
  // fallo = Again).
  const answerOption = (picked: string, correct: boolean) => {
    const item = queue?.items[0];
    if (!item || answered) return;
    triggerHaptic(correct ? 14 : 24);
    setAnswered({ picked, correct });
    // Racha en un solo punto: aquí, donde el lector ve el resultado; grade no
    // la vuelve a sumar en los modos con opciones. La pose se mantiene
    // mientras dure el reto (sin temporizador).
    let pose: CompanionPose;
    if (correct) {
      const next = combo + 1;
      setCombo(next);
      pose = next >= 3 ? "playful_hop" : "celebrate";
      setCatSpeech(next >= 3 ? `¡En racha! x${next}` : "¡Exacto!");
      triggerPurrHaptic();
      playCompanionSound("purr");
    } else {
      setCombo(0);
      pose = "pet";
      setCatSpeech(wrongAnswerSpeech(item));
    }
    setCatPose(pose);
    setResultPose(pose);
    // Los ejercicios con ítem del catálogo («contexto») también anotan
    // el intento en su estadística editorial; no bloquea el repaso.
    // El repaso lo registra `grade` al confirmar con «Continuar»: un
    // solo evento por ejercicio.
    const scope = captureDbScope();
    if (item.item) void answerItem(item.item.id, correct, scope);
  };

  // «Escribir» con sesión: la IA revisa la oración (solo viajan la
  // forma, el significado y el texto escrito, nunca el contexto del
  // libro) y su veredicto precarga la autocalificación; si falla, el
  // error se muestra y el lector se califica igual por su cuenta.
  const checkWriteSentence = async () => {
    const item = queue?.items[0];
    const sentence = writeText.trim();
    if (!item || !sentence || verifying) return;
    setVerifying(true);
    setVerifyResult(null);
    setVerifyError("");
    writeItemRef.current = item;
    const result = await verifySentence(
      item.word.form,
      item.word.meaning ?? "",
      sentence,
      captureDbScope(),
      item.word.language,
      loadNativeLanguage(),
    );
    // Si la tarjeta ya no es la misma (la cola avanzó o se cerró),
    // el veredicto tardío se descarta.
    if (writeItemRef.current !== item) return;
    setVerifying(false);
    if (!result.ok) {
      setVerifyError(result.planRequired ? VERIFY_PLAN_REQUIRED : result.error);
      return;
    }
    setVerifyResult({ correct: result.correct, feedback: result.feedback });
    setWritePick(result.correct ? "good" : "again");
  };

  // Parejas: tocar significado tras elegir una forma. El acierto
  // resuelve el par; el error flashea la opción y cuenta fallo de la
  // forma elegida. Al resolver la tanda se califica cada palabra.
  const pickMeaning = (meaningKey: string) => {
    if (!queue || !matchSel || matchDone.has(meaningKey)) return;
    const tanda = queue.items.slice(0, MATCH_TANDA);
    if (meaningKey === matchSel) {
      triggerPurrHaptic();
      playCompanionSound("purr");
      const nextDone = new Set(matchDone).add(meaningKey);
      setMatchDone(nextDone);
      setMatchSel(null);
      const next = combo + 1;
      setCombo(next);
      setCatPose(next >= 3 ? "playful_hop" : "celebrate");
      setCatSpeech(
        nextDone.size === tanda.length
          ? "¡Tanda de parejas completada con éxito!"
          : next >= 3
            ? `¡Parejas en racha! x${next}`
            : "¡Pareja encontrada!",
      );
      settleCatAfter(2200);
      if (tanda.length > 0 && nextDone.size === tanda.length)
        void finishMatchTanda(tanda, matchFails);
    } else {
      setCombo(0);
      setCatPose("pet");
      setCatSpeech("Esa no. Prueba otra.");
      settleCatAfter(2200);
      setMatchFails((fails) => ({ ...fails, [matchSel]: (fails[matchSel] ?? 0) + 1 }));
      setMatchFlash(meaningKey);
      window.clearTimeout(matchFlashTimer.current);
      matchFlashTimer.current = window.setTimeout(() => setMatchFlash(null), 700);
    }
  };

  const finishMatchTanda = async (tanda: QueueItem[], fails: Record<string, number>) => {
    for (const item of tanda) {
      const wrongs = fails[item.word.key] ?? 0;
      // grade() avanza la cola de a un item y registra el repaso (kind
      // «match»): la tanda respeta el orden y no duplica el evento.
      const saved = await grade(item, wrongs ? EXERCISE_RATING.wrong : EXERCISE_RATING.correct);
      // Si un guardado falla se corta la tanda: el resto sigue vencido.
      if (!saved) break;
    }
    setMatchSel(null);
    setMatchDone(new Set());
    setMatchFails({});
    setMatchFlash(null);
  };


  // Foco a la acción siguiente: al revelar → primera calificación;
  // al responder una opción o autocalificar en «escribir» → «Continuar»;
  // al avanzar → «Mostrar respuesta» (o el textarea en «escribir»).
  const current = queue?.items[0];
  const currentKey = current?.word.key;
  const currentMode = current?.mode;
  // `preventScroll`: enfocar no debe desplazar la página (el salto al responder).
  useEffect(() => {
    const opts = { preventScroll: true };
    if (revealed) firstGradeRef.current?.focus(opts);
    else if (answered || writePick) continueRef.current?.focus(opts);
    else if (currentMode === "write") writeAreaRef.current?.focus(opts);
    else if (currentKey) revealButtonRef.current?.focus(opts);
  }, [revealed, answered, writePick, currentKey, currentMode]);


  // Rescate tras fallar un reto de nivel > 1: baja a un ejercicio más amable.
  // «Elegir palabra» solo si la palabra tiene oración donde abrir el hueco
  // (sin ella es adivinar entre cuatro); si no, «Significado»; y si tampoco
  // hay significado no se rescata y el reto se reintenta como estaba.
  const tryRescue = (item: QueueItem, speech: string): boolean => {
    missedRef.current = true;
    const challenge = item.adaptiveChallenge;
    if (!challenge || challenge.level <= 1) return false;
    const rescueMode: PracticeMode | null = isEligible(item.word, "choose")
      ? "choose"
      : item.word.meaning
        ? "meaning"
        : null;
    if (!rescueMode) return false;
    const rescued = rescueChallenge(challenge, scopedWords);
    setQueue((prev) => {
      if (!prev) return prev;
      const nextItems = [...prev.items];
      nextItems[0] = { ...item, mode: rescueMode, adaptiveChallenge: rescued };
      return { ...prev, items: nextItems };
    });
    setCatPose("greet");
    setCatSpeech(rescueMode === "choose" ? speech : "¡Tranquilo! Probemos con el significado.");
    setHintText(rescued.hint ?? null);
    setCombo(0);
    return true;
  };

  // Una pista por reto: el gato, el botón «💡 Pista» y los minijuegos pasan por
  // aquí. Una pista de rescate (tryRescue) no cuenta. «Escribir» no pide pista.
  const askCatHint = () => {
    if (!current || hintBusy || !canHint) return;
    if (hintsUsedRef.current > 0 || current.mode === "write") return;
    const forKey = current.word.key;
    hintForRef.current = forKey;
    hintsUsedRef.current += 1;
    setHintUsed(true);
    setHintBusy(true);
    setCatSpeech("Pensando en una pista…");
    const scope = captureDbScope();
    // Si la cola ya avanzó, la respuesta tardía no se pinta sobre otra tarjeta.
    const stillHere = () => hintForRef.current === forKey;
    void explainInContext(current.word.form, current.word.language, current.word.context, scope, loadNativeLanguage())
      .then((res) => {
        if (!stillHere()) return;
        if (res.ok && res.explanation) {
          setHintText(res.explanation);
          setCatSpeech("¡Aquí tienes una pista!");
          setCatPose("greet");
        } else {
          const fallback = current.word.meaning
            ? `Significado: «${current.word.meaning.slice(0, 50)}…»`
            : "Intenta recordar el pasaje del libro.";
          setHintText(fallback);
          setCatSpeech("Pista del cuaderno");
        }
      })
      .catch(() => {
        if (!stillHere()) return;
        const fallback = current.word.meaning
          ? `Significado: «${current.word.meaning.slice(0, 50)}…»`
          : "Intenta recordar el pasaje del libro.";
        setHintText(fallback);
        setCatSpeech("Pista del cuaderno");
      })
      .finally(() => {
        if (stillHere()) setHintBusy(false);
      });
  };

  // Caricia: pose «pet» y vuelta a la pose de resultado del reto.
  const pet = () => {
    setCatPose("pet");
    setCatSpeech(PET_PHRASES[petIndexRef.current % PET_PHRASES.length]);
    petIndexRef.current += 1;
    settleCatAfter(1200, resultPose);
  };

  // Toque al gato: el primero de cada reto pide la pista si la hay y aún no se
  // respondió; el resto, y todos sin pista posible, son una caricia.
  const catTap = () => {
    if (
      current &&
      !answered &&
      !writePick &&
      current.mode !== "write" &&
      canHint &&
      !hintUsed &&
      !hintBusy
    ) {
      askCatHint();
      return;
    }
    pet();
  };

  // «Terminar por hoy» desde la cabecera: califica la respuesta pendiente
  // (opción tocada o autocalificación de «Escribir») y cierra. Si el guardado
  // falla, la sesión sigue y saveError lo explica.
  const exitSession = async () => {
    if (gradingRef.current) return;
    const item = queue?.items[0];
    let extra = 0;
    if (item && (answered || writePick)) {
      const rating = answered
        ? answered.correct
          ? EXERCISE_RATING.correct
          : EXERCISE_RATING.wrong
        : writePick === "good"
          ? Rating.Good
          : Rating.Again;
      const saved = await grade(item, rating);
      if (!saved) return;
      extra = 1;
    }
    endSessionForToday(Date.now(), extra);
  };


  const cloze = current ? clozeTextFor(current.word) : null;
  // «Oración nueva» oculta la forma en la oración del ítem del
  // catálogo; la cola ya descartó las que no dan hueco, así que aquí
  // solo falta recomputar el texto para mostrarlo.
  const clozeNewText =
    current?.mode === "clozeNew" && current.item
      ? blankWordInContext(current.item.sentence, current.word.form, current.word.language)
      : null;
  // «Contexto» y «acepción» comparten opciones indexadas (definiciones
  // de la acepción): el índice correcto viene del ítem o de la ficha.
  const senseLikeOptions =
    current?.mode === "context"
      ? (current.item?.options ?? [])
      : current?.mode === "sense"
        ? (current.entry?.senses ?? []).map((sense) => sense.definition)
        : [];
  const senseLikeAnswer =
    current?.mode === "context" ? current.item?.answerIndex : current?.correctIndex;
  const done = queue ? queue.total - queue.items.length : 0;

  // «Elegir palabra»: la forma correcta más tres distractores del
  // cuaderno, mezclados con semilla estable por palabra. El pool se limita
  // al idioma de la palabra: una opción en otro idioma se descarta sin leer.
  const choiceOptions =
    current?.mode === "choose"
      ? shuffleStable(
          [
            current.word,
            ...pickDistractors(
              current.word,
              all.filter(
                (w) => (w.language || "es") === (current.word.language || "es"),
              ),
              3,
            ),
          ],
          seedFor(current.word.key),
        )
      : [];

  // Espacio revela la respuesta; 1–4 califican una vez revelada.
  useEffect(() => {
    if (!queue) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable]")
      )
        return;
      const current = queue.items[0];
      if (!current) return;
      // Modos con opciones: las teclas 1–9 eligen la opción en esa posición.
      // Con la opción ya respondida no hacen nada (no se responde dos veces).
      if (OPTION_MODES.has(current.mode)) {
        if (answered) return;
        const index = Number(event.key) - 1;
        if (!Number.isInteger(index) || index < 0 || index > 8) return;
        if (current.mode === "choose") {
          const option = choiceOptions[index];
          if (!option) return;
          event.preventDefault();
          answerOption(option.key, option.key === current.word.key);
        } else {
          if (index >= senseLikeOptions.length) return;
          event.preventDefault();
          answerOption(String(index), index === senseLikeAnswer);
        }
        return;
      }
      // El resto de modos de ejercicio se responden con sus botones;
      // las teclas de autovaloración no aplican.
      if (EXERCISE_MODES.has(current.mode)) return;
      if (event.key === " " && !revealed) {
        if (target instanceof HTMLElement && target.closest("button")) return;
        event.preventDefault();
        reveal();
        return;
      }
      const match = GRADES.find((item) => item.key === event.key);
      if (match && revealed) {
        event.preventDefault();
        void grade(current, match.rating);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // grade/reveal se releen de closures actuales en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, revealed, answered]);

  // «Parejas»: la tanda vigente (hasta 4) y las dos columnas mezcladas.
  const tanda =
    current?.mode === "match" ? (queue?.items.slice(0, MATCH_TANDA) ?? []) : [];
  const tandaSeed = seedFor(tanda.map((item) => item.word.key).join("|"));
  const matchLeft = shuffleStable(tanda, tandaSeed);
  const matchRight = shuffleStable(tanda, tandaSeed ^ 0x9e3779b9);
  // Próximo vencimiento real tras el repaso, no un «mañana» inventado.
  const nextDue =
    queue && finishedAt !== null
      ? Math.min(
          ...all
            .filter((word) => word.card && new Date(word.card.due).getTime() > finishedAt)
            .map((word) => new Date(word.card!.due).getTime()),
        )
      : Infinity;


  // El destello de parejas se limpia al desmontar.
  useEffect(
    () => () => {
      window.clearTimeout(matchFlashTimer.current);
    },
    [],
  );

  return {
    answerOption,
    answered,
    askCatHint,
    catTap,
    exitSession,
    hintUsed,
    beginQueue,
    buildItemItems,
    buildSenseItems,
    checkWriteSentence,
    choiceOptions,
    cloze,
    clozeNewText,
    continueRef,
    current,
    currentKey,
    currentMode,
    done,
    endSessionForToday,
    finishMatchTanda,
    finishedAt,
    firstGradeRef,
    grade,
    grading,
    handleQuickGame,
    hintBusy,
    hintText,
    matchDone,
    matchFails,
    matchFlash,
    matchFlashTimer,
    matchLeft,
    matchRight,
    matchSel,
    nextDue,
    pickMeaning,
    practiceNote,
    previews,
    queue,
    resetExercise,
    reveal,
    revealButtonRef,
    revealed,
    senseLikeAnswer,
    senseLikeOptions,
    setAnswered,
    setFinishedAt,
    setGrading,
    setHintBusy,
    setHintText,
    setMatchDone,
    setMatchFails,
    setMatchFlash,
    setMatchSel,
    setPracticeNote,
    setPreviews,
    setQueue,
    setRevealed,
    setVerifyError,
    setVerifyResult,
    setVerifying,
    setWritePick,
    setWriteText,
    startAdaptiveFlow,
    startPractice,
    startRetentionCheck30d,
    tanda,
    tandaSeed,
    tryRescue,
    verifyError,
    verifyResult,
    verifying,
    writeAreaRef,
    writePick,
    writeText,
    queueTotal: queue?.total ?? 0,
  };
}

export type UseReviewSessionResult = ReturnType<typeof useReviewSession>;
