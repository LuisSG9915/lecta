import Icon from "../Icon";
import { renderHighlightedContext } from "../../lib/word-highlight";
import type { SavedWord } from "../../lib/idb";
import type { MarkLevel } from "../../lib/word-level";
import { getStabilitySegments, safeStability } from "../../lib/notebook-model";

export function WordRow({
  word,
  state,
  isOpen,
  onToggle,
  canLearn,
  onLearn,
  onRemove,
  onSpeak,
  bookTitle,
  onQuickGame,
  onShareCard,
}: {
  word: SavedWord;
  state: { label: string; level: MarkLevel | "due" };
  isOpen: boolean;
  onToggle: () => void;
  canLearn: boolean;
  onLearn: () => void;
  onRemove: () => void;
  onSpeak: () => void;
  bookTitle?: string;
  onQuickGame?: () => void;
  onShareCard?: () => void;
}) {
  const detailId = `word-detail-${word.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const cardStability = safeStability(word.card?.stability);
  const stabilityDays = Math.round(cardStability);
  const stabilityPercent = Math.min(
    100,
    Math.max(word.card ? 5 : 0, Math.round((cardStability / 90) * 100)),
  );
  const activeSegments = getStabilitySegments(cardStability);

  return (
    <li className="nb-word nb-editorial-card">
      <button
        type="button"
        className="nb-word-row"
        aria-expanded={isOpen}
        aria-controls={detailId}
        onClick={onToggle}
      >
        <span className="nb-word-row-head">
          <strong className="nb-word-form nb-word-lemma">{word.lemma || word.form}</strong>
          {word.pos ? <span className="nb-badge-pos card-pos">{word.pos}</span> : null}
          <span className="nb-state" data-level={state.level}>
            {state.label}
          </span>
        </span>
        {/* Abierta, el significado ya se lee completo en el detalle: no se repite. */}
        {word.meaning && !isOpen ? (
          <span className="nb-word-preview">{word.meaning}</span>
        ) : null}
      </button>

      {isOpen ? (
        <div id={detailId} className="nb-word-detail">
          <div className="nb-word-detail-meta">
            {word.lemma && word.lemma !== word.form ? (
              <span className="meta">de «{word.lemma}»</span>
            ) : null}
            {word.pos ? <span className="card-pos">{word.pos}</span> : null}
          </div>
          {word.meaning ? <p className="nb-meaning">{word.meaning}</p> : null}

          {/* Barra de estabilidad de memoria (FSRS) de 4 segmentos */}
          <div
            className="word-memory-stability word-memory-stability--segmented"
            title={`Estabilidad de memoria FSRS: ${stabilityDays} días`}
          >
            <div className="word-stability-header">
              <span className="word-stability-label">Estabilidad en memoria</span>
              <span className="word-stability-val">
                {word.card
                  ? `${stabilityDays} ${stabilityDays === 1 ? "día" : "días"}`
                  : "Sin repasar"}
              </span>
            </div>
            <div
              className="word-stability-bar"
              role="progressbar"
              aria-label="Estabilidad de memoria"
              aria-valuenow={stabilityPercent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="word-stability-fill"
                style={{ inlineSize: `${stabilityPercent}%` }}
              />
            </div>
            <div className="word-stability-segments" aria-hidden="true">
              {[1, 2, 3, 4].map((seg) => (
                <span
                  key={seg}
                  className={`word-stability-segment ${seg <= activeSegments ? "is-filled" : ""}`}
                />
              ))}
            </div>
          </div>

          {/* Caja de citación del libro donde apareció con palabra resaltada en ámbar suave */}
          {word.context ? (
            <div className="nb-word-quote-box">
              <blockquote className="nb-word-quote">
                “{renderHighlightedContext(word.context, word.form, word.lemma)}”
              </blockquote>
              {bookTitle ? (
                <cite className="nb-word-cite">
                  <Icon name="quote" size={13} />
                  <span>{bookTitle}</span>
                </cite>
              ) : null}
            </div>
          ) : null}

          <div className="nb-word-actions">
            <button
              type="button"
              className="btn--pronounce"
              aria-label={`Pronunciar ${word.form}`}
              title="Escuchar pronunciación"
              onClick={onSpeak}
            >
              <Icon name="speaker" size={16} />
            </button>
            {onQuickGame ? (
              <button
                type="button"
                className="btn btn--quick-game"
                onClick={onQuickGame}
                title="Partida rápida de repaso (3 min)"
              >
                <Icon name="sparkles" size={14} />
                <span>Partida rápida (3 min)</span>
              </button>
            ) : null}
            {canLearn ? (
              <button
                type="button"
                className="btn--quiet"
                aria-label={`Aprender ${word.form}`}
                onClick={onLearn}
              >
                Aprender
              </button>
            ) : null}
            {onShareCard ? (
              <button
                type="button"
                className="btn--quiet"
                aria-label={`Crear postal de ${word.form}`}
                title="Crear postal compartible"
                onClick={onShareCard}
              >
                Postal
              </button>
            ) : null}
            <button
              type="button"
              className="btn--quiet nb-remove"
              aria-label={`Quitar ${word.form}`}
              onClick={onRemove}
            >
              Quitar
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
