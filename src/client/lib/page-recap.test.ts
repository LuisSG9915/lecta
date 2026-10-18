// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deterministicPageRecapFallback,
  requestPageRecap,
  requestLastPagesRecap,
  generateZeroSpoilerSceneRecap,
  loadCharacterMemoryEnabled,
  saveCharacterMemoryEnabled,
  type SceneReturnRecap,
} from "./page-recap";
import * as accountFetchModule from "./account-fetch";
import ReaderRecapBubble, { formatTimeAway } from "../components/ReaderRecapBubble";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("page-recap", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("generates deterministic fallback from text sentences", () => {
    const text =
      "En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho tiempo que vivía un hidalgo. Tenía en su casa una ama que pasaba de los cuarenta y una sobrina que no llegaba a los veinte.";
    const result = deterministicPageRecapFallback(text);
    expect(result.bullets).toHaveLength(2);
    expect(result.hookQuestion).toBe("¿Cómo continúa el hilo de este pasaje?");
    expect(result.fallback).toBe(true);
  });

  it("handles short/empty text in deterministic fallback", () => {
    const result = deterministicPageRecapFallback("");
    expect(result.bullets).toHaveLength(2);
    expect(result.bullets[0]).toContain("La lectura transcurre");
  });

  it("calls /api/ai/page-recap and returns structured response", async () => {
    vi.spyOn(accountFetchModule, "accountFetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        bullets: ["Don Quijote decide partir.", "Ensilla a Rocinante."],
        hookQuestion: "¿A quién buscará como escudero?",
      }),
    } as unknown as Response);

    const res = await requestPageRecap({
      text: "Texto de la página.",
      bookTitle: "Don Quijote",
      chapterTitle: "Capítulo I",
    });

    expect(res.bullets).toEqual([
      "Don Quijote decide partir.",
      "Ensilla a Rocinante.",
    ]);
    expect(res.hookQuestion).toBe("¿A quién buscará como escudero?");
  });

  it("falls back gracefully when API returns error", async () => {
    vi.spyOn(accountFetchModule, "accountFetch").mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "AI gateway timeout" }),
    } as unknown as Response);

    const res = await requestPageRecap({
      text: "Una oración lo suficientemente larga para generar una viñeta clara. Otra oración que complementa el pasaje.",
    });

    expect(res.fallback).toBe(true);
    expect(res.bullets.length).toBeGreaterThanOrEqual(1);
    expect(res.hookQuestion).toBe("¿Cómo continúa el hilo de este pasaje?");
  });

  it("requestLastPagesRecap strictly limits analysis to the last 3 pages", async () => {
    let capturedBody = "";
    vi.spyOn(accountFetchModule, "accountFetch").mockImplementationOnce(async (_url, init) => {
      capturedBody = String(init?.body ?? "");
      return {
        ok: true,
        json: async () => ({
          bullets: ["Punto 1", "Punto 2", "Punto 3"],
          hookQuestion: "¿Qué pasará ahora?",
        }),
      } as unknown as Response;
    });

    const pages = [
      "Página 1: muy antigua que no debe incluirse.",
      "Página 2: también antigua que debe quedar excluida.",
      "Página 3: la antepenúltima página leída.",
      "Página 4: la penúltima página leída.",
      "Página 5: la última página leída.",
    ];

    const res = await requestLastPagesRecap({
      lastPagesText: pages,
      bookTitle: "Libro Mágico",
    });

    expect(capturedBody).toContain("Página 3");
    expect(capturedBody).toContain("Página 4");
    expect(capturedBody).toContain("Página 5");
    expect(capturedBody).not.toContain("Página 1");
    expect(capturedBody).not.toContain("Página 2");
    expect(res.bullets).toHaveLength(3);
  });

  describe("generateZeroSpoilerSceneRecap & Preferences (Fase 3)", () => {
    it("gestiona la preferencia de memoria de personajes activa por defecto", () => {
      expect(loadCharacterMemoryEnabled()).toBe(true);
      saveCharacterMemoryEnabled(false);
      expect(loadCharacterMemoryEnabled()).toBe(false);
      saveCharacterMemoryEnabled(true);
      expect(loadCharacterMemoryEnabled()).toBe(true);
    });

    it("analiza los últimos ~650 caracteres para extraer la última frase clave y personajes activos", () => {
      const longText =
        "Hace mucho tiempo en un reino lejano existían castillos y colinas desiertas. ".repeat(10) +
        "Edmond Dantès miró fijamente el horizonte de Marsella mientras Mercédès sostenía su mano con dulzura. Los guardias del rey avanzaban silenciosamente por el muelle empedrado.";

      const now = Date.now();
      const lastRead = now - 48 * 3_600_000; // hace 48 horas (2 días)

      const recap = generateZeroSpoilerSceneRecap(longText, lastRead, now);

      expect(recap.hoursSinceLastRead).toBe(48);
      expect(recap.shouldShowAutomatically).toBe(true);
      expect(recap.lastReadSnippet).toContain("Los guardias del rey avanzaban silenciosamente");
      expect(recap.activeCharactersInScene).toContain("Mercédès");
    });

    it("desactiva shouldShowAutomatically si han pasado menos de 12 horas", () => {
      const text = "Aureliano Buendía sonrió ante la sorpresa de Melquíades.";
      const now = Date.now();
      const lastRead = now - 2 * 3_600_000; // hace 2 horas

      const recap = generateZeroSpoilerSceneRecap(text, lastRead, now);
      expect(recap.hoursSinceLastRead).toBe(2);
      expect(recap.shouldShowAutomatically).toBe(false);
    });

    it("no activa automáticamente si el usuario desactivó characterMemoryEnabled", () => {
      saveCharacterMemoryEnabled(false);
      const text = "Sherlock Holmes caminaba por Baker Street con Watson.";
      const now = Date.now();
      const lastRead = now - 24 * 3_600_000; // hace 24 horas

      const recap = generateZeroSpoilerSceneRecap(text, lastRead, now);
      expect(recap.hoursSinceLastRead).toBe(24);
      expect(recap.shouldShowAutomatically).toBe(false);
    });
  });

  describe("ReaderRecapBubble (Fase 3 UI)", () => {
    let host: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
      host = document.createElement("div");
      document.body.appendChild(host);
      root = createRoot(host);
    });

    afterEach(() => {
      act(() => root.unmount());
      host.remove();
    });

    const render = (node: any) => act(() => root.render(node));
    const click = (el: Element) =>
      act(() => {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });

    it("formatea correctamente las horas de ausencia (formatTimeAway)", () => {
      expect(formatTimeAway(0.5)).toBe("hace unos minutos");
      expect(formatTimeAway(1)).toBe("hace 1 hora");
      expect(formatTimeAway(5)).toBe("hace 5 horas");
      expect(formatTimeAway(24)).toBe("hace 1 día");
      expect(formatTimeAway(48)).toBe("hace 2 días");
      expect(formatTimeAway(72)).toBe("hace 3 días");
    });

    it("renderiza la síntesis de escena con cita clave y personajes activos al volver", async () => {
      const onSelectCharacter = vi.fn();
      const onDismiss = vi.fn();

      const sceneRecap: SceneReturnRecap = {
        lastReadSnippet: "Los guardias del rey avanzaban por el muelle.",
        activeCharactersInScene: ["Dantès", "Mercédès"],
        hoursSinceLastRead: 48,
        shouldShowAutomatically: true,
      };

      render(
        h(ReaderRecapBubble, {
          sceneRecap,
          onDismiss,
          onSelectCharacter,
        }),
      );

      expect(host.textContent).toContain("Dónde te quedaste (hace 2 días):");
      expect(host.querySelector(".recap-last-snippet")?.textContent).toContain(
        "Los guardias del rey avanzaban por el muelle.",
      );
      expect(host.textContent).toContain("Personajes en esta escena:");

      const pills = host.querySelectorAll<HTMLButtonElement>(".recap-character-pill");
      expect(pills.length).toBe(2);
      expect(pills[0].textContent).toBe("Dantès");
      expect(pills[1].textContent).toBe("Mercédès");

      // Al pulsar en un personaje, abre su ficha
      await act(async () => {
        click(pills[0]);
      });
      expect(onSelectCharacter).toHaveBeenCalledWith("Dantès");
    });

    it("permite desactivar el recordatorio de personajes en 1 toque", async () => {
      const onDismiss = vi.fn();
      const onDisableCharacterMemory = vi.fn();

      saveCharacterMemoryEnabled(true);
      expect(loadCharacterMemoryEnabled()).toBe(true);

      const sceneRecap: SceneReturnRecap = {
        lastReadSnippet: "Una frase leída.",
        activeCharactersInScene: ["Frodo"],
        hoursSinceLastRead: 24,
        shouldShowAutomatically: true,
      };

      render(
        h(ReaderRecapBubble, {
          sceneRecap,
          onDismiss,
          onDisableCharacterMemory,
        }),
      );

      const disableBtn = host.querySelector<HTMLButtonElement>(".btn--disable-character-memory");
      expect(disableBtn).not.toBeNull();
      expect(disableBtn?.textContent).toContain("✕ Desactivar recordatorio de personajes");

      await act(async () => {
        click(disableBtn!);
      });

      expect(loadCharacterMemoryEnabled()).toBe(false);
      expect(onDisableCharacterMemory).toHaveBeenCalled();
      expect(onDismiss).toHaveBeenCalled();
    });

    it("preserva retrocompatibilidad con recapBullets anteriores", () => {
      render(
        h(ReaderRecapBubble, {
          recapBullets: ["Punto A", "Punto B"],
          onDismiss: vi.fn(),
        }),
      );

      expect(host.textContent).toContain("¿Te recuerdo en 15s qué pasaba?");
      const listItems = host.querySelectorAll(".recap-bullets-list li");
      expect(listItems.length).toBe(2);
      expect(listItems[0].textContent).toBe("Punto A");
      expect(listItems[1].textContent).toBe("Punto B");
    });
  });

  describe("Verificación Estricta Cero Spoilers en Recapitulación (Fase 4)", () => {
    it("garantiza que cualquier texto o personaje posterior al cursor del lector jamás se incluye en el resumen de escena", () => {
      const textBeforeCursor =
        "Ned Land observaba las profundidades del mar desde el Nautilus. El capitán Nemo permanecía en silencio en el puente de mando contemplando el abismo.";

      const textAfterCursor =
        "\n\nSPOILER FATAL: Un monstruo calamar gigante devora a Ned Land y el Nautilus se hunde trágicamente en el Maelstrom.";

      // El reader solo pasa estrictamente el texto antes del cursor
      const now = Date.now();
      const lastRead = now - 24 * 3_600_000;

      const recap = generateZeroSpoilerSceneRecap(textBeforeCursor, lastRead, now);

      // Verificación 1: Contiene la última frase antes del cursor
      expect(recap.lastReadSnippet).toContain("El capitán Nemo permanecía en silencio");

      // Verificación 2: Contiene los personajes de la escena antes del cursor
      expect(recap.activeCharactersInScene).toContain("Nemo");

      // Verificación 3: El texto posterior al cursor NUNCA se filtra
      expect(textAfterCursor).toContain("calamar");
      expect(recap.lastReadSnippet).not.toContain("calamar");
      expect(recap.lastReadSnippet).not.toContain("Maelstrom");
      expect(recap.activeCharactersInScene).not.toContain("Maelstrom");

      const serialized = JSON.stringify(recap);
      expect(serialized).not.toContain("SPOILER");
      expect(serialized).not.toContain("calamar");
      expect(serialized).not.toContain("hunde");
    });

    it("ignora texto muy lejano anterior (>650 caracteres) y se ciñe estrictamente a la escena inmediata", () => {
      const farPastText =
        "Capítulo antiguo sobre paisajes y praderas de hace 50 páginas. ".repeat(15);
      const immediateScene =
        "Don Quijote y Sancho Panza divisaron los molinos de viento en la llanura. Don Quijote arremetió con su lanza contra el primer aspa.";

      const now = Date.now();
      const lastRead = now - 15 * 3_600_000;

      const recap = generateZeroSpoilerSceneRecap(farPastText + immediateScene, lastRead, now);

      expect(recap.lastReadSnippet).toContain("Don Quijote arremetió con su lanza");
      expect(recap.activeCharactersInScene).toContain("Quijote");
      expect(recap.lastReadSnippet).not.toContain("Capítulo antiguo");
    });
  });
});
