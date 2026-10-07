import { useEffect, useRef, useState } from "react";
import Sheet from "./Sheet";
import type { PreparationAnswer, PreparationAnswers } from "../lib/preparation";
import type { SuggestionRow } from "../lib/section-words";

// Una fila de la preparación: la SuggestionRow que construye el
// controlador, con razón y medición opcionales en la vista (las usa
// el trayecto para anotar por qué se presentó cada palabra).
export type SectionPreviewRow = Omit<SuggestionRow, "reason" | "zipf"> & {
  reason?: SuggestionRow["reason"];
  zipf?: SuggestionRow["zipf"];
};

export type SectionPreviewAnalysis = "loading" | "ready" | "error";

export type SectionPreviewProps = {
  // Destino que se prepara («Capítulo 1», «Introducción»…).
  title: string;
  analysis: SectionPreviewAnalysis;
  // Filas en el orden visual fijo: no se reordenan ni desaparecen
  // al responderlas; si llega una definición tardía se actualiza en
  // su lugar (misma `key`).
  rows: SectionPreviewRow[];
  // Respuestas controladas por el controlador (borrador incluido).
  answers: PreparationAnswers;
  // Consulta secundaria: formas que el catálogo no sabe medir. Se
  // muestran colapsadas para no saturar la selección principal.
  uncertainRows?: SectionPreviewRow[];
  // Candidatas que no cupieron en la selección principal: consulta
  // aparte, colapsada y paginada — no son «sin información» ni se
  // declaran conocidas por el recorte.
  deferredRows?: SectionPreviewRow[];
  // El controlador anota qué filas quedaron realmente visibles
  // (trayecto): se dispara al abrir y cada vez que crece lo visible.
  onRowsPresented?: (rows: SectionPreviewRow[]) => void;
  saving: boolean;
  // La definición/contexto se consulta desplegada en la misma
  // preparación; nunca se abre la ficha encima.
  onAnswer: (key: string, answer: PreparationAnswer) => void;
  // «Guardar y leer»: confirma las respuestas explícitas.
  onConfirm: () => void;
  // «Leer sin preparar»: salida siempre alcanzable, sin evidencia.
  onSkip: () => void;
  // Reintenta el análisis tras un error.
  onRetry: () => void;
  // Cerrar conserva el borrador (lo persiste el controlador).
  onClose: () => void;
  // Descarte explícito del borrador; el componente lo confirma en la
  // misma hoja, sin apilar otro diálogo.
  onDiscard: () => void;
};

const PAGE_SIZE = 8;

const groupOf = (row: SectionPreviewRow) =>
  row.meaning == null ? "noDef" : row.learning ? "learning" : "new";

const GROUPS: { id: ReturnType<typeof groupOf>; label: string }[] = [
  { id: "new", label: "Palabras nuevas" },
  { id: "learning", label: "Que estás aprendiendo" },
  { id: "noDef", label: "Sin definición todavía" },
];

function Row({
  row,
  answer,
  expanded,
  saving,
  onAnswer,
  onToggleExpand,
}: {
  row: SectionPreviewRow;
  answer: PreparationAnswer | undefined;
  expanded: boolean;
  saving: boolean;
  onAnswer: (key: string, answer: PreparationAnswer) => void;
  onToggleExpand: (key: string) => void;
}) {
  return (
    <li className="section-preview-item">
      <button
        type="button"
        className="section-preview-open"
        aria-expanded={expanded}
        onClick={() => onToggleExpand(row.key)}
      >
        <strong>{row.form}</strong>
        {row.lemma && row.lemma !== row.form.toLowerCase() ? (
          <span className="section-preview-def"> · forma de «{row.lemma}»</span>
        ) : row.pos ? (
          <span className="section-preview-def"> · {row.pos}</span>
        ) : null}
      </button>
      <span
        className="cal-choices"
        role="group"
        aria-label={`Respuesta para ${row.form}`}
      >
        <button
          type="button"
          className={`cal-choice${answer === "known" ? " is-selected" : ""}`}
          aria-pressed={answer === "known"}
          disabled={saving}
          onClick={() => onAnswer(row.key, "known")}
        >
          La conozco
        </button>
        <button
          type="button"
          className={`cal-choice${answer === "unknown" ? " is-selected" : ""}`}
          aria-pressed={answer === "unknown"}
          disabled={saving}
          onClick={() => onAnswer(row.key, "unknown")}
        >
          No la conozco
        </button>
      </span>
      {expanded ? (
        <p className="section-preview-def">
          {row.meaning ?? "Sin definición todavía"}
          {row.context ? ` — “${row.context}”` : ""}
        </p>
      ) : null}
    </li>
  );
}

