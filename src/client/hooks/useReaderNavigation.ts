// Navegación del lector: el salto entre destinos (`navigate`) y el paso de
// página que en los bordes cambia de sección (`goPage`).
//
// Extraída de Reader.tsx (línea de trabajo posterior a la Fase 7). Son dos hooks
// porque el lector los necesita en momentos distintos: `navigate` antes de montar
// la voz (alimenta useReaderTts) y `goPage` después de la exposición pasiva.
import { useCallback, useEffect, useRef } from "react";
import type { CompanionSignal } from "../lib/companion-state";
import { targetAt, type ChapterCatalog } from "../lib/chapters";
import type { DeepReadingSummary } from "../lib/deep-reading";
import { getBookLanguage, type EpubBook } from "../lib/epub";
import {
  evaluateReadingFatigue,
  loadFocusTelemetryProfile,
  saveFocusTelemetryProfile,
} from "../lib/focus-telemetry";
import { pageForFragment, type PageLayout } from "../lib/pagination";
import {
  buildPostChapterConsolidationQueue,
  isConsolidationActive,
  loadPostChapterConsolidationPrefs,
  type ConsolidationModality,
  type EpisodicWordItem,
} from "../lib/practice";
import { recordChapterCompleted } from "../lib/profile-models";
import { scrollToFragment } from "../lib/reading-location";
import {
  isFeatureFlagEnabled,
  loadNativeLanguage,
  type ReaderSettings,
} from "../lib/settings";
import { isTtsProgrammaticNav } from "../lib/ttsGuards";
import type { FocusSuggestion } from "../components/SmartReaderDock";
import type { NavIntent, ReaderState } from "../components/Reader";

/** Un ref de React visto desde el hook. */
type Ref<T> = { current: T };

/** Restauración dentro de la sección: el formato persistido no cambia. */
export type ReaderNavRestore = {
  ratio?: number;
  anchor?: string;
  snippet?: string;
  fragment?: string;
  at?: "end";
};

export type ReaderNavDestination = {
  index: number;
  fragment?: string;
  restore?: ReaderNavRestore;
};

export type ReaderNavigate = (
  intent: NavIntent,
  dest: ReaderNavDestination,
) => Promise<unknown>;

export interface UseReaderNavigationOptions {
  loadSection: (index: number, restore: ReaderNavRestore) => Promise<unknown>;
  evaluatePreparation: (
    index: number,
    via?: "enter" | "analysis-settled",
    prevTargetId?: string | null,
  ) => Promise<void>;
  setPageIdx: (next: number, updateAnchor?: boolean) => void;
  setActiveScrollFragment: (fragment: string | null) => void;
  activeScrollFragRef: Ref<string | null>;
  catalogRef: Ref<ChapterCatalog | null>;
  containerRef: Ref<HTMLDivElement | null>;
  layoutRef: Ref<"scroll" | "pages">;
  metricsRef: Ref<PageLayout | null>;
  navIntentRef: Ref<NavIntent>;
  sectionIndexRef: Ref<number>;
  stateRef: Ref<ReaderState>;
  ttsStopOnNavRef: Ref<(() => void) | null>;
}

export interface UseReaderPaginationOptions {
  navigate: ReaderNavigate;
  checkPassiveExposure: () => void;
  noteActivity: () => void;
  saveSoon: () => void;
  trackMove: (back: boolean) => void;
  showNotice: (message: string) => void;
  signalCompanion: (signal: Omit<CompanionSignal, "at"> & { at?: number }) => void;
  setPageIdx: (next: number, updateAnchor?: boolean) => void;
  setBarsVisible: (visible: boolean) => void;
  setDeepSummary: (summary: DeepReadingSummary | null) => void;
  setFatigueSuggestion: (suggestion: FocusSuggestion | null) => void;
  setPostChapterQueue: (
    queue: { item: EpisodicWordItem; modality: ConsolidationModality }[],
  ) => void;
  bookHash: string;
  language: string;
  sectionWords: number;
  sectionTotal: number;
  bookRef: Ref<EpubBook | null>;
  pageRef: Ref<number>;
  pageCountRef: Ref<number>;
  sectionIndexRef: Ref<number>;
  pageTurnTimeRef: Ref<number>;
  sessionStartRef: Ref<number>;
  chapterStartedAtRef: Ref<number>;
  pendingNextChapterRef: Ref<number | null>;
  currentChapterLookups: Ref<EpisodicWordItem[]>;
  currentChapterPrimedWordsRef: Ref<EpisodicWordItem[]>;
  focusTelemetryRef: Ref<{
    recordPageTurn: (wordsOnPage?: number, dwellMs?: number) => boolean;
  }>;
  settingsRef: Ref<ReaderSettings | null>;
}

