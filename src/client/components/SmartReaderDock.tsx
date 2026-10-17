import { useState, useRef, useEffect, type ReactNode } from "react";
import {
  READING_PRESETS,
  type ReadingPreset,
} from "../lib/settings";
import type { TtsSnapshot } from "../lib/ttsTypes";
import Icon from "./Icon";

export interface SmartReaderDockProps {
  /** Texto legible de progreso (ej. "Pág. 12 de 45 · ~3 min" o "Cap. 2 de 8 · ~15 min") */
  progressText: string;
  errorText?: string;

  /** Estado de Lienzo Puro (ocultar barras para lectura inmersiva) */
  isPureCanvas: boolean;
  onExitPureCanvas: () => void;

  /** Presets cognitivos de 1 clic */
  activePreset: ReadingPreset;
  onSelectPreset: (preset: Exclude<ReadingPreset, "custom">) => void;
  onOpenAdvancedSettings: () => void;

  /** Acciones adicionales del modo lectura */
  onStartAudio?: () => void;
  onRecap?: () => void;
  companionSlot?: ReactNode;

  /** Estado y controles de Audio / TTS */
  ttsSnap: TtsSnapshot;
  onTogglePlayPause: () => void;
  onPrevSentence?: () => void;
  onNextSentence?: () => void;
  onCycleSpeed: () => void;
  onOpenVoiceSelector?: () => void;
  onCaptureWord?: () => void;
  onStopAudio: () => void;

  /** Compañero en Lienzo Puro */
  onOpenCatCorner?: () => void;
}

