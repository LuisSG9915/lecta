import React, { useState } from "react";

export interface BilingueParagraphProps {
  originalText: string;
  bookLanguage: "es" | "en";
  fetchParagraphTranslation: (text: string) => Promise<string>;
}

export const BilingueParagraph: React.FC<BilingueParagraphProps> = ({
  originalText,
  bookLanguage,
  fetchParagraphTranslation,
}) => {
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);

  const handleDoubleTap = async () => {
    if (bookLanguage !== "en") return;
    if (translatedText) {
      setTranslatedText(null); // Ocultar al volver a dar doble toque
      return;
    }
    setIsTranslating(true);
    try {
      const translation = await fetchParagraphTranslation(originalText);
      setTranslatedText(translation);
    } finally {
      setIsTranslating(false);
    }
  };

  return (
    <p className="reader-text-paragraph" onDoubleClick={handleDoubleTap}>
      {originalText}
      {isTranslating && <span className="paragraph-translating-indicator"> ⏳ Traduciendo...</span>}
      {translatedText && (
        <span className="paragraph-inline-translation">
          <em>{translatedText}</em>
        </span>
      )}
    </p>
  );
};

export default BilingueParagraph;