// Preparación «Antes de leer»: hoja controlada que lista el
// vocabulario del destino y pide una respuesta explícita por palabra.
// No escribe ni consulta nada: el controlador decide qué se guarda.
export default function SectionPreview({
  title,
  analysis,
  rows,
  answers,
  uncertainRows,
  deferredRows,
  onRowsPresented,
  saving,
  onAnswer,
  onConfirm,
  onSkip,
  onRetry,
  onClose,
  onDiscard,
}: SectionPreviewProps) {
  const [showAll, setShowAll] = useState(false);
  const [showUncertain, setShowUncertain] = useState(false);
  const [showDeferred, setShowDeferred] = useState(false);
  const [deferredShown, setDeferredShown] = useState(PAGE_SIZE);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const answered = Object.keys(answers).length;
  const unknownCount = Object.values(answers).filter(
    (answer) => answer === "unknown",
  ).length;

  const toggleExpand = (key: string) =>
    setExpandedKey((current) => (current === key ? null : key));

  const groups = GROUPS.map((group) => ({
    ...group,
    rows: rows.filter((row) => groupOf(row) === group.id),
  })).filter((group) => group.rows.length);

  let shown = 0;
  const visibleGroups = showAll
    ? groups
    : groups
        .map((group) => {
          const take = Math.max(0, PAGE_SIZE - shown);
          shown += Math.min(take, group.rows.length);
          return { ...group, rows: group.rows.slice(0, take) };
        })
        .filter((group) => group.rows.length);
  const hiddenCount = rows.length - shown;

  // Lo visible en pantalla (grupos principales + consultas abiertas):
  // el controlador deduplica por clave, así basta avisar el conjunto.
  const visibleRows = [
    ...visibleGroups.flatMap((group) => group.rows),
    ...(showUncertain ? (uncertainRows ?? []) : []),
    ...(showDeferred ? (deferredRows ?? []).slice(0, deferredShown) : []),
  ];
  const presentedSigRef = useRef("");
  useEffect(() => {
    const sig = visibleRows.map((row) => row.key).join("|");
    if (sig === presentedSigRef.current) return;
    presentedSigRef.current = sig;
    onRowsPresented?.(visibleRows);
  });

  return (
    <Sheet label={`Antes de leer — ${title}`} onClose={onClose}>
      <div className="sheet-head">
        <strong className="sheet-title">Antes de leer — {title}</strong>
        <button
          type="button"
          className="btn--quiet"
          onClick={onClose}
          aria-label="Cerrar preparación"
          data-autofocus
        >
          Cerrar
        </button>
      </div>

      {analysis === "loading" ? (
        <p className="meta">Preparando vocabulario del capítulo…</p>
      ) : null}

      {analysis === "error" ? (
        <>
          <p role="alert" className="status">
            No se pudo analizar el vocabulario de esta parte.
          </p>
          <div className="actions">
            <button type="button" className="btn" onClick={onRetry}>
              Reintentar
            </button>
            <button type="button" className="btn btn--primary" onClick={onSkip}>
              Leer sin preparar
            </button>
          </div>
        </>
      ) : null}

      {analysis === "ready" && !rows.length ? (
        <>
          <p className="meta">
            Nada que preparar en esta parte: puedes leer tranquilo.
          </p>
          <div className="actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={onSkip}
            >
              Leer
            </button>
          </div>
        </>
      ) : null}

      {analysis === "ready" && rows.length ? (
        <>
          <p className="meta">
            Marca cada palabra: lo que no conozcas se agrega a tu Cuaderno
            al guardar. Puedes dejar algunas sin responder.
          </p>
          {visibleGroups.map((group) => (
            <section key={group.id} className="section-preview-group">
              <h3 className="section-preview-group-title">{group.label}</h3>
              <ul className="section-preview-list">
                {group.rows.map((row) => (
                  <Row
                    key={row.key}
                    row={row}
                    answer={answers[row.key]}
                    expanded={expandedKey === row.key}
                    saving={saving}
                    onAnswer={onAnswer}
                    onToggleExpand={toggleExpand}
                  />
                ))}
              </ul>
            </section>
          ))}
          {hiddenCount > 0 ? (
            <button
              type="button"
              className="btn--quiet"
              onClick={() => setShowAll(true)}
            >
              Ver {hiddenCount} más
            </button>
          ) : null}
          {uncertainRows?.length ? (
            <section className="section-preview-group">
              <h3 className="section-preview-group-title">
                <button
                  type="button"
                  className="btn--quiet"
                  aria-expanded={showUncertain}
                  onClick={() => setShowUncertain((v) => !v)}
                >
                  {showUncertain ? "Ocultar" : "Ver"} otras palabras sin información ({uncertainRows.length})
                </button>
              </h3>
              {showUncertain ? (
                <>
                  <p className="meta">
                    El catálogo no sabe si estas palabras son raras o comunes.
                    Marcadas como desconocidas también irán a tu Cuaderno.
                  </p>
                  <ul className="section-preview-list">
                    {uncertainRows.map((row) => (
                      <Row
                        key={row.key}
                        row={row}
                        answer={answers[row.key]}
                        expanded={expandedKey === row.key}
                        saving={saving}
                        onAnswer={onAnswer}
                        onToggleExpand={toggleExpand}
                      />
                    ))}
                  </ul>
                </>
              ) : null}
            </section>
          ) : null}
          {deferredRows?.length ? (
            <section className="section-preview-group">
              <h3 className="section-preview-group-title">
                <button
                  type="button"
                  className="btn--quiet"
                  aria-expanded={showDeferred}
                  onClick={() => setShowDeferred((v) => !v)}
                >
                  {showDeferred ? "Ocultar" : "Ver"} más palabras de esta parte ({deferredRows.length})
                </button>
              </h3>
              {showDeferred ? (
                <>
                  <p className="meta">
                    No cupieron en la selección principal de esta ronda.
                    Marcadas como desconocidas también irán a tu Cuaderno.
                  </p>
                  <ul className="section-preview-list">
                    {deferredRows.slice(0, deferredShown).map((row) => (
                      <Row
                        key={row.key}
                        row={row}
                        answer={answers[row.key]}
                        expanded={expandedKey === row.key}
                        saving={saving}
                        onAnswer={onAnswer}
                        onToggleExpand={toggleExpand}
                      />
                    ))}
                  </ul>
                  {deferredRows.length > deferredShown ? (
                    <button
                      type="button"
                      className="btn--quiet"
                      onClick={() =>
                        setDeferredShown((n) => n + PAGE_SIZE)
                      }
                    >
                      Ver {deferredRows.length - deferredShown} más
                    </button>
                  ) : null}
                </>
              ) : null}
            </section>
          ) : null}
          <p className="meta">
            {answered
              ? `${answered} respondida(s)${unknownCount ? ` · ${unknownCount} irán a tu Cuaderno` : ""}`
              : "Responde las que quieras; el resto queda pendiente."}
          </p>
          {confirmDiscard ? (
            <p className="meta" role="alert">
              ¿Descartar las respuestas marcadas?
              <button
                type="button"
                className="btn--quiet"
                onClick={() => {
                  setConfirmDiscard(false);
                  onDiscard();
                }}
              >
                Sí, descartar
              </button>
              <button
                type="button"
                className="btn--quiet"
                onClick={() => setConfirmDiscard(false)}
              >
                Conservar
              </button>
            </p>
          ) : answered ? (
            <p className="meta">
              <button
                type="button"
                className="btn--quiet"
                onClick={() => setConfirmDiscard(true)}
              >
                Descartar respuestas
              </button>
            </p>
          ) : null}
          <div className="actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={saving}
              onClick={onConfirm}
            >
              {saving ? "Guardando…" : "Guardar y leer"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={saving}
              onClick={onSkip}
            >
              Leer sin preparar
            </button>
          </div>
        </>
      ) : null}

      {analysis === "loading" ? (
        <div className="actions">
          <button type="button" className="btn" onClick={onSkip}>
            Leer sin preparar
          </button>
        </div>
      ) : null}
    </Sheet>
  );
}