export default function SmartReaderDock({
  progressText,
  errorText,
  isPureCanvas,
  onExitPureCanvas,
  activePreset,
  onSelectPreset,
  onOpenAdvancedSettings,
  onStartAudio,
  onRecap,
  companionSlot,
  ttsSnap,
  onTogglePlayPause,
  onPrevSentence,
  onNextSentence,
  onCycleSpeed,
  onOpenVoiceSelector,
  onCaptureWord,
  onStopAudio,
  onOpenCatCorner,
}: SmartReaderDockProps) {
  const [isModeSheetOpen, setIsModeSheetOpen] = useState(false);
  const [wordCapturedToast, setWordCapturedToast] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const isAudioMode = ttsSnap.status !== "idle" && ttsSnap.status !== "stopping";

  const currentPresetMeta =
    READING_PRESETS.find((p) => p.id === activePreset) ?? {
      icon: "🎛️",
      shortLabel: "Ajustado",
      label: "Personalizado",
      description: "Opciones avanzadas personalizadas",
    };

  // Cierra el popover si se hace clic fuera
  useEffect(() => {
    if (!isModeSheetOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsModeSheetOpen(false);
      }
    };
    window.addEventListener("pointerdown", handleClickOutside);
    return () => window.removeEventListener("pointerdown", handleClickOutside);
  }, [isModeSheetOpen]);

  // Si pasa a modo audio, cerramos el popover de modos
  useEffect(() => {
    if (isAudioMode) {
      setIsModeSheetOpen(false);
    }
  }, [isAudioMode]);

  const handleCapture = () => {
    if (!onCaptureWord) return;
    onCaptureWord();
    setWordCapturedToast(true);
    window.setTimeout(() => setWordCapturedToast(false), 1800);
  };

  const isNeuralVoice = ttsSnap.activeEngine === "kitten-neural";

  return (
    <>
      {/* Botón flotante discreto del Michi en Modo Lienzo Puro */}
      <div
        className={`reader-pure-canvas-cat ${isPureCanvas ? "is-visible" : ""}`}
        aria-hidden={!isPureCanvas}
      >
        <button
          type="button"
          className="reader-mini-cat-btn"
          onClick={onOpenCatCorner ?? onExitPureCanvas}
          aria-label="Abrir rincón de tu gato o salir de lienzo puro"
          title="Toca para interactuar o salir de Lienzo Puro"
        >
          <span className="reader-mini-cat-avatar" aria-hidden="true">🐾</span>
          {isAudioMode && ttsSnap.status === "speaking" && (
            <span className="reader-mini-audio-dot" aria-label="Audio reproduciéndose" />
          )}
        </button>
      </div>

      {/* DOCK ÚNICO INFERIOR INTELIGENTE */}
      <div
        className={`reader-smart-dock-wrapper ${isPureCanvas ? "is-pure-canvas" : ""}`}
        data-hidden={isPureCanvas || undefined}
        ref={popoverRef}
      >
        {/* Popover de 1 toque para los 3 Modos Humanos */}
        {isModeSheetOpen && !isAudioMode && (
          <div
            className="reader-mode-popover"
            role="dialog"
            aria-label="Elegir modo de lectura"
          >
            <div className="reader-mode-popover-grid">
              {READING_PRESETS.map((preset) => {
                const isSelected = activePreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={`reader-mode-card ${isSelected ? "is-active" : ""}`}
                    onClick={() => {
                      onSelectPreset(preset.id as Exclude<ReadingPreset, "custom">);
                      setIsModeSheetOpen(false);
                    }}
                  >
                    <span className="reader-mode-card-icon" aria-hidden="true">{preset.icon}</span>
                    <strong className="reader-mode-card-title">{preset.label}</strong>
                    <span className="reader-mode-card-desc">{preset.description}</span>
                  </button>
                );
              })}
            </div>
            <div className="reader-mode-popover-footer">
              <button
                type="button"
                className="reader-mode-customize-link"
                onClick={() => {
                  setIsModeSheetOpen(false);
                  onOpenAdvancedSettings();
                }}
              >
                ⚙️ Personalizar opciones avanzadas…
              </button>
            </div>
          </div>
        )}

        <nav
          className={`reader-smart-dock reader-dock ${isAudioMode ? "is-audio-mode" : "is-reading-mode"}`}
          aria-label={isAudioMode ? "Controles de voz y ritmo" : "Barra de lectura"}
        >
          {!isAudioMode ? (
            /* ================= MODO LECTURA ================= */
            <>
              <div className="dock-section dock-progress-info">
                <span className="dock-chapter-text">{progressText}</span>
                {errorText ? (
                  <span className="dock-error-text" role="alert">
                    {errorText}
                  </span>
                ) : null}
              </div>

              <span className="reader-dock-divider" aria-hidden="true" />

              {/* Selector de los 3 Modos Humanos */}
              <button
                type="button"
                className="dock-action-btn dock-mode-trigger"
                onClick={() => setIsModeSheetOpen((prev) => !prev)}
                aria-expanded={isModeSheetOpen}
                aria-label={`Modo de lectura: ${currentPresetMeta.label}. Toque para cambiar`}
                title="Modo de lectura y ayudas visuales"
              >
                <span aria-hidden="true">{currentPresetMeta.icon}</span>
                <span>{currentPresetMeta.shortLabel}</span>
              </button>

              {/* Botón directo de 1 toque para escuchar en voz alta */}
              {onStartAudio && (
                <button
                  type="button"
                  className="dock-action-btn dock-listen-trigger"
                  onClick={onStartAudio}
                  aria-label="Escuchar página en voz alta"
                  title="Escuchar en voz alta (TTS)"
                >
                  <Icon name="headphones" size={14} />
                  <span>Escuchar</span>
                </button>
              )}

              {/* Resumen de atención (Hilo) */}
              {onRecap && (
                <button
                  type="button"
                  className="dock-action-btn dock-recap-trigger"
                  onClick={onRecap}
                  aria-label="Recuperar el hilo de esta página"
                  title="Recuperar el hilo (resumen de atención)"
                >
                  <span aria-hidden="true">🧭</span>
                  <span>Hilo</span>
                </button>
              )}

              {/* Slot del Gato Acompañante interactivo */}
              {companionSlot ? (
                <>
                  <span className="reader-dock-divider" aria-hidden="true" />
                  <div className="dock-companion-slot">
                    {companionSlot}
                  </div>
                </>
              ) : null}
            </>
          ) : (
            /* ================= MODO AUDIO / TTS ================= */
            <>
              {/* Frase anterior */}
              {onPrevSentence ? (
                <button
                  type="button"
                  className="dock-audio-btn dock-audio-step-btn"
                  onClick={onPrevSentence}
                  disabled={ttsSnap.status === "preparing"}
                  aria-label="Frase anterior"
                  title="Frase anterior"
                >
                  ⏮
                </button>
              ) : null}

              {/* Play / Pausa */}
              <button
                type="button"
                className="dock-audio-play-btn"
                onClick={onTogglePlayPause}
                disabled={ttsSnap.status === "preparing"}
                aria-label={
                  ttsSnap.status === "preparing"
                    ? "Preparando voz"
                    : ttsSnap.status === "speaking"
                      ? "Pausar lectura"
                      : "Reanudar lectura"
                }
              >
                {ttsSnap.status === "preparing"
                  ? "⏳"
                  : ttsSnap.status === "speaking"
                    ? "⏸ Pausa"
                    : "▶ Seguir"}
              </button>

              {/* Frase siguiente */}
              {onNextSentence ? (
                <button
                  type="button"
                  className="dock-audio-btn dock-audio-step-btn"
                  onClick={onNextSentence}
                  disabled={ttsSnap.status === "preparing"}
                  aria-label="Frase siguiente"
                  title="Frase siguiente"
                >
                  ⏭
                </button>
              ) : null}

              {/* Velocidad */}
              <button
                type="button"
                className="dock-audio-pill-btn"
                onClick={onCycleSpeed}
                aria-label="Velocidad de voz"
                title="Cambiar velocidad"
              >
                {`${ttsSnap.rate}×`}
              </button>

              {/* Selector de Voz */}
              <button
                type="button"
                className={`dock-audio-pill-btn ${isNeuralVoice ? "is-hd-active" : ""}`}
                onClick={onOpenVoiceSelector}
                aria-label="Elegir voz"
                title={isNeuralVoice ? "Voz KittenTTS Neural HD activa" : "Voz del sistema. Toca para cambiar o descargar HD"}
              >
                {isNeuralVoice ? "✨ Voz HD" : "🎙️ Voz"}
              </button>

              {/* Captura al Cuaderno de la frase actual */}
              {onCaptureWord ? (
                <button
                  type="button"
                  className={`dock-audio-pill-btn dock-audio-capture-btn ${wordCapturedToast ? "is-captured" : ""}`}
                  onClick={handleCapture}
                  disabled={ttsSnap.status === "preparing"}
                  aria-label="Capturar joya léxica de la frase al Cuaderno"
                  title="Guardar palabra clave de la frase"
                >
                  {wordCapturedToast ? "✓ Guardada" : "★ Joya"}
                </button>
              ) : null}

              <span className="reader-dock-divider" aria-hidden="true" />

              {/* Volver a lectura silenciosa */}
              <button
                type="button"
                className="dock-audio-close-btn"
                onClick={onStopAudio}
                aria-label="Detener audio y volver a lectura silenciosa"
                title="Volver a lectura silenciosa"
              >
                ✕
              </button>
            </>
          )}
        </nav>
      </div>
    </>
  );
}
