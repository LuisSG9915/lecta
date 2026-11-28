// «La Mesa de Estudio con el Gato» (Fase 5, V2): portada del Cuaderno con el
// resumen del día, el progreso por etapa, el botón principal (repasar o
// aprender) y el hueco para los modos libres.
import {
  REVIEW_SESSION_SIZE,
} from "../../lib/learn";
import {
  type FilterId,
} from "../../lib/notebook-model";


import { futureRelativeDay } from "../../lib/relative-time";
import { triggerHaptic } from "../../lib/haptics";
import { Companion, type CompanionPose } from "../Companion";
import Icon from "../Icon";

import type { ReactNode } from "react";
import type { CompanionContextValue } from "../CompanionProvider";

export type NotebookTab = "words" | "quotes" | "activity";

type NotebookHeroProps = {
  wordCount: number;
  /** Palabras por aprender (abre la ficha) y para repasar (abre la sesión). */
  learnableCount: number;
  reviewWordCount: number;
  /** Texto del botón «Aprender N de M palabras nuevas». */
  learnLabel: string;
  /** Próximo vencimiento (ms) cuando no hay nada para repasar hoy. */
  nextDueTs: number | null;
  progressStats: { total: number; settled: number; learning: number; newWords: number };
  filter: FilterId;
  setFilter: (update: (prev: FilterId) => FilterId) => void;
  setTab: (tab: NotebookTab) => void;
  /** Compañero activo (null si está apagado): solo entonces se pinta el gato. */
  heroCompanion: CompanionContextValue | null;
  catPose: CompanionPose;
  catSpeech: string;
  onPetCat: () => void;
  startLearn: () => void;
  startAdaptiveFlow: () => void;
  onClose: () => void;
  /** Modos libres (plegable), debajo del botón principal. */
  children?: ReactNode;
};

export function NotebookHero({
  wordCount,
  learnableCount,
  reviewWordCount,
  learnLabel,
  nextDueTs,
  progressStats,
  filter,
  setFilter,
  setTab,
  heroCompanion,
  catPose,
  catSpeech,
  onPetCat,
  startLearn,
  startAdaptiveFlow,
  onClose,
  children,
}: NotebookHeroProps) {
  return (
    <section className="nb-hero-card" aria-label="La Mesa de Estudio con el Gato">
      <div
        className={`nb-hero-study-desk${heroCompanion ? "" : " nb-hero-study-desk--solo"}`}
      >
        {heroCompanion ? (
          <div className="nb-hero-companion-pane">
            <div
              className="nb-hero-cat-wrapper"
              onClick={onPetCat}
              role="button"
              tabIndex={0}
              aria-label={`Interactuar con ${heroCompanion.name}`}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPetCat();
                }
              }}
            >
              <Companion
                stage={heroCompanion.stage}
                mood={heroCompanion.mood}
                accessories={heroCompanion.accessories}
                pose={catPose}
                name={heroCompanion.name}
              />
              {catSpeech ? (
                <div className="nb-hero-cat-bubble" role="status">
                  <span>{catSpeech}</span>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="nb-hero-session-summary">
          <div className="nb-hero-header">
            <span className="nb-hero-eyebrow">La Mesa de Estudio</span>
            <h2 className="nb-hero-title">
              {reviewWordCount > 0
                ? `Tienes ${reviewWordCount} ${
                    reviewWordCount === 1 ? "palabra" : "palabras"
                  } para repasar hoy`
                : learnableCount > 0
                  ? `Tienes ${learnableCount} ${
                      learnableCount === 1 ? "palabra nueva" : "palabras nuevas"
                    } para aprender`
                  : wordCount === 0
                    ? "Tu Herbario está esperando tus lecturas"
                    : `Estás al día. ${nextDueTs !== null ? `El próximo repaso: ${futureRelativeDay(nextDueTs)}` : "Tu mente descansa hoy."}`}
            </h2>
          </div>

          {wordCount > 0 ? (
            <div className="vocab-progress-card" aria-label="Progreso del Herbario">
              <div
                className="vocab-progress-track"
                role="progressbar"
                aria-label="Progreso del Herbario"
                aria-valuenow={progressStats.settled}
                aria-valuemin={0}
                aria-valuemax={progressStats.total}
              >
                <div
                  className="vocab-progress-seg vocab-progress-seg--settled"
                  style={{
                    inlineSize: `${progressStats.total > 0 ? (progressStats.settled / progressStats.total) * 100 : 0}%`,
                  }}
                  title={`${progressStats.settled} dominadas`}
                />
                <div
                  className="vocab-progress-seg vocab-progress-seg--learning"
                  style={{
                    inlineSize: `${progressStats.total > 0 ? (progressStats.learning / progressStats.total) * 100 : 0}%`,
                  }}
                  title={`${progressStats.learning} en práctica`}
                />
                <div
                  className="vocab-progress-seg vocab-progress-seg--new"
                  style={{
                    inlineSize: `${progressStats.total > 0 ? (progressStats.newWords / progressStats.total) * 100 : 0}%`,
                  }}
                  title={`${progressStats.newWords} nuevas`}
                />
              </div>
              <div className="vocab-progress-legend" role="group" aria-label="Filtrar por nivel de dominio">
                <button
                  type="button"
                  className={`vocab-progress-item vocab-progress-pill vocab-progress-item--new ${filter === "new" ? "is-active" : ""}`}
                  onClick={() => {
                    triggerHaptic("selection");
                    setFilter((prev) => (prev === "new" ? "all" : "new"));
                    setTab("words");
                  }}
                  aria-pressed={filter === "new"}
                >
                  <span className="vocab-progress-dot" aria-hidden="true" />
                  <span className="vocab-progress-name">Nuevas</span>
                  <strong className="vocab-progress-count">{progressStats.newWords}</strong>
                </button>
                <button
                  type="button"
                  className={`vocab-progress-item vocab-progress-pill vocab-progress-item--learning ${filter === "learning" ? "is-active" : ""}`}
                  onClick={() => {
                    triggerHaptic("selection");
                    setFilter((prev) => (prev === "learning" ? "all" : "learning"));
                    setTab("words");
                  }}
                  aria-pressed={filter === "learning"}
                >
                  <span className="vocab-progress-dot" aria-hidden="true" />
                  <span className="vocab-progress-name">En Práctica</span>
                  <strong className="vocab-progress-count">{progressStats.learning}</strong>
                </button>
                <button
                  type="button"
                  className={`vocab-progress-item vocab-progress-pill vocab-progress-item--settled ${filter === "settled" ? "is-active" : ""}`}
                  onClick={() => {
                    triggerHaptic("selection");
                    setFilter((prev) => (prev === "settled" ? "all" : "settled"));
                    setTab("words");
                  }}
                  aria-pressed={filter === "settled"}
                >
                  <span className="vocab-progress-dot" aria-hidden="true" />
                  <span className="vocab-progress-name">Dominadas</span>
                  <strong className="vocab-progress-count">{progressStats.settled}</strong>
                </button>
              </div>
            </div>
          ) : null}

          {/* CTA Principal Único: un solo botón, con cifra y verbo honestos */}
          <div className="nb-hero-cta">
            {wordCount === 0 ? (
              <button
                type="button"
                className="btn btn--primary nb-hero-btn-flow"
                onClick={onClose}
              >
                <Icon name="shelf" size={16} />
                <span>Abrir un libro para guardar palabras</span>
              </button>
            ) : reviewWordCount > 0 ? (
              // Repasar primero: lo vencido se atrasa si el botón
              // principal siempre manda a aprender. «Aprender» queda
              // como segundo botón mientras haya palabras nuevas.
              <>
                <button
                  type="button"
                  className="btn btn--primary nb-hero-btn-flow"
                  aria-label={`Repasar ${Math.min(REVIEW_SESSION_SIZE, reviewWordCount)} ${
                    Math.min(REVIEW_SESSION_SIZE, reviewWordCount) === 1
                      ? "palabra"
                      : "palabras"
                  }`}
                  onClick={() => startAdaptiveFlow()}
                >
                  <Icon name="sparkles" size={16} />
                  <span>
                    Repasar {Math.min(REVIEW_SESSION_SIZE, reviewWordCount)}{" "}
                    {Math.min(REVIEW_SESSION_SIZE, reviewWordCount) === 1
                      ? "palabra"
                      : "palabras"}
                  </span>
                </button>
                {learnableCount > 0 ? (
                  <button
                    type="button"
                    className="btn nb-hero-btn-flow"
                    aria-label={learnLabel}
                    onClick={() => startLearn()}
                  >
                    <span>{learnLabel}</span>
                  </button>
                ) : null}
              </>
            ) : learnableCount > 0 ? (
              <button
                type="button"
                className="btn btn--primary nb-hero-btn-flow"
                aria-label={learnLabel}
                onClick={() => startLearn()}
              >
                <Icon name="sparkles" size={16} />
                <span>{learnLabel}</span>
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--primary nb-hero-btn-flow"
                onClick={onClose}
              >
                <Icon name="shelf" size={16} />
                <span>Seguir leyendo</span>
              </button>
            )}
          </div>

          {children}
        </div>
      </div>
    </section>
  );
}
