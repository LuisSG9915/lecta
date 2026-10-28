import { useState, useRef, useEffect, type ReactNode } from "react";
import {
  READING_PRESETS,
  type ReadingPreset,
  isFeatureFlagEnabled,
} from "../lib/settings";
import type { TtsSnapshot } from "../lib/ttsTypes";
import { unlockAudioContext } from "../lib/kittenTtsEngine";
import Icon, { type IconName } from "./Icon";
import { getWeeklyLearnedWordsCount } from "../lib/journey";

import type { FocusAidType } from "../lib/focus-telemetry";

export interface FocusSuggestion {
  isFatigued: boolean;
  reason?: "none" | "stall" | "regressions" | "sustained-load";
  recommendedAid: FocusAidType;
}

export function formatCompactProgress(raw: string): { compact: string; title: string } {
  if (!raw) return { compact: "", title: "" };

  const match = raw.match(
    /^(Cap\.|Pág\.|pág\.|cap\.)\s*(\d+)(?:\s+de\s+(\d+))?(?:\s*·\s*~?(\d+)\s*(?:min|m))?/i
  );
  if (match) {
    const [, prefix, current, total, mins] = match;
    const isCap = prefix.toLowerCase().startsWith("cap");
    const label = isCap ? "Cap." : "Pág.";
    const fullUnit = isCap ? "Capítulo" : "Página";

    let compact = `${label} ${current}`;
    let title = `${fullUnit} ${current}${total ? ` de ${total}` : ""}`;

    if (mins) {
      compact += ` · ~${mins}m`;
      title += ` — ~${mins} min restantes`;
    }

    return { compact, title };
  }

  const compact = raw
    .replace(/\s+de\s+\d+/i, "")
    .replace(/~(\d+)\s*min/gi, "~$1m")
    .replace(/(\d+)\s*min/gi, "$1m")
    .trim();

  return { compact, title: raw };
}

export function getCoverageBandClass(pct: number): string {
  if (pct >= 95) return "is-easy"; // Verde suave / óptimo (95-100%)
  if (pct >= 90) return "is-moderate"; // Amarillo / zona de desarrollo próximo
  return "is-challenging"; // Naranja / desafiante (< 90%)
}

export interface SmartReaderDockProps {
  /** Texto legible de progreso (ej. "Pág. 12 de 45 · ~3 min" o "Cap. 2 de 8 · ~15 min") */
  progressText: string;
  errorText?: string;

  /** Cobertura léxica del capítulo (porcentaje 0-100) */
  coveragePct?: number | null;
  onOpenGlossary?: () => void;

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

  /** Fase 1 Anti-Abandono: Píldora de Progreso Invisible y Récord Contextual */
  bookProgressPct?: number | null;
  weeklyWordsCount?: number | null;
  recordToast?: string | null;
  onDismissRecordToast?: () => void;
  isReadingActive?: boolean;
  onStartAudio5Min?: () => void;
}

