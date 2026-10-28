import { normalizeBlockText } from "./reading-location";

export interface TtsLandingPosition {
  bookHash: string;
  sectionIndex: number;
  sentenceIndex: number;
  paragraphText: string;
  anchor: string;
  updatedAt: number;
}

const LANDING_STORAGE_PREFIX = "lecta:tts_landing:";
const memoryLanding = new Map<string, TtsLandingPosition>();

const BLOCK_SELECTOR = "p, h1, h2, h3, h4, h5, h6, li, blockquote, figure, pre, td";
export const TTS_LANDING_CLASS = "tts-landing-anchor";

export function saveTtsLandingPosition(pos: TtsLandingPosition): void {
  if (!pos.bookHash) return;
  memoryLanding.set(pos.bookHash, pos);
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(`${LANDING_STORAGE_PREFIX}${pos.bookHash}`, JSON.stringify(pos));
    }
  } catch {
    // Ignore storage errors in private browsing / sandboxes
  }
}

export function loadTtsLandingPosition(bookHash: string): TtsLandingPosition | null {
  if (!bookHash) return null;
  const inMem = memoryLanding.get(bookHash);
  if (inMem) return inMem;
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(`${LANDING_STORAGE_PREFIX}${bookHash}`);
      if (raw) {
        const parsed = JSON.parse(raw) as TtsLandingPosition;
        memoryLanding.set(bookHash, parsed);
        return parsed;
      }
    }
  } catch {
    // Ignore storage parse errors
  }
  return null;
}

export function clearTtsLandingPosition(bookHash: string): void {
  if (!bookHash) return;
  memoryLanding.delete(bookHash);
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(`${LANDING_STORAGE_PREFIX}${bookHash}`);
    }
  } catch {
    // Ignore storage errors
  }
}

export function removeTtsLandingMarker(container: HTMLElement): void {
  container.querySelectorAll(`.${TTS_LANDING_CLASS}`).forEach((el) => {
    el.classList.remove(TTS_LANDING_CLASS);
  });
}

export function applyTtsLandingMarker(
  container: HTMLElement,
  landingPos: TtsLandingPosition,
): HTMLElement | null {
  removeTtsLandingMarker(container);

  const targetPrefix = normalizeBlockText(landingPos.anchor || landingPos.paragraphText).slice(0, 40);
  if (!targetPrefix) return null;

  let matchedElement: HTMLElement | null = null;
  const blocks = container.querySelectorAll<HTMLElement>(BLOCK_SELECTOR);

  for (const block of blocks) {
    const text = normalizeBlockText(block.textContent ?? "");
    if (text && (text.startsWith(targetPrefix) || targetPrefix.startsWith(text.slice(0, 40)))) {
      matchedElement = block;
      break;
    }
  }

  if (matchedElement) {
    matchedElement.classList.add(TTS_LANDING_CLASS);
    const dismiss = () => {
      matchedElement?.classList.remove(TTS_LANDING_CLASS);
      if (typeof window !== "undefined") {
        window.removeEventListener("pointerdown", dismiss);
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener("pointerdown", dismiss, { once: true, passive: true });
    }
    try {
      matchedElement.scrollIntoView({ block: "center", behavior: "smooth" });
    } catch {
      // Ignore
    }
  }

  return matchedElement;
}
