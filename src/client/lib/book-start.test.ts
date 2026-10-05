// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  loadBookStart,
  saveBookStart,
  resolveEntryTarget,
} from "./book-start";
import type { ChapterCatalog, ChapterTarget } from "./chapters";
import type { SavedBookPosition } from "./idb";

const store = new Map<string, string>();
vi.mock("./idb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./idb")>();
  return {
    ...mod,
    loadSessionValue: vi.fn(async (key: string) => store.get(key) ?? null),
    saveSessionValue: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  };
});

const target = (id: string, over: Partial<ChapterTarget> = {}): ChapterTarget => ({
  id,
  label: id,
  href: id,
  sectionIndex: 0,
  depth: 0,
  kind: "chapter",
  ...over,
});

const catalog = (targets: ChapterTarget[]): ChapterCatalog => ({
  targets,
  ranges: targets.map((t, i) => ({
    target: t,
    startSection: t.sectionIndex,
    endSection: targets[i + 1]?.sectionIndex ?? t.sectionIndex + 1,
  })),
});

const pos = (over: Partial<SavedBookPosition> = {}): SavedBookPosition => ({
  bookHash: "b",
  sectionIndex: 2,
  scrollTop: 0,
  ratio: 0.4,
  progress: 0.4,
  anchor: "ancla",
  updatedAt: 1,
  ...over,
});

describe("resolveEntryTarget", () => {
  const cat = catalog([
    target("intro.xhtml", { kind: "preliminary" }),
    target("cap1.xhtml", { sectionIndex: 1 }),
    target("cap2.xhtml#s2", { sectionIndex: 2, fragment: "s2" }),
  ]);

  it("con posición reanuda ahí, nunca pregunta", () => {
    const entry = resolveEntryTarget(pos(), null, cat, 5);
    expect(entry).toEqual({
      kind: "resume",
      sectionIndex: 2,
      ratio: 0.4,
      anchor: "ancla",
    });
  });

  it("posición fuera de rango se sujeta al final sin ancla ajena", () => {
    const entry = resolveEntryTarget(
      pos({ sectionIndex: 9 }),
      null,
      cat,
      5,
    );
    expect(entry).toEqual({
      kind: "resume",
      sectionIndex: 4,
      ratio: 0,
      anchor: undefined,
    });
  });

  it("sin posición pero con registro, abre el destino elegido", () => {
    const entry = resolveEntryTarget(
      null,
      {
        version: 1,
        readingTargetId: "cap2.xhtml#s2",
        preparationTargetId: "cap2.xhtml#s2",
        updatedAt: 1,
      },
      cat,
      5,
    );
    expect(entry).toEqual({
      kind: "target",
      target: cat.targets[2],
    });
  });

  it("registro con destino que ya no existe → preguntar", () => {
    const entry = resolveEntryTarget(
      null,
      {
        version: 1,
        readingTargetId: "fantasma.xhtml",
        preparationTargetId: null,
        updatedAt: 1,
      },
      cat,
      5,
    );
    expect(entry.kind).toBe("ask");
  });

  it("sin posición ni registro → preguntar", () => {
    expect(resolveEntryTarget(null, null, cat, 5).kind).toBe("ask");
    expect(resolveEntryTarget(undefined, null, cat, 5).kind).toBe("ask");
  });
});

describe("bookStart record", () => {
  it("guarda y recupera la elección por libro", async () => {
    await saveBookStart("libro-a", {
      readingTargetId: "cap1.xhtml",
      preparationTargetId: "cap1.xhtml",
    });
    const record = await loadBookStart("libro-a");
    expect(record?.readingTargetId).toBe("cap1.xhtml");
    expect(record?.version).toBe(1);
  });

  it("un registro corrupto se ignora", async () => {
    store.set("bookStart:v1:libro-b", "{no json");
    expect(await loadBookStart("libro-b")).toBeNull();
    store.set("bookStart:v1:libro-c", JSON.stringify({ version: 9 }));
    expect(await loadBookStart("libro-c")).toBeNull();
    store.set(
      "bookStart:v1:libro-d",
      JSON.stringify({ version: 1, readingTargetId: "", preparationTargetId: null, updatedAt: 1 }),
    );
    expect(await loadBookStart("libro-d")).toBeNull();
  });

  it("libros distintos no comparten elección", async () => {
    expect(await loadBookStart("otro-libro")).toBeNull();
  });
});
