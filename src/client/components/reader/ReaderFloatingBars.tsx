import { memo } from "react";
import Icon from "../Icon";
// Barras flotantes del lector: aviso de palabra capturada por TTS y párrafo
// bilingüe traducido. El marcapasos vive en el popover de la luna (un solo dock).
//
// Extraídas de Reader.tsx (Fase 7). Solo pintan; el estado vive en el lector.
import { BilingueParagraph } from "../BilingueParagraph";
import {
  loadBilingualScaffoldingProfile,
  muteBilingualForBook,
  saveBilingualScaffoldingProfile,
  selectOptimalScaffoldingTier,
  updateBilingualAutonomyProfile,
} from "../../lib/phrases";

export interface ReaderFloatingBarsProps {
  ttsCapturedToast: string | null;
  activeBilingualParagraph: { originalText: string; translatedText?: string } | null;
  bookHash: string;
  language: string;
  setBilingualMode: (mode: "off" | "auto" | "tier-1-only" | "tier-3-always") => void;
}

function ReaderFloatingBarsImpl(props: ReaderFloatingBarsProps) {
  const {
  ttsCapturedToast,
  activeBilingualParagraph,
  bookHash,
  language,
  setBilingualMode,
  } = props;

  return (
    <>
  {ttsCapturedToast ? (
    <div className="reader-hint-toast reader-hint-toast--captured" role="status" aria-live="polite">
      <Icon name="star" size={14} /> Guardada en Herbario: <strong>{ttsCapturedToast}</strong>
    </div>
  ) : null}


  {activeBilingualParagraph ? (
    <div
      className="reader-bilingual-floating-container"
      role="region"
      aria-label="Párrafo bilingüe"
    >
      <BilingueParagraph
        bookId={bookHash}
        bookLanguage={language}
        originalText={activeBilingualParagraph.originalText}
        translatedText={activeBilingualParagraph.translatedText}
        initialTier={selectOptimalScaffoldingTier(
          activeBilingualParagraph.originalText,
          0.1,
          language || "en",
          loadBilingualScaffoldingProfile(),
          bookHash,
        )}
        onTierEscalated={() => {
          const prof = loadBilingualScaffoldingProfile();
          const updated = updateBilingualAutonomyProfile(
            prof,
            language || "en",
            "escalated",
          );
          saveBilingualScaffoldingProfile(updated);
        }}
        onMuteForBook={(id) => muteBilingualForBook(id)}
        onDisableBilingual={() => setBilingualMode("off")}
      />
    </div>
  ) : null}
    </>
  );
}

export const ReaderFloatingBars = memo(ReaderFloatingBarsImpl);
