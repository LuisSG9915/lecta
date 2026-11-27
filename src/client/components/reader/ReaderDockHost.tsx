// Dock inferior único del lector (Track 2): muta entre Lectura, Audio y Lienzo
// Puro, y lleva al gato de compañía en su carril.
//
// Extraído de Reader.tsx (Fase 7). Solo pinta y despacha: el estado de los
// modos y del gato sigue viviendo en el lector.
import { CompanionButton } from "../CompanionButton";
import type { CompanionContextValue } from "../CompanionProvider";
import type { ReaderSettingsTab } from "../Reader";
import SmartReaderDock, { type FocusSuggestion } from "../SmartReaderDock";
import type { CompanionState } from "../../lib/companion-state";
import { triggerHaptic } from "../../lib/deep-reading";
import { dockProgressText } from "../../lib/progress";
import { loadFocusTelemetryProfile, type FocusAidType } from "../../lib/focus-telemetry";
import type { SectionPrediction } from "../../lib/knowledge";
import {
  applyReadingPreset,
  readingModeView,
  readingPresetOptions,
  type ReadingPresetOption,
  type ReaderSettings,
} from "../../lib/settings";
import type { TtsSnapshot } from "../../lib/ttsTypes";
import type { WordHit } from "../../lib/words";

export interface ReaderDockHostProps {
  pacerPaused: boolean;
  strategyPaused: boolean;
  onTogglePacerPause: () => void;
  settings: ReaderSettings;
  updateSettings: (patch: Partial<ReaderSettings>) => void;
  errorText: string;
  page: number;
  pageCount: number;
  sectionIndex: number;
  sectionTotal: number;
  minutes: number;
  chapterOrdinal: { n: number; total: number } | null;
  prediction: SectionPrediction | null;
  scrollRatio: number;
  barsShown: boolean;
  setBarsVisible: (visible: boolean) => void;
  setGlossaryOpen: (open: boolean) => void;
  setSettingsTab: (tab: ReaderSettingsTab) => void;
  setSheet: (sheet: "settings" | null) => void;
  setStrategyPaused: (paused: boolean) => void;
  openVoiceSelector: () => void;
  ttsSnap: TtsSnapshot;
  onTtsRequest: () => void;
  togglePlayPause: () => void;
  prevSentence: () => void;
  nextSentence: () => void;
  cycleSpeed: () => void;
  setSleepTimer: (opt: number | { chapterEnd: true } | null) => void;
  autoAdvanceChapter: boolean;
  setAutoAdvanceChapter: (value: boolean) => void;
  backgroundAudio: boolean;
  setBackgroundAudio: (value: boolean) => void;
  stopTts: (reason?: "user" | "navigation" | "visibility") => void;
  handleTtsCaptureWord: () => Promise<void>;
  handleRecapClick: () => Promise<void>;
  isDeepReading: boolean;
  selection: WordHit | null;
  companion: CompanionContextValue;
  catState: CompanionState | null;
  catShown: boolean;
  catLeaving: boolean;
  catTap: boolean;
  catSavedWord: boolean;
  catSleepy: boolean;
  catGreeting: boolean;
  onCatTap: () => void;
  stallBubble: string | null;
  onStallBubbleClick: () => void;
  fatigueSuggestion: FocusSuggestion | null;
  handleAcceptFocusAid: (aid: FocusAidType) => void;
  handleDismissFocusSuggestion: () => void;
  handleMuteFocusForBook: () => void;
  handleDisableFocusGlobally: () => void;
  progress?: number;
  weeklyWordsCount?: number | null;
  recordToast?: string | null;
  onDismissRecordToast?: () => void;
  isReadingActive?: boolean;
  onStartAudio5Min?: () => void;
  language?: string;
  onOpenDeepReading?: () => void;
  onOpenOpticalRecipe?: () => void;
  isForeignLanguage?: boolean;
}

