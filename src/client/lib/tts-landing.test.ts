// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  saveTtsLandingPosition,
  loadTtsLandingPosition,
  clearTtsLandingPosition,
  applyTtsLandingMarker,
  removeTtsLandingMarker,
  TTS_LANDING_CLASS,
  type TtsLandingPosition,
} from "./tts-landing";

describe("TTS Landing Position & Marker (Fase 3 Anti-Abandono)", () => {
  const bookHash = "book-landing-test";

  beforeEach(() => {
    clearTtsLandingPosition(bookHash);
  });

  afterEach(() => {
    clearTtsLandingPosition(bookHash);
  });

  it("guarda y carga la posición de aterrizaje auditivo correctamente", () => {
    const pos: TtsLandingPosition = {
      bookHash,
      sectionIndex: 2,
      sentenceIndex: 5,
      paragraphText: "En un lugar de la Mancha de cuyo nombre no quiero acordarme.",
      anchor: "En un lugar de la Mancha",
      updatedAt: Date.now(),
    };

    saveTtsLandingPosition(pos);
    const loaded = loadTtsLandingPosition(bookHash);

    expect(loaded).not.toBeNull();
    expect(loaded?.bookHash).toBe(bookHash);
    expect(loaded?.sectionIndex).toBe(2);
    expect(loaded?.sentenceIndex).toBe(5);
    expect(loaded?.anchor).toBe("En un lugar de la Mancha");
  });

  it("limpia la posición de aterrizaje auditivo", () => {
    const pos: TtsLandingPosition = {
      bookHash,
      sectionIndex: 1,
      sentenceIndex: 0,
      paragraphText: "Había una vez...",
      anchor: "Había una vez",
      updatedAt: Date.now(),
    };
    saveTtsLandingPosition(pos);
    expect(loadTtsLandingPosition(bookHash)).not.toBeNull();

    clearTtsLandingPosition(bookHash);
    expect(loadTtsLandingPosition(bookHash)).toBeNull();
  });

  it("aplica el marcador visual de aterrizaje auditivo sobre el párrafo exacto", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <p id="p1">Primer párrafo de introducción en el capítulo.</p>
      <p id="p2">En un lugar de la Mancha de cuyo nombre no quiero acordarme.</p>
      <p id="p3">Tercer párrafo de continuación.</p>
    `;
    document.body.appendChild(container);

    const pos: TtsLandingPosition = {
      bookHash,
      sectionIndex: 0,
      sentenceIndex: 1,
      paragraphText: "En un lugar de la Mancha de cuyo nombre no quiero acordarme.",
      anchor: "En un lugar de la Mancha",
      updatedAt: Date.now(),
    };

    const matched = applyTtsLandingMarker(container, pos);
    expect(matched).not.toBeNull();
    expect(matched?.id).toBe("p2");
    expect(matched?.classList.contains(TTS_LANDING_CLASS)).toBe(true);

    removeTtsLandingMarker(container);
    expect(matched?.classList.contains(TTS_LANDING_CLASS)).toBe(false);

    container.remove();
  });
});
