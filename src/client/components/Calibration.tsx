import { useEffect, useMemo, useRef, useState } from "react";
import Sheet from "./Sheet";
import { Companion, type CompanionPose } from "./Companion";
import {
  CALIBRATION_ADAPTIVE_COUNT,
  calibrationDraftKey,
  fetchCalibrationSample,
  parseCalibrationDraft,
  recordCalibration,
  serializeCalibrationDraft,
  type CalibrationAnswers,
  type CalibrationAnswerValue,
  type CalibrationWord,
} from "../lib/calibration";
import {
  calibrationFallbackDefinition,
  calibrationSampleContext,
  calibrationBankZipf,
  CALIBRATION_DEFINITIONS_ES,
} from "../../shared/calibration-bank";
import {
  applyOverconfidenceCorrection,
  defaultTheta,
  estimateThetaMAP,
  saveUserTheta,
  selectNextAdaptiveItem,
  wordDifficulty,
  type CalibrationResponseItem,
} from "../lib/profile-models";
import { saveBaselineWpm } from "../lib/focus-telemetry";
import {
  applyStrategyPreset,
  hasExplicitNativeLanguage,
  loadNativeLanguage,
  loadReaderSettings,
  readerProfileFor,
  saveNativeLanguage,
  saveReaderSettings,
  type ReadingStrategyPreset,
} from "../lib/settings";
import {
  captureDbScope,
  loadSessionValue,
  saveSessionValue,
  type DbScope,
} from "../lib/idb";
import { syntacticBreaks, SYNTACTIC_LINE_CLASS } from "../lib/syntactic-lines";

import type { CompanionState } from "../lib/companion-state";

type CalibrationProps = {
  words: CalibrationWord[];
  language?: string;
  onDone: () => void;
  onClose: () => void;
};

// Fragmento literario de muestra para la Etapa 3 ("Tu Lente de Lectura")
const LENS_EXCERPT = [
  "El rey burgués tenía un palacio magnífico, donde acumulaba riquezas y objetos de arte maravillosos.",
  "En los jardines crecían flores exóticas traídas de climas remotos, y fuentes de mármol cantaban bajo el cielo purpúreo del atardecer.",
  "Un día trajeron a su presencia a un poeta errante, cubierto de harapos pero con la frente iluminada por la poesía.",
];
const LENS_WORD_COUNT = 58;