export function computePacerSpeeds(lang = "es"): readonly [number, number, number] {
  const langKey = (lang || "es").slice(0, 2).toLowerCase();
  const baseline = loadFocusTelemetryProfile().paceByLang[langKey];
  if (baseline && baseline.samples >= 3 && baseline.meanSecPer100Words > 0) {
    const mid = Math.max(120, Math.min(320, Math.round(6000 / baseline.meanSecPer100Words)));
    const slow = Math.max(90, Math.round(mid * 0.85));
    const fast = Math.min(360, Math.round(mid * 1.15));
    return [slow, mid, fast];
  }
  return [150, 210, 270];
}

/** Velocidades guardadas por la barra anterior (180, 240…) caen al botón más cercano. */
function snapPacerWpm(
  wpm: number,
  speeds: readonly [number, number, number] = [150, 210, 270],
): number {
  return speeds.reduce((a, b) => (Math.abs(b - wpm) < Math.abs(a - wpm) ? b : a));
}

export function ReaderDockHost(props: ReaderDockHostProps) {
  const {
  pacerPaused,
  strategyPaused,
  onTogglePacerPause,
  settings,
  updateSettings,
  errorText,
  page,
  pageCount,
  sectionIndex,
  sectionTotal,
  minutes,
  chapterOrdinal,
  prediction,
  scrollRatio,
  barsShown,
  setBarsVisible,
  setGlossaryOpen,
  setSettingsTab,
  setSheet,
  setStrategyPaused,
  openVoiceSelector,
  ttsSnap,
  onTtsRequest,
  togglePlayPause,
  prevSentence,
  nextSentence,
  cycleSpeed,
  setSleepTimer,
  autoAdvanceChapter,
  setAutoAdvanceChapter,
  backgroundAudio,
  setBackgroundAudio,
  stopTts,
  handleTtsCaptureWord,
  handleRecapClick,
  isDeepReading,
  selection,
  companion,
  catState,
  catShown,
  catLeaving,
  catTap,
  catSavedWord,
  catSleepy,
  catGreeting,
  onCatTap,
  stallBubble,
  onStallBubbleClick,
  fatigueSuggestion,
  handleAcceptFocusAid,
  handleDismissFocusSuggestion,
  handleMuteFocusForBook,
  handleDisableFocusGlobally,
  progress,
  weeklyWordsCount,
  recordToast,
  onDismissRecordToast,
  isReadingActive,
  onStartAudio5Min,
  language,
  onOpenDeepReading,
  onOpenOpticalRecipe,
  isForeignLanguage,
  } = props;

  const pacerSpeeds = computePacerSpeeds(language);

  return (
    <SmartReaderDock
      progressText={dockProgressText({
        layout: settings.layout,
        page,
        pageCount,
        sectionIndex,
        sectionTotal,
        minutes,
        ordinal: chapterOrdinal,
      })}
      errorText={errorText ?? undefined}
      coveragePct={prediction?.coveragePct ?? null}
      onOpenGlossary={() => setGlossaryOpen(true)}
      isPureCanvas={!barsShown}
      onExitPureCanvas={() => setBarsVisible(true)}
      layout={settings.layout}
      onSelectLayout={(layout) => {
        triggerHaptic("selection");
        updateSettings({ layout });
      }}
      activePreset={readingModeView(settings).active}
      modeOptions={readingPresetOptions(readingModeView(settings).optionsFor).map((o) => ({
        id: o.key,
        label: o.label,
        checked: Boolean(settings[o.key]),
      }))}
      pacer={
        settings.visualPacer && !strategyPaused
          ? {
              paused: pacerPaused,
              wpm: snapPacerWpm(settings.pacerWpm || pacerSpeeds[1], pacerSpeeds),
              speeds: pacerSpeeds,
            }
          : null
      }
      onTogglePacerPause={onTogglePacerPause}
      onSetPacerWpm={(wpm) => updateSettings({ pacerWpm: wpm })}
      onStopPacer={() => {
        if (pacerPaused) onTogglePacerPause();
        updateSettings({ visualPacer: false });
      }}
      onToggleModeOption={(id) => {
        triggerHaptic("selection");
        const key = id as ReadingPresetOption["key"];
        if (key === "visualPacer" && settings.visualPacer && pacerPaused) onTogglePacerPause();
        // Conservar el modo elegido: sin esto el hook marca «custom» y los
        // interruptores desaparecen al apagar una pieza.
        updateSettings({
          [key]: !settings[key],
          readingPreset: settings.readingPreset,
          strategyPreset: settings.strategyPreset,
        });
      }}
      onSelectPreset={(preset) => {
        triggerHaptic("selection");
        setStrategyPaused(false);
        updateSettings(applyReadingPreset(settings, preset));
      }}
      onOpenAdvancedSettings={() => {
        setSettingsTab("appearance");
        setSheet("settings");
      }}
      onStartAudio={onTtsRequest}
      onRecap={handleRecapClick}
      focusSuggestion={fatigueSuggestion}
      isFatigued={fatigueSuggestion?.isFatigued}
      recommendedFocusAid={fatigueSuggestion?.recommendedAid}
      focusFatigueReason={fatigueSuggestion?.reason}
      onAcceptFocusAid={handleAcceptFocusAid}
      bookProgressPct={progress != null ? Math.round(progress * 100) : null}
      weeklyWordsCount={weeklyWordsCount}
      recordToast={recordToast}
      onDismissRecordToast={onDismissRecordToast}
      isReadingActive={isReadingActive}
      onStartAudio5Min={onStartAudio5Min}
      onOpenDeepReading={onOpenDeepReading}
      onOpenOpticalRecipe={onOpenOpticalRecipe}
      isForeignLanguage={isForeignLanguage}
      soundscape={settings.soundscape ?? (settings.ambientPurr ? "purr" : "none")}
      onSelectSoundscape={(kind) => {
        triggerHaptic("selection");
        updateSettings({ soundscape: kind, ambientPurr: kind === "purr" });
      }}
      onDismissFocusSuggestion={handleDismissFocusSuggestion}
      onMuteFocusForBook={handleMuteFocusForBook}
      onDisableFocusGlobally={handleDisableFocusGlobally}
      companionSlot={
        catShown && catState ? (
          <div
            className="reader-dock-cat cat-anim"
            data-out={catLeaving || undefined}
          >
            <CompanionButton
              stage={companion.stage}
              mood={
                catSavedWord
                  ? "happy"
                  : catSleepy
                    ? "sleepy"
                    : "awake"
              }
              accessories={companion.accessories}
              focus={
                catSavedWord
                  ? "celebrating"
                  : isDeepReading
                    ? "deep_focus"
                    : catSleepy
                      ? "sleep"
                      : selection
                        ? "curious"
                        : catState
              }
              gazeProgress={
                settings.layout === "pages"
                  ? pageCount > 1
                    ? page / (pageCount - 1)
                    : 0
                  : scrollRatio
              }
              pose={
                isDeepReading
                  ? undefined
                  : catTap
                    ? "celebrate"
                    : catSavedWord
                      ? "celebrate"
                      : catGreeting
                        ? "greet"
                        : undefined
              }
              label={`Ver a ${companion.name}`}
              onClick={onCatTap}
              bubbleMessage={stallBubble}
              onBubbleClick={onStallBubbleClick}
            />
          </div>
        ) : null
      }
      ttsSnap={ttsSnap}
      onTogglePlayPause={togglePlayPause}
      onPrevSentence={prevSentence}
      onNextSentence={nextSentence}
      onCycleSpeed={cycleSpeed}
      onSetSleepTimer={setSleepTimer}
      autoAdvanceChapter={autoAdvanceChapter}
      onToggleAutoAdvance={setAutoAdvanceChapter}
      backgroundAudio={backgroundAudio}
      onToggleBackgroundAudio={setBackgroundAudio}
      onOpenVoiceSelector={openVoiceSelector}
      onCaptureWord={handleTtsCaptureWord}
      onStopAudio={() => stopTts("user")}
      onOpenCatCorner={onCatTap}
    />
  );
}
