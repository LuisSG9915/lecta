import { useEffect, useRef, useState } from "react";
import Sheet from "./Sheet";
import {
  STEP_SIZE,
  calibrationDraftKey,
  fetchCalibrationSample,
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
import {
  hasExplicitNativeLanguage,
  loadNativeLanguage,
  readerProfileFor,
  saveNativeLanguage,
} from "../lib/settings";

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
  const [nativeLang, setNativeLang] = useState<string>(() => loadNativeLanguage());
  const [showPrompt, setShowPrompt] = useState(
    () => language === "es" && !hasExplicitNativeLanguage(),
  );
  const [loadingWords, setLoadingWords] = useState(false);
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

  useEffect(() => {
    void loadSessionValue(calibrationDraftKey(language), bound)
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
  }, [words, language, bound]);

  const persist = (next: CalibrationAnswers, at: number) =>
    saveSessionValue(
      calibrationDraftKey(language),
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
    saveSessionValue(calibrationDraftKey(language), "", bound).catch(() => undefined);

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

      {language === "es" ? (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "0.5rem 0.75rem",
            marginBottom: "0.75rem",
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

      <p className="meta">
        Prueba general{language === "es" ? " de vocabulario en español" : language === "en" ? " de vocabulario en inglés" : " de vocabulario"}:
        marca cada palabra y Lecta ajusta qué palabras prepararte antes de cada
        capítulo. Puedes dejar algunas sin responder.
      </p>

      {loadingWords ? (
        <p className="meta" aria-live="polite" style={{ paddingBlock: "2rem", textAlign: "center" }}>
          Cargando palabras…
        </p>
      ) : (
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
      )}

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
