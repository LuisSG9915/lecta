// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminInsights from "./AdminInsights";
import { downloadText } from "../lib/export";
import type {
  AdminOverview,
  AdminUserDetail,
} from "../../shared/admin-insights";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock("../lib/export", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/export")>();
  return { ...actual, downloadText: vi.fn() };
});

const overview: AdminOverview = {
  generatedAt: 1_700_000_000_000,
  days: 30,
  timeZone: "UTC",
  kpis: {
    totalAccounts: 12,
    newAccounts: 3,
    activeToday: 2,
    active7d: 5,
    active30d: 8,
    stickiness: 0.25,
    readingMinutes: 340,
    kindleMinutesEst: 45,
    readingMinutesPerActive: 42.5,
    booksFinished: 4,
    wordsSaved: 20,
    reviews: 55,
    recallPct: 80,
    annotations: 6,
  },
  kpisPrev: {
    totalAccounts: 12,
    newAccounts: 1,
    activeToday: 1,
    active7d: 4,
    active30d: 7,
    stickiness: 0.14,
    readingMinutes: 200,
    kindleMinutesEst: 30,
    readingMinutesPerActive: 28.6,
    booksFinished: 2,
    wordsSaved: 10,
    reviews: 40,
    recallPct: 70,
    annotations: 4,
  },
  series: [
    {
      day: "2026-11-01",
      activeUsers: 2,
      readingMinutes: 30,
      kindlePages: 4,
      kindleMinutesEst: 5,
      reviews: 3,
      wordsSaved: 2,
      consults: 1,
      signups: 0,
    },
    {
      day: "2026-11-02",
      activeUsers: 4,
      readingMinutes: 60,
      kindlePages: 8,
      kindleMinutesEst: 10,
      reviews: 6,
      wordsSaved: 4,
      consults: 2,
      signups: 1,
    },
  ],
  funnel: [
    { id: "signup", users: 12 },
    { id: "read", users: 10 },
    { id: "saved", users: 8 },
    { id: "reviewed", users: 6 },
    { id: "returned", users: 5 },
    { id: "finished", users: 4 },
  ],
  cohorts: [
    {
      week: "2026-10-19",
      size: 4,
      retainedPct: [100, 50, null, null, null, null, null, null],
      retainedUsers: [4, 2, 0, 0, 0, 0, 0, 0],
    },
  ],
  hourHeatmap: [
    { dow: 1, hour: 9, minutes: 15 },
    { dow: 6, hour: 22, minutes: 40 },
  ],
  topBooks: [
    {
      bookHash: "abc123456789",
      title: "El libro",
      author: "La Autora",
      language: "es",
      readers: 3,
      minutes: 120,
      avgProgress: 0.62,
      finished: 1,
      lastOpenAt: 1_700_000_000_000,
    },
  ],
  pausedBooks: [],
  learning: {
    stages: { new: 5, learning: 8, settled: 6, mastered: 1 },
    ratings: { good: 40, again: 15 },
    reviewKinds: { meaning: 30, write: 25 },
    knowledgeByLang: [
      { language: "en", known: 120, sources: { calibration: 80, saved: 40 } },
    ],
  },
  devices: [
    { device: "phone", sessions: 4, users: 3 },
    { device: "kindle", sessions: 2, users: 2 },
  ],
  aiByScope: [{ scope: "summary", units: 30, users: 4 }],
  users: [
    {
      id: "u1",
      email: "ana@test.mx",
      name: "Ana",
      createdAt: 1_690_000_000_000,
      lastActiveAt: 1_700_000_000_000,
      minutesPeriod: 100,
      minutesTotal: 400,
      booksStarted: 3,
      booksFinished: 1,
      wordsSaved: 10,
      reviews: 20,
      recallPct: 75,
      usesKindle: true,
      annotations: 2,
    },
    {
      id: "u2",
      email: "luis@test.mx",
      name: "Luis",
      createdAt: 1_690_500_000_000,
      lastActiveAt: null,
      minutesPeriod: 0,
      minutesTotal: 10,
      booksStarted: 1,
      booksFinished: 0,
      wordsSaved: 0,
      reviews: 0,
      recallPct: null,
      usesKindle: false,
      annotations: 0,
    },
  ],
  truncatedUsers: false,
  testAccountsExcluded: true,
};

const detail: AdminUserDetail = {
  user: {
    id: "u1",
    email: "ana@test.mx",
    name: "Ana",
    createdAt: 1_690_000_000_000,
  },
  lastActiveAt: 1_700_000_000_000,
  days: 30,
  series: [
    {
      day: "2026-11-01",
      minutes: 20,
      kindlePages: 0,
      reviews: 2,
      wordsSaved: 1,
      consults: 0,
    },
  ],
  books: [
    {
      bookHash: "abc123456789",
      title: "El libro",
      author: null,
      language: null,
      progress: 0.4,
      minutes: 50,
      lastOpenAt: 1_700_000_000_000,
      finished: false,
    },
  ],
  stages: { new: 2, learning: 5, settled: 3, mastered: 0 },
  recallByWeek: [{ week: "2026-10-19", reviews: 12, recallPct: 83 }],
  languages: [{ language: "en", lemmasKnown: 80, wordsSaved: 10 }],
  devices: [{ device: "phone", sessions: 2, users: 1 }],
  consultsTotal: 14,
  aiByScope: [],
};

const overviewResponse = () =>
  new Response(JSON.stringify(overview), { status: 200 });
const detailResponse = () =>
  new Response(JSON.stringify(detail), { status: 200 });

const flush = async (ms = 20) => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
};

describe("AdminInsights", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/admin/users/")) return detailResponse();
        if (url.startsWith("/api/admin/insights")) return overviewResponse();
        return new Response(null, { status: 404 });
      }),
    );
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    act(() => root.unmount());
    host.remove();
    document.body.innerHTML = "";
  });

  it("muestra el resumen con cifras, gráficas y cuentas", async () => {
    const onClose = vi.fn();
    await act(async () => {
      root.render(h(AdminInsights, { onClose }));
    });
    await flush();

    const text = host.textContent ?? "";
    expect(text).toContain("Panel de análisis");
    expect(text).toContain("Minutos leídos");
    expect(text).toContain("5 h 40 min");
    expect(text).toContain("Embudo de activación");
    expect(text).toContain("Retención por semana de alta");
    expect(text).toContain("Cuándo se lee");
    expect(text).toContain("El libro");
    expect(text).toContain("ana@test.mx");
    expect(text).toContain("luis@test.mx");
    // Accesibilidad: las gráficas tienen tabla equivalente.
    expect(
      Array.from(host.querySelectorAll("summary")).some((s) =>
        s.textContent?.includes("Ver como tabla"),
      ),
    ).toBe(true);
    // El estimado del Kindle va etiquetado.
    expect(text).toContain("Minutos Kindle (est.)");
  });

  it("pide el periodo elegido y omite cuentas de prueba por omisión", async () => {
    const fetchMock = vi.mocked(fetch);
    await act(async () => {
      root.render(h(AdminInsights, { onClose: vi.fn() }));
    });
    await flush();

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("/api/admin/insights");
    expect(url).toContain("days=30");
    expect(url).not.toContain("includeTest");

    // Cambiar a 7 días recarga con days=7.
    const select = host.querySelector("select");
    expect(select).toBeTruthy();
    await act(async () => {
      select!.value = "7";
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    const last = String(fetchMock.mock.calls.at(-1)?.[0]);
    expect(last).toContain("days=7");
  });

  it("cierra en silencio cuando la ruta responde 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    const onClose = vi.fn();
    await act(async () => {
      root.render(h(AdminInsights, { onClose }));
    });
    await flush();
    expect(onClose).toHaveBeenCalled();
    expect(host.textContent).not.toContain("ana@test.mx");
  });

  it("muestra el estado de error y permite reintentar", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 500 }))
        .mockImplementation(async () => overviewResponse()),
    );
    await act(async () => {
      root.render(h(AdminInsights, { onClose: vi.fn() }));
    });
    await flush();
    expect(host.textContent).toContain("No se pudo cargar el panel.");

    const retry = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Reintentar"),
    );
    await act(async () => retry!.click());
    await flush();
    expect(host.textContent).toContain("ana@test.mx");
  });

  it("filtra las cuentas por correo o nombre", async () => {
    await act(async () => {
      root.render(h(AdminInsights, { onClose: vi.fn() }));
    });
    await flush();

    const search = host.querySelector(
      "input[type='search']",
    ) as HTMLInputElement;
    expect(search).toBeTruthy();
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(search, "ana");
      search.dispatchEvent(new Event("input", { bubbles: true }));
      search.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();

    expect(host.textContent).toContain("ana@test.mx");
    expect(host.textContent).not.toContain("luis@test.mx");
  });

  it("abre la ficha de una cuenta con Ver", async () => {
    const fetchMock = vi.mocked(fetch);
    await act(async () => {
      root.render(h(AdminInsights, { onClose: vi.fn() }));
    });
    await flush();

    const ver = Array.from(host.querySelectorAll("button")).find(
      (b) => b.textContent === "Ver",
    );
    expect(ver).toBeTruthy();
    await act(async () => ver!.click());
    await flush();

    const url = String(fetchMock.mock.calls.at(-1)?.[0]);
    expect(url).toContain("/api/admin/users/u1");
    const text = host.textContent ?? "";
    expect(text).toContain("ana@test.mx");
    expect(text).toContain("← Panel");
    expect(text).toContain("Palabras por etapa");
    expect(text).toContain("Repasos por semana");
  });

  it("exporta las cuentas a CSV", async () => {
    await act(async () => {
      root.render(h(AdminInsights, { onClose: vi.fn() }));
    });
    await flush();

    const exportBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Exportar cuentas (CSV)"),
    );
    expect(exportBtn).toBeTruthy();
    await act(async () => exportBtn!.click());

    expect(downloadText).toHaveBeenCalledTimes(1);
    const [filename, text, type] = vi.mocked(downloadText).mock.calls[0]!;
    expect(filename).toBe("lecta-cuentas-30d.csv");
    expect(type).toContain("text/csv");
    expect(text).toContain("correo,nombre,alta");
    expect(text).toContain("ana@test.mx");
    expect(text).toContain("luis@test.mx");
  });

  it("exporta la serie diaria a CSV", async () => {
    await act(async () => {
      root.render(h(AdminInsights, { onClose: vi.fn() }));
    });
    await flush();

    const exportBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Exportar días (CSV)"),
    );
    expect(exportBtn).toBeTruthy();
    await act(async () => exportBtn!.click());

    const [filename, text] = vi.mocked(downloadText).mock.calls[0]!;
    expect(filename).toBe("lecta-actividad-30d.csv");
    expect(text).toContain("dia,personas_activas,minutos");
    expect(text).toContain("2026-11-01");
  });
});
