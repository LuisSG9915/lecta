import React, { useState } from "react";
import type { BilingualScaffoldingTier } from "../lib/phrases";

export interface InlineGlossItem {
  surface: string;
  gloss: string;
}

export interface BilingueParagraphProps {
  /** Retrocompatibilidad con props anteriores */
  bookLanguage?: "es" | "en" | string;
  fetchParagraphTranslation?: (text: string) => Promise<string>;

  /** Nuevas props Track 11 - Fase 2 */
  bookId?: string;
  originalText: string;
  translatedText?: string;
  difficultClauseOriginal?: string;
  difficultClauseTranslation?: string;
  inlineGlosses?: InlineGlossItem[];
  initialTier?: BilingualScaffoldingTier;
  onTierEscalated?: () => void;
  onMuteForBook?: (bookId: string) => void;
  onDisableBilingual?: () => void;
}

export const BilingueParagraph: React.FC<BilingueParagraphProps> = ({
  bookLanguage,
  fetchParagraphTranslation,
  bookId,
  originalText,
  translatedText,
  difficultClauseOriginal,
  difficultClauseTranslation,
  inlineGlosses = [],
  initialTier = 1,
  onTierEscalated,
  onMuteForBook,
  onDisableBilingual,
}) => {
  const [activeTier, setActiveTier] = useState<BilingualScaffoldingTier>(initialTier);
  const [showOptions, setShowOptions] = useState(false);
  const [localTranslatedText, setLocalTranslatedText] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);

  const currentTranslatedText = translatedText || localTranslatedText;

  const handleEscalateToTier = (nextTier: 2 | 3) => {
    setActiveTier(nextTier);
    onTierEscalated?.();
  };

  const handleDoubleTap = async () => {
    if (bookLanguage && bookLanguage !== "en") return;
    if (activeTier === 3) {
      setActiveTier(1);
      return;
    }
    if (currentTranslatedText) {
      handleEscalateToTier(3);
      return;
    }
    if (fetchParagraphTranslation) {
      setIsTranslating(true);
      try {
        const translation = await fetchParagraphTranslation(originalText);
        setLocalTranslatedText(translation);
        handleEscalateToTier(3);
      } finally {
        setIsTranslating(false);
      }
    }
  };

  if (activeTier === "off") {
    return (
      <p
        className="reader-text-paragraph lecta-bilingue__original"
        onDoubleClick={handleDoubleTap}
      >
        {originalText}
      </p>
    );
  }

  return (
    <div className="lecta-bilingue" data-tier={activeTier}>
      <p
        className="reader-text-paragraph lecta-bilingue__original"
        onDoubleClick={handleDoubleTap}
      >
        {originalText}
        {isTranslating && (
          <span className="paragraph-translating-indicator"> ⏳ Traduciendo...</span>
        )}
      </p>

      {/* Nivel 1: Micro-glosas de locuciones y palabras clave sin traducir todo el párrafo */}
      {inlineGlosses.length > 0 && (
        <div className="lecta-bilingue__gloss-strip" aria-label="Glosas clave del párrafo">
          {inlineGlosses.map((g) => (
            <span key={g.surface} className="lecta-bilingue__gloss-chip">
              <strong>{g.surface}</strong>: {g.gloss}
            </span>
          ))}
        </div>
      )}

      {/* Nivel 2: Traducción acotada únicamente a la cláusula difícil */}
      {activeTier === 2 && difficultClauseTranslation && (
        <div className="lecta-bilingue__clause-box">
          {difficultClauseOriginal && (
            <span className="lecta-bilingue__clause-src">«{difficultClauseOriginal}» → </span>
          )}
          <span className="lecta-bilingue__clause-dst">{difficultClauseTranslation}</span>
        </div>
      )}

      {/* Nivel 3: Párrafo Espejo Completo */}
      {activeTier === 3 && currentTranslatedText && (
        <p
          className="lecta-bilingue__translation paragraph-inline-translation"
          aria-label="Traducción completa del párrafo"
        >
          <em>{currentTranslatedText}</em>
        </p>
      )}

      {/* Controles de escalado gradual y desactivación Cero Fricción */}
      <div className="lecta-bilingue__toolbar">
        {activeTier === 1 && difficultClauseTranslation && (
          <button
            type="button"
            className="lecta-bilingue__step-btn"
            onClick={() => handleEscalateToTier(2)}
          >
            Destrabar frase clave
          </button>
        )}

        {activeTier !== 3 && currentTranslatedText && (
          <button
            type="button"
            className="lecta-bilingue__step-btn"
            onClick={() => handleEscalateToTier(3)}
          >
            Ver párrafo traducido
          </button>
        )}

        {activeTier === 3 && (
          <button
            type="button"
            className="lecta-bilingue__step-btn"
            onClick={() => setActiveTier(1)}
          >
            Ocultar traducción
          </button>
        )}

        <div className="lecta-bilingue__prefs">
          <button
            type="button"
            className="lecta-bilingue__prefs-trigger"
            onClick={() => setShowOptions((v) => !v)}
            title="Opciones de ayuda bilingüe"
          >
            ⋯
          </button>
          {showOptions && (
            <div className="lecta-bilingue__prefs-menu" role="menu">
              {bookId && onMuteForBook && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setActiveTier("off");
                    onMuteForBook(bookId);
                  }}
                >
                  Desactivar ayuda bilingüe en este libro
                </button>
              )}
              {onDisableBilingual && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setActiveTier("off");
                    onDisableBilingual();
                  }}
                >
                  Desactivar modo bilingüe siempre
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BilingueParagraph;
