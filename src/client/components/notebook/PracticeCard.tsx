// Tarjeta de un ejercicio del repaso (Fase 5, V2): pinta el modo actual —
// parejas, descifrar, categoría, ordenar frase, escribir, elegir/acepción o
// autovaloración — con las acciones del hook useReviewSession.
import {
  Rating,
} from "../../lib/fsrs";
import {
  type SavedWord,
} from "../../lib/idb";
import {
  conciseMeaning,
  EXERCISE_RATING,
} from "../../lib/practice";
import {
  type QueueItem,
  MODES,
  EXERCISE_MODES,
  GRADES,
  VERIFY_PLAN_REQUIRED,
} from "../../lib/notebook-model";
import { PracticeContext } from "../PracticeContext";
import PlanNote from "../PlanNote";
import { PracticeCompanionHeader } from "../PracticeCompanionHeader";
import { WordScrambleGame } from "../WordScrambleGame";
import { GrammarGame } from "../GrammarGame";
import { SentenceBuilderGame } from "../SentenceBuilderGame";
import { speakWord } from "../../lib/speech";
import Icon from "../Icon";

import type { UseReviewSessionResult } from "../../hooks/useReviewSession";
import type { UsePracticeCompanionResult } from "../../hooks/usePracticeCompanion";

type PracticeCardProps = {
  /** Ejercicio en curso (la cola no está vacía). */
  current: QueueItem;
  review: UseReviewSessionResult;
  practiceCompanion: UsePracticeCompanionResult;
  hasSession: boolean;
  canHint: boolean;
  useAi: boolean;
  /** Título visible del libro de una palabra, si se conoce. */
  wordBookTitle: (word: SavedWord) => string | undefined;
};

