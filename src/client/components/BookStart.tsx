import { useState } from "react";
import Sheet from "./Sheet";
import type { ChapterTarget } from "../lib/chapters";
import { useCompanionSafe } from "./CompanionProvider";
import { Companion } from "./Companion";
import { loadNativeLanguage, type StrategyPreset } from "../lib/settings";
import { loadUserTheta, saveUserTheta } from "../lib/profile-models";

export type BookStartChoice = {
  // Dónde empieza la lectura (destino real del catálogo).
  readingTargetId: string;
  // Qué vocabulario preparar; null si no hay capítulo confiable y el
  // lector no eligió uno explícitamente.
  preparationTargetId: string | null;
  strategyPreset?: StrategyPreset;
};

export type LexicalGem = {
  word: string;
  lemma?: string;
  meaning?: string;
  zipf?: number;
};

export interface L2LevelOption {
  id: string;
  label: string;
  logit: number;
  theta: number;
  desc: string;
}

export const L2_LEVEL_OPTIONS: readonly L2LevelOption[] = [
  { id: "a2_b1", label: "A2–B1", logit: -0.6, theta: 3.4, desc: "Intermedio inicial" },
  { id: "b2", label: "B2", logit: 0.2, theta: 4.2, desc: "Intermedio estándar" },
  { id: "c1_c2", label: "C1–C2", logit: 1.0, theta: 5.0, desc: "Avanzado" },
];

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
  bookTitle?: string;
  author?: string;
  totalWords?: number;
  sampleVocab?: LexicalGem[];
  averageSentenceLength?: number;
  suggestedStrategy?: StrategyPreset;
  language?: string;
  isSecondLanguage?: boolean;
  onStartCalibration?: (lang: string) => void;
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
  bookTitle,
  author,
  totalWords,
  sampleVocab,
  averageSentenceLength,
  suggestedStrategy,
  language = "es",
  isSecondLanguage,
  onStartCalibration,
}: BookStartProps) {
  const companion = useCompanionSafe();
  const suggested =
    targets.find((t) => t.id === suggestedStartId) ?? targets[0] ?? null;
  const [mode, setMode] = useState<"suggested" | "pick">("suggested");
  const [pickedId, setPickedId] = useState(suggested?.id ?? "");
  const [prepId, setPrepId] = useState("");
  const [selectedGem, setSelectedGem] = useState<LexicalGem | null>(null);

  const isL2English =
    (language.toLowerCase().startsWith("en") && isSecondLanguage !== false) ||
    (language.toLowerCase().startsWith("en") && loadNativeLanguage() !== "en");

  const [l2Level, setL2Level] = useState<number | null>(() => {
    if (!isL2English) return null;
    const currentTheta = loadUserTheta(3.0, "en");
    if (Math.abs(currentTheta - 3.4) < 0.3) return -0.6;
    if (Math.abs(currentTheta - 4.2) < 0.3) return 0.2;
    if (Math.abs(currentTheta - 5.0) < 0.3) return 1.0;
    return null;
  });

  const selectLevel = (logit: number, theta: number) => {
    setL2Level(logit);
    saveUserTheta(theta, "en");
  };

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

  // Estrategia recomendada por el gato basada en la longitud media de oraciones
  const strategy: StrategyPreset =
    suggestedStrategy ??
    (averageSentenceLength && averageSentenceLength > 22
      ? "lexical"
      : "focus");

  const catSpeechText =
    isL2English
      ? "¡Bienvenido! He preparado este libro en inglés adaptando las notas de vocabulario a tu nivel."
      : strategy === "lexical"
        ? "Este libro tiene oraciones largas y poéticas; te recomiendo activar «Líneas Sintácticas»."
        : "¡Bienvenido! He preparado el mapa de expedición de este libro y te recomiendo activar «Enfoque Profundo».";

  const chapterCount =
    targets.filter((t) => t.kind === "chapter").length || targets.length;
  const estimatedMins = totalWords
    ? Math.max(5, Math.round(totalWords / 200))
    : chapterCount * 12;
  const timeLabel =
    estimatedMins >= 60
      ? `~${Math.round(estimatedMins / 60)} h`
      : `~${estimatedMins} min`;

  const activeGems: LexicalGem[] = sampleVocab ?? (
    language.toLowerCase().startsWith("en")
      ? [
          { word: "wander", meaning: "Caminar sin rumbo fijo o perderse en pensamientos" },
          { word: "glimmer", meaning: "Brillo tenue o débil que titila" },
          { word: "whisper", meaning: "Hablar en voz muy baja o susurrar" },
          { word: "fierce", meaning: "Intenso, salvaje o con gran fuerza" },
        ]
      : [
          { word: "azur", meaning: "De color azul heráldico o poético" },
          { word: "alba", meaning: "Primera luz del día antes de salir el sol" },
          { word: "cisne", meaning: "Ave emblemática del Modernismo literario" },
          { word: "quimera", meaning: "Sueño o ilusión hermosa que se persigue" },
        ]
  );

  const confirm = () => {
    if (!reading || !canConfirm) return;
    onConfirm({
      readingTargetId: reading.id,
      preparationTargetId: preparation?.id ?? null,
    });
  };

  const confirmWithStrategy = () => {
    if (!reading || !canConfirm) return;
    onConfirm({
      readingTargetId: reading.id,
      preparationTargetId: preparation?.id ?? null,
      strategyPreset: strategy,
    });
  };

  const optionLabel = (id: string) =>
    targets.find((t) => t.id === id)?.label ?? "";

  return (
    <Sheet label="¿Dónde empiezas?" onClose={onClose}>
      <div className="sheet-head">
        <div>
          <strong className="sheet-title">Mapa de Expedición del Libro</strong>
          {bookTitle ? (
            <p className="meta" style={{ margin: 0, fontSize: "var(--fs-xs)" }}>
              {bookTitle} {author ? `· ${author}` : ""}
            </p>
          ) : null}
        </div>
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

      <div className="portico-cat-section" style={{ marginBlock: "var(--s-2) var(--s-3)" }}>
        <div className="portico-cat-avatar">
          {companion ? (
            <Companion
              stage={companion.stage}
              mood="awake"
              accessories={companion.accessories}
              pose="greet"
            />
          ) : (
            <span className="portico-cat-fallback-icon" aria-hidden="true">🐱</span>
          )}
        </div>
        <div className="portico-speech-bubble" role="status">
          <p>{catSpeechText}</p>
        </div>
      </div>

      {isL2English ? (
        <div className="bookstart-l2-section" role="region" aria-label="Modo Segunda Lengua">
          <div className="bookstart-l2-badge">
            <span className="bookstart-l2-flag" aria-hidden="true">🇬🇧</span>
            <strong>Libro en inglés · Modo Segunda Lengua (L2)</strong>
          </div>
          <p className="meta bookstart-l2-hint">
            Nivel estimado para adaptar la preparación y el vocabulario inicial:
          </p>
          <div className="bookstart-l2-levels" role="group" aria-label="Nivel de vocabulario en inglés">
            {L2_LEVEL_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`btn bookstart-level-pill${l2Level === opt.logit ? " bookstart-level-pill--active" : ""}`}
                onClick={() => selectLevel(opt.logit, opt.theta)}
                title={opt.desc}
              >
                <span className="bookstart-level-label">{opt.label}</span>
                <span className="bookstart-level-val">({opt.logit > 0 ? `+${opt.logit}` : opt.logit})</span>
              </button>
            ))}
            {onStartCalibration ? (
              <button
                type="button"
                className="btn btn--quiet bookstart-calibrate-btn"
                onClick={() => onStartCalibration("en")}
              >
                Calibrar →
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Sinopsis de Preparación: tiempo total y número de capítulos */}
      <div className="bookstart-synopsis">
        <div className="bookstart-synopsis-item">
          <span className="meta">Estructura</span>
          <strong>{chapterCount} partes / capítulos</strong>
        </div>
        <div className="bookstart-synopsis-item">
          <span className="meta">Tiempo total estimado</span>
          <strong>{timeLabel} de lectura</strong>
        </div>
      </div>

      {/* Muestras de Vocabulario: Joyas Léxicas del libro */}
      {activeGems.length > 0 ? (
        <div className="bookstart-gems-section">
          <p className="meta bookstart-gems-title">Joyas Léxicas de esta obra</p>
          <div className="bookstart-gems-list" role="list" aria-label="Joyas léxicas">
            {activeGems.map((gem) => (
              <button
                key={gem.word}
                type="button"
                className={`lexical-gem-chip${selectedGem?.word === gem.word ? " lexical-gem-chip--active" : ""}`}
                onClick={() => setSelectedGem(selectedGem?.word === gem.word ? null : gem)}
                title={gem.meaning ? `${gem.word}: ${gem.meaning}` : gem.word}
              >
                <span className="gem-sparkle" aria-hidden="true">✦</span>
                <span className="gem-word">{gem.word}</span>
              </button>
            ))}
          </div>
          {selectedGem?.meaning ? (
            <p className="meta gem-meaning-preview">
              <em>«{selectedGem.word}»:</em> {selectedGem.meaning}
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="meta" style={{ marginBlockStart: "var(--s-3)" }}>
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

      <div className="actions bookstart-actions">
        <button
          type="button"
          className="btn btn--primary btn--strategy-start"
          disabled={!canConfirm}
          onClick={confirmWithStrategy}
        >
          Comenzar con esta estrategia
        </button>
        <button
          type="button"
          className="btn"
          disabled={!canConfirm}
          onClick={confirm}
        >
          Abrir
        </button>
      </div>
    </Sheet>
  );
}
