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
  ttsSessionCaptures?: string[];
  ttsActive?: boolean;
  onOpenNotebook?: () => void;
  onDismissAudioSummary?: () => void;
  activeBilingualParagraph: { originalText: string; translatedText?: string } | null;
  bookHash: string;
  language: string;
  setBilingualMode: (mode: "off" | "auto" | "tier-1-only" | "tier-3-always") => void;
}

function ReaderFloatingBarsImpl(props: ReaderFloatingBarsProps) {
  const {
    ttsCapturedToast,
    ttsSessionCaptures,
    ttsActive = false,
    onOpenNotebook,
    onDismissAudioSummary,
    activeBilingualParagraph,
    bookHash,
    language,
    setBilingualMode,
  } = props;

  const showAudioSummary =
    !ttsActive && !ttsCapturedToast && ttsSessionCaptures && ttsSessionCaptures.length > 0;
  const capturePreview = ttsSessionCaptures?.slice(0, 3).join(", ") ?? "";
  const extraCount = (ttsSessionCaptures?.length ?? 0) - 3;

  return (
    <>
  {ttsCapturedToast ? (
    <div className="reader-hint-toast reader-hint-toast--captured" role="status" aria-live="polite">
      <Icon name="star" size={14} /> Guardada en Herbario: <strong>{ttsCapturedToast}</strong>
    </div>
  ) : showAudioSummary ? (
    <div className="reader-hint-toast reader-hint-toast--captured reader-hint-toast--interactive" role="status" aria-live="polite">
      <Icon name="headphones" size={14} />{" "}
      <span>
        Capturaste {ttsSessionCaptures.length}{" "}
        {ttsSessionCaptures.length === 1 ? "palabra" : "palabras"} al escuchar:{" "}
        <strong>{capturePreview}</strong>
        {extraCount > 0 ? ` (+${extraCount})` : ""}
      </span>{" "}
      {onOpenNotebook ? (
        <button
          type="button"
          className="btn--quiet"
          onClick={() => {
            onDismissAudioSummary?.();
            onOpenNotebook();
          }}
        >
          Ver en Herbario
        </button>
      ) : null}
      {onDismissAudioSummary ? (
        <button
          type="button"
          className="btn--quiet"
          onClick={onDismissAudioSummary}
          aria-label="Cerrar resumen de audio"
        >
          <Icon name="close" size={14} />
        </button>
      ) : null}
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