export function useReaderNavigation(options: UseReaderNavigationOptions) {
  // Las acciones leen las opciones vigentes de este ref: sin él tendrían que
  // recrearse en cada render y rearmarían los efectos que las reciben.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  // Coordinador de navegación: todo salto registra su intención para
  // que la preparación (T19) sepa si debe interponerse. El destino
  // físico sigue siendo sección + restauración — el formato de
  // posición persistida no cambia.
  const navigate = useCallback(
    (intent: NavIntent, dest: ReaderNavDestination) => {
      const {
        navIntentRef,
        ttsStopOnNavRef,
        catalogRef,
        sectionIndexRef,
        containerRef,
        stateRef,
        layoutRef,
        metricsRef,
        setPageIdx,
        activeScrollFragRef,
        setActiveScrollFragment,
        evaluatePreparation,
        loadSection,
      } = optionsRef.current;
      navIntentRef.current = intent;
      // La voz solo cede ante navegación del lector: los avances que
      // hace el propio TTS dentro del target llegan protegidos por
      // withTtsProgrammaticNav y no cierran la sesión.
      if (!isTtsProgrammaticNav()) ttsStopOnNavRef.current?.();
      const restore = { ...dest.restore };
      if (dest.fragment) restore.fragment = dest.fragment;
      const prevTargetId = targetAt(
        catalogRef.current?.ranges ?? [],
        sectionIndexRef.current,
      )?.id ?? null;

      // Optimización intra-sección: si ya estamos en la misma sección y lista,
      // desplazamos directamente al nuevo fragmento sin recargar todo el documento.
      if (
        dest.index === sectionIndexRef.current &&
        dest.fragment &&
        containerRef.current &&
        stateRef.current === "ready"
      ) {
        if (layoutRef.current === "pages" && metricsRef.current) {
          const targetPage = pageForFragment(
            containerRef.current,
            dest.fragment,
            metricsRef.current,
          );
          if (targetPage !== null) {
            setPageIdx(targetPage, true);
          }
        } else {
          scrollToFragment(containerRef.current, dest.fragment);
        }
        activeScrollFragRef.current = dest.fragment;
        setActiveScrollFragment(dest.fragment);
        if (intent === "initial" || intent === "chapter") {
          void evaluatePreparation(dest.index, "enter", prevTargetId);
        }
        return Promise.resolve();
      }

      const result = loadSection(dest.index, restore);
      // Solo «entrar» puede interponer preparación; reanudar, buscar
      // y regresar nunca la disparan. La decisión corre tras la carga
      // y jamás la bloquea — si la sección falló no hay nada que
      // evaluar (sectionIndexRef no cambió).
      if (intent === "initial" || intent === "chapter")
        void result.then(() => {
          if (sectionIndexRef.current === dest.index)
            void evaluatePreparation(dest.index, "enter", prevTargetId);
        });
      return result;
    },
    [],
  );

  return { navigate };
}

