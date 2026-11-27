// Marcapasos Visual («Ritmo Guiado» para TDAH): resalta chunk por chunk
// del texto con un temporizador basado en WPM. Extraído de Reader.tsx (B7).
import { useEffect } from "react";

type ContainerRef = { current: HTMLElement | null };
type IndexRef = { current: number };

type Deps = {
  containerRef: ContainerRef;
  pacerIndexRef: IndexRef;
  visualPacer: boolean | undefined;
  pacerWpm: number | undefined;
  strategyPaused: boolean;
  pacerPaused: boolean;
  state: string;
  readingPaused: boolean;
};

export function findFirstVisibleChunkIndex(
  chunks: HTMLElement[],
  viewportHeight: number,
): number {
  if (chunks.length === 0) return 0;
  const targetY = viewportHeight * 0.3;
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < chunks.length; i += 1) {
    const rect = chunks[i].getBoundingClientRect();
    if (rect.height <= 0 && rect.width <= 0) continue;
    if (rect.bottom > 48 && rect.top < viewportHeight) {
      const dist = Math.abs(rect.top - targetY);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
  }
  return bestIdx >= 0 ? bestIdx : 0;
}

export function useVisualPacer(deps: Deps): void {
  const {
    containerRef,
    pacerIndexRef,
    visualPacer,
    pacerWpm,
    strategyPaused,
    pacerPaused,
    state,
    readingPaused,
  } = deps;

  useEffect(() => {
    const container = containerRef.current;
    if (
      !visualPacer ||
      strategyPaused ||
      pacerPaused ||
      state !== "ready" ||
      readingPaused
    ) {
      if (container) {
        container.querySelectorAll(".lecta-pacer-active").forEach((el) => {
          el.classList.remove("lecta-pacer-active");
        });
      }
      return;
    }

    if (!container) return;

    const initialChunks = Array.from(
      container.querySelectorAll<HTMLElement>(".lecta-syntactic-chunk"),
    );
    if (initialChunks.length > 0) {
      const cur = pacerIndexRef.current;
      const curEl = cur >= 0 && cur < initialChunks.length ? initialChunks[cur] : null;
      const curRect = curEl?.getBoundingClientRect();
      const outOfView = Boolean(
        curRect &&
          curRect.height > 0 &&
          (curRect.bottom < 0 || curRect.top > window.innerHeight),
      );
      if (cur <= 0 || cur >= initialChunks.length || outOfView) {
        pacerIndexRef.current = findFirstVisibleChunkIndex(initialChunks, window.innerHeight);
      }
    }

    let timer: number | null = null;
    let destroyed = false;

    const stepPacer = () => {
      if (destroyed) return;
      const chunks = Array.from(
        container.querySelectorAll<HTMLElement>(".lecta-syntactic-chunk"),
      );
      if (chunks.length === 0) return;

      if (pacerIndexRef.current >= chunks.length) {
        pacerIndexRef.current = 0;
      }
      const activeChunk = chunks[pacerIndexRef.current];

      chunks.forEach((chunk, i) => {
        if (i === pacerIndexRef.current) {
          chunk.classList.add("lecta-pacer-active");
        } else {
          chunk.classList.remove("lecta-pacer-active");
        }
      });

      if (activeChunk) {
        const rect = activeChunk.getBoundingClientRect();
        if (rect.bottom > window.innerHeight - 80 || rect.top < 60) {
          activeChunk.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }

      const text = activeChunk?.textContent || "";
      const words = Math.max(1, text.trim().split(/\s+/).filter(Boolean).length);
      const wpm = pacerWpm || 210;
      const durationMs = Math.max(200, Math.min(5000, Math.round((words / wpm) * 60_000)));

      pacerIndexRef.current += 1;
      timer = window.setTimeout(stepPacer, durationMs);
    };

    stepPacer();

    return () => {
      destroyed = true;
      if (timer) window.clearTimeout(timer);
      if (container) {
        container.querySelectorAll(".lecta-pacer-active").forEach((el) => {
          el.classList.remove("lecta-pacer-active");
        });
      }
    };
  }, [
    visualPacer,
    pacerWpm,
    strategyPaused,
    pacerPaused,
    state,
    readingPaused,
    containerRef,
    pacerIndexRef,
  ]);
}