// Ficha guiada de «Aprender» y su pantalla final (Fase 5, V2): muestra la
// palabra con su frase del libro, revela el significado y ofrece «Ya la
// conozco» / «Quiero aprenderla» / «Pasar por ahora», con el puente a repaso.
import {
  type SavedWord,
} from "../../lib/idb";
import {
  LEARN_SESSION_SIZE,
  REVIEW_SESSION_SIZE,
} from "../../lib/learn";


import { PracticeContext } from "../PracticeContext";
import { PracticeCompanionHeader } from "../PracticeCompanionHeader";
import { speakWord } from "../../lib/speech";
import Icon from "../Icon";

import type { LearnState, UseLearnSessionResult } from "../../hooks/useLearnSession";
import type { UsePracticeCompanionResult } from "../../hooks/usePracticeCompanion";

type LearnSessionViewProps = {
  /** Tanda activa (ya hay sesión de Aprender). */
  learn: LearnState;
  session: UseLearnSessionResult;
  practiceCompanion: UsePracticeCompanionResult;
  hasSession: boolean;
  useAi: boolean;
  /** Palabras que siguen por aprender (para «Seguir aprendiendo»). */
  learnPending: SavedWord[];
  /** Título visible del libro de una palabra, si se conoce. */
  wordBookTitle: (word: SavedWord) => string | undefined;
  /** Puente a repaso: «Repasar estas N palabras». */
  startAdaptiveFlow: (onlyKeys?: ReadonlySet<string>) => void;
  /** Foco inicial del botón «Mostrar significado» (lo comparte la sesión de repaso). */
  revealButtonRef: React.RefObject<HTMLButtonElement | null>;
  /** Toque al gato: una caricia (Aprender no pide pistas). */
  onCatTap: () => void;
};

export function LearnSessionView({
  learn,
  session,
  practiceCompanion,
  hasSession,
  useAi,
  learnPending,
  wordBookTitle,
  startAdaptiveFlow,
  revealButtonRef,
  onCatTap,
}: LearnSessionViewProps) {
  const {
    learnBusy,
    learnDraft,
    learnEnrich,
    learnError,
    learnKeep,
    learnKnown,
    learnSaveMeaning,
    passLearn,
    setLearn,
    setLearnDraft,
    startLearn,
  } = session;
  const { catPose, catSpeech, combo, companionMode, updateCompanionMode } = practiceCompanion;

  return (
    learn.done || learn.items.length === 0 ? (
      <div className="nb-done">
        <p className="nb-done-title">Aprender terminado.</p>
        <p className="meta">
          {learn.total - learn.items.length}{" "}
          {learn.total - learn.items.length === 1
            ? "palabra vista"
            : "palabras vistas"}
          {learnPending.length > 0
            ? ` · quedan ${learnPending.length} por aprender`
            : ""}
          .
        </p>
        {learn.kept.length > 0 ? (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              const keys = new Set(learn.kept);
              setLearn(null);
              startAdaptiveFlow(keys);
            }}
          >
            {Math.min(REVIEW_SESSION_SIZE, learn.kept.length) === 1
              ? "Repasar esta palabra"
              : `Repasar estas ${Math.min(REVIEW_SESSION_SIZE, learn.kept.length)} palabras`}
          </button>
        ) : null}
        {learnPending.length > 0 ? (
          <button
            type="button"
            className={learn.kept.length > 0 ? "btn" : "btn btn--primary"}
            onClick={() => startLearn()}
          >
            Seguir aprendiendo (
            {Math.min(LEARN_SESSION_SIZE, learnPending.length)})
          </button>
        ) : null}
        <button
          type="button"
          className="btn--quiet"
          onClick={() => setLearn(null)}
        >
          Ver el cuaderno
        </button>
      </div>
    ) : (
      <div className="nb-practice">
        <PracticeCompanionHeader
          pose={catPose}
          speech={catSpeech}
          combo={combo}
          mode={companionMode}
          onModeChange={updateCompanionMode}
          onCatTap={onCatTap}
        />
        <p className="meta nb-practice-meta">
          Lee la frase del libro: ¿qué crees que significa aquí?
        </p>
        <div className="index-card nb-card">
          <div className="game-book-eco-row">
            <span className="game-book-eco-pill">
              {wordBookTitle(learn.items[0])
                ? `Eco de: ${wordBookTitle(learn.items[0])}`
                : "De tus lecturas recientes"}
            </span>
          </div>
          <p className="nb-card-front">
            <strong>{learn.items[0].form}</strong>
            <button
              type="button"
              className="btn--pronounce"
              aria-label={`Pronunciar ${learn.items[0].form}`}
              title="Escuchar pronunciación"
              onClick={() => void speakWord(learn.items[0].form, learn.items[0].language)}
            >
              <Icon name="speaker" size={16} />
            </button>
            {learn.items[0].pos ? (
              <span className="card-pos"> · {learn.items[0].pos}</span>
            ) : null}
          </p>
          {learn.items[0].lemma && learn.items[0].lemma !== learn.items[0].form ? (
            <p className="meta">de «{learn.items[0].lemma}»</p>
          ) : null}
          {learn.items[0].context ? (
            <PracticeContext
              key={learn.items[0].key}
              text={learn.items[0].context}
              target={learn.items[0].form}
              language={learn.items[0].language}
              highlightTarget
              lemma={learn.items[0].lemma ?? undefined}
            />
          ) : null}
          {learn.revealed ? (
            learn.items[0].meaning ? (
              <p className="nb-card-back">{learn.items[0].meaning}</p>
            ) : (
              <>
                <p className="nb-card-back meta">
                  Sin significado guardado: sin él no puede entrar
                  al repaso.
                </p>
                {hasSession && useAi ? (
                  <button
                    type="button"
                    className="btn"
                    disabled={learnBusy === "enrich"}
                    onClick={() => void learnEnrich()}
                  >
                    {learnBusy === "enrich"
                      ? "Consultando…"
                      : "Definir con IA"}
                  </button>
                ) : null}
                <form
                  className="nb-learn-meaning-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void learnSaveMeaning();
                  }}
                >
                  <label className="nb-learn-meaning-label" htmlFor={`learn-meaning-${learn.items[0].key}`}>
                    ¿Qué significa? Escríbelo tú:
                  </label>
                  <input
                    id={`learn-meaning-${learn.items[0].key}`}
                    type="text"
                    className="nb-learn-meaning-input"
                    value={learnDraft}
                    disabled={Boolean(learnBusy)}
                    onChange={(event) => setLearnDraft(event.target.value)}
                    placeholder="Escribe el significado"
                    autoComplete="off"
                  />
                  <button
                    type="submit"
                    className="btn"
                    disabled={Boolean(learnBusy) || !learnDraft.trim()}
                  >
                    Guardar significado
                  </button>
                </form>
              </>
            )
          ) : (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() =>
                setLearn({ ...learn, revealed: true })
              }
              ref={revealButtonRef}
            >
              Mostrar significado
            </button>
          )}
        </div>
        {learn.revealed ? (
          <div className="actions">
            <button
              type="button"
              className="btn"
              disabled={Boolean(learnBusy)}
              onClick={() => void learnKnown()}
            >
              Ya la conozco
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={Boolean(learnBusy) || !learn.items[0].meaning}
              title={
                learn.items[0].meaning
                  ? undefined
                  : "Necesita un significado para entrar al repaso"
              }
              onClick={() => void learnKeep()}
            >
              Quiero aprenderla
            </button>
            {!learn.items[0].meaning ? (
              // Sin significado no hay nada que aprender ni que repasar:
              // se puede pasar sin escribir exposición ni tarjeta.
              <button
                type="button"
                className="btn--quiet"
                disabled={Boolean(learnBusy)}
                onClick={passLearn}
              >
                Pasar por ahora
              </button>
            ) : null}
          </div>
        ) : null}
        {learnError ? (
          <p className="status" role="alert">
            {learnError}
          </p>
        ) : null}
      </div>
    )
  );
}