export default function SmartReaderDock({
  progressText,
  errorText,
  coveragePct,
  onOpenGlossary,
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
  bookProgressPct,
  weeklyWordsCount,
  recordToast,
  onDismissRecordToast: _onDismissRecordToast,
  isReadingActive = false,
  onStartAudio5Min,
}: SmartReaderDockProps) {
  const [isModeSheetOpen, setIsModeSheetOpen] = useState(false);
  const [wordCapturedToast, setWordCapturedToast] = useState(false);
  const [isDismissedLocally, setIsDismissedLocally] = useState(false);
  const [isMuteOptionsOpen, setIsMuteOptionsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Auto-ocultamiento de la píldora al hacer scroll / leer activamente (Fase 1)
  const [isScrollHidden, setIsScrollHidden] = useState(false);
  const scrollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleScroll = () => {
      setIsScrollHidden(true);
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = window.setTimeout(() => {
        setIsScrollHidden(false);
      }, 1800);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("touchmove", handleScroll, { passive: true });
    window.addEventListener("wheel", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("touchmove", handleScroll);
      window.removeEventListener("wheel", handleScroll);
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, []);

  const displayProgress =
    typeof bookProgressPct === "number"
      ? Math.round(Math.max(0, Math.min(100, bookProgressPct)))
      : (() => {
          const match = progressText.match(/(\d+)%/);
          if (match) return parseInt(match[1], 10);
          return 0;
        })();

  const displayWeeklyWords =
    typeof weeklyWordsCount === "number"
      ? weeklyWordsCount
      : getWeeklyLearnedWordsCount();

  const isPillHidden = isReadingActive || isScrollHidden;

  const progressMeta = formatCompactProgress(progressText);
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
      icon: "more",
      shortLabel: "Ajustado",
      label: "Personalizado",
      description: "Opciones avanzadas personalizadas",
    };

  // Cierra el popover si se presiona la tecla Escape
  useEffect(() => {
    if (!isModeSheetOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsModeSheetOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
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
          tabIndex={isPureCanvas ? 0 : -1}
          disabled={!isPureCanvas}
        >
          <span className="reader-mini-cat-avatar" aria-hidden="true">
            <Icon name="sparkles" size={16} />
          </span>
          {isAudioMode && ttsSnap.status === "speaking" && (
            <span className="reader-mini-audio-dot" aria-label="Audio reproduciéndose" />
          )}
        </button>
      </div>

      {/* DOCK ÚNICO INFERIOR INTELIGENTE */}
      <div
        className={`reader-dock-shell reader-dock-wrapper reader-smart-dock-wrapper ${isPureCanvas ? "is-pure-canvas" : ""}`}
        data-hidden={isPureCanvas || undefined}
        ref={popoverRef}
      >
        {/* Toast sutil de Récord Mensual (Fase 1 Anti-Abandono) */}
        {recordToast && !isPureCanvas && (
          <div
            className="reader-record-toast"
            role="status"
            aria-live="polite"
            style={{
              position: "absolute",
              bottom: "calc(100% + 44px)",
              left: "50%",
              transform: "translateX(-50%)",
              background: "var(--paper-raised, #1e1e1e)",
              color: "var(--ink, #ffffff)",
              padding: "6px 14px",
              borderRadius: "9999px",
              border: "1px solid var(--accent, #e5a93c)",
              fontSize: "0.82rem",
              fontWeight: 500,
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.2)",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              zIndex: 60,
              whiteSpace: "nowrap",
              pointerEvents: "none",
            }}
          >
            <span aria-hidden="true">🏆</span>
            <span>{recordToast}</span>
          </div>
        )}

        {/* Píldora de Progreso Invisible (Fase 1 Anti-Abandono - Cero CLS) */}
        {!isPureCanvas && !isAudioMode && (
          <div
            className={`reader-progress-invisible-pill ${isPillHidden ? "is-hidden" : ""}`}
            role="status"
            aria-label={`Llevas ${displayProgress}% · ${displayWeeklyWords} palabras nuevas esta semana`}
            style={{
              position: "absolute",
              bottom: "calc(100% + 8px)",
              left: "50%",
              transform: isPillHidden
                ? "translateX(-50%) translateY(4px)"
                : "translateX(-50%) translateY(0)",
              background: "var(--paper-raised, rgba(30, 30, 30, 0.85))",
              color: "var(--ink, #ffffff)",
              padding: "4px 12px",
              borderRadius: "9999px",
              border: "1px solid var(--rule-subtle, rgba(255, 255, 255, 0.1))",
              fontSize: "0.78rem",
              fontWeight: 500,
              boxShadow: "0 2px 10px rgba(0, 0, 0, 0.12)",
              zIndex: 40,
              whiteSpace: "nowrap",
              pointerEvents: "none",
              opacity: isPillHidden ? 0 : 0.9,
              transition: "opacity 0.25s ease, transform 0.25s ease",
            }}
          >
            Llevas {displayProgress}% · {displayWeeklyWords} palabras nuevas esta semana
          </div>
        )}
        {/* Backdrop transparente que intercepta el toque exterior para cerrar el popover sin pasar de página */}
        {isModeSheetOpen && !isAudioMode && (
          <div
            className="dock-mode-popover-backdrop"
            data-testid="dock-mode-popover-backdrop"
            aria-hidden="true"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setIsModeSheetOpen(false);
            }}
            onTouchStart={(e) => {
              e.stopPropagation();
              setIsModeSheetOpen(false);
            }}
          />
        )}

        {/* Popover de 1 toque para los 3 Modos Humanos */}
        {isModeSheetOpen && !isAudioMode && (
          <div
            className="dock-mode-popover reader-mode-popover"
            role="dialog"
            aria-label="Elegir modo de lectura"
          >
            <div className="dock-mode-popover-grid reader-mode-popover-grid">
              {READING_PRESETS.map((preset) => {
                const isSelected = activePreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={`reader-mode-card ${isSelected ? "is-active" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectPreset(preset.id as Exclude<ReadingPreset, "custom">);
                      setIsModeSheetOpen(false);
                    }}
                  >
                    <span className="reader-mode-card-icon" aria-hidden="true">
                      <Icon name={preset.icon as IconName} size={18} />
                    </span>
                    <strong className="reader-mode-card-title">{preset.label}</strong>
                    <span className="reader-mode-card-desc">{preset.description}</span>
                  </button>
                );
              })}
            </div>
            <div className="dock-mode-popover-footer reader-mode-popover-footer">
              <button
                type="button"
                className="dock-mode-customize-btn reader-mode-customize-link"
                onClick={() => {
                  setIsModeSheetOpen(false);
                  onOpenAdvancedSettings();
                }}
              >
                Personalizar opciones avanzadas…
              </button>
            </div>
          </div>
        )}

        {/* Píldora sutil de Neuro-Foco (Track 9 - Cero Fricción) */}
        {isFeatureFlagEnabled("focusTelemetry") && effectiveIsFatigued && !isDismissedLocally && !isAudioMode && !isPureCanvas && (
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
              background: "var(--paper-raised)",
              color: "var(--ink)",
              borderRadius: "9999px",
              boxShadow: "var(--shadow-2)",
              fontSize: "0.86rem",
              lineHeight: 1.3,
              zIndex: 50,
              border: "1px solid var(--rule-strong)",
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
                    <Icon
                      name={
                        effectiveAid === "syntactic-lines"
                          ? "strategy"
                          : effectiveAid === "focus-ruler"
                            ? "focus"
                            : "focus"
                      }
                      size={14}
                    />
                  </span>
                  <span>{suggestionText}</span>
                </button>
                {onStartAudio5Min && (
                  <button
                    type="button"
                    className="reader-focus-pill-audio"
                    onClick={() => {
                      onStartAudio5Min();
                      setIsDismissedLocally(true);
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      padding: "2px 8px",
                      margin: 0,
                      color: "inherit",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                      font: "inherit",
                      fontSize: "0.82rem",
                      fontWeight: 500,
                      borderLeft: "1px solid var(--rule-strong)",
                    }}
                    aria-label="Escuchar los próximos 5 min"
                  >
                    <span>Escuchar 5 min 🎧</span>
                  </button>
                )}
                <button
                  type="button"
                  className="reader-focus-pill-close"
                  onClick={() => setIsMuteOptionsOpen(true)}
                  style={{
                    background: "var(--paper-sunken)",
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
          className={`smart-reader-dock reader-smart-dock reader-dock ${isAudioMode ? "is-audio-mode" : "is-reading-mode"}`}
          aria-label={isAudioMode ? "Controles de voz y ritmo" : "Barra de lectura"}
        >
          {/* Asiento del Gato (Perch Mode: reposando sobre la esquina superior derecha de la cápsula) */}
          {companionSlot ? (
            <div
              className="dock-companion-slot dock-companion-perch"
              data-popover-open={isModeSheetOpen || undefined}
            >
              {companionSlot}
            </div>
          ) : null}

          {!isAudioMode ? (
            /* ================= MODO LECTURA ================= */
            <>
              <div
                className="dock-progress-meta dock-section dock-progress-info"
                title={progressMeta.title || progressText}
              >
                <span className="dock-chapter-text">{progressMeta.compact || progressText}</span>
                {errorText ? (
                  <span className="dock-error-text" role="alert">
                    {errorText}
                  </span>
                ) : null}
              </div>

              <div className="dock-actions-group">
                {coveragePct != null && !Number.isNaN(coveragePct) && (
                  <button
                    type="button"
                    className={`smart-dock-btn smart-dock-pill ${getCoverageBandClass(coveragePct)}`}
                    onClick={onOpenGlossary}
                    aria-label={`Vocabulario conocido del capítulo: ${Math.round(coveragePct)}%. Toca para abrir el glosario`}
                    title="Ver palabras de este capítulo"
                  >
                    <span className="smart-dock-pill-label">Vocab.</span>{" "}
                    <strong>{Math.round(coveragePct)}%</strong>
                  </button>
                )}

                {/* Selector de los 3 Modos Humanos */}
                <button
                  type="button"
                  className="dock-action-btn dock-pill-btn dock-mode-trigger"
                  onClick={() => setIsModeSheetOpen((prev) => !prev)}
                  aria-expanded={isModeSheetOpen}
                  aria-label={`Modo de lectura: ${currentPresetMeta.label}. Toque para cambiar`}
                  title="Modo de lectura y ayudas visuales"
                >
                  <span aria-hidden="true">
                    <Icon name={currentPresetMeta.icon as IconName} size={14} />
                  </span>
                  <span>{currentPresetMeta.shortLabel}</span>
                </button>

                {/* Botón directo de 1 toque para escuchar en voz alta */}
                {onStartAudio && (
                  <button
                    type="button"
                    className="dock-action-btn dock-pill-btn dock-listen-trigger"
                    onClick={onStartAudio}
                    aria-label="Escuchar página en voz alta"
                    title="Escuchar en voz alta (TTS)"
                  >
                    <Icon name="headphones" size={14} />
                    <span className="dock-action-label-collapsible">Escuchar</span>
                  </button>
                )}

                {/* Resumen de atención (Hilo) */}
                {onRecap && (
                  <button
                    type="button"
                    className="dock-action-btn dock-pill-btn dock-recap-trigger"
                    onClick={onRecap}
                    aria-label="Recuperar el hilo de esta página"
                    title="Recuperar el hilo (resumen de atención)"
                  >
                    <Icon name="journey" size={14} />
                    <span className="dock-action-label-collapsible">Hilo</span>
                  </button>
                )}
              </div>
            </>
          ) : (
            /* ================= MODO AUDIO / TTS ================= */
            <div className="dock-actions-group dock-audio-group" style={{ width: "100%", justifyContent: "center" }}>
              {/* Frase anterior */}
              {onPrevSentence ? (
                <button
                  type="button"
                  className="dock-audio-btn dock-audio-step-btn dock-pill-btn"
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
                className="dock-audio-play-btn dock-pill-btn"
                onClick={() => {
                  unlockAudioContext();
                  onTogglePlayPause();
                }}
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
                  className="dock-audio-btn dock-audio-step-btn dock-pill-btn"
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
                className="dock-audio-pill-btn dock-pill-btn"
                onClick={onCycleSpeed}
                aria-label="Velocidad de voz"
                title="Cambiar velocidad"
              >
                {`${ttsSnap.rate}×`}
              </button>

              {/* Selector de Voz */}
              {onOpenVoiceSelector ? (
                <button
                  type="button"
                  className={`dock-audio-pill-btn dock-pill-btn ${isNeuralVoice ? "is-hd-active" : ""}`}
                  onClick={onOpenVoiceSelector}
                  aria-label="Elegir voz"
                  title={isNeuralVoice ? "Voz KittenTTS Neural HD activa" : "Voz del sistema. Toca para cambiar o descargar HD"}
                >
                  <span aria-hidden="true">
                    <Icon name={isNeuralVoice ? "sparkles" : "speaker"} size={14} />
                  </span>
                  <span className="dock-action-label-collapsible">{isNeuralVoice ? " Voz HD" : " Voz"}</span>
                </button>
              ) : null}

              {/* Captura al Cuaderno de la frase actual */}
              {onCaptureWord ? (
                <button
                  type="button"
                  className={`dock-audio-pill-btn dock-pill-btn dock-audio-capture-btn ${wordCapturedToast ? "is-captured" : ""}`}
                  onClick={handleCapture}
                  disabled={ttsSnap.status === "preparing"}
                  aria-label="Capturar joya léxica de la frase al Cuaderno"
                  title="Guardar palabra clave de la frase"
                >
                  <span aria-hidden="true">{wordCapturedToast ? "✓" : "★"}</span>
                  <span className="dock-action-label-collapsible">{wordCapturedToast ? " Guardada" : " Joya"}</span>
                </button>
              ) : null}

              {/* Volver a lectura silenciosa */}
              <button
                type="button"
                className="dock-audio-close-btn dock-pill-btn"
                onClick={onStopAudio}
                aria-label="Detener audio y volver a lectura silenciosa"
                title="Volver a lectura silenciosa"
              >
                ✕
              </button>
            </div>
          )}
        </nav>
      </div>
    </>
  );
}
