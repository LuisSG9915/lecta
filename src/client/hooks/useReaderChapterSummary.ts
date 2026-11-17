// Resumen de capítulo al llegar al final del tramo. Extraído de Reader.tsx (B7).
import { useEffect, useRef } from "react";
import { captureDbScope, listReadingEvents } from "../lib/idb";
import { chapterSummary, hasChapterSummary } from "../lib/reading-events";
import type { ChapterSummary } from "../lib/reading-events";
import type { ChapterTarget } from "../lib/chapters";

type Ref<T> = { current: T };

type EndRange = { startSection: number; endSection: number } | null;

type Deps = {
  atChapterEnd: boolean;
  endTarget: ChapterTarget | null;
  endRange: EndRange;
  bookHash: string;
  visitIdRef: Ref<string | null>;
  setEndSummary: (v: { targetId: string; summary: ChapterSummary } | null) => void;
};

export function useReaderChapterSummary(deps: Deps): void {
  const { atChapterEnd, endTarget, endRange, bookHash, visitIdRef, setEndSummary } = deps;
  const summaryForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!atChapterEnd || !endTarget || !endRange) return;
    if (summaryForRef.current === endTarget.id) return;
    const range = endRange;
    const visitId = visitIdRef.current ?? "";
    void listReadingEvents(bookHash, captureDbScope())
      .then((events) => {
        const summary = chapterSummary(events, range, visitId);
        if (hasChapterSummary(summary)) {
          summaryForRef.current = endTarget.id;
          setEndSummary({ targetId: endTarget.id, summary });
        } else {
          setEndSummary(null);
        }
      })
      .catch(() => undefined);
  }, [atChapterEnd, endTarget, endRange, bookHash, visitIdRef, setEndSummary]);
}