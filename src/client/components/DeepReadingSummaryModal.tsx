import Dialog from "./Dialog";
import { triggerHaptic, type DeepReadingSummary } from "../lib/deep-reading";
import { useCompanionSafe } from "./CompanionProvider";
import { Companion } from "./Companion";

export interface DeepReadingSummaryModalProps {
  summary: DeepReadingSummary;
  onContinue?: () => void;
  onClose: () => void;
}

export default function DeepReadingSummaryModal({
  summary,
  onContinue,
  onClose,
}: DeepReadingSummaryModalProps) {
  const companion = useCompanionSafe();
  const durationText =
    summary.durationMinutes === 1
      ? "1 minuto"
      : `${summary.durationMinutes} minutos`;
  const handleContinue = onContinue ?? onClose;

  const wordsAssimilated =
    summary.wordsAssimilated ?? Math.max(3, summary.sectionsRead * 4);
  const coverageDelta =
    summary.coverageDeltaPercent ?? (summary.sectionsRead > 0 ? 1 : 0);

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

      <div
        style={{
          marginTop: "var(--s-4)",
          display: "flex",
          justifyContent: "flex-end",
          gap: "var(--s-2)",
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
        <button
          type="button"
          className="btn"
          onClick={() => {
            triggerHaptic("selection");
            handleContinue();
          }}
          data-autofocus
        >
          Continuar leyendo
        </button>
      </div>
    </Dialog>
  );
}
