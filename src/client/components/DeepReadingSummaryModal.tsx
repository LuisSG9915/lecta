import { useState } from "react";
import Dialog from "./Dialog";
import { triggerHaptic, type DeepReadingSummary } from "../lib/deep-reading";
import { useCompanionSafe } from "./CompanionProvider";
import { Companion } from "./Companion";
import type { ConsolidationModality, EpisodicWordItem } from "../lib/practice";
import {
  isConsolidationActive,
  muteConsolidationForBook,
  disableConsolidationGlobally,
  awardEpisodicConsolidation,
} from "../lib/game";
import { SentenceBuilderGame } from "./SentenceBuilderGame";
import { WordScrambleGame } from "./WordScrambleGame";

export interface DeepReadingSummaryModalProps {
  summary: DeepReadingSummary;
  consolidationQueue?: Array<{ item: EpisodicWordItem; modality: ConsolidationModality }>;
  onStartConsolidation?: () => void;
  onContinue?: () => void;
  onClose: () => void;
  bookId?: string;
  onSkipConsolidation?: () => void;
}

export default function DeepReadingSummaryModal({
  summary,
  consolidationQueue,
  onStartConsolidation,
  onContinue,
  onClose,
  bookId,
  onSkipConsolidation,
}: DeepReadingSummaryModalProps) {
  const companion = useCompanionSafe();
  const durationText =
    summary.durationMinutes === 1
      ? "1 minuto"
      : `${summary.durationMinutes} minutos`;
  const handleContinue = onContinue ?? onClose;

  const [isMuted, setIsMuted] = useState(() => !isConsolidationActive(bookId));
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const [activeWordIndex, setActiveWordIndex] = useState<number | null>(null);
  const [consolidationCompleted, setConsolidationCompleted] = useState(false);

  const wordsAssimilated =
    summary.wordsAssimilated ?? Math.max(3, summary.sectionsRead * 4);
  const coverageDelta =
    summary.coverageDeltaPercent ?? (summary.sectionsRead > 0 ? 1 : 0);

  const queue = consolidationQueue ?? [];
  const hasConsolidation = !isMuted && queue.length > 0;

  const handleSkip = () => {
    triggerHaptic("selection");
    onSkipConsolidation?.();
    handleContinue();
  };

  const handleMuteThisBook = () => {
    triggerHaptic("selection");
    if (bookId) muteConsolidationForBook(bookId);
    setIsMuted(true);
    setShowOptionsMenu(false);
  };

  const handleDisableGlobally = () => {
    triggerHaptic("selection");
    disableConsolidationGlobally();
    setIsMuted(true);
    setShowOptionsMenu(false);
  };

  const handleStartConsolidation = () => {
    triggerHaptic("selection");
    if (onStartConsolidation) {
      onStartConsolidation();
    } else {
      setActiveWordIndex(0);
    }
  };

  const handleSolveStep = () => {
    void awardEpisodicConsolidation(4).catch(() => {});
    if (activeWordIndex !== null && activeWordIndex + 1 < queue.length) {
      setActiveWordIndex(activeWordIndex + 1);
    } else {
      setActiveWordIndex(null);
      setConsolidationCompleted(true);
    }
  };

  // -------------------------------------------------------------------------
  // VISTA: PANTALLA DE CELEBRACIÓN DE CONSOLIDACIÓN COMPLETADA
  // -------------------------------------------------------------------------
  if (consolidationCompleted) {
    return (
      <Dialog label="Capítulo sellado en memoria" onClose={handleContinue}>
        <div className="sheet-head">
          <h2 className="sheet-title">¡Capítulo sellado en memoria!</h2>
          <button
            type="button"
            className="btn--quiet"
            onClick={handleContinue}
            aria-label="Continuar"
          >
            ✕
          </button>
        </div>

        <div
          className="deep-summary-companion"
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            margin: "var(--s-3) 0 var(--s-1)",
          }}
        >
          <div style={{ width: 76, height: 76 }}>
            {companion ? (
              <Companion
                stage={companion.stage}
                mood="awake"
                accessories={companion.accessories}
                pose="celebrate"
              />
            ) : (
              <div style={{ fontSize: "3rem", textAlign: "center" }} aria-hidden="true">
                🎉🐱
              </div>
            )}
          </div>
        </div>

        <div style={{ textAlign: "center", padding: "0 0 var(--s-2)" }}>
          <p
            className="card-context"
            style={{ fontStyle: "normal", fontSize: "1.125rem", margin: "0 auto var(--s-1)" }}
          >
            Fijaste {queue.length} palabras clave de este capítulo
          </p>
          <p className="meta" style={{ fontStyle: "italic", fontSize: "var(--fs-sm)" }}>
            «{companion?.name ?? "Michi"} celebra tu memoria literaria: la estabilidad de recuerdo se ha consolidado en tu catálogo personal.»
          </p>
        </div>

        <div style={{ marginTop: "var(--s-4)", display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="btn btn--primary"
            onClick={handleContinue}
            data-autofocus
          >
            Continuar al siguiente capítulo →
          </button>
        </div>
      </Dialog>
    );
  }

  // -------------------------------------------------------------------------
  // VISTA: JUGAR MICRO-RETO DIRECTO DENTRO DEL MODAL (SI CORRE IN-SITU)
  // -------------------------------------------------------------------------
  if (activeWordIndex !== null && activeWordIndex < queue.length) {
    const active = queue[activeWordIndex];
    return (
      <Dialog label="Fijar palabras del capítulo" onClose={handleSkip}>
        <div className="sheet-head consolidation-runner-head">
          <span className="consolidation-badge">
            Palabra {activeWordIndex + 1} de {queue.length}
          </span>
          <button
            type="button"
            className="btn--quiet consolidation-skip-link"
            onClick={handleSkip}
          >
            Saltar al siguiente capítulo →
          </button>
        </div>

        <div style={{ marginTop: "var(--s-2)" }}>
          {active.modality === "word-scramble" ? (
            <WordScrambleGame
              key={`scramble-${active.item.lemma}`}
              targetWord={active.item.surfaceForm || active.item.lemma}
              chapterSentence={active.item.chapterSentence}
              shortGloss={active.item.shortGloss}
              language={active.item.lang}
              timeLimitSeconds={10}
              onSolve={handleSolveStep}
            />
          ) : (
            <SentenceBuilderGame
              key={`cloze-${active.item.lemma}`}
              targetWord={active.item.surfaceForm || active.item.lemma}
              chapterSentence={active.item.chapterSentence}
              shortGloss={active.item.shortGloss}
              language={active.item.lang}
              mode="cloze"
              onSolve={handleSolveStep}
            />
          )}
        </div>
      </Dialog>
    );
  }

  // -------------------------------------------------------------------------
  // VISTA: RESUMEN DEL CAPÍTULO + TARJETA DE CONSOLIDACIÓN (25 SEGUNDOS)
  // -------------------------------------------------------------------------
  return (
    <Dialog label="Retiro de lectura completado" onClose={onClose}>
      <div className="sheet-head">
        <h2 className="sheet-title">Retiro completado</h2>
        <button
          type="button"
          className="btn--quiet"
          onClick={onClose}
          aria-label="Cerrar resumen"
        >
          Cerrar
        </button>
      </div>

      {/* Celebración con el Gato */}
      <div
        className="deep-summary-companion"
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          margin: "var(--s-3) 0 var(--s-1)",
        }}
      >
        <div style={{ width: 68, height: 68 }}>
          {companion ? (
            <Companion
              stage={companion.stage}
              mood="awake"
              accessories={companion.accessories}
              pose="celebrate"
            />
          ) : (
            <div style={{ fontSize: "2.5rem", textAlign: "center" }} aria-hidden="true">
              🎉🐱
            </div>
          )}
        </div>
      </div>

      <div style={{ textAlign: "center", padding: "0 0 var(--s-2)" }}>
        <p className="card-context" style={{ fontStyle: "normal", fontSize: "1.125rem", margin: "0 auto var(--s-1)" }}>
          {durationText} de inmersión profunda
        </p>
        <p className="meta" style={{ fontStyle: "italic", fontSize: "var(--fs-sm)" }}>
          «{companion?.name ?? "Michi"} celebra tu lectura: incorporaste {wordsAssimilated} palabras de forma natural y avanzaste en tu dominio del libro.»
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "var(--s-2)",
          margin: "var(--s-3) 0",
          background: "var(--paper-sunken)",
          padding: "var(--s-3)",
          borderRadius: "var(--r-sm)",
          textAlign: "center",
        }}
      >
        <div>
          <strong style={{ display: "block", fontSize: "1.25rem", color: "var(--ink)" }}>
            {summary.durationMinutes} min
          </strong>
          <span className="meta" style={{ fontSize: "var(--fs-xs)" }}>
            Tiempo en retiro
          </span>
        </div>
        <div>
          <strong style={{ display: "block", fontSize: "1.25rem", color: "var(--ink)" }}>
            {summary.sectionsRead}
          </strong>
          <span className="meta" style={{ fontSize: "var(--fs-xs)" }}>
            {summary.sectionsRead === 1 ? "Sección leída" : "Secciones leídas"}
          </span>
        </div>
        <div>
          <strong style={{ display: "block", fontSize: "1.25rem", color: "var(--vermilion, #b8332a)" }}>
            +{wordsAssimilated}
          </strong>
          <span className="meta" style={{ fontSize: "var(--fs-xs)" }}>
            Palabras asimiladas
          </span>
        </div>
        <div>
          <strong style={{ display: "block", fontSize: "1.25rem", color: "var(--ink)" }}>
            +{coverageDelta}%
          </strong>
          <span className="meta" style={{ fontSize: "var(--fs-xs)" }}>
            Incremento de cobertura
          </span>
        </div>
      </div>

      {/* Tarjeta Limpia de Consolidación Episódica (~25 segundos) */}
      {hasConsolidation ? (
        <div className="consolidation-card deep-summary-consolidation">
          <div className="consolidation-card-header">
            <h3 className="consolidation-card-title">
              Fija en tu memoria {queue.length} palabras de este capítulo (~25 s)
            </h3>
            <div className="consolidation-options-wrapper">
              <button
                type="button"
                className="btn--quiet consolidation-options-toggle"
                onClick={() => setShowOptionsMenu((prev) => !prev)}
                aria-label="Opciones de consolidación"
                title="Opciones de consolidación"
              >
                Opciones ▾
              </button>
              {showOptionsMenu ? (
                <div className="consolidation-options-dropdown" role="menu">
                  {bookId ? (
                    <button
                      type="button"
                      className="consolidation-option-item"
                      role="menuitem"
                      onClick={handleMuteThisBook}
                    >
                      ✕ Ocultar en este libro
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="consolidation-option-item"
                    role="menuitem"
                    onClick={handleDisableGlobally}
                  >
                    🚫 Desactivar consolidación al final de capítulo siempre
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="consolidation-word-chips">
            {queue.map(({ item }) => (
              <span key={item.lemma} className="consolidation-word-chip">
                {item.surfaceForm || item.lemma}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div
        style={{
          marginTop: "var(--s-4)",
          display: "flex",
          justifyContent: "flex-end",
          gap: "var(--s-2)",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          className="btn--quiet"
          onClick={() => {
            triggerHaptic("selection");
            onClose();
          }}
        >
          Cerrar
        </button>

        {hasConsolidation ? (
          <button
            type="button"
            className="btn btn--accent consolidation-start-btn"
            onClick={handleStartConsolidation}
          >
            Fijar en memoria (~25 s)
          </button>
        ) : null}

        {/* Botón principal prominente para saltar sin fricción */}
        <button
          type="button"
          className="btn btn--primary consolidation-skip-btn"
          onClick={handleSkip}
          data-autofocus
        >
          Continuar al siguiente capítulo →
        </button>
      </div>
    </Dialog>
  );
}
