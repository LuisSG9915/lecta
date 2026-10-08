import { Companion, type CompanionPose } from "./Companion";
import { useCompanionSafe } from "./CompanionProvider";
import type { PracticeCompanionMode } from "../lib/settings";

export interface PracticeCompanionHeaderProps {
  pose: CompanionPose;
  speech: string;
  combo: number;
  mode: PracticeCompanionMode;
  onModeChange: (mode: PracticeCompanionMode) => void;
  onAskHint?: () => void;
  hintBusy?: boolean;
  hintText?: string | null;
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

  const modeLabel =
    mode === "animated"
      ? "Animado"
      : mode === "calm"
        ? "Tranquilo"
        : "Oculto";

  const displayText = hintText ? `💡 ${hintText}` : speech;

  return (
    <aside className="practice-cat-bar" aria-label={`Compañero ${name}`}>
      <div className="practice-cat-avatar" aria-hidden="true">
        <Companion
          stage={stage}
          mood={mood}
          accessories={accessories}
          name={name}
          pose={mode === "animated" ? pose : "idle"}
          decorative={true}
        />
      </div>

      <div className="practice-cat-content">
        <div className="practice-cat-speech-bubble" role="status">
          <div className="practice-cat-meta-row">
            <strong className="practice-cat-name">{name}</strong>
            {combo >= 2 && mode === "animated" ? (
              <span
                className="practice-cat-combo"
                aria-label={`Racha de ${combo} aciertos`}
              >
                <span aria-hidden="true">🔥</span> x{combo} racha
              </span>
            ) : null}
          </div>
          <p className="practice-cat-text">{displayText}</p>
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
