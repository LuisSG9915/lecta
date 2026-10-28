import { Companion, type CompanionPose } from "./Companion";
import { useCompanionSafe } from "./CompanionProvider";
import type { PracticeCompanionMode } from "../lib/settings";
import { triggerHaptic } from "../lib/haptics";
import { playCompanionSound } from "../lib/companion-audio";

export interface PracticeCompanionHeaderProps {
  pose: CompanionPose;
  speech: string;
  combo: number;
  mode: PracticeCompanionMode;
  onModeChange: (mode: PracticeCompanionMode) => void;
  onAskHint?: () => void;
  hintBusy?: boolean;
  hintText?: string | null;
  progress?: { current: number; total: number };
  instruction?: string;
  bookTitle?: string;
}

export function getProgressEncouragement(current: number, total: number): string {
  if (total <= 1) return "Cada palabra que recuerdas hace tu próxima página más fluida 🐾";
  if (current === 1) return "Cada palabra que recuerdas hace tu próxima página más fluida 🐾";
  if (current === total) return "¡Última palabra de la ronda! Tu lectura será mucho más fluida ✨";
  const ratio = current / total;
  if (ratio >= 0.5) return "¡Gran avance! Estas palabras resonarán en tu próxima lectura 📖";
  return "Sumando ecos de tus libros a tu memoria activa 🐾";
}

export function PracticeCompanionHeader({
  pose,
  speech,
  combo,
  mode,
  onModeChange,
  onAskHint,
  hintBusy = false,
  hintText,
  progress,
  instruction,
  bookTitle,
}: PracticeCompanionHeaderProps) {
  const companion = useCompanionSafe();

  if (!companion || !companion.enabled || !companion.state) return null;

  const { name, stage, mood, accessories } = companion;

  if (mode === "off") {
    return (
      <div className="practice-cat-bar practice-cat-bar--collapsed">
        <button
          type="button"
          className="btn--quiet practice-cat-reopen"
          onClick={() => onModeChange("animated")}
          title={`Activar a ${name} en el juego`}
        >
          <span aria-hidden="true">🐾</span> Mostrar a {name}
        </button>
      </div>
    );
  }

  const cycleMode = () => {
    if (mode === "animated") onModeChange("calm");
    else if (mode === "calm") onModeChange("off");
    else onModeChange("animated");
  };

  const handleCatClick = () => {
    triggerHaptic("selection");
    playCompanionSound("purr");
    if (onAskHint && !hintBusy) {
      onAskHint();
    }
  };

  const modeLabel =
    mode === "animated"
      ? "Animado"
      : mode === "calm"
        ? "Tranquilo"
        : "Oculto";

  const getDisplayText = () => {
    if (hintText) return `💡 ${hintText}`;
    if (instruction) return instruction;
    // Sin frase propia manda el ánimo por progreso; una frase real (¡Exacto!,
    // pista) siempre gana.
    if (progress && progress.total > 0 && !speech) {
      return getProgressEncouragement(progress.current, progress.total);
    }
    return speech;
  };

  const displayText = getDisplayText();

  return (
    <aside className="practice-cat-bar" aria-label={`Compañero ${name}`}>
      {/* Barra de progreso de sesión integrada si se proporciona */}
      {progress && progress.total > 0 ? (
        <div
          className="practice-header-progress"
          aria-label={`Progreso: Reto ${progress.current} de ${progress.total}`}
        >
          <span className="practice-progress-text">
            Reto {progress.current} de {progress.total}
          </span>
          <div
            className="practice-progress-track"
            role="progressbar"
            aria-valuenow={progress.current}
            aria-valuemin={1}
            aria-valuemax={progress.total}
          >
            <div
              className="practice-progress-fill"
              style={{
                inlineSize: `${Math.min(100, Math.max(5, (progress.current / progress.total) * 100))}%`,
              }}
            />
          </div>
        </div>
      ) : null}

      <div className="practice-cat-main-row">
        <div
          className="practice-cat-avatar"
          role="button"
          tabIndex={0}
          onClick={handleCatClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleCatClick();
            }
          }}
          aria-label={`Tocar a ${name} para pedir pista o interactuar`}
          title={`Toca a ${name} para pedir una pista`}
        >
          <Companion
            stage={stage}
            mood={mood}
            accessories={accessories}
            name={name}
            pose={mode === "animated" ? pose : "idle"}
            decorative={false}
          />
        </div>

        <div className="practice-cat-content">
          <div className="practice-cat-speech-bubble" role="status">
            <div className="practice-cat-meta-row">
              <strong className="practice-cat-name">{name}</strong>
              {bookTitle ? (
                <span className="practice-header-book-pill" title={`De tu libro: ${bookTitle}`}>
                  📖 Eco de: {bookTitle}
                </span>
              ) : null}
              {combo >= 2 && mode === "animated" ? (
                <span
                  className={`practice-cat-combo ${combo >= 3 ? "is-blazing pulse-combo" : ""}`}
                  aria-label={`Racha de ${combo} aciertos`}
                >
                  <span aria-hidden="true">🔥</span> x{combo} racha
                </span>
              ) : null}
            </div>
            {displayText ? <p className="practice-cat-text">{displayText}</p> : null}
          </div>
        </div>
      </div>

      <div className="practice-cat-actions">
        {onAskHint && !hintText ? (
          <button
            type="button"
            className="btn--quiet practice-cat-hint-btn"
            disabled={hintBusy}
            onClick={onAskHint}
            title={`Pedir una pista a ${name}`}
          >
            {hintBusy ? "Pensando…" : "💡 Pista"}
          </button>
        ) : null}

        <button
          type="button"
          className="btn--quiet practice-cat-mode-btn"
          onClick={cycleMode}
          title={`Modo del compañero: ${modeLabel}. Toca para cambiar.`}
          aria-label={`Modo del compañero: ${modeLabel}`}
        >
          {modeLabel}
        </button>
      </div>
    </aside>
  );
}
