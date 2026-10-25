// Barras flotantes del lector: marcapasos visual, aviso de palabra capturada
// por TTS y párrafo bilingüe traducido.
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
import type { ReaderSettings } from "../../lib/settings";

export interface ReaderFloatingBarsProps {
  settings: ReaderSettings;
  state: "idle" | "opening" | "ready" | "error";
  strategyPaused: boolean;
  isDeepReading: boolean;
  pacerPaused: boolean;
  setPacerPaused: (updater: boolean | ((prev: boolean) => boolean)) => void;
  updateSettings: (patch: Partial<ReaderSettings>) => void;
  ttsCapturedToast: string | null;
  activeBilingualParagraph: { originalText: string; translatedText?: string } | null;
  bookHash: string;
  language: string;
  setBilingualMode: (mode: "off" | "auto" | "tier-1-only" | "tier-3-always") => void;
}

export function ReaderFloatingBars(props: ReaderFloatingBarsProps) {
  const {
  settings,
  state,
  strategyPaused,
  isDeepReading,
  pacerPaused,
  setPacerPaused,
  updateSettings,
  ttsCapturedToast,
  activeBilingualParagraph,
  bookHash,
  language,
  setBilingualMode,
  } = props;

  return (
    <>
  {/* Marcapasos Visual: barra flotante ergonómica cuando está activo (OBJ-05) */}
  {settings.visualPacer && !strategyPaused && state === "ready" && !isDeepReading ? (
    <div
      className="reader__pacer-bar tts-chip tts-chip--expanded"
      role="status"
      aria-label="Marcapasos visual"
    >
      <span className="tts-chip-label">
        {pacerPaused ? "En pausa" : "Ritmo activo"}
      </span>
      <div className="tts-chip-actions">
        <button
          type="button"
          className="btn--quiet tts-btn-playpause"
          onClick={() => setPacerPaused((p) => !p)}
          aria-label={pacerPaused ? "Reanudar ritmo" : "Pausar ritmo"}
        >
          {pacerPaused ? "Reanudar" : "Pausar"}
        </button>
        <button
          type="button"
          className="btn--quiet tts-chip-rate"
          onClick={() => {
            const nextWpm =
              (settings.pacerWpm || 210) >= 350
                ? 150
                : (settings.pacerWpm || 210) + 30;
            updateSettings({ pacerWpm: nextWpm });
          }}
          aria-label="Velocidad del ritmo"
        >
          {`${settings.pacerWpm || 210} WPM`}
        </button>
        <button
          type="button"
          className="btn--quiet tts-chip-stop"
          onClick={() => updateSettings({ visualPacer: false })}
          aria-label="Detener ritmo"
        >
          Detener
        </button>
      </div>
    </div>
  ) : null}

  {ttsCapturedToast ? (
    <div className="reader-hint-toast reader-hint-toast--captured" role="status" aria-live="polite">
      ★ Guardada en Cuaderno: <strong>{ttsCapturedToast}</strong>
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
