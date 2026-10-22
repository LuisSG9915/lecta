// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { authClient } from "./lib/auth";
import {
  getStoredBook,
  listBookOps,
  listStoredBooks,
  loadSessionValue,
} from "./lib/idb";
import { listRemoteBooks } from "./lib/books";
import { syncPositions } from "./lib/positions-sync";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock("./lib/auth", () => ({
  authClient: {
    useSession: vi.fn(() => ({ data: null, isPending: false })),
  },
}));

vi.mock("./components/Reader", async () => {
  const { createElement } = await import("react");
  return { default: () => createElement("div", { className: "reader-stub" }) };
});

// La estantería real jala portadas y metadatos del EPUB; la prueba es del
// aviso de conflicto, así que el estante queda reducido a su contrato.
vi.mock("./components/Shelf", async () => {
  const { createElement } = await import("react");
  return {
    default: ({
      library,
      checking,
      onOpen,
      onRemove,
    }: {
      library: { hash: string; name: string }[];
      checking?: boolean;
      onOpen: (item: never) => void;
      onRemove?: (hash: string) => void;
    }) => {
      if (checking) {
        return createElement("p", { className: "status" }, "Preparando tu estantería…");
      }
      return createElement(
        "ul",
        { className: "shelf-stub" },
        library.map((item) =>
          createElement(
            "li",
            { key: item.hash },
            createElement(
              "button",
              {
                className: "shelf-book-cover",
                onClick: () => onOpen(item as never),
              },
              item.name,
            ),
            createElement(
              "span",
              { className: "shelf-item-lang" },
              (item as { language?: string }).language ?? "",
            ),
            createElement(
              "button",
              {
                className: "shelf-book-remove",
                onClick: () => onRemove?.(item.hash),
              },
              "Quitar",
            ),
          ),
        ),
      );
    },
  };
});

vi.mock("./lib/idb", () => ({
  captureDbScope: vi.fn(() => ({ userId: null as string | null, generation: 0 })),
  isDbScopeActive: vi.fn(() => true),
  classifyDbError: vi.fn((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err ?? "");
    const code = msg.includes("otra pestaña") ? "blocked" : "corrupt";
    return { code, message: msg };
  }),
  resetDbConnection: vi.fn(),
  StaleScopeError: class StaleScopeError extends Error {
    constructor() {
      super("La cuenta activa cambió durante la operación.");
      this.name = "StaleScopeError";
    }
  },
  CompanionEventConflictError: class CompanionEventConflictError extends Error {
    constructor() {
      super("companion event conflict");
      this.name = "CompanionEventConflictError";
    }
  },
  GAME_STATE_KEY: "gameState",
  GAME_KEY: "companion",
  COMPANION_BASELINES_KEY: "companionBaselines:v1",
  COMPANION_PROFILE_KEY: "companionProfile:v1",
  COMPANION_DEVICE_PREFS_KEY: "companionDevicePrefs:v1",
  COMPANION_MIGRATION_KEY: "companionMigration:v1",
  COMPANION_ACKED_KEY: "companionAcked:v1",
  appendCompanionEvents: vi.fn(async () => undefined),
  commitCompanionEvent: vi.fn(async () => undefined),
  listCompanionEvents: vi.fn(async () => []),
  listCompanionReceipts: vi.fn(async () => []),
  mergeCompanionReceipts: vi.fn(async () => []),
  migrateGameStateV1: vi.fn(async () => ({ already: true })),
  putCompanionBaseline: vi.fn(async () => undefined),
  putCompanionRegisters: vi.fn(async () => []),
  readCompanionAcked: vi.fn(async () => ({
    baselines: [],
    events: [],
    fields: [],
    receipts: [],
  })),
  readCompanionBaselines: vi.fn(async () => ({})),
  readCompanionDevicePrefs: vi.fn(async () => null),
  readCompanionRegisters: vi.fn(async () => []),
  saveCompanionAcked: vi.fn(async () => undefined),
  saveCompanionDevicePrefs: vi.fn(async () => undefined),
  deleteAccountDb: vi.fn(async () => undefined),
  deleteStoredBook: vi.fn(async () => undefined),
  getStoredBook: vi.fn(async () => undefined),
  listBookOps: vi.fn(async () => []),
  getActiveUserId: vi.fn(() => null),
  listKnowledge: vi.fn(async () => []),
  listIntervals: vi.fn(async () => []),
  listAllReviews: vi.fn(async () => []),
  listReadingEvents: vi.fn(async () => []),
  countCachedLexicon: vi.fn(async () => 0),
  clearDictionaryCache: vi.fn(async () => undefined),
  listPositions: vi.fn(async () => []),
  listReadingDays: vi.fn(async () => []),
  listSavedWords: vi.fn(async () => []),
  listStoredBooks: vi.fn(async () => []),
  loadBookPosition: vi.fn(async () => undefined),
  loadLatestBookHash: vi.fn(async () => undefined),
  loadSessionValue: vi.fn(async () => "1"),
  loadShelfBootstrap: vi.fn(async () => ({
    positions: [],
    savedWords: [],
    latestHash: undefined,
    readingDays: [],
    intervals: [],
    rawGoal: null,
  })),
  saveBook: vi.fn(async () => undefined),
  saveBookPosition: vi.fn(async () => undefined),
  saveSessionValue: vi.fn(async () => undefined),
  setDbUser: vi.fn(async () => undefined),
  updateBookMeta: vi.fn(async () => undefined),
}));

