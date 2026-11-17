// Detección de inactividad > 6h para «¿En qué me quedé?» (Track 8, cero
// spoilers). Extraído de Reader.tsx (B7).
import { useEffect, useRef } from "react";
import { captureDbScope, listIntervals } from "../lib/idb";
import type { DbScope } from "../lib/idb";
import { checkHasInactivityGap } from "../lib/reading-activity";
import type { TimeInterval } from "../lib/reading-activity";
import { generateZeroSpoilerSceneRecap } from "../lib/page-recap";
import type { SceneReturnRecap } from "../lib/page-recap";
import type { JourneySelectorCache } from "../lib/journey";
import { charOffsetAtViewTop } from "../lib/reading-location";

type Ref<T> = { current: T };

type Deps = {
  bookHash: string;
  language: string | null | undefined;
  containerRef: Ref<HTMLElement | null>;
  sectionTextRef: Ref<string>;
  intervalsRef: Ref<TimeInterval[]>;
  setJourneySelectorCache: (v: Partial<JourneySelectorCache>) => void;
  setSceneRecap: (v: SceneReturnRecap | null) => void;
  setRecapBubbleVisible: (v: boolean) => void;
};

export function useReaderRecap(deps: Deps): void {
  const {
    bookHash,
    language,
    containerRef,
    sectionTextRef,
    intervalsRef,
    setJourneySelectorCache,
    setSceneRecap,
    setRecapBubbleVisible,
  } = deps;
  const recapCheckedRef = useRef(false);

  useEffect(() => {
    if (recapCheckedRef.current || !bookHash) return;
    recapCheckedRef.current = true;
    const scope: DbScope = captureDbScope();
    void listIntervals(scope)
      .then((intervals) => {
        intervalsRef.current = intervals;
        setJourneySelectorCache({ intervals });
        if (checkHasInactivityGap(intervals, bookHash)) {
          const offset = containerRef.current
            ? charOffsetAtViewTop(containerRef.current, sectionTextRef.current)
            : sectionTextRef.current.length;
          const textBefore = sectionTextRef.current.slice(0, offset);
          const lastInterval = intervals[intervals.length - 1];
          const lastMs = lastInterval ? lastInterval.endedAt : Date.now() - 7 * 3600 * 1000;
          const recap = generateZeroSpoilerSceneRecap(
            textBefore,
            lastMs,
            Date.now(),
            language || "es",
          );
          setSceneRecap(recap);
          setRecapBubbleVisible(true);
        }
      })
      .catch(() => undefined);
  }, [bookHash, language, containerRef, sectionTextRef, intervalsRef, setJourneySelectorCache, setSceneRecap, setRecapBubbleVisible]);
}