import { useState } from "react";
import Sheet from "./Sheet";
import type { ChapterTarget } from "../lib/chapters";

export type BookStartChoice = {
  // Dónde empieza la lectura (destino real del catálogo).
  readingTargetId: string;
  // Qué vocabulario preparar; null si no hay capítulo confiable y el
  // lector no eligió uno explícitamente.
  preparationTargetId: string | null;
};

export type BookStartProps = {
  // Catálogo de destinos del libro (T10/T11), ya con profundidad.
  targets: (ChapterTarget & { depth?: number })[];
  // Inicio sugerido (primer capítulo confirmado o primer destino).
  suggestedStartId: string | null;
  // Primer capítulo confirmado; null si no existe → preparar pide
  // elección explícita.
  firstChapterId: string | null;
  // Confirma con destinos reales del catálogo; nunca se llama con un
  // id inexistente.
  onConfirm: (choice: BookStartChoice) => void;
  // Vuelve al flujo anterior sin fingir una elección.
  onClose: () => void;
};

// «¿Dónde empiezas?»: se pregunta una sola vez cuando el libro no
// tiene posición guardada. Dos caminos — empezar donde sugiere el
// libro o elegir destino del índice. Si la elección es preliminar
// (portada, intro…), la preparación apunta al primer capítulo
// confirmado y se explica; sin capítulo confiable se pide elegirlo.
export default function BookStart({
  targets,
  suggestedStartId,
  firstChapterId,
  onConfirm,
  onClose,
}: BookStartProps) {
  const suggested =
    targets.find((t) => t.id === suggestedStartId) ?? targets[0] ?? null;
  const [mode, setMode] = useState<"suggested" | "pick">("suggested");
  const [pickedId, setPickedId] = useState(suggested?.id ?? "");
  const [prepId, setPrepId] = useState("");

  const reading =
    mode === "suggested" ? suggested : targets.find((t) => t.id === pickedId);

  const firstChapter = targets.find((t) => t.id === firstChapterId) ?? null;
  // Capítulo a preparar: el elegido salvo que sea preliminar; entonces
  // el primer capítulo confirmado o una elección explícita.
  const needsPrepPick =
    reading != null && reading.kind === "preliminary" && !firstChapter;
  const preparation = !reading
    ? null
    : reading.kind === "preliminary"
      ? (firstChapter ?? targets.find((t) => t.id === prepId) ?? null)
      : reading;

  const canConfirm = reading != null && (!needsPrepPick || preparation != null);

  const confirm = () => {
    if (!reading || !canConfirm) return;
    onConfirm({
      readingTargetId: reading.id,
      preparationTargetId: preparation?.id ?? null,
    });
  };

  const optionLabel = (id: string) =>
    targets.find((t) => t.id === id)?.label ?? "";

  return (
    <Sheet label="¿Dónde empiezas?" onClose={onClose}>
      <div className="sheet-head">
        <strong className="sheet-title">¿Dónde empiezas?</strong>
        <button
          type="button"
          className="btn--quiet"
          onClick={onClose}
          aria-label="Cerrar elección de inicio"
          data-autofocus
        >
          Cerrar
        </button>
      </div>

      <p className="meta">
        Elige por dónde abrir el libro. Antes de leer prepararemos el
        vocabulario del primer capítulo que corresponda.
      </p>

      {suggested ? (
        <div className="bookstart-options" role="radiogroup" aria-label="Punto de inicio">
          <label className="bookstart-option">
            <input
              type="radio"
              name="bookstart"
              checked={mode === "suggested"}
              onChange={() => setMode("suggested")}
            />
            <span>
              Empezar en «{suggested.label}»
            </span>
          </label>
          <label className="bookstart-option">
            <input
              type="radio"
              name="bookstart"
              checked={mode === "pick"}
              onChange={() => setMode("pick")}
            />
            <span>Elegir otro lugar del índice</span>
          </label>
        </div>
      ) : null}

      {mode === "pick" || !suggested ? (
        <label className="bookstart-pick">
          <span className="meta">Destino del índice</span>
          <select
            value={pickedId}
            onChange={(e) => setPickedId(e.target.value)}
          >
            {!pickedId ? <option value="">Elige una parte…</option> : null}
            {targets.map((target) => (
              <option key={target.id} value={target.id}>
                {" ".repeat((target.depth ?? 0) * 2)}
                {target.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {reading?.kind === "preliminary" ? (
        firstChapter ? (
          <p className="meta">
            Leerás desde «{reading.label}» y prepararemos las palabras de
            «{firstChapter.label}», tu primer capítulo.
          </p>
        ) : (
          <>
            <p className="meta">
              «{reading.label}» no es un capítulo y el libro no marca
              cuál es el primero. Elige qué vocabulario preparar:
            </p>
            <label className="bookstart-pick">
              <span className="meta">Preparar palabras de</span>
              <select value={prepId} onChange={(e) => setPrepId(e.target.value)}>
                <option value="">Elige una parte…</option>
                {targets
                  .filter((t) => t.id !== reading.id)
                  .map((target) => (
                    <option key={target.id} value={target.id}>
                      {optionLabel(target.id)}
                    </option>
                  ))}
              </select>
            </label>
          </>
        )
      ) : null}

      <div className="actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={!canConfirm}
          onClick={confirm}
        >
          Abrir
        </button>
      </div>
    </Sheet>
  );
}