export function PracticeCard({
  current,
  review,
  practiceCompanion,
  hasSession,
  canHint,
  useAi,
  wordBookTitle,
}: PracticeCardProps) {
  const {
    answerOption,
    answered,
    askCatHint,
    catTap,
    checkWriteSentence,
    choiceOptions,
    cloze,
    clozeNewText,
    continueRef,
    done,
    firstGradeRef,
    grade,
    grading,
    hintBusy,
    hintText,
    hintUsed,
    matchDone,
    matchFlash,
    matchLeft,
    matchRight,
    matchSel,
    pickMeaning,
    previews,
    queueTotal,
    reveal,
    revealButtonRef,
    revealed,
    senseLikeAnswer,
    senseLikeOptions,
    setMatchSel,
    setVerifyError,
    setVerifyResult,
    setWritePick,
    setWriteText,
    tanda,
    tryRescue,
    verifyError,
    verifyResult,
    verifying,
    writeAreaRef,
    writePick,
    writeText,
  } = review;
  const {
    catPose,
    catSpeech,
    combo,
    companionMode,
    setCatPose,
    setCatSpeech,
    setCombo,
    settleCatAfter,
    updateCompanionMode,
  } = practiceCompanion;

  // Minijuegos: la racha suma al resolver (grade no la repite) y el gato
  // vuelve a «idle» pasados 2,2 s para no celebrar en el reto siguiente.
  const solveReaction = (speech: string, streakSpeech: (n: number) => string) => {
    const next = combo + 1;
    setCombo(next);
    setCatPose(next >= 3 ? "playful_hop" : "celebrate");
    setCatSpeech(next >= 3 ? streakSpeech(next) : speech);
    settleCatAfter(2200);
  };
  const wrongReaction = (speech: string) => {
    setCatPose("pet");
    setCatSpeech(speech);
    setCombo(0);
    settleCatAfter(2200);
  };
  const hintBox =
    hintText && current.mode !== "write" ? (
      <p className="scramble-hint-box" role="status">
        💡 {hintText}
      </p>
    ) : null;

  return (
    <div className="nb-practice">
      <PracticeCompanionHeader
        pose={catPose}
        speech={catSpeech}
        combo={combo}
        mode={companionMode}
        onModeChange={updateCompanionMode}
        onAskHint={canHint && current.mode !== "write" ? askCatHint : undefined}
        onCatTap={catTap}
        hintBusy={hintBusy}
        hintUsed={hintUsed}
        progress={{
          current: done + 1,
          total: queueTotal,
        }}
        instruction={
          current.mode === "scramble"
            ? "Toca las fichas en orden para completar la palabra del pasaje."
            : current.mode === "syntax"
              ? "Ordena los fragmentos con sentido para reconstruir la frase literaria."
              : current.mode === "grammar"
                ? "Observa la escena e identifica qué papel cumple la palabra."
                : current.mode === "match"
                  ? "Empareja cada término con su significado correspondiente."
                  : undefined
        }
      />
      <div className="nb-practice-progress-row">
        <span className="game-book-eco-pill">
          {wordBookTitle(current.word)
            ? `Eco de: ${wordBookTitle(current.word)}`
            : "De tus lecturas recientes"}
        </span>
        <span className="nb-practice-counter meta">
          {MODES.find((m) => m.id === current.mode)?.label ?? ""}
        </span>
      </div>

      {current.mode === "match" ? (
        <>
          <div className="match-header-tracker">
            <span>Parejas: {matchDone.size} de {tanda.length}</span>
            <div className="match-dots" aria-hidden="true">
              {tanda.map((item, idx) => (
                <span
                  key={item.word.key}
                  className={`match-dot${matchDone.size > idx ? " is-done" : ""}`}
                />
              ))}
            </div>
          </div>
          <div className="match-board">
            <div className="match-col" role="group" aria-label="Palabras">
              {matchLeft.map((item) => (
                <button
                  key={item.word.key}
                  type="button"
                  className={`btn match-option${
                    matchDone.has(item.word.key) ? " is-done" : ""
                  }`}
                  aria-pressed={matchSel === item.word.key}
                  disabled={matchDone.has(item.word.key) || grading}
                  onClick={() =>
                    setMatchSel(matchSel === item.word.key ? null : item.word.key)
                  }
                >
                  {item.word.form}
                </button>
              ))}
            </div>
            <div className="match-col" role="group" aria-label="Significados">
              {matchRight.map((item) => (
                <button
                  key={item.word.key}
                  type="button"
                  className={`btn match-option${
                    matchDone.has(item.word.key) ? " is-done" : ""
                  }${matchFlash === item.word.key ? " is-wrong" : ""}`}
                  disabled={matchDone.has(item.word.key) || grading}
                  onClick={() => pickMeaning(item.word.key)}
                  title={item.word.meaning ?? undefined}
                >
                  {conciseMeaning(item.word.meaning ?? "", 68)}
                </button>
              ))}
            </div>
          </div>
          <p className="meta nb-keys-hint">Toca una palabra y luego su significado.</p>
        </>
      ) : current.mode === "scramble" ? (
        <WordScrambleGame
          key={current.word.key}
          targetWord={current.word.form}
          meaning={current.word.meaning}
          pos={current.word.pos}
          context={current.word.context}
          language={current.word.language}
          disabled={grading}
          hintText={hintText}
          hintBusy={hintBusy}
          onAskHint={canHint ? askCatHint : undefined}
          onSolve={() => {
            solveReaction("¡Palabra descifrada!", (n) => `¡En racha! x${n}`);
            void grade(current, EXERCISE_RATING.correct);
          }}
          onWrong={() => {
            if (tryRescue(current, "¡No pasa nada! El gato te ayuda: inténtalo en contexto.")) return;
            wrongReaction("Casi... ¡revisa el orden de las letras!");
          }}
        />
      ) : current.mode === "grammar" ? (
        <GrammarGame
          key={current.word.key}
          targetWord={current.word.form}
          meaning={current.word.meaning}
          pos={current.word.pos}
          context={current.word.context}
          language={current.word.language}
          disabled={grading}
          hintText={hintText}
          hintBusy={hintBusy}
          onAskHint={canHint ? askCatHint : undefined}
          onSolve={() => {
            solveReaction("¡Categoría acertada!", (n) => `¡Gramática en racha! x${n}`);
            void grade(current, EXERCISE_RATING.correct);
          }}
          onWrong={() => {
            if (tryRescue(current, "¡Tranquilo! Vamos a ver la palabra en su oración.")) return;
            wrongReaction("Casi... revisa la función de la palabra.");
          }}
        />
      ) : current.mode === "syntax" ? (
        <SentenceBuilderGame
          key={current.word.key}
          targetWord={current.word.form}
          meaning={current.word.meaning}
          sentence={current.word.context ?? ""}
          language={current.word.language}
          disabled={grading}
          hintText={hintText}
          hintBusy={hintBusy}
          onAskHint={canHint ? askCatHint : undefined}
          onSolve={() => {
            solveReaction("¡Oración ordenada!", (n) => `¡Sintaxis en racha! x${n}`);
            void grade(current, EXERCISE_RATING.correct);
          }}
          onWrong={() => {
            if (tryRescue(current, "¡No pasa nada! Reconozcamos la palabra primero.")) return;
            wrongReaction("Revisa el orden de las palabras.");
          }}
        />
      ) : current.mode === "write" ? (
        <>
          <div className="index-card nb-card">
            <p className="nb-card-front">
              Escribe una oración con «<strong>{current.word.form}</strong>»
            </p>
            {current.word.meaning ? (
              <p className="meta">Significado: {current.word.meaning}</p>
            ) : null}
          </div>

          <div className="write-box">
            <label className="visually-hidden" htmlFor="nb-write-input">
              Tu oración con «{current.word.form}»
            </label>
            <textarea
              id="nb-write-input"
              ref={writeAreaRef}
              value={writeText}
              rows={3}
              disabled={grading}
              autoComplete="off"
              placeholder="Escribe aquí tu oración…"
              onChange={(event) => {
                setWriteText(event.target.value);
                // La revisión y la calificación hablaban del texto
                // anterior; si la oración cambia se descartan.
                setVerifyResult(null);
                setVerifyError("");
                setWritePick(null);
              }}
            />
          </div>

          {hasSession && useAi ? (
            <button
              type="button"
              className="btn"
              disabled={!writeText.trim() || verifying || grading}
              onClick={() => void checkWriteSentence()}
            >
              {verifying ? "Revisando…" : "Comprobar con IA"}
            </button>
          ) : null}

          {verifyResult?.feedback ? (
            <p className="verify-feedback" role="status">
              {verifyResult.feedback}
            </p>
          ) : null}
          {verifyError === VERIFY_PLAN_REQUIRED ? (
            <PlanNote
              feature="ai-check"
              title="Comprobar con IA es de Lecta+."
              detail="Califica tu oración tú mismo, justo debajo."
            />
          ) : verifyError ? (
            <p className="status" role="alert">
              {verifyError}
            </p>
          ) : null}

          {/* Con sesión y la IA encendida la autocalificación
              aparece tras revisar (o tras el error de la IA);
              sin una de las dos va directa. El texto vacío no
              califica. */}
          {!hasSession || !useAi || verifyResult || verifyError ? (
            <div
              className="practice-grades write-grades"
              role="group"
              aria-label="Calificar tu oración"
            >
              <div className="grade-col">
                <button
                  type="button"
                  className="btn"
                  aria-pressed={writePick === "again"}
                  disabled={!writeText.trim() || grading}
                  onClick={() => setWritePick("again")}
                >
                  Otra vez
                </button>
              </div>
              <div className="grade-col">
                <button
                  type="button"
                  className="btn"
                  aria-pressed={writePick === "good"}
                  disabled={!writeText.trim() || grading}
                  onClick={() => setWritePick("good")}
                >
                  Bien
                </button>
              </div>
            </div>
          ) : null}

          {writePick ? (
            <button
              type="button"
              className="btn btn--primary nb-continue"
              ref={continueRef}
              disabled={grading}
              onClick={() =>
                void grade(
                  current,
                  writePick === "good" ? Rating.Good : Rating.Again,
                )
              }
            >
              Continuar
            </button>
          ) : null}
        </>
      ) : EXERCISE_MODES.has(current.mode) ? (
        <>
          <div className="index-card nb-card">
            {current.mode === "choose" ? (
              <>
                {cloze ? (
                  <PracticeContext
                    key={`${current.word.key}:choose`}
                    text={cloze}
                    target="_____"
                    language={current.word.language}
                  />
                ) : null}
                <p className="meta">Toca la palabra que falta.</p>
                {hintBox}
              </>
            ) : current.mode === "context" ? (
              <>
                {/* La palabra NO se oculta: se mide reconocer el
                    sentido en una oración nueva del catálogo. */}
                {current.item?.sentence ? (
                  <PracticeContext
                    key={`${current.word.key}:context`}
                    text={current.item.sentence}
                    target={current.word.form}
                    language={current.word.language}
                    highlightTarget
                    lemma={current.word.lemma ?? undefined}
                  />
                ) : null}
                <p className="meta">
                  ¿Qué significa «{current.word.form}» en esta oración?
                </p>
                {hintBox}
              </>
            ) : (
              <>
                <p className="nb-card-front">
                  <strong>{current.word.form}</strong>
                  <button
                    type="button"
                    className="btn--pronounce"
                    aria-label={`Pronunciar ${current.word.form}`}
                    title="Escuchar pronunciación"
                    onClick={() => void speakWord(current.word.form, current.word.language)}
                  >
                    <Icon name="speaker" size={16} />
                  </button>
                  {current.word.pos ? (
                    <span className="card-pos"> · {current.word.pos}</span>
                  ) : null}
                </p>
                {current.word.context ? (
                  <PracticeContext
                    key={`${current.word.key}:sense`}
                    text={current.word.context}
                    target={current.word.form}
                    language={current.word.language}
                    highlightTarget
                    lemma={current.word.lemma ?? undefined}
                  />
                ) : null}
                <p className="meta">¿Qué acepción corresponde aquí?</p>
                {hintBox}
              </>
            )}
          </div>

          <div
            className="choice-list"
            role="group"
            aria-label={current.mode === "choose" ? "Opciones de palabra" : "Acepciones"}
          >
            {current.mode === "choose"
              ? choiceOptions.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={`btn choice-option${
                      answered
                        ? option.key === current.word.key
                          ? " is-correct"
                          : answered.picked === option.key
                            ? " is-wrong"
                            : ""
                        : ""
                    }`}
                    disabled={Boolean(answered) || grading}
                    onClick={() =>
                      answerOption(option.key, option.key === current.word.key)
                    }
                  >
                    {option.form}
                  </button>
                ))
              : senseLikeOptions.map((label, index) => (
                  <button
                    key={index}
                    type="button"
                    className={`btn choice-option${
                      answered
                        ? index === senseLikeAnswer
                          ? " is-correct"
                          : answered.picked === String(index)
                            ? " is-wrong"
                            : ""
                        : ""
                    }`}
                    disabled={Boolean(answered) || grading}
                    onClick={() =>
                      answerOption(String(index), index === senseLikeAnswer)
                    }
                  >
                    {label}
                  </button>
                ))}
          </div>

          <p className="meta nb-keys-hint nb-keys-hint--kbd">
            Teclas 1–{Math.min(9, current.mode === "choose" ? choiceOptions.length : senseLikeOptions.length)} eligen
          </p>

          {/* El resultado va debajo de las opciones: no las empuja. Es la única
              región que lo anuncia (el globo del gato no repite). */}
          {answered ? (
            <div className="nb-answer-foot" role="status">
              <p
                className={`nb-answer-verdict${
                  current.mode === "choose" ? "" : " visually-hidden"
                }`}
              >
                {answered.correct
                  ? "Correcto"
                  : `Incorrecto: era “${
                      current.mode === "choose"
                        ? current.word.form
                        : senseLikeAnswer != null
                          ? (senseLikeOptions[senseLikeAnswer] ?? "")
                          : ""
                    }”`}
              </p>
              {/* Corrección con significado: sin esto, fallar el hueco
                  no enseña lo que la palabra quiere decir. */}
              {current.mode === "choose" ? (
                <p className="nb-card-back">
                  <strong>{current.word.form}</strong>
                  {current.word.meaning ? ` — ${current.word.meaning}` : ""}
                </p>
              ) : null}
            </div>
          ) : null}

          {answered ? (
            <button
              type="button"
              className="btn btn--primary nb-continue"
              ref={continueRef}
              disabled={grading}
              onClick={() =>
                void grade(
                  current,
                  answered.correct ? EXERCISE_RATING.correct : EXERCISE_RATING.wrong,
                )
              }
            >
              Continuar
            </button>
          ) : null}
        </>
      ) : (
        <>
          <div className="index-card nb-card">
            {current.mode === "form" ? (
              <p className="nb-card-front">{current.word.meaning}</p>
            ) : current.mode === "cloze" || current.mode === "clozeNew" ? (
              (current.mode === "clozeNew" ? clozeNewText : cloze) ? (
                <PracticeContext
                  key={`${current.word.key}:${current.mode}`}
                  text={(current.mode === "clozeNew" ? clozeNewText : cloze) ?? ""}
                  target="_____"
                  language={current.word.language}
                />
              ) : null
            ) : (
              <>
                <p className="nb-card-front">
                  <strong>{current.word.form}</strong>
                  <button
                    type="button"
                    className="btn--pronounce"
                    aria-label={`Pronunciar ${current.word.form}`}
                    title="Escuchar pronunciación"
                    onClick={() => void speakWord(current.word.form, current.word.language)}
                  >
                    <Icon name="speaker" size={16} />
                  </button>
                  {current.word.pos ? (
                    <span className="card-pos"> · {current.word.pos}</span>
                  ) : null}
                </p>
                {current.word.context ? (
                  <PracticeContext
                    key={`${current.word.key}:meaning`}
                    text={current.word.context}
                    target={current.word.form}
                    language={current.word.language}
                    highlightTarget
                    lemma={current.word.lemma ?? undefined}
                  />
                ) : null}
              </>
            )}
            {hintBox}

            {revealed ? (
              <p className="nb-card-back">
                {current.mode === "meaning" ? (
                  (current.word.meaning ?? "Sin significado guardado.")
                ) : (
                  <>
                    <strong>{current.word.form}</strong>
                    <button
                      type="button"
                      className="btn--pronounce"
                      aria-label={`Pronunciar ${current.word.form}`}
                      title="Escuchar pronunciación"
                      onClick={() => void speakWord(current.word.form, current.word.language)}
                    >
                      <Icon name="speaker" size={16} />
                    </button>
                    {(current.mode === "cloze" || current.mode === "clozeNew") &&
                    current.word.meaning
                      ? ` — ${current.word.meaning}`
                      : ""}
                  </>
                )}
              </p>
            ) : (
              <button
                type="button"
                className="btn btn--primary"
                onClick={reveal}
                ref={revealButtonRef}
              >
                Mostrar respuesta
              </button>
            )}
          </div>

          {revealed ? (
            <>
              <div className="practice-grades" role="group" aria-label="Calificar recuerdo">
                {GRADES.map(({ rating, label }, index) => (
                  <div key={rating} className="grade-col">
                    <button
                      type="button"
                      className="btn"
                      ref={index === 0 ? firstGradeRef : undefined}
                      disabled={grading}
                      aria-label={`${label}, en ${previews?.[index] ?? ""}`}
                      onClick={() => void grade(current, rating)}
                    >
                      {label}
                    </button>
                    <span className="grade-interval">{previews?.[index] ?? ""}</span>
                  </div>
                ))}
              </div>
              <p className="meta nb-keys-hint nb-keys-hint--kbd">Teclas 1–4 califican · Espacio muestra la respuesta</p>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
