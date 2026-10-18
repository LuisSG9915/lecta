import { useState, useRef, useEffect, type ReactNode } from "react";
import {
  READING_PRESETS,
  type ReadingPreset,
} from "../lib/settings";
import type { TtsSnapshot } from "../lib/ttsTypes";
import Icon from "./Icon";

import type { FocusAidType } from "../lib/focus-telemetry";

export interface FocusSuggestion {
  isFatigued: boolean;
  reason?: "none" | "stall" | "regressions" | "sustained-load";
  recommendedAid: FocusAidType;
}

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

  /** Sugerencia silenciosa de neuro-foco adaptativo (Track 9) */
  focusSuggestion?: FocusSuggestion | null;
  isFatigued?: boolean;
  recommendedFocusAid?: FocusAidType;
  focusFatigueReason?: "none" | "stall" | "regressions" | "sustained-load";
  onAcceptFocusAid?: (aid: FocusAidType) => void;
  onMuteFocusForBook?: () => void;
  onDisableFocusGlobally?: () => void;
  onDismissFocusSuggestion?: () => void;

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
  focusSuggestion,
  isFatigued,
  recommendedFocusAid,
  focusFatigueReason,
  onAcceptFocusAid,
  onMuteFocusForBook,
  onDisableFocusGlobally,
  onDismissFocusSuggestion,
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
  const [isDismissedLocally, setIsDismissedLocally] = useState(false);
  const [isMuteOptionsOpen, setIsMuteOptionsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const isAudioMode = ttsSnap.status !== "idle" && ttsSnap.status !== "stopping";

  const effectiveIsFatigued = Boolean(
    focusSuggestion?.isFatigued ?? isFatigued,
  );
  const effectiveAid: FocusAidType =
    focusSuggestion?.recommendedAid ?? recommendedFocusAid ?? "paragraph-focus";
  const effectiveReason =
    focusSuggestion?.reason ?? focusFatigueReason ?? "stall";

  const suggestionText =
    effectiveReason === "regressions"
      ? "¿Enfocar párrafo actual?"
      : effectiveAid === "syntactic-lines"
        ? "¿Activar cadencia por frases?"
        : effectiveAid === "focus-ruler"
          ? "¿Activar regla de lectura?"
          : "¿Enfocar párrafo actual?";

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

        {/* Píldora sutil de Neuro-Foco (Track 9 - Cero Fricción) */}
        {effectiveIsFatigued && !isDismissedLocally && !isAudioMode && !isPureCanvas && (
          <div
            className="reader-focus-suggestion-pill"
            role="status"
            aria-live="polite"
            style={{
              margin: "0 auto 8px auto",
              width: "fit-content",
              maxWidth: "92vw",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: isMuteOptionsOpen ? "6px 12px" : "6px 10px 6px 14px",
              background: "var(--bg-elevated, #2a2a2e)",
              color: "var(--text-main, #ffffff)",
              borderRadius: "9999px",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.22)",
              fontSize: "0.86rem",
              lineHeight: 1.3,
              zIndex: 50,
              border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))",
            }}
          >
            {!isMuteOptionsOpen ? (
              <>
                <button
                  type="button"
                  className="reader-focus-pill-action"
                  onClick={() => {
                    onAcceptFocusAid?.(effectiveAid);
                    setIsDismissedLocally(true);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    margin: 0,
                    color: "inherit",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    font: "inherit",
                    fontWeight: 500,
                  }}
                  aria-label={`Sugerencia de enfoque: ${suggestionText}. Toca para activar`}
                >
                  <span aria-hidden="true">
                    {effectiveAid === "syntactic-lines"
                      ? "〰️"
                      : effectiveAid === "focus-ruler"
                        ? "📏"
                        : "🎯"}
                  </span>
                  <span>{suggestionText}</span>
                </button>
                <button
                  type="button"
                  className="reader-focus-pill-close"
                  onClick={() => setIsMuteOptionsOpen(true)}
                  style={{
                    background: "rgba(255, 255, 255, 0.1)",
                    border: "none",
                    color: "inherit",
                    borderRadius: "9999px",
                    width: "20px",
                    height: "20px",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    padding: 0,
                    marginLeft: "4px",
                    fontSize: "11px",
                    opacity: 0.8,
                  }}
                  aria-label="Opciones para silenciar sugerencias de enfoque"
                  title="Opciones de sugerencias"
                >
                  ✕
                </button>
              </>
            ) : (
              <div
                className="reader-focus-pill-mute-options"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  className="reader-focus-mute-book-btn"
                  onClick={() => {
                    onMuteFocusForBook?.();
                    setIsDismissedLocally(true);
                    setIsMuteOptionsOpen(false);
                  }}
                  style={{
                    background: "rgba(255, 255, 255, 0.12)",
                    border: "none",
                    borderRadius: "6px",
                    padding: "4px 8px",
                    color: "inherit",
                    cursor: "pointer",
                    font: "inherit",
                    fontSize: "0.82rem",
                  }}
                >
                  No sugerir en este libro
                </button>
                <button
                  type="button"
                  className="reader-focus-disable-always-btn"
                  onClick={() => {
                    onDisableFocusGlobally?.();
                    setIsDismissedLocally(true);
                    setIsMuteOptionsOpen(false);
                  }}
                  style={{
                    background: "rgba(255, 255, 255, 0.12)",
                    border: "none",
                    borderRadius: "6px",
                    padding: "4px 8px",
                    color: "inherit",
                    cursor: "pointer",
                    font: "inherit",
                    fontSize: "0.82rem",
                  }}
                >
                  Desactivar sugerencias de enfoque siempre
                </button>
                <button
                  type="button"
                  className="reader-focus-pill-cancel-btn"
                  onClick={() => {
                    onDismissFocusSuggestion?.();
                    setIsDismissedLocally(true);
                    setIsMuteOptionsOpen(false);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: "inherit",
                    cursor: "pointer",
                    padding: "2px 6px",
                    fontSize: "0.9rem",
                    opacity: 0.7,
                  }}
                  aria-label="Cerrar"
                >
                  ✕
                </button>
              </div>
            )}
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
