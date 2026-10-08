import Dialog from "./Dialog";
import { triggerHaptic, type DeepReadingSummary } from "../lib/deep-reading";

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
  const durationText =
    summary.durationMinutes === 1
      ? "1 minuto"
      : `${summary.durationMinutes} minutos`;
  const handleContinue = onContinue ?? onClose;

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

      <div style={{ textAlign: "center", padding: "var(--s-3) 0 var(--s-2)" }}>
        <p className="card-context" style={{ fontStyle: "normal", fontSize: "1.125rem", margin: "0 auto var(--s-2)" }}>
          {durationText} de inmersión profunda
        </p>
        <p className="meta" style={{ fontStyle: "italic" }}>
          «Que las palabras reposen y las ideas decanten con serenidad.»
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