export function useReaderPagination(options: UseReaderPaginationOptions) {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  // Cierre de capítulo: lo comparten el paso de página (modo `pages`)
  // y el enlace «Siguiente» del final del texto (modo `scroll`), para
  // que el lector reciba el mismo cierre y la misma consolidación en
  // los dos modos de lectura.
  const completeChapterTo = useCallback(
    (nextIndex: number, fragment?: string): Promise<unknown> => {
      const {
        navigate,
        checkPassiveExposure,
        signalCompanion,
        setDeepSummary,
        setPostChapterQueue,
        bookHash,
        language,
        sectionWords,
        bookRef,
        chapterStartedAtRef,
        pendingNextChapterRef,
        currentChapterLookups,
        currentChapterPrimedWordsRef,
      } = optionsRef.current;
      const currentLang =
        language || (bookRef.current ? getBookLanguage(bookRef.current) : "es");
      const isL2 = currentLang !== loadNativeLanguage();
      try {
        recordChapterCompleted(currentLang);
      } catch {
        // Ignorar fallo de guardado
      }
      signalCompanion({ kind: "goal_completed", at: Date.now() });

      // Fin de Capítulo: Aprendizaje Pasivo + Consolidación Episódica
      checkPassiveExposure();
      const prefs = loadPostChapterConsolidationPrefs();
      const candidates: EpisodicWordItem[] = [
        ...currentChapterLookups.current,
        ...currentChapterPrimedWordsRef.current,
      ];
      const queue = isFeatureFlagEnabled("vocabGames")
        ? buildPostChapterConsolidationQueue(candidates, prefs, isL2, { bookId: bookHash })
        : [];

      if (queue.length > 0 && isConsolidationActive(bookHash) && isFeatureFlagEnabled("vocabGames")) {
        setPostChapterQueue(queue);
        pendingNextChapterRef.current = nextIndex;
        const durationMinutes = Math.max(
          1,
          Math.round((Date.now() - chapterStartedAtRef.current) / 60000),
        );
        setDeepSummary({
          durationMinutes,
          targetMinutes: 15,
          sectionsRead: 1,
          completedNaturally: true,
          wordsAssimilated: sectionWords,
        });
        return Promise.resolve();
      }

      return navigate("chapter", { index: nextIndex, fragment });
    },
    [],
  );

  // Página siguiente/anterior; en los bordes salta de sección (atrás
  // cae al final de la sección anterior, como al retroceder una página
  // en un libro impreso).
  const goPage = useCallback(
    (delta: number) => {
      const {
        navigate,
        checkPassiveExposure,
        noteActivity,
        saveSoon,
        trackMove,
        showNotice,
        setPageIdx,
        setBarsVisible,
        setFatigueSuggestion,
        bookHash,
        language,
        sectionWords,
        sectionTotal,
        bookRef,
        pageRef,
        pageCountRef,
        sectionIndexRef,
        pageTurnTimeRef,
        sessionStartRef,
        focusTelemetryRef,
        settingsRef,
      } = optionsRef.current;
      noteActivity();
      trackMove(delta < 0);
      checkPassiveExposure();

      // Al avanzar página, pasa a lectura inmersiva ocultando las barras
      if (delta > 0) {
        setBarsVisible(false);
      }

      // Track 9: Neuro-Foco en vivo
      const now = Date.now();
      const dwellTimeMs = Math.max(500, now - pageTurnTimeRef.current);
      pageTurnTimeRef.current = now;
      const direction: "forward" | "backward" = delta > 0 ? "forward" : "backward";
      const isL2 = (language || (bookRef.current ? getBookLanguage(bookRef.current) : "es")) !== loadNativeLanguage();
      if (isFeatureFlagEnabled("focusTelemetry")) {
        const telemetryProfile = loadFocusTelemetryProfile();
        const fatigueResult = evaluateReadingFatigue(
          telemetryProfile,
          {
            dwellTimeMs,
            direction,
            wordCountOnPage: 80,
            sessionMinutesElapsed: Math.max(0, (now - sessionStartRef.current) / 60000),
            bookId: bookHash,
            lang: language || "es",
            recentBackwardCountInWindow: delta < 0 ? 1 : 0,
          },
          isL2,
        );
        saveFocusTelemetryProfile(fatigueResult.updatedProfile);
        if (fatigueResult.isFatigued) {
          setFatigueSuggestion({
            isFatigued: true,
            reason: fatigueResult.reason,
            recommendedAid: fatigueResult.recommendedAid,
          });
        } else if (fatigueResult.reason === "none") {
          setFatigueSuggestion(null);
        }
      } else {
        setFatigueSuggestion(null);
      }

      // Sugerencia consentida de Guía Visual (Lectura Biónica) ante pasaje denso
      const shouldSuggestBionic = focusTelemetryRef.current.recordPageTurn(
        Math.max(1, Math.round(sectionWords / Math.max(1, pageCountRef.current))),
        dwellTimeMs,
      );
      if (
        shouldSuggestBionic &&
        !settingsRef.current?.bionicAnchors &&
        !(settingsRef.current as { bionicReading?: boolean } | null)?.bionicReading
      ) {
        showNotice("¿Pasaje denso? Puedes activar la «Guía visual de sílabas» en el menú Aa.");
      }

      const next = pageRef.current + delta;
      if (next < 0) {
        if (sectionIndexRef.current > 0)
          return navigate("chapter", {
            index: sectionIndexRef.current - 1,
            restore: { at: "end" },
          });
        return Promise.resolve();
      }
      if (next >= pageCountRef.current) {
        // En la última página el ratio ya es ~1: pasar a la sección
        // siguiente cuenta como tramo terminado (el gato celebra).
        if (sectionIndexRef.current + 1 < sectionTotal)
          return completeChapterTo(sectionIndexRef.current + 1);
        return Promise.resolve();
      }
      setPageIdx(next);
      saveSoon();
      return Promise.resolve();
    },
    [completeChapterTo],
  );

  return { goPage, completeChapterTo };
}