vi.mock("./lib/books", () => ({
  downloadBook: vi.fn(async () => null),
  listRemoteBooks: vi.fn(async () => []),
}));

vi.mock("./lib/book-queue", () => ({
  queueBookDelete: vi.fn(async () => undefined),
  queueBookUpload: vi.fn(async () => undefined),
  runBookQueue: vi.fn(async () => undefined),
}));

vi.mock("./lib/positions-sync", () => ({
  syncPositions: vi.fn(async () => null),
}));

vi.mock("./lib/vocab", () => ({ syncSavedWords: vi.fn(async () => undefined) }));

vi.mock("./lib/reading-sync", () => ({
  syncActivity: vi.fn(async () => undefined),
  syncAnnotations: vi.fn(async () => undefined),
  syncKnowledge: vi.fn(async () => undefined),
  syncReviews: vi.fn(async () => undefined),
  pullMissingUserBooksFromCloud: vi.fn(async () => 0),
  syncUserBookUpload: vi.fn(async () => true),
}));

vi.mock("./lib/companion-sync", () => ({
  scheduleCompanionSync: vi.fn(),
  requestCompanionSync: vi.fn(),
  syncCompanion: vi.fn(async () => null),
}));

vi.mock("./lib/calibration", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./lib/calibration")>();
  return {
    ...mod,
    fetchCalibrationSample: vi.fn(async () => ({ ok: false, words: [] })),
  };
});

let host: HTMLDivElement;
let root: Root;

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));
const popBack = () =>
  act(() => {
    history.replaceState({}, "");
    window.dispatchEvent(new Event("popstate"));
  });

const CONFLICT = {
  bookHash: "h1",
  previous: { bookHash: "h1", sectionIndex: 1, updatedAt: 5 },
  merged: { bookHash: "h1", sectionIndex: 3, progress: 0.4, updatedAt: 9 },
};

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  window.scrollTo = vi.fn();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.mocked(authClient.useSession).mockReturnValue({ data: null, isPending: false } as never);
  vi.mocked(listStoredBooks).mockResolvedValue([
    { hash: "h1", name: "b.epub", addedAt: 1, data: new Blob() },
  ] as never);
  vi.mocked(getStoredBook).mockResolvedValue({
    hash: "h1",
    name: "b.epub",
    addedAt: 1,
    data: new Blob(),
  } as never);
  vi.mocked(listBookOps).mockResolvedValue([] as never);
  vi.mocked(listRemoteBooks).mockResolvedValue([] as never);
  vi.mocked(loadSessionValue).mockResolvedValue("1");
  vi.mocked(syncPositions).mockResolvedValue({ conflicts: [CONFLICT] } as never);
});

afterEach(() => {
  act(() => {
    history.replaceState({}, "", "/");
    window.dispatchEvent(new Event("popstate"));
    root.unmount();
  });
  host.remove();
  document.body.innerHTML = "";
});

const openConflict = async () => {
  renderRoot();
  await flush();
  const card = host.querySelector<HTMLButtonElement>(".shelf-book-cover");
  expect(card).toBeTruthy();
  await act(async () => card!.click());
  await flush();
  expect(host.querySelector(".dialog-scrim")).toBeTruthy();
};

const renderRoot = () => act(() => root.render(h(App)));

describe("App · aviso de conflicto de posición", () => {
  it("atrás cierra solo la capa del aviso y no abre el libro", async () => {
    await openConflict();
    popBack();
    expect(host.querySelector(".dialog-scrim")).toBeNull();
    expect(host.querySelector(".reader-stub")).toBeNull();
  });

  it("cerrar el aviso no abre el libro", async () => {
    await openConflict();
    const close = [...host.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Cerrar aviso",
    );
    expect(close).toBeTruthy();
    await act(async () => close!.click());
    expect(host.querySelector(".dialog-scrim")).toBeNull();
    expect(host.querySelector(".reader-stub")).toBeNull();
  });

  it("elegir continuar abre el libro y atrás vuelve a la estantería", async () => {
    await openConflict();
    const go = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Continuar desde ahí",
    );
    expect(go).toBeTruthy();
    await act(async () => go!.click());
    await flush();
    expect(host.querySelector(".reader-stub")).toBeTruthy();
    expect(host.querySelector(".dialog-scrim")).toBeNull();
    // Atrás desde el lector vuelve a la estantería: el aviso no reaparece.
    popBack();
    await flush();
    expect(host.querySelector(".reader-stub")).toBeNull();
    expect(host.querySelector(".dialog-scrim")).toBeNull();
  });
});

describe("App · quitar libro", () => {
  it("no reaparece como «En la nube» mientras el borrado remoto corre en la cola", async () => {
    vi.mocked(authClient.useSession).mockReturnValue({
      data: { user: { id: "u1" } },
      isPending: false,
    } as never);
    // El servidor todavía lista el libro: el DELETE viaja en la cola.
    vi.mocked(listRemoteBooks).mockResolvedValue([
      { hash: "h1", uploaded: "2026-10-01T00:00:00Z", name: "b.epub" },
    ] as never);
    renderRoot();
    await flush();
    expect(host.querySelectorAll(".shelf-book-cover").length).toBe(1);

    // Al quitarlo, la base local ya no lo tiene pero la op de borrado
    // remoto queda pendiente en bookOps — la respuesta del servidor aún
    // incluiría el libro.
    vi.mocked(listStoredBooks).mockResolvedValue([] as never);
    vi.mocked(listBookOps).mockResolvedValue([
      { id: "op1", kind: "delete", hash: "h1", createdAt: 1 },
    ] as never);
    const remove = host.querySelector<HTMLButtonElement>(".shelf-book-remove");
    expect(remove).toBeTruthy();
    await act(async () => remove!.click());
    await flush();

    expect(host.querySelectorAll(".shelf-book-cover").length).toBe(0);
  });

  it("sale de la vista sin esperar a la red aunque el GET remoto se cuelgue", async () => {
    vi.mocked(authClient.useSession).mockReturnValue({
      data: { user: { id: "u1" } },
      isPending: false,
    } as never);
    // La primera lista remota responde (montaje); la del borrado queda
    // colgada — el libro debe desaparecer igual, sin esperar la red.
    let remoteCalls = 0;
    vi.mocked(listRemoteBooks).mockImplementation(() => {
      remoteCalls += 1;
      return remoteCalls === 1
        ? Promise.resolve([
            { hash: "h1", uploaded: "2026-10-01T00:00:00Z", name: "b.epub" },
          ] as never)
        : new Promise(() => {});
    });
    renderRoot();
    await flush();
    expect(host.querySelectorAll(".shelf-book-cover").length).toBe(1);

    const remove = host.querySelector<HTMLButtonElement>(".shelf-book-remove");
    await act(async () => remove!.click());
    await flush();

    expect(host.querySelectorAll(".shelf-book-cover").length).toBe(0);
    expect(remoteCalls).toBeGreaterThan(1); // el refresco sí se pidió
  });
});

describe("App · navegación principal (Fase 2)", () => {
  it("cabecera solo contiene la marca Lecta y no tiene botones de navegación ni menú de tema", async () => {
    renderRoot();
    await flush();
    const header = host.querySelector("header.app-header");
    expect(header).toBeTruthy();
    expect(header?.querySelector(".brand")?.textContent).toBe("Lecta");
    expect(header?.querySelector("nav")).toBeNull();
    expect(header?.querySelector("button")).toBeNull();
  });

  it("barra de navegación tiene 4 destinos y Biblioteca está activa inicialmente", async () => {
    renderRoot();
    await flush();
    const nav = host.querySelector("nav.app-nav");
    expect(nav).toBeTruthy();
    const items = nav?.querySelectorAll(".app-nav-item");
    expect(items?.length).toBe(4);

    const shelfBtn = nav?.querySelector<HTMLButtonElement>('[data-dest="shelf"]');
    const vocabBtn = nav?.querySelector<HTMLButtonElement>('[data-dest="vocabulary"]');
    const journeyBtn = nav?.querySelector<HTMLButtonElement>('[data-dest="journey"]');
    const accountBtn = nav?.querySelector<HTMLButtonElement>('[data-dest="account"]');

    expect(shelfBtn?.getAttribute("aria-current")).toBe("page");
    expect(vocabBtn?.getAttribute("aria-current")).toBeNull();
    expect(journeyBtn?.getAttribute("aria-current")).toBeNull();
    expect(accountBtn?.getAttribute("aria-current")).toBeNull();
  });

  it("Biblioteca → Cuaderno → Perfil → atrás vuelve a Biblioteca con un solo paso de historial", async () => {
    renderRoot();
    await flush();
    const nav = host.querySelector("nav.app-nav");
    const vocabBtn = nav?.querySelector<HTMLButtonElement>('[data-dest="vocabulary"]');
    const accountBtn = nav?.querySelector<HTMLButtonElement>('[data-dest="account"]');
    const shelfBtn = nav?.querySelector<HTMLButtonElement>('[data-dest="shelf"]');

    // Navegar a Cuaderno
    await act(async () => vocabBtn!.click());
    await flush();
    expect(vocabBtn?.getAttribute("aria-current")).toBe("page");
    expect(shelfBtn?.getAttribute("aria-current")).toBeNull();

    // Navegar a Perfil
    await act(async () => accountBtn!.click());
    await act(async () => {
      await import("./components/Account");
    });
    await flush();
    expect(accountBtn?.getAttribute("aria-current")).toBe("page");
    expect(vocabBtn?.getAttribute("aria-current")).toBeNull();
    expect(shelfBtn?.getAttribute("aria-current")).toBeNull();
    expect(host.querySelector(".account-page")).toBeTruthy();

    // Atrás del navegador debe regresar a Biblioteca en un solo paso
    popBack();
    await flush();
    expect(shelfBtn?.getAttribute("aria-current")).toBe("page");
    expect(accountBtn?.getAttribute("aria-current")).toBeNull();
    expect(host.querySelector(".account-page")).toBeNull();
  });

  it("Tu recorrido abierto desde Perfil regresa a Perfil al cerrarse", async () => {
    renderRoot();
    await flush();
    const nav = host.querySelector("nav.app-nav");
    const accountBtn = nav?.querySelector<HTMLButtonElement>('[data-dest="account"]');

    // Abrir Perfil
    await act(async () => accountBtn!.click());
    await act(async () => {
      await import("./components/Account");
    });
    await flush();
    expect(host.querySelector(".account-page")).toBeTruthy();

    const idBeforeJourney =
      (history.state as { lecta?: number } | null)?.lecta ?? 0;

    // Abrir Journey desde la fila de recorrido en Perfil
    const journeyRow = host.querySelector<HTMLButtonElement>(".account-journey-row");
    expect(journeyRow).toBeTruthy();
    await act(async () => journeyRow!.click());
    await flush();

    // Cerrar Journey con atrás
    act(() => {
      const cur = history.state as { s?: string } | null;
      history.replaceState({ lecta: idBeforeJourney, s: cur?.s }, "");
      window.dispatchEvent(new Event("popstate"));
    });
    await flush();

    // Perfil sigue visible
    expect(host.querySelector(".account-page")).toBeTruthy();
    expect(accountBtn?.getAttribute("aria-current")).toBe("page");
  });

  it("en Recorrido al presionar vestidor del gato abre la hoja del compañero en el armario", async () => {
    renderRoot();
    await flush();

    const nav = host.querySelector("nav.app-nav");
    const journeyBtn = nav?.querySelector<HTMLButtonElement>('[data-dest="journey"]');
    expect(journeyBtn).toBeTruthy();

    await import("./components/Journey");
    await act(async () => journeyBtn!.click());
    await flush();
    await flush();

    expect(host.querySelector(".journey-sheet")).toBeTruthy();

    const closetBtn = host.querySelector<HTMLButtonElement>(
      "button[aria-label='Abrir vestidor del gato']",
    );
    expect(closetBtn).toBeTruthy();

    await act(async () => closetBtn!.click());
    // La hoja es diferida (React.lazy): se espera a que resuelva el chunk.
    for (let i = 0; i < 40 && !host.querySelector(".sheet.sheet--stage"); i += 1) {
      await flush();
    }

    // La hoja del compañero se monta y muestra el armario
    expect(host.querySelector(".sheet.sheet--stage")).toBeTruthy();
    expect(host.querySelector("#companion-panel-closet")).toBeTruthy();
  });

  it("enlace con token abre directamente el destino Perfil", async () => {
    window.history.replaceState({}, "", "/?token=reset123");
    renderRoot();
    await flush();

    const nav = host.querySelector("nav.app-nav");
    const accountBtn = nav?.querySelector<HTMLButtonElement>('[data-dest="account"]');
    expect(accountBtn?.getAttribute("aria-current")).toBe("page");
    expect(host.querySelector(".account-page")).toBeTruthy();
  });

  it("Cuaderno se preserva con Activity al alternar a Biblioteca y de vuelta", async () => {
    renderRoot();
    await flush();

    const nav = host.querySelector("nav.app-nav");
    const vocabBtn = nav?.querySelector<HTMLButtonElement>('[data-dest="vocabulary"]');
    const shelfBtn = nav?.querySelector<HTMLButtonElement>('[data-dest="shelf"]');

    // Inicialmente Cuaderno no está montado
    expect(host.querySelector(".notebook--page")).toBeNull();

    // Navegar a Cuaderno
    await act(async () => vocabBtn!.click());
    await act(async () => {
      await import("./components/Vocabulary");
    });
    await flush();
    expect(host.querySelector(".notebook--page")).toBeTruthy();

    // Alternar a Biblioteca: Cuaderno se conserva en el DOM (en Activity hidden)
    await act(async () => shelfBtn!.click());
    await flush();
    expect(shelfBtn?.getAttribute("aria-current")).toBe("page");
    expect(host.querySelector(".shelf-stub")).toBeTruthy();
    expect(host.querySelector(".notebook--page")).toBeTruthy();

    // Volver a Cuaderno: sigue ahí sin perder estado
    await act(async () => vocabBtn!.click());
    await flush();
    expect(vocabBtn?.getAttribute("aria-current")).toBe("page");
    expect(host.querySelector(".notebook--page")).toBeTruthy();
  });

  it("muestra la MiniReaderBar al cambiar de pestaña si hay un libro activo", async () => {
    vi.mocked(syncPositions).mockResolvedValue({ conflicts: [] } as never);
    renderRoot();
    await flush();

    // Abrir el libro desde la estantería
    const openBtn = host.querySelector<HTMLButtonElement>(".shelf-book-cover");
    expect(openBtn).toBeTruthy();
    await act(async () => openBtn!.click());
    await flush();
    await flush();
    expect(host.querySelector(".reader-stub")).toBeTruthy();

    // Volver / cerrar lector para regresar a la vista general
    popBack();
    await flush();
    expect(host.querySelector(".reader-stub")).toBeNull();

    // En Biblioteca no se muestra MiniReaderBar porque ya está el héroe
    expect(host.querySelector(".mini-reader-bar")).toBeNull();

    // Al cambiar a Cuaderno (o Perfil), la MiniReaderBar aparece
    const nav = host.querySelector("nav.app-nav");
    const vocabBtn = nav?.querySelector<HTMLButtonElement>('[data-dest="vocabulary"]');
    await act(async () => vocabBtn!.click());
    await flush();

    const bar = host.querySelector(".mini-reader-bar");
    expect(bar).toBeTruthy();
    expect(bar?.textContent).toContain("b.epub");
    expect(bar?.textContent).toContain("Continuar leyendo →");

    // Al pulsar «Continuar leyendo →», reabre el lector
    const resumeBtn = bar?.querySelector<HTMLButtonElement>(".mini-reader-resume");
    expect(resumeBtn).toBeTruthy();
    await act(async () => resumeBtn!.click());
    await flush();

    expect(host.querySelector(".reader-stub")).toBeTruthy();
  });

  it("preserva el idioma de los libros locales en la estantería", async () => {
    vi.mocked(listStoredBooks).mockResolvedValueOnce([
      {
        hash: "h-en",
        name: "red-queen.epub",
        title: "Red Queen",
        author: "Victoria Aveyard",
        addedAt: 1,
        language: "en",
        data: new Blob(),
      },
    ] as never);

    renderRoot();
    await flush();

    const langSpan = host.querySelector(".shelf-item-lang");
    expect(langSpan).toBeTruthy();
    expect(langSpan?.textContent).toBe("en");
  });

  it("muestra panel de error honesto cuando falla IndexedDB, sin mostrar estantería vacía", async () => {
    vi.mocked(listStoredBooks).mockRejectedValueOnce(
      new Error("La base local sigue abierta en otra pestaña"),
    );

    renderRoot();
    await flush();

    // No debe mostrar la estantería vacía
    expect(host.querySelector(".shelf-stub")).toBeNull();

    // Debe mostrar el panel de error honesto
    const errorPanel = host.querySelector(".db-error-panel");
    expect(errorPanel).toBeTruthy();
    expect(errorPanel?.textContent).toContain("Problema con el almacenamiento local");
    expect(errorPanel?.textContent).toContain("otra pestaña");

    // Debe mostrar los botones de acción requeridos
    const buttons = errorPanel?.querySelectorAll("button");
    const buttonTexts = Array.from(buttons ?? []).map((b) => b.textContent);
    expect(buttonTexts).toContain("Reintentar conexión");
    expect(buttonTexts).toContain("Exportar respaldo de emergencia");
    expect(buttonTexts).toContain("Restaurar respaldo");
  });

  it("tras fallo inicial de IndexedDB, pulsar 'Reintentar conexión' exitoso apaga checkingLibrary y muestra la estantería", async () => {
    vi.mocked(listStoredBooks).mockRejectedValueOnce(
      new Error("La base local sigue abierta en otra pestaña"),
    );

    renderRoot();
    await flush();

    const errorPanel = host.querySelector(".db-error-panel");
    expect(errorPanel).toBeTruthy();
    expect(host.querySelector(".shelf-stub")).toBeNull();

    // Al reintentar, la base se abre exitosamente con un libro
    vi.mocked(listStoredBooks).mockResolvedValueOnce([
      {
        hash: "b-recuperado",
        name: "libro-recuperado.epub",
        addedAt: 1,
        data: new Blob(),
      },
    ] as never);

    const retryBtn = Array.from(errorPanel!.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Reintentar conexión"),
    );
    expect(retryBtn).toBeDefined();

    await act(async () => {
      retryBtn!.click();
    });
    await flush();

    // Ya no debe estar en estado de error
    expect(host.querySelector(".db-error-panel")).toBeNull();
    // Ya no debe mostrar "Preparando tu estantería…"
    expect(host.textContent).not.toContain("Preparando tu estantería…");
    // Debe mostrar la estantería con el libro recuperado
    const shelf = host.querySelector(".shelf-stub");
    expect(shelf).toBeTruthy();
    expect(shelf?.textContent).toContain("libro-recuperado.epub");
  });
});

