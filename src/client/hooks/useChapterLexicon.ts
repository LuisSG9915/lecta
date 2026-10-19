import { useCallback, useEffect, useState } from 'react';
import type { WordMeaning } from '../lib/idb';
import { type KnowledgeMap, getAllKnowledgeMap } from '../lib/knowledge';
import {
  type ChapterAnalysis,
  computeChapterAnalysis,
  markSectionPreviewed,
  shouldAutoShowPreview,
} from '../lib/chapter-analysis';
import { extractSectionWords, type SectionWord } from '../lib/section-words';
import { lookupWord } from '../lib/lexicon';

interface UseChapterLexiconParams {
  bookId: string;
  sectionDoc: Document | null;
  sectionIndex: number;
  chapterPreviewEnabled: boolean;
}

export function useChapterLexicon({
  bookId,
  sectionDoc,
  sectionIndex,
  chapterPreviewEnabled,
}: UseChapterLexiconParams) {
  const [knowledgeMap, setKnowledgeMap] = useState<KnowledgeMap>(() => new Map());
  const [chapterAnalysis, setChapterAnalysis] = useState<ChapterAnalysis | null>(null);
  const [previewSuggested, setPreviewSuggested] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [glossaryWords, setGlossaryWords] = useState<SectionWord[]>([]);
  const [glossaryMeanings, setGlossaryMeanings] = useState<Record<string, WordMeaning>>({});
  const [glossaryLoading, setGlossaryLoading] = useState(false);

  // Cargar mapa de conocimiento inicial
  useEffect(() => {
    let cancelled = false;
    getAllKnowledgeMap().then((map) => {
      if (!cancelled) setKnowledgeMap(map);
    });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  // Analizar el capítulo actual cada vez que cambia la sección o el mapa de vocabulario
  useEffect(() => {
    let cancelled = false;
    if (!sectionDoc?.body) {
      queueMicrotask(() => {
        if (!cancelled) {
          setChapterAnalysis(null);
          setPreviewSuggested(false);
        }
      });
      return () => {
        cancelled = true;
      };
    }

    const text = sectionDoc.body.textContent || '';
    const analysis = computeChapterAnalysis(text, knowledgeMap);
    queueMicrotask(() => {
      if (cancelled) return;
      setChapterAnalysis(analysis);
      if (
        shouldAutoShowPreview(
          chapterPreviewEnabled,
          bookId,
          sectionIndex,
          analysis.coveragePct,
          analysis.unknownKeyWords?.length ?? 0,
        )
      ) {
        // Activa únicamente la píldora superior no bloqueante, nunca el modal directo
        setPreviewSuggested(true);
      } else {
        setPreviewSuggested(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [bookId, sectionDoc, sectionIndex, knowledgeMap, chapterPreviewEnabled]);

  const updateLocalKnowledge = useCallback(
    (lemma: string, status: 'seen' | 'learning' | 'known') => {
      setKnowledgeMap((prev) => {
        const next = new Map(prev);
        next.set(lemma.toLowerCase(), status);
        return next;
      });
    },
    [],
  );

  const dismissPreviewPill = useCallback(() => {
    markSectionPreviewed(bookId, sectionIndex);
    setPreviewSuggested(false);
  }, [bookId, sectionIndex]);

  const openPreviewModal = useCallback(() => {
    setPreviewSuggested(false);
    setShowPreviewModal(true);
  }, []);

  const closePreviewModal = useCallback(() => {
    markSectionPreviewed(bookId, sectionIndex);
    setShowPreviewModal(false);
  }, [bookId, sectionIndex]);

  const openChapterGlossary = useCallback(async () => {
    if (!sectionDoc) return;
    setGlossaryOpen(true);
    setGlossaryLoading(true);
    try {
      const extracted = extractSectionWords(sectionDoc, { maxWords: 18 });
      setGlossaryWords(extracted);
      const meaningsAcc: Record<string, WordMeaning> = {};
      await Promise.all(
        extracted.slice(0, 8).map(async (item) => {
          try {
            const m = await lookupWord(item.word, item.sentence);
            if (m.ok && m.found) {
              meaningsAcc[item.word.toLowerCase()] = m as unknown as WordMeaning;
            }
          } catch {
            // ignorar fallos individuales
          }
        }),
      );
      setGlossaryMeanings((prev) => ({ ...prev, ...meaningsAcc }));
    } finally {
      setGlossaryLoading(false);
    }
  }, [sectionDoc]);

  return {
    knowledgeMap,
    chapterAnalysis,
    coveragePct: chapterAnalysis?.coveragePct ?? null,
    previewSuggested,
    showPreviewModal,
    glossaryOpen,
    setGlossaryOpen,
    glossaryWords,
    glossaryMeanings,
    glossaryLoading,
    updateLocalKnowledge,
    dismissPreviewPill,
    openPreviewModal,
    closePreviewModal,
    openChapterGlossary,
  };
}
