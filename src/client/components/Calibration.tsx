import { useEffect, useRef, useState } from "react";
import Sheet from "./Sheet";
import {
  CALIBRATION_DRAFT_KEY,
  parseCalibrationDraft,
  recordCalibration,
  type CalibrationAnswers,
  type CalibrationWord,
} from "../lib/calibration";
import { loadSessionValue, saveSessionValue } from "../lib/idb";

type CalibrationProps = {
  // Muestra del catálogo (lemas repartidos en bandas de frecuencia),
  // ya descargada por quien monta la hoja.
  words: CalibrationWord[];
  language?: string;
  // «Listo» y «Saltar»: el flujo terminó. Quien monta decide si la
  // prueba queda hecha y qué sigue (abrir el libro o solo cerrar).
  onDone: () => void;
  // «Cerrar» y Escape: se descarta sin escribir ni marcar nada; las
  // respuestas del borrador sobreviven para la próxima oferta.
  onClose: () => void;
};

// Prueba general de vocabulario. Cada palabra pide una respuesta
// explícita — «la conozco» o «no la conozco»; lo no respondido no
// genera evidencia. Las desconocidas entran al Cuaderno al confirmar.
// Las respuestas se van guardando en un borrador de sesión: cerrar la
// hoja por accidente no las pierde.
export default function Calibration({
  words,
  language = "es",
  onDone,
  onClose,
}: CalibrationProps) {
  const [answers, setAnswers] = useState<CalibrationAnswers>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Evita que la hidratación del borrador pise una respuesta que el
  // lector dio mientras cargaba (carrera real en dispositivos lentos).
  const hydrated = useRef(false);

  useEffect(() => {
    void loadSessionValue(CALIBRATION_DRAFT_KEY)
      .then((raw) => {
        if (!hydrated.current)
          setAnswers((current) =>
            Object.keys(current).length
              ? current
              : parseCalibrationDraft(raw, words),
          );
        hydrated.current = true;
      })
      .catch(() => undefined);
  }, [words]);

  const setAnswer = (lemma: string, answer: "known" | "unknown") => {
    setAnswers((prev) => {
      const next = { ...prev };
      // Tocar la misma opción la desmarca — vuelve a pendiente.
      if (next[lemma] === answer) delete next[lemma];
      else next[lemma] = answer;
      void saveSessionValue(
        CALIBRATION_DRAFT_KEY,
        JSON.stringify({ answers: next }),
      ).catch(() => undefined);
      return next;
    });
  };

  const clearDraft = () => saveSessionValue(CALIBRATION_DRAFT_KEY, "").catch(() => undefined);

  const finish = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await recordCalibration(words, answers, language);
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
        {words.map(({ lemma, definition }) => {
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
