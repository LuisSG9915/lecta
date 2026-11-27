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
  /** Modo por páginas: las columnas van lado a lado y la vista nunca se desplaza. */
  paged?: boolean;
};

/** Espera a que useReaderSyntacticLines cree los chunks (≈12 s como máximo). */
const PACER_RETRY_MS = 300;
const PACER_MAX_RETRIES = 40;
/** En páginas, cada cuánto se mira si el lector ya pasó de página. */
const PACER_PAGE_WAIT_MS = 400;

/** El chunk está en pantalla en ambos ejes (en páginas las columnas comparten la vertical). */
function isChunkOnScreen(chunk: HTMLElement | undefined): boolean {
  if (!chunk) return false;
  const rect = chunk.getBoundingClientRect();
  if (rect.height <= 0 && rect.width <= 0) return false;
  return (
    rect.bottom > 0 &&
    rect.top < window.innerHeight &&
    rect.right > 0 &&
    rect.left < window.innerWidth
  );
}

export function findFirstVisibleChunkIndex(
  chunks: HTMLElement[],
  viewportHeight: number,
  paged = false,
): number {
  if (chunks.length === 0) return 0;
  if (paged) {
    // En páginas se arranca arriba de la página visible.
    const idx = chunks.findIndex((chunk) => isChunkOnScreen(chunk));
    return idx >= 0 ? idx : 0;
  }
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
    paged = false,
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

    let timer: number | null = null;
    let destroyed = false;
    let placed = false;
    let retries = 0;

    const stepPacer = () => {
      if (destroyed) return;
      const chunks = Array.from(
        container.querySelectorAll<HTMLElement>(".lecta-syntactic-chunk"),
      );
      // useReaderSyntacticLines crea los chunks en un rAF posterior a este
      // efecto (cambio de capítulo, marcapasos sin «Pausas por frase»): sin
      // chunks se reintenta en vez de quedar quieto.
      if (chunks.length === 0) {
        if (retries < PACER_MAX_RETRIES) {
          retries += 1;
          timer = window.setTimeout(stepPacer, PACER_RETRY_MS);
        }
        return;
      }

      if (!placed) {
        placed = true;
        const cur = pacerIndexRef.current;
        const curEl = cur >= 0 && cur < chunks.length ? chunks[cur] : undefined;
        const outOfView = Boolean(curEl && !isChunkOnScreen(curEl));
        if (cur <= 0 || cur >= chunks.length || outOfView) {
          pacerIndexRef.current = findFirstVisibleChunkIndex(chunks, window.innerHeight, paged);
        }
      }

      // Fin del capítulo: el marcapasos se queda en el último chunk. Volver
      // al 0 subía la vista al principio y el guardado perezoso pisaba la
      // posición leída.
      if (pacerIndexRef.current >= chunks.length) return;

      if (paged && !isChunkOnScreen(chunks[pacerIndexRef.current])) {
        const prev = chunks[pacerIndexRef.current - 1];
        if (isChunkOnScreen(prev)) {
          // Última frase de la página: espera a que el lector pase de página.
          timer = window.setTimeout(stepPacer, PACER_PAGE_WAIT_MS);
          return;
        }
        // El lector saltó a otra página: sigue desde arriba de la visible.
        const visible = chunks.findIndex((chunk) => isChunkOnScreen(chunk));
        if (visible < 0) {
          timer = window.setTimeout(stepPacer, PACER_PAGE_WAIT_MS);
          return;
        }
        pacerIndexRef.current = visible;
      }

      const activeChunk = chunks[pacerIndexRef.current];

      chunks.forEach((chunk, i) => {
        if (i === pacerIndexRef.current) {
          chunk.classList.add("lecta-pacer-active");
        } else {
          chunk.classList.remove("lecta-pacer-active");
        }
      });

      if (activeChunk && !paged) {
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
    paged,
    containerRef,
    pacerIndexRef,
  ]);
}