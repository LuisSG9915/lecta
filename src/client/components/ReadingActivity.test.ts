// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReadingActivity from "./ReadingActivity";
import {
  listIntervals,
  listReadingEvents,
  loadSessionValue,
  saveSessionValue,
} from "../lib/idb";
import { serializeReadingGoal } from "../lib/reading-goal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock("../lib/idb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../lib/idb")>();
  return {
    ...mod,
    listIntervals: vi.fn(async () => []),
    listReadingEvents: vi.fn(async () => []),
    loadSessionValue: vi.fn(async () => null),
    saveSessionValue: vi.fn(async () => undefined),
  };
});

const intervalsMock = vi.mocked(listIntervals);
const eventsMock = vi.mocked(listReadingEvents);
const loadMock = vi.mocked(loadSessionValue);
const saveMock = vi.mocked(saveSessionValue);

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

// Intervalo de 90 s una hora después de la medianoche local: siempre
// cae dentro de hoy sin importar a qué hora corre la prueba.
const todaysReading = () => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return [
    { id: "i1", bookHash: "b1", startedAt: start.getTime() + 3_600_000, endedAt: start.getTime() + 3_690_000 },
  ];
};

const render = (activityVersion = 0) =>
  act(async () => {
    root.render(h(ReadingActivity, { books: [], words: [], activityVersion }));
  });

describe("ReadingActivity · meta de la semana", () => {
  it("sin meta configurada no muestra la sección", async () => {
    await render();
    expect(host.querySelector('[aria-label="Meta de la semana"]')).toBeNull();
  });

  it("con meta muestra progreso derivado de los intervalos", async () => {
    intervalsMock.mockResolvedValue(todaysReading());
    loadMock.mockImplementation(async (key) =>
      key === "readingGoal:v1" ? serializeReadingGoal(3) : null,
    );
    await render();
    expect(host.textContent).toContain("1 de 3 días con lectura");
    expect(host.querySelectorAll(".dot--done")).toHaveLength(1);
  });

  it("meta desactivada (daysPerWeek null) tampoco muestra la sección", async () => {
    loadMock.mockImplementation(async (key) =>
      key === "readingGoal:v1" ? serializeReadingGoal(null) : null,
    );
    await render();
    expect(host.querySelector('[aria-label="Meta de la semana"]')).toBeNull();
  });

  it("un cambio en activityVersion relee intervalos y meta", async () => {
    await render(0);
    expect(intervalsMock).toHaveBeenCalledTimes(1);
    intervalsMock.mockResolvedValue(todaysReading());
    loadMock.mockImplementation(async (key) =>
      key === "readingGoal:v1" ? serializeReadingGoal(1) : null,
    );
    await act(async () => {
      root.render(h(ReadingActivity, { books: [], words: [], activityVersion: 1 }));
    });
    expect(intervalsMock).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("1 de 1 días con lectura");
    expect(host.textContent).toContain("cumplida");
  });

  it("muestra el Escudo de Ronroneo y mensaje de protección si ayer no hubo lectura", async () => {
    // Sin intervalos leídos (ayer no hubo lectura)
    intervalsMock.mockResolvedValue([]);
    // Meta con 1 escudo disponible
    loadMock.mockImplementation(async (key) =>
      key === "readingGoal:v1" ? serializeReadingGoal(3, 1000, 1) : null,
    );
    await render();

    expect(host.textContent).toContain("Escudo de Ronroneo");
    // Al no haber leído ayer, el escudo protegió la racha automáticamente
    expect(host.textContent).toContain("¡Cuidé tu racha ayer mientras descansabas!");
    expect(saveMock).toHaveBeenCalled();
  });

  it("renderiza el Mapa de tinta mensual con celdas de actividad", async () => {
    intervalsMock.mockResolvedValue(todaysReading());
    await render();

    const monthMap = host.querySelector('[aria-label="Mapa de tinta mensual"]');
    expect(monthMap).toBeTruthy();
    expect(monthMap?.querySelectorAll(".act-month-cell").length).toBeGreaterThanOrEqual(28);
  });
});

describe("ReadingActivity · Estado de Flujo y Ritmo", () => {
  it("muestra el estado inicial empático cuando hay poca o ninguna lectura", async () => {
    intervalsMock.mockResolvedValue([]);
    eventsMock.mockResolvedValue([]);
    await render();

    const flowSection = host.querySelector('[aria-label="Estado de flujo y ritmo"]');
    expect(flowSection).toBeTruthy();
    expect(host.textContent).toContain("Estado de flujo y ritmo");
    expect(host.textContent).toContain("Capítulos en flujo");
    expect(host.textContent).toContain("Páginas sin interrupción");
    expect(host.textContent).toContain(
      "Lee tus primeras páginas con calma; aquí verás cuántas páginas fluyen sin interrupciones.",
    );
  });

  it("muestra métricas de flujo, páginas seguidas y ritmo cómodo cuando hay datos suficientes", async () => {
    intervalsMock.mockResolvedValue([
      { id: "i1", bookHash: "b1", startedAt: 1000, endedAt: 1000 + 10 * 60_000 },
    ]);
    eventsMock.mockResolvedValue([
      {
        id: "e1",
        bookHash: "b1",
        visitId: "v1",
        createdAt: 1000,
        kind: "section_dwell",
        sectionIndex: 0,
        ms: 30_000,
        words: 100,
      },
      {
        id: "e2",
        bookHash: "b1",
        visitId: "v2",
        createdAt: 35_000,
        kind: "section_dwell",
        sectionIndex: 1,
        ms: 30_000,
        words: 110,
      },
      {
        id: "e3",
        bookHash: "b1",
        visitId: "v3",
        createdAt: 70_000,
        kind: "section_dwell",
        sectionIndex: 2,
        ms: 30_000,
        words: 95,
      },
    ]);
    await render();

    const flowSection = host.querySelector('[aria-label="Estado de flujo y ritmo"]');
    expect(flowSection).toBeTruthy();
    expect(host.textContent).toContain("Capítulos en flujo");
    expect(host.textContent).toContain("Capítulos leídos de corrido");
    expect(host.textContent).toContain("Páginas sin interrupción");
    expect(host.textContent).toContain("Páginas seguidas en inmersión");
    expect(host.textContent).toContain("Ritmo cómodo");
    expect(host.textContent).toMatch(/~\d+\s+palabras\/min/);
    expect(host.textContent).toContain(
      "Lecta adapta las ayudas previas a este ritmo para que nunca pierdas el hilo.",
    );
  });
});