export default function Calibration({
  words,
  language = "es",
  onDone,
  onClose,
}: CalibrationProps) {
  const [stage, setStage] = useState<1 | 2 | 3>(1);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<CalibrationAnswers>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [nativeLang, setNativeLang] = useState<string>(() => loadNativeLanguage());
  const [showPrompt, setShowPrompt] = useState(
    () => language === "es" && !hasExplicitNativeLanguage(),
  );
  const [loadingWords, setLoadingWords] = useState(false);
  const [sampleWords, setSampleWords] = useState<CalibrationWord[]>(words);

  // Historial ordenado de palabras visitadas en la Etapa 1
  const [orderedLemmas, setOrderedLemmas] = useState<string[]>(() => {
    if (words.length > 0) {
      const first = selectNextAdaptiveItem(words, new Set(), defaultTheta()) ?? words[0];
      return [first.lemma];
    }
    return [];
  });

  // Reacciones en vivo del gato
  const [catPose, setCatPose] = useState<CompanionPose>("idle");
  const [catFocus, setCatFocus] = useState<CompanionState | null>("curious");
  const [catBubble, setCatBubble] = useState(
    "No es un examen; si dudas, elige «Me suena dudosa» para que ajuste mejor tus libros.",
  );
  const lastResponseTimeRef = useRef<number>(0);

  // Estado de la Etapa 2 (Verificación de precisión)
  const [verifyIndex, setVerifyIndex] = useState(0);
  const [failedVerifications, setFailedVerifications] = useState(0);

  // Estado de la Etapa 3 (Lente de lectura y perfil)
  const [selectedStrategy, setSelectedStrategy] =
    useState<ReadingStrategyPreset>("immersive");
  const [showSummary, setShowSummary] = useState(false);
  const [baselineWpm, setComputedBaselineWpm] = useState<number>(200);
  const stage3StartRef = useRef<number>(0);

  const hydrated = useRef(false);
  const answeredRef = useRef(false);
  const [bound] = useState<DbScope>(() => captureDbScope());

  useEffect(() => {
    lastResponseTimeRef.current = Date.now();
  }, []);

  useEffect(() => {
    if (stage === 3 && stage3StartRef.current === 0) {
      stage3StartRef.current = Date.now();
    }
  }, [stage]);

  // Manejador de selección de perfil nativo / aprendiz
  const handleSelectProfile = async (chosen: string) => {
    saveNativeLanguage(chosen);
    setNativeLang(chosen);
    setShowPrompt(false);
    const profile = readerProfileFor(chosen, language);
    setLoadingWords(true);
    try {
      const res = await fetchCalibrationSample(language, profile);
      if (res.ok && res.words.length) {
        setSampleWords(res.words);
        setAnswers({});
        setStep(0);
        setStage(1);
        const first = selectNextAdaptiveItem(res.words, new Set(), defaultTheta()) ?? res.words[0];
        setOrderedLemmas([first.lemma]);
        void saveSessionValue(
          calibrationDraftKey(language),
          serializeCalibrationDraft({
            answers: {},
            step: 0,
            words: res.words,
          }),
          bound,
        ).catch(() => undefined);
      }
    } catch {
      // Si falla la red se mantiene la muestra existente
    } finally {
      setLoadingWords(false);
    }
  };

  // Restauración del borrador de sesión
  useEffect(() => {
    void loadSessionValue(calibrationDraftKey(language), bound)
      .then((raw) => {
        if (hydrated.current) return;
        hydrated.current = true;
        const draft = parseCalibrationDraft(raw, words);
        if (!answeredRef.current && draft.words && draft.words.length > 0) {
          setSampleWords(draft.words);
          const restoredAnswers = draft.answers;
          setAnswers(restoredAnswers);
          // Reconstruir orderedLemmas a partir de las respuestas restauradas
          const answeredKeys = Object.keys(restoredAnswers);
          if (answeredKeys.length > 0) {
            setOrderedLemmas(answeredKeys);
            setStep(Math.min(draft.step, answeredKeys.length - 1));
          } else {
            const first = selectNextAdaptiveItem(draft.words, new Set(), defaultTheta()) ?? draft.words[0];
            setOrderedLemmas([first.lemma]);
            setStep(0);
          }
          if (draft.stage && (draft.stage === 1 || draft.stage === 2 || draft.stage === 3)) {
            setStage(draft.stage);
          }
        }
      })
      .catch(() => undefined);
  }, [words, language, bound]);

  const persist = (next: CalibrationAnswers, atStep: number, atStage: number) =>
    saveSessionValue(
      calibrationDraftKey(language),
      serializeCalibrationDraft({
        answers: next,
        step: atStep,
        stage: atStage,
        words: sampleWords,
      }),
      bound,
    ).catch(() => undefined);

  const clearDraft = () =>
    saveSessionValue(calibrationDraftKey(language), "", bound).catch(() => undefined);

  // Total de ítems para la etapa adaptativa (10 o tamaño de la muestra)
  const maxAdaptiveItems = Math.min(CALIBRATION_ADAPTIVE_COUNT, sampleWords.length);

  // Estimación Bayesiana provisional de theta según lo respondido hasta ahora
  const currentProvisionalTheta = useMemo(() => {
    const responses: CalibrationResponseItem[] = [];
    for (const [lem, ans] of Object.entries(answers)) {
      const found = sampleWords.find((w) => w.lemma === lem);
      const zipf =
        found?.zipf ?? calibrationBankZipf(lem, language) ?? 3.5;
      const b_i = wordDifficulty(zipf);
      let score = 0.0;
      if (ans === "known") score = 1.0;
      else if (ans === "unsure") score = 0.35;
      responses.push({ b_i, score });
    }
    return estimateThetaMAP(responses);
  }, [answers, sampleWords, language]);

  // Selección de palabras candidatas para la Etapa 2 (Verificación de precisión)
  const verificationWords = useMemo(() => {
    const knownCandidates = sampleWords
      .filter((w) => answers[w.lemma] === "known")
      .map((w) => {
        const zipf =
          w.zipf ?? calibrationBankZipf(w.lemma, language) ?? 3.0;
        const diff = wordDifficulty(zipf);
        return { word: w, difficulty: diff };
      })
      .sort((a, b) => b.difficulty - a.difficulty);

    // Priorizar palabras cuya dificultad supera la estimación provisional
    const hardKnown = knownCandidates.filter(
      (c) => c.difficulty > currentProvisionalTheta,
    );
    const pool = hardKnown.length > 0 ? hardKnown : knownCandidates;
    return pool.slice(0, 2).map((c) => c.word);
  }, [sampleWords, answers, currentProvisionalTheta, language]);

  // Palabra activa en la Etapa 1
  const currentLemma = orderedLemmas[step];
  const currentWord = sampleWords.find((w) => w.lemma === currentLemma) ?? sampleWords[0];

  // Cálculo del siguiente ítem adaptativo
  const advanceToNextWord = (nextAnswers: CalibrationAnswers) => {
    const answeredCount = Object.keys(nextAnswers).length;
    if (answeredCount >= maxAdaptiveItems) {
      // Etapa 1 completada: pasar a verificación si hay candidatos o a lente de lectura
      if (verificationWords.length > 0) {
        setStage(2);
        void persist(nextAnswers, 0, 2);
      } else {
        setStage(3);
        void persist(nextAnswers, 0, 3);
      }
      return;
    }

    if (step + 1 < orderedLemmas.length) {
      setStep(step + 1);
      void persist(nextAnswers, step + 1, 1);
      return;
    }

    // Seleccionar siguiente ítem adaptativo con máxima información de Fisher
    const answeredSet = new Set(Object.keys(nextAnswers));
    const nextItem =
      selectNextAdaptiveItem(sampleWords, answeredSet, currentProvisionalTheta) ??
      sampleWords.find((w) => !answeredSet.has(w.lemma));

    if (nextItem) {
      const nextLemmas = [...orderedLemmas, nextItem.lemma];
      setOrderedLemmas(nextLemmas);
      setStep(step + 1);
      void persist(nextAnswers, step + 1, 1);
    } else {
      // Muestra agotada: avanzar de etapa
      if (verificationWords.length > 0) {
        setStage(2);
        void persist(nextAnswers, 0, 2);
      } else {
        setStage(3);
        void persist(nextAnswers, 0, 3);
      }
    }
  };

  // Responder en la Etapa 1
  const handleAnswer = (val: CalibrationAnswerValue) => {
    if (!currentWord) return;
    answeredRef.current = true;
    const now = Date.now();
    const duration = now - lastResponseTimeRef.current;
    lastResponseTimeRef.current = now;

    // Respuestas emocionales del gato
    const zipf =
      currentWord.zipf ??
      calibrationBankZipf(currentWord.lemma, language) ??
      3.5;
    const diff = wordDifficulty(zipf);

    if (val === "known" && diff >= 4.2) {
      setCatPose("celebrate");
      setCatFocus("celebrating");
      setCatBubble("¡Excelente! Esa es una palabra selecta y muy expresiva.");
    } else if (duration < 1400) {
      setCatPose("playful_hop");
      setCatFocus("curious");
      setCatBubble("¡Qué agilidad! Cada respuesta afina tu perfil de lector.");
    } else if (val === "unsure") {
      setCatPose("greet");
      setCatFocus("curious");
      setCatBubble("Anotada como dudosa. Es ideal para afinar el punto exacto de ayuda.");
    } else {
      setCatPose("idle");
      setCatFocus("reading");
      setCatBubble("No es un examen; si dudas, elige «Me suena dudosa» para que ajuste mejor tus libros.");
    }

    const nextAnswers: CalibrationAnswers = {
      ...answers,
      [currentWord.lemma]: val,
    };
    setAnswers(nextAnswers);
    advanceToNextWord(nextAnswers);
  };

  const handleAnswerRef = useRef(handleAnswer);
  useEffect(() => {
    handleAnswerRef.current = handleAnswer;
  });

  // Escucha de atajos de teclado [1], [2], [3] en la Etapa 1
  useEffect(() => {
    if (showPrompt || stage !== 1) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (e.key === "1") {
        e.preventDefault();
        handleAnswerRef.current("unknown");
      } else if (e.key === "2") {
        e.preventDefault();
        handleAnswerRef.current("unsure");
      } else if (e.key === "3") {
        e.preventDefault();
        handleAnswerRef.current("known");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [stage, showPrompt]);

  // Manejo de la Etapa 2 (Verificación de precisión)
  const currentVerifyWord = verificationWords[verifyIndex];
  const verificationChoices = useMemo(() => {
    if (!currentVerifyWord) return [];
    const correctDef =
      currentVerifyWord.definition ??
      calibrationFallbackDefinition(currentVerifyWord.lemma, language) ??
      "Significado contextual de la palabra.";

    const otherDefs: string[] = [];
    for (const w of sampleWords) {
      if (w.lemma !== currentVerifyWord.lemma && w.definition) {
        if (!otherDefs.includes(w.definition) && w.definition !== correctDef) {
          otherDefs.push(w.definition);
        }
      }
    }
    if (otherDefs.length < 2) {
      for (const [k, d] of Object.entries(CALIBRATION_DEFINITIONS_ES)) {
        if (k !== currentVerifyWord.lemma && d !== correctDef && !otherDefs.includes(d)) {
          otherDefs.push(d);
          if (otherDefs.length >= 4) break;
        }
      }
    }
    const distractors = otherDefs.slice(0, 2);
    // Mezcla determinista según longitud del lema
    const list = [correctDef, ...distractors];
    return list.sort((a, b) => a.localeCompare(b));
  }, [currentVerifyWord, sampleWords, language]);

  const handleVerifyChoice = (chosenDef: string) => {
    if (!currentVerifyWord) return;
    const correctDef =
      currentVerifyWord.definition ??
      calibrationFallbackDefinition(currentVerifyWord.lemma, language) ??
      "";

    const isCorrect = chosenDef === correctDef;
    if (isCorrect) {
      setCatPose("celebrate");
      setCatBubble("¡Exacto! Tienes muy claro su sentido.");
    } else {
      setFailedVerifications((prev) => prev + 1);
      setCatPose("greet");
      setCatBubble("No pasa nada; afinamos el calibre con más cuidado.");
    }

    if (verifyIndex + 1 < verificationWords.length) {
      setVerifyIndex(verifyIndex + 1);
    } else {
      // Completada la Etapa 2 -> pasar a la Etapa 3
      setStage(3);
      void persist(answers, 0, 3);
    }
  };

  // Calcular WPM y pasar a la tarjeta resumen en la Etapa 3
  const handleInspectProfile = () => {
    const startTime = stage3StartRef.current > 0 ? stage3StartRef.current : Date.now();
    const elapsedMs = Math.max(1000, Date.now() - startTime);
    const elapsedMin = Math.max(0.05, elapsedMs / 60000);
    const calculatedWpm = Math.round(LENS_WORD_COUNT / elapsedMin);
    const clampedWpm = Math.min(500, Math.max(80, calculatedWpm));
    setComputedBaselineWpm(clampedWpm);
    setShowSummary(true);
    setCatPose("celebrate");
    setCatBubble("¡Afinación completada! Ya conozco tu ritmo y tus preferencias de lectura.");
  };

  // Guardado definitivo y finalización
  const finish = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      // Calcular theta final con penalización de sobreconfianza si hubo verificaciones
      const finalTheta = applyOverconfidenceCorrection(
        currentProvisionalTheta,
        failedVerifications,
        verificationWords.length,
      );
      saveUserTheta(finalTheta);
      saveBaselineWpm(baselineWpm);
      saveReaderSettings(
        applyStrategyPreset(selectedStrategy, loadReaderSettings()),
      );

      await recordCalibration(sampleWords, answers, language, bound);
      await clearDraft();
      onDone();
    } catch {
      setError("No se pudieron guardar tus respuestas. Intenta de nuevo.");
      setSaving(false);
    }
  };

  const skip = () => {
    void clearDraft();
    onDone();
  };

  // Vista modal para elección de lengua materna si aún no fue confirmada
  if (showPrompt) {
    return (
      <Sheet label="¿Cuál es tu lengua materna?" onClose={onClose}>
        <div className="sheet-head">
          <strong className="sheet-title">¿Cuál es tu lengua materna?</strong>
          <button
            type="button"
            className="btn--quiet"
            onClick={onClose}
            aria-label="Cerrar calibración"
            data-autofocus
          >
            Cerrar
          </button>
        </div>

        <p className="meta">
          Para adaptar la prueba a tu nivel real, indícanos si el español es tu lengua materna o estás aprendiéndolo:
        </p>

        <div style={{ display: "grid", gap: "1rem", marginBlock: "1.5rem" }}>
          <button
            type="button"
            className="btn"
            style={{
              textAlign: "left",
              padding: "1rem",
              display: "grid",
              gap: "0.25rem",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
            }}
            onClick={() => void handleSelectProfile("es")}
          >
            <strong style={{ fontSize: "var(--fs-md)" }}>Español (lengua materna)</strong>
            <span className="meta">
              Vocabulario literario, culto y expresivo. Se omiten palabras elementales.
            </span>
          </button>

          <button
            type="button"
            className="btn"
            style={{
              textAlign: "left",
              padding: "1rem",
              display: "grid",
              gap: "0.25rem",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
            }}
            onClick={() => void handleSelectProfile("other")}
          >
            <strong style={{ fontSize: "var(--fs-md)" }}>Otro idioma (estudiante de español)</strong>
            <span className="meta">
              Vocabulario graduado desde el uso habitual y descriptivo hasta avanzado.
            </span>
          </button>
        </div>

        <div className="actions">
          <button type="button" className="btn" onClick={skip}>
            Saltar prueba
          </button>
        </div>
      </Sheet>
    );
  }

  const answeredCount = Object.keys(answers).length;
  const currentAnswer = currentWord ? answers[currentWord.lemma] : undefined;
  const contextSentence = currentWord
    ? currentWord.sampleContext ??
      calibrationSampleContext(currentWord.lemma, language) ??
      (currentWord.definition
        ? `Definición: ${currentWord.definition}`
        : "Palabra seleccionada para calibrar tu nivel de lectura.")
    : "";

  return (
    <Sheet label="Ritual de Afinación con el Gato" onClose={onClose}>
      <div className="sheet-head">
        <strong className="sheet-title">Afinación con el Gato</strong>
        <button
          type="button"
          className="btn--quiet"
          onClick={onClose}
          aria-label="Cerrar calibración"
          data-autofocus
        >
          Cerrar
        </button>
      </div>

      {language === "es" ? (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "0.375rem 0.75rem",
            marginBottom: "0.5rem",
            background: "var(--surface-sunken, rgba(0, 0, 0, 0.04))",
            borderRadius: "var(--radius-sm)",
          }}
        >
          <span className="meta">
            Perfil: <strong>{readerProfileFor(nativeLang, "es") === "native" ? "Español nativo" : "Estudiante de español"}</strong>
          </span>
          <button
            type="button"
            className="btn--quiet"
            style={{ fontSize: "var(--fs-sm)", padding: 0 }}
            onClick={() => setShowPrompt(true)}
          >
            Cambiar
          </button>
        </div>
      ) : null}

      <div className="cal-container">
        {/* Barra de progreso superior y stepper */}
        <div className="cal-stage-badge">
          <span>
            {stage === 1
              ? `Etapa 1 de 3: Cartas de Tinta (Palabra ${step + 1} de ${maxAdaptiveItems})`
              : stage === 2
                ? `Etapa 2 de 3: Verificación (${verifyIndex + 1} de ${verificationWords.length})`
                : "Etapa 3 de 3: Tu Lente de Lectura"}
          </span>
        </div>
        <div className="cal-progress-bar" role="progressbar" aria-valuenow={stage === 1 ? Math.round(((step + 1) / maxAdaptiveItems) * 100) : stage === 2 ? 66 : 100} aria-valuemin={0} aria-valuemax={100}>
          <div
            className="cal-progress-fill"
            style={{
              inlineSize:
                stage === 1
                  ? `${Math.round(((step + 1) / maxAdaptiveItems) * 100)}%`
                  : stage === 2
                    ? `${50 + Math.round(((verifyIndex + 1) / Math.max(1, verificationWords.length)) * 25)}%`
                    : "100%",
            }}
          />
        </div>

        {loadingWords ? (
          <p className="meta" aria-live="polite" style={{ paddingBlock: "2rem", textAlign: "center" }}>
            Cargando palabras del catálogo…
          </p>
        ) : stage === 1 && currentWord ? (
          /* ---------- ETAPA 1: CARTAS DE TINTA ---------- */
          <div className="cal-editorial-card">
            <h3 className="cal-lemma">{currentWord.lemma}</h3>
            <div className="cal-context-box">
              <p className="cal-context-text">
                «{contextSentence}»
              </p>
            </div>

            <div
              className="cal-actions-grid cal-choices"
              role="group"
              aria-label={`Respuesta para ${currentWord.lemma}`}
            >
              <button
                type="button"
                className={`cal-action-btn cal-choice${currentAnswer === "unknown" ? " is-selected" : ""}`}
                aria-pressed={currentAnswer === "unknown"}
                onClick={() => handleAnswer("unknown")}
              >
                <span className="cal-btn-key">[1]</span>
                <span>No me suena</span>
              </button>
              <button
                type="button"
                className={`cal-action-btn cal-choice${currentAnswer === "unsure" ? " is-selected" : ""}`}
                aria-pressed={currentAnswer === "unsure"}
                onClick={() => handleAnswer("unsure")}
              >
                <span className="cal-btn-key">[2]</span>
                <span>Me suena dudosa</span>
              </button>
              <button
                type="button"
                className={`cal-action-btn cal-choice${currentAnswer === "known" ? " is-selected" : ""}`}
                aria-pressed={currentAnswer === "known"}
                onClick={() => handleAnswer("known")}
              >
                <span className="cal-btn-key">[3]</span>
                <span>La conozco bien</span>
              </button>
            </div>

            {/* Guía en vivo del gato */}
            <div className="cal-companion-guide">
              <div style={{ width: 44, height: 44, flexShrink: 0 }}>
                <Companion
                  stage={1}
                  mood="awake"
                  focus={catFocus}
                  pose={catPose}
                  accessories={[]}
                  decorative
                />
              </div>
              <p className="cal-bubble-text">{catBubble}</p>
            </div>
          </div>
        ) : stage === 2 && currentVerifyWord ? (
          /* ---------- ETAPA 2: VERIFICACIÓN DE PRECISIÓN ---------- */
          <div className="cal-editorial-card">
            <span className="meta" style={{ fontSize: "var(--fs-xs)", textTransform: "uppercase" }}>
              Micro-reto anti-sobreconfianza
            </span>
            <h3 className="cal-lemma">{currentVerifyWord.lemma}</h3>
            <p className="meta" style={{ margin: 0 }}>
              ¿Cuál es el significado más cercano en tus lecturas?
            </p>

            <div className="cal-options-list" role="group" aria-label={`Significado para ${currentVerifyWord.lemma}`}>
              {verificationChoices.map((choiceDef, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="cal-option-tile"
                  onClick={() => handleVerifyChoice(choiceDef)}
                >
                  <span>{choiceDef}</span>
                </button>
              ))}
            </div>

            <div className="cal-companion-guide">
              <div style={{ width: 44, height: 44, flexShrink: 0 }}>
                <Companion
                  stage={1}
                  mood="awake"
                  focus={catPose === "celebrate" ? "celebrating" : "curious"}
                  pose={catPose}
                  accessories={[]}
                  decorative
                />
              </div>
              <p className="cal-bubble-text">{catBubble}</p>
            </div>
          </div>
        ) : (
          /* ---------- ETAPA 3: TU LENTE DE LECTURA ---------- */
          <div className="cal-editorial-card">
            {!showSummary ? (
              <>
                <h3 className="cal-lemma" style={{ fontSize: "1.5rem" }}>
                  Ajusta tu lente de lectura
                </h3>
                <p className="meta" style={{ margin: 0 }}>
                  Elige cómo prefieres sentir las ayudas visuales mientras lees este fragmento:
                </p>

                {/* Selector de estrategia */}
                <div className="cal-actions-grid" style={{ marginBlock: "0.5rem" }}>
                  <button
                    type="button"
                    className={`cal-action-btn${selectedStrategy === "immersive" ? " is-selected" : ""}`}
                    onClick={() => setSelectedStrategy("immersive")}
                  >
                    <strong>Lectura Limpia</strong>
                    <span className="meta" style={{ fontSize: "0.75rem" }}>Sin marcas</span>
                  </button>
                  <button
                    type="button"
                    className={`cal-action-btn${selectedStrategy === "focus" ? " is-selected" : ""}`}
                    onClick={() => setSelectedStrategy("focus")}
                  >
                    <strong>Enfoque de Párrafo</strong>
                    <span className="meta" style={{ fontSize: "0.75rem" }}>Atenúa el resto</span>
                  </button>
                  <button
                    type="button"
                    className={`cal-action-btn${selectedStrategy === "lexical" ? " is-selected" : ""}`}
                    onClick={() => setSelectedStrategy("lexical")}
                  >
                    <strong>Líneas Sintácticas</strong>
                    <span className="meta" style={{ fontSize: "0.75rem" }}>Cortes naturales</span>
                  </button>
                </div>

                {/* Previsualización interactiva en vivo del texto */}
                <div className="cal-lens-preview" style={{ textAlign: "left" }}>
                  {LENS_EXCERPT.map((paragraphText, idx) => {
                    if (selectedStrategy === "focus") {
                      const isFocused = idx === 1;
                      return (
                        <p
                          key={idx}
                          className={isFocused ? "is-focused" : "is-dimmed"}
                          style={{ marginBlock: "0.5rem" }}
                        >
                          {paragraphText}
                        </p>
                      );
                    }
                    if (selectedStrategy === "lexical") {
                      const breaks = syntacticBreaks(paragraphText);
                      const segments: string[] = [];
                      let last = 0;
                      for (const b of breaks) {
                        segments.push(paragraphText.slice(last, b));
                        last = b;
                      }
                      segments.push(paragraphText.slice(last));
                      return (
                        <p key={idx} style={{ marginBlock: "0.5rem" }}>
                          {segments.map((seg, sIdx) => (
                            <span
                              key={sIdx}
                              className={SYNTACTIC_LINE_CLASS}
                              style={{ display: "block" }}
                            >
                              {seg}
                            </span>
                          ))}
                        </p>
                      );
                    }
                    return (
                      <p key={idx} style={{ marginBlock: "0.5rem" }}>
                        {paragraphText}
                      </p>
                    );
                  })}
                </div>

                <button
                  type="button"
                  className="btn btn--primary"
                  style={{ width: "100%", marginBlockStart: "0.5rem" }}
                  onClick={handleInspectProfile}
                >
                  Finalizar afinación y ver mi perfil
                </button>
              </>
            ) : (
              /* Tarjeta de Perfil de Lector entregada por el gato */
              <>
                <div style={{ width: 64, height: 64, marginBlock: "0.5rem" }}>
                  <Companion
                    stage={1}
                    mood="awake"
                    focus="celebrating"
                    pose="celebrate"
                    accessories={[]}
                    decorative
                  />
                </div>
                <h3 className="cal-lemma" style={{ fontSize: "1.5rem" }}>
                  ¡Perfil de Lector Listo!
                </h3>
                <p className="meta" style={{ margin: 0 }}>
                  Michi ha calibrado tus preferencias y tu umbral de vocabulario.
                </p>

                <div className="cal-profile-card">
                  <div className="cal-profile-stat">
                    <span className="cal-profile-stat-value">
                      {currentProvisionalTheta >= 4.5
                        ? "Literario Alto"
                        : currentProvisionalTheta >= 3.5
                          ? "Expresivo"
                          : "Descriptivo"}
                    </span>
                    <span className="cal-profile-stat-label">Nivel de Vocabulario</span>
                  </div>
                  <div className="cal-profile-stat">
                    <span className="cal-profile-stat-value">
                      {selectedStrategy === "immersive"
                        ? "Limpia"
                        : selectedStrategy === "focus"
                          ? "Enfoque"
                          : "Sintáctico"}
                    </span>
                    <span className="cal-profile-stat-label">Lente Inicial</span>
                  </div>
                  <div className="cal-profile-stat">
                    <span className="cal-profile-stat-value">
                      {baselineWpm} ppm
                    </span>
                    <span className="cal-profile-stat-label">Ritmo de Lectura</span>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Acciones de navegación */}
        <div className="actions" style={{ justifyContent: "space-between" }}>
          {stage === 1 && (
            <button
              type="button"
              className="btn"
              disabled={step === 0 || saving}
              onClick={() => {
                if (step > 0) {
                  setStep(step - 1);
                  void persist(answers, step - 1, 1);
                }
              }}
            >
              Atrás
            </button>
          )}

          <div style={{ display: "flex", gap: "0.5rem", marginInlineStart: "auto" }}>
            <button
              type="button"
              className="btn btn--primary"
              disabled={saving}
              onClick={() => void finish()}
            >
              {saving ? "Guardando…" : "Listo"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={saving}
              onClick={skip}
            >
              Saltar
            </button>
          </div>
        </div>

        {answeredCount > 0 ? (
          <p className="meta" style={{ textAlign: "center", fontSize: "var(--fs-xs)" }}>
            {answeredCount} palabra(s) respondida(s)
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="status">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
