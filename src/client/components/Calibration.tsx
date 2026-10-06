import { useEffect, useRef, useState } from "react";
import Sheet from "./Sheet";
import {
  CALIBRATION_DRAFT_KEY,
  STEP_SIZE,
  parseCalibrationDraft,
  recordCalibration,
  serializeCalibrationDraft,
  type CalibrationAnswers,
  type CalibrationWord,
} from "../lib/calibration";
import {
  captureDbScope,
  loadSessionValue,
  saveSessionValue,
  type DbScope,
} from "../lib/idb";

type CalibrationProps = {
  // Muestra del catálogo (lemas repartidos en bandas de frecuencia),
  // ya descargada por quien monta la hoja. Si hay borrador con su
  // propia muestra guardada, esa manda — las respuestas restauradas
  // pertenecen a ella.
  words: CalibrationWord[];
  language?: string;
  // «Listo» y «Saltar»: el flujo terminó. Quien monta decide si la
  // prueba queda hecha y qué sigue (abrir el libro o solo cerrar).
  onDone: () => void;
  // «Cerrar» y Escape: se descarta sin escribir ni marcar nada; las
  // respuestas del borrador sobreviven para la próxima oferta.
  onClose: () => void;
};

// Prueba general de vocabulario, en pasos de seis palabras. Cada
// palabra pide una respuesta explícita — «la conozco» o «no la
// conozco»; lo no respondido no genera evidencia. Las desconocidas
// entran al Cuaderno al confirmar. Las respuestas, la muestra y el
// paso se van guardando en un borrador de sesión: cerrar la hoja por
// accidente retoma donde quedó.
export default function Calibration({
  words,
  language = "es",
  onDone,
  onClose,
}: CalibrationProps) {
  const [answers, setAnswers] = useState<CalibrationAnswers>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // La muestra vigente: la recién descargada o la del borrador. Con
  // ella se evalúan respuestas y se re-serializa el borrador.
  const [sampleWords, setSampleWords] = useState<CalibrationWord[]>(words);
  const [step, setStep] = useState(0);
  // Evita que la hidratación del borrador pise una respuesta que el
  // lector dio mientras cargaba (carrera real en dispositivos lentos).
  const hydrated = useRef(false);
  const answeredRef = useRef(false);
  // La hoja entera pertenece a la base que la abrió: si la cuenta
  // cambia mientras está abierta, borrador y evidencia siguen
  // aterrizando juntos en la base dueña — nunca repartidos.
  const [bound] = useState<DbScope>(() => captureDbScope());

  useEffect(() => {
    void loadSessionValue(CALIBRATION_DRAFT_KEY, bound)
      .then((raw) => {
        if (hydrated.current) return;
        hydrated.current = true;
        const draft = parseCalibrationDraft(raw, words);
        // Solo con la hoja intacta se restauran muestra y paso: si el
        // lector ya respondió, su muestra recién descargada se queda.
        if (!answeredRef.current && draft.words) {
          setSampleWords(draft.words);
          setStep(draft.step);
        }
        setAnswers((current) =>
          Object.keys(current).length ? current : draft.answers,
        );
      })
      .catch(() => undefined);
  }, [words, bound]);

  const persist = (next: CalibrationAnswers, at: number) =>
    saveSessionValue(
      CALIBRATION_DRAFT_KEY,
      serializeCalibrationDraft({
        answers: next,
        step: at,
        words: sampleWords,
      }),
      bound,
    ).catch(() => undefined);

  const setAnswer = (lemma: string, answer: "known" | "unknown") => {
    answeredRef.current = true;
    setAnswers((prev) => {
      const next = { ...prev };
      // Tocar la misma opción la desmarca — vuelve a pendiente.
      if (next[lemma] === answer) delete next[lemma];
      else next[lemma] = answer;
      void persist(next, step);
      return next;
    });
  };

  const clearDraft = () =>
    saveSessionValue(CALIBRATION_DRAFT_KEY, "", bound).catch(() => undefined);

  const finish = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
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

  const answered = Object.keys(answers).length;
  const unknownCount = Object.values(answers).filter(
    (answer) => answer === "unknown",
  ).length;

  // La lista va en pasos: la muestra barajada ya mezcla bandas, así
  // que cortar en orden reparte raras y cotidianas parejo.
  const pageCount = Math.max(1, Math.ceil(sampleWords.length / STEP_SIZE));
  const page = Math.min(step, pageCount - 1);
  const pageWords = sampleWords.slice(page * STEP_SIZE, page * STEP_SIZE + STEP_SIZE);
  const goToStep = (next: number) => {
    const clamped = Math.min(Math.max(next, 0), pageCount - 1);
    setStep(clamped);
    void persist(answers, clamped);
  };

  return (
    <Sheet label="¿Qué palabras conoces?" onClose={onClose}>
      <div className="sheet-head">
        <strong className="sheet-title">¿Qué palabras conoces?</strong>
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
        Prueba general{language === "es" ? " de vocabulario en español" : " de vocabulario"}:
        marca cada palabra y Lecta ajusta qué palabras prepararte antes de cada
        capítulo. Puedes dejar algunas sin responder.
      </p>

      <ul className="word-list">
        {pageWords.map(({ lemma, definition }) => {
          const answer = answers[lemma];
          return (
            <li key={lemma}>
              <strong>{lemma}</strong>
              <span className="cal-choices" role="group" aria-label={`Respuesta para ${lemma}`}>
                <button
                  type="button"
                  className={`cal-choice${answer === "known" ? " is-selected" : ""}`}
                  aria-pressed={answer === "known"}
                  onClick={() => setAnswer(lemma, "known")}
                >
                  La conozco
                </button>
                <button
                  type="button"
                  className={`cal-choice${answer === "unknown" ? " is-selected" : ""}`}
                  aria-pressed={answer === "unknown"}
                  onClick={() => setAnswer(lemma, "unknown")}
                >
                  No la conozco
                </button>
              </span>
              {answer === "unknown" && definition ? (
                <span className="meta">{definition}</span>
              ) : null}
            </li>
          );
        })}
      </ul>

      {pageCount > 1 ? (
        <div className="actions">
          <button
            type="button"
            className="btn"
            disabled={saving || page === 0}
            onClick={() => goToStep(page - 1)}
          >
            Atrás
          </button>
          <span className="meta" aria-live="polite">
            Paso {page + 1} de {pageCount}
          </span>
          <button
            type="button"
            className="btn"
            disabled={saving || page === pageCount - 1}
            onClick={() => goToStep(page + 1)}
          >
            Siguiente
          </button>
        </div>
      ) : null}

      <p className="meta">
        {answered
          ? `${answered} respondida(s)${unknownCount ? ` · ${unknownCount} irán a tu Cuaderno` : ""}`
          : "Responde las que quieras; el resto queda pendiente."}
      </p>

      <div className="actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={saving}
          onClick={() => void finish()}
        >
          {saving ? "Guardando…" : "Listo"}
        </button>
        <button type="button" className="btn" disabled={saving} onClick={skip}>
          Saltar
        </button>
      </div>
      {error ? (
        <p role="alert" className="status">
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}
