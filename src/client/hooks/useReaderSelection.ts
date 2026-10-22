// Selección de una palabra en el lector: abrir la ficha (locución, capa de
// historial, evidencia del perfil y journal) y cerrarla.
//
// Extraída de Reader.tsx (línea de trabajo posterior a la Fase 7). Las dos
// acciones son estables: leen las opciones vigentes de un ref, así que abrir la
// ficha no rearma los efectos ni los hooks que las reciben como prop.
import { useCallback, useEffect, useRef } from "react";
import type { ChapterAnalyzer } from "../lib/chapter-analysis";
import { targetAt, type ChapterCatalog } from "../lib/chapters";
import type { CompanionSignal } from "../lib/companion-state";
import { getBookLanguage, type EpubBook } from "../lib/epub";
import { award, localDayKey } from "../lib/game";
import { pushOverlay, type OverlayHandle } from "../lib/history";
import { captureDbScope } from "../lib/idb";
import { lemmaOfFromEntries, matchPhrase, type PhraseIndex } from "../lib/phrases";
import type { EpisodicWordItem } from "../lib/practice";
import { betaFromZipf, updateLanguageTheta } from "../lib/profile-models";
import { charOffsetAtViewTop } from "../lib/reading-location";
import type { VisitEventDraft } from "../lib/reading-events";
import type { WordHit } from "../lib/words";
import type { ReadyAnalysis, TocRow } from "../components/Reader";

/** Un ref de React visto desde el hook. */
type Ref<T> = { current: T };

// Metadata del premio por consulta de palabra: el uuid se genera al
// abrir la ficha y viaja congelado en el journal. Vive fuera del
// componente para que reloj/uuid no se lean durante el render.
const consultedAwardMeta = () => {
  const at = Date.now();
  return {
    id: `consult:${crypto.randomUUID()}`,
    at,
    dayKey: localDayKey(at),
  };
};

export interface UseReaderSelectionOptions {
  /** Idioma del libro; vacío cae al del EPUB. */
  language: string;
  setSelection: (hit: WordHit | null) => void;
  /** La ficha solo cierra la hoja que hubiera; nunca la abre. */
  setSheet: (sheet: null) => void;
  setCharOffsetInChapter: (offset: number) => void;
  analyzerRef: Ref<ChapterAnalyzer | null>;
  bookRef: Ref<EpubBook | null>;
  catalogRef: Ref<ChapterCatalog | null>;
  consultedInPageRef: Ref<Set<string>>;
  containerRef: Ref<HTMLDivElement | null>;
  currentChapterLookups: Ref<EpisodicWordItem[]>;
  overlayReleaseRef: Ref<OverlayHandle | null>;
  phrasesRef: Ref<PhraseIndex | null>;
  sectionIndexRef: Ref<number>;
  sectionTextRef: Ref<string>;
  tocRowsRef: Ref<TocRow[]>;
  analysisFor: (index: number) => ReadyAnalysis | undefined;
  recordConsult: (form: string) => void;
  signalCompanion: (signal: Omit<CompanionSignal, "at"> & { at?: number }) => void;
  trackEvent: (draft: VisitEventDraft) => void;
  releaseOverlay: () => void;
  noteActivity: () => void;
}

export function useReaderSelection(options: UseReaderSelectionOptions) {
  // Las acciones leen las opciones vigentes de este ref: sin él tendrían que
  // recrearse en cada render y rearmarían los efectos que las reciben.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const openSelection = useCallback((hit: WordHit) => {
    const {
      noteActivity,
      phrasesRef,
      analyzerRef,
      catalogRef,
      sectionIndexRef,
      overlayReleaseRef,
      setSelection,
      setSheet,
      containerRef,
      setCharOffsetInChapter,
      sectionTextRef,
      consultedInPageRef,
      language,
      bookRef,
      analysisFor,
      currentChapterLookups,
      tocRowsRef,
      trackEvent,
      signalCompanion,
      recordConsult,
    } = optionsRef.current;
    noteActivity();
    // Locución en la oración del toque: matching por lema con el
    // análisis ya en caché del capítulo (capítulo sin analizar →
    // solo superficie; degradación documentada en phrases.ts).
    if (hit.context && phrasesRef.current) {
      const analysis = analyzerRef.current?.cached(
        targetAt(
          catalogRef.current?.ranges ?? [],
          sectionIndexRef.current,
        )?.id ?? "",
      );
      hit.phrase =
        matchPhrase(
          phrasesRef.current,
          hit.context,
          hit.word,
          lemmaOfFromEntries(
            analysis?.state === "ready" ? analysis.entries : undefined,
          ),
        ) ?? undefined;
    }
    const close = () => {
      overlayReleaseRef.current = null;
      setSelection(null);
    };
    if (overlayReleaseRef.current) overlayReleaseRef.current.swap(close);
    else overlayReleaseRef.current = pushOverlay(close);
    setSheet(null);
    setSelection(hit);
    if (containerRef.current) {
      setCharOffsetInChapter(charOffsetAtViewTop(containerRef.current, sectionTextRef.current));
    }
    consultedInPageRef.current.add(hit.word.toLowerCase());
    // Recalibración adaptativa hacia abajo (outcome = 0) para el idioma actual y registro en lookups del capítulo
    try {
      const currentLang = language || (bookRef.current ? getBookLanguage(bookRef.current) : "es");
      const cachedAnalysis = analysisFor(sectionIndexRef.current);
      const hitEntry = cachedAnalysis?.entries[hit.word.toLowerCase()]?.[0];
      const wordBeta = betaFromZipf(hitEntry?.zipf);
      updateLanguageTheta(currentLang, wordBeta, 0, 0.8);

      const tocLabel = tocRowsRef.current.find((r) => r.index === sectionIndexRef.current)?.label;
      const lookupItem: EpisodicWordItem = {
        lemma: hitEntry?.lemma || hit.word.toLowerCase(),
        surfaceForm: hit.word,
        lang: currentLang,
        shortGloss: hitEntry?.senses?.[0]?.definition || "",
        chapterSentence: hit.context || hit.word,
        chapterTitle: tocLabel || `Sección ${sectionIndexRef.current + 1}`,
        source: "in-chapter-lookup",
        partOfSpeech: hitEntry?.pos ?? undefined,
      };
      if (!currentChapterLookups.current.some((l) => l.lemma === lookupItem.lemma)) {
        currentChapterLookups.current.push(lookupItem);
      }
    } catch {
      // Ignorar fallo al persistir theta o lookups
    }
    // La consulta es un acto neutral para el modelo, pero sí queda en
    // el trayecto: sirve para distinguir curiosidad de guardado.
    trackEvent({
      kind: "word_consulted",
      sectionIndex: sectionIndexRef.current,
      form: hit.word,
      origin: "text",
    });
    // Una consulta = un evento del journal, sellado al abrir la ficha.
    void award({ kind: "consulted" }, captureDbScope(), consultedAwardMeta());
    signalCompanion({ kind: "word_consulted" });
    recordConsult(hit.word);
  }, []);

  const closeSelection = useCallback(() => {
    const { releaseOverlay, setSelection } = optionsRef.current;
    releaseOverlay();
    setSelection(null);
  }, []);

  return { openSelection, closeSelection };
}
