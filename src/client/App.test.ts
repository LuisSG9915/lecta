// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { getStoredBook, listStoredBooks, loadSessionValue } from "./lib/idb";
import { syncPositions } from "./lib/positions-sync";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock("./lib/auth", () => ({
  authClient: { useSession: () => ({ data: null, isPending: false }) },
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
    default: ({ library, onOpen }: { library: { hash: string; name: string }[]; onOpen: (item: never) => void }) =>
      createElement(
        "ul",
        { className: "shelf-stub" },
        library.map((item) =>
          createElement(
            "button",
            {
              key: item.hash,
              className: "shelf-book-cover",
              onClick: () => onOpen(item as never),
            },
            item.name,
          ),
        ),
      ),
  };
});

vi.mock("./lib/idb", () => ({
  deleteAccountDb: vi.fn(async () => undefined),
  deleteStoredBook: vi.fn(async () => undefined),
  getStoredBook: vi.fn(async () => undefined),
  listBookOps: vi.fn(async () => []),
  listPositions: vi.fn(async () => []),
  listReadingDays: vi.fn(async () => []),
  listSavedWords: vi.fn(async () => []),
  listStoredBooks: vi.fn(async () => []),
  loadBookPosition: vi.fn(async () => undefined),
  loadLatestBookHash: vi.fn(async () => undefined),
  loadSessionValue: vi.fn(async () => "1"),
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
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.mocked(listStoredBooks).mockResolvedValue([
    { hash: "h1", name: "b.epub", addedAt: 1, data: new Blob() },
  ] as never);
  vi.mocked(getStoredBook).mockResolvedValue({
    hash: "h1",
    name: "b.epub",
    addedAt: 1,
    data: new Blob(),
  } as never);
  vi.mocked(loadSessionValue).mockResolvedValue("1");
  vi.mocked(syncPositions).mockResolvedValue({ conflicts: [CONFLICT] } as never);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  history.replaceState({}, "");
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
