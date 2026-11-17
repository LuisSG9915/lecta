// Registra el evento target_entered al entrar a un capítulo. Extraído de
// Reader.tsx (B7).
import { useEffect } from "react";
import { targetAt } from "../lib/chapters";
import type { ChapterTarget, ChapterCatalog } from "../lib/chapters";
import type { VisitEventDraft } from "../lib/reading-events";

type Ref<T> = { current: T };

type Deps = {
  state: string;
  sectionIndex: number;
  catalog: ChapterCatalog | null;
  currentChapterTarget: ChapterTarget | null;
  lastTargetEnteredRef: Ref<string | null>;
  trackEvent: (draft: VisitEventDraft) => void;
};

export function useReaderTargetEntered(deps: Deps): void {
  const { state, sectionIndex, catalog, currentChapterTarget, lastTargetEnteredRef, trackEvent } = deps;

  useEffect(() => {
    if (state !== "ready") return;
    const target = currentChapterTarget ?? targetAt(catalog?.ranges ?? [], sectionIndex);
    if (!target || lastTargetEnteredRef.current === target.id) return;
    lastTargetEnteredRef.current = target.id;
    trackEvent({
      kind: "target_entered",
      targetId: target.id,
      sectionIndex,
    });
  }, [state, sectionIndex, catalog, currentChapterTarget, trackEvent, lastTargetEnteredRef]);
}