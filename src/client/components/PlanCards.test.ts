// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StudyPlanCard from "./StudyPlanCard";
import CoachCard from "./CoachCard";
import FluencyForecastCard from "./FluencyForecastCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let reply: { status: number; body: unknown } = { status: 200, body: {} };
vi.mock("../lib/account-fetch", () => ({
  accountFetch: vi.fn(async () => ({
    status: reply.status,
    ok: reply.status >= 200 && reply.status < 300,
    json: async () => reply.body,
  })),
}));

describe("tarjetas de Lecta+ del recorrido", () => {
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
  const mount = async (el: ReturnType<typeof h>) => {
    await act(async () => {
      root.render(el);
    });
  };

  it("402 no pinta notas sueltas (Journey da una sola)", async () => {
    reply = { status: 402, body: {} };
    await mount(h("div", null, h(CoachCard), h(StudyPlanCard, { books: [] }), h(FluencyForecastCard, { lang: "en" })));
    expect(host.querySelector(".plan-note")).toBeNull();
  });

  it("CoachCard lleva aria-label", async () => {
    reply = { status: 200, body: { text: "Buena semana." } };
    await mount(h(CoachCard));
    expect(host.querySelector("[data-testid=coach-card]")?.getAttribute("aria-label")).toBe("Tu coach");
  });

  it("plan: «Hoy» una vez, días capitalizados, limpia nombre del libro y sin días en 0", async () => {
    const days = Array.from({ length: 7 }, (_, i) => ({ offset: i, reviews: i === 0 ? 4 : i === 1 ? 2 : i === 3 ? 1 : 0 }));
    reply = {
      status: 200,
      body: {
        empty: false,
        days,
        backlog: 0,
        readingMinutes: 15,
        minutesToday: 18,
        habit: "default",
        habitSamples: [],
        next: { bookHash: "h1", sectionIndex: 2 },
      },
    };
    await mount(h(StudyPlanCard, { books: [{ hash: "h1", name: "a3f9c2d1e4b8901234567890abcdef12.epub" }] }));
    const text = host.textContent ?? "";
    expect(text.match(/Hoy/g)?.length).toBe(1);
    expect(text).toContain("4 repasos");
    expect(text).toContain("Mañana 2");
    expect(text).toContain("Próximo capítulo: 3");
    expect(text).not.toContain("a3f9c2d1");
    expect(text).not.toContain("0 repasos");
    expect(text).not.toContain("hora tranquila");
    expect(host.querySelectorAll("li").length).toBe(0);
  });

  it("predicción: sin jerga de cobertura y con ritmo sugerido si está lejos", async () => {
    reply = {
      status: 200,
      body: {
        forecast: {
          status: "far", consolidated: 100, currentCoverage: 0.4, targetCoverage: 0.95, targetWords: 5304,
          weeklyRate: 2, at: null, earliestAt: null, latestAt: null, note: "Con tu ritmo actual",
        },
      },
    };
    await mount(h(FluencyForecastCard, { lang: "en" }));
    const text = host.textContent ?? "";
    expect(text).not.toContain("cobertura");
    expect(text).not.toContain("más de 5 años");
    expect(text).toContain("51 palabras consolidadas por semana");
  });
});
