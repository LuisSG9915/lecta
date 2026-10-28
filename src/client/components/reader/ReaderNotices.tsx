// Franja de avisos flotantes del lector: marcador de retomar, sugerencia de
// preparación de capítulo, invitación a la calibración y pausa 20-20-20.
//
// Extraída de Reader.tsx (Fase 7). Solo pinta; el orden de prioridad y el
// estado viven en el lector.
import { isFeatureFlagEnabled } from "../../lib/settings";
import { markSectionPreviewed } from "../../lib/chapter-analysis";

const RICH_CHAPTER_KEY_WORDS = 12;

export type ReaderResumeCard = {
  label: string | null;
  lastReadText: string;
  daysSince: number;
  savedInRange: number;
  rereadTo: { index: number; fragment?: string } | null;
};

export interface ReaderNoticesProps {
  resumeCard: ReaderResumeCard | null;
  rereadChapter: () => void;
  setResumeCard: (value: ReaderResumeCard | null) => void;
  previewSuggested: boolean;
  setPreviewSuggested: (value: boolean) => void;
  showPreview: boolean;
  setShowPreview: (value: boolean) => void;
  chapterAnalysis: { unknownKeyWords: unknown[] } | null;
  openPrepManual: () => void;
  bookHash: string;
  sectionIndex: number;
  dismissPrepNotice: () => void;
  calNotice: boolean;
  prep: unknown;
  prepNotice: unknown;
  isDeepReading: boolean;
  acceptCalibrationNotice: () => void | Promise<unknown>;
  dismissCalibrationNotice: () => void;
  fatigueNotice: boolean;
  setFatigueNotice: (value: boolean) => void;
  onActivateFocusRule?: () => void;
  onStartAudio5Min?: () => void;
}

export function ReaderNotices(props: ReaderNoticesProps) {
  const {
  resumeCard,
  rereadChapter,
  setResumeCard,
  previewSuggested,
  setPreviewSuggested,
  showPreview,
  setShowPreview,
  chapterAnalysis,
  openPrepManual,
  bookHash,
  sectionIndex,
  dismissPrepNotice,
  calNotice,
  prep,
  prepNotice,
  isDeepReading,
  acceptCalibrationNotice,
  dismissCalibrationNotice,
  fatigueNotice,
  setFatigueNotice,
  onActivateFocusRule,
  onStartAudio5Min,
  } = props;

  return (
    <>
  {/* Marcador de retomar: máxima prioridad en la franja — es el
      mensaje de apertura cuando el libro llevaba días cerrado.
      Mientras está visible, el resto de avisos espera; al
      descartarlo vuelven a su orden normal. */}
  {resumeCard ? (
    <div className="reader-prep" role="status">
      <span className="reader-prep-text">
        {resumeCard.label
          ? `Quedaste en «${resumeCard.label}» ${resumeCard.lastReadText}.`
          : `La última vez que abriste este libro fue ${resumeCard.lastReadText}.`}
        {resumeCard.savedInRange > 0
          ? ` Guardaste ${resumeCard.savedInRange} palabra(s) en este tramo.`
          : ""}
      </span>
      {resumeCard.rereadTo ? (
        <button
          type="button"
          className="btn reader-prep-open"
          onClick={rereadChapter}
        >
          Releer el capítulo
        </button>
      ) : null}
      <button
        type="button"
        className="reader-return-dismiss"
        onClick={() => setResumeCard(null)}
        aria-label="Seguir leyendo"
      >
        ×
      </button>
    </div>
  ) : null}

  {/* Píldora superior de preparación de capítulo (Regla 2 Zero-Friction) */}
  {isFeatureFlagEnabled("chapterPriming") && previewSuggested && !showPreview && chapterAnalysis && chapterAnalysis.unknownKeyWords.length > 0 && (
    <div className="reader-chapter-prep-pill" role="status" aria-live="polite">
      <span>
        {chapterAnalysis.unknownKeyWords.length >= RICH_CHAPTER_KEY_WORDS
          ? "Capítulo rico en vocabulario · "
          : null}
        <strong>{chapterAnalysis.unknownKeyWords.length} palabras clave</strong> en este capítulo
      </span>
      <div className="reader-chapter-prep-actions">
        <button
          type="button"
          className="reader-chapter-prep-btn"
          onClick={() => {
            setPreviewSuggested(false);
            setShowPreview(true);
            openPrepManual();
          }}
        >
          Preparar antes de leer
        </button>
        <button
          type="button"
          className="reader-chapter-prep-dismiss"
          onClick={() => {
            markSectionPreviewed(bookHash, sectionIndex);
            setPreviewSuggested(false);
            dismissPrepNotice();
          }}
          aria-label="Descartar sugerencia del capítulo"
        >
          ✕
        </button>
      </div>
    </div>
  )}

  {/* Invitación a la prueba de vocabulario: misma franja fija que
      el aviso de preparación, fuera del texto; conviven solo una
      por diseño (la de preparación tiene preferencia). Persiste
      hasta aceptar o decir «Ahora no». */}
  {calNotice && !prep && !prepNotice && !resumeCard && !isDeepReading ? (
    <div className="reader-prep" role="status">
      <span className="reader-prep-text">
        Ajusta qué palabras te sugiere Lecta antes de cada capítulo.
      </span>
      <button
        type="button"
        className="btn reader-prep-open"
        onClick={() => void acceptCalibrationNotice()}
      >
        Ajustar mi vocabulario
      </button>
      <button
        type="button"
        className="reader-return-dismiss"
        onClick={dismissCalibrationNotice}
        aria-label="Ahora no"
      >
        ×
      </button>
    </div>
  ) : null}

  {/* Transición suave ante fatiga cognitiva/visual (Fase 3 Anti-Abandono) */}
  {fatigueNotice && !resumeCard && !isDeepReading ? (
    <div
      className="reader-prep reader-fatigue-action-pill"
      role="status"
      aria-live="polite"
    >
      <span className="reader-prep-text">
        Notamos fatiga en la lectura. Elige cómo continuar:
      </span>
      <div className="reader-fatigue-pill-actions">
        <button
          type="button"
          className="btn btn--secondary reader-fatigue-btn-focus"
          onClick={() => {
            onActivateFocusRule?.();
            setFatigueNotice(false);
          }}
        >
          Activar Regla de Foco
        </button>
        <button
          type="button"
          className="btn btn--primary reader-fatigue-btn-audio"
          onClick={() => {
            onStartAudio5Min?.();
            setFatigueNotice(false);
          }}
        >
          Escuchar los próximos 5 min 🎧
        </button>
      </div>
      <button
        type="button"
        className="reader-return-dismiss"
        onClick={() => setFatigueNotice(false)}
        aria-label="Ocultar aviso de fatiga"
      >
        ×
      </button>
    </div>
  ) : null}
    </>
  );
}
