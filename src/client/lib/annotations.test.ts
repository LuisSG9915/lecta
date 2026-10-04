import { describe, expect, it } from "vitest";
import { BOOKMARK_ID, makeBookmark, makePassage, mergeAnnotation } from "./annotations";
import type { SavedAnnotation } from "./idb";

const annotation = (over: Partial<SavedAnnotation>): SavedAnnotation => ({
  key: "b1:x",
  id: "x",
  bookHash: "b1",
  kind: "passage",
  sectionIndex: 0,
  createdAt: 100,
  updatedAt: 100,
  ...over,
});

describe("mergeAnnotation", () => {
  it("gana el registro más reciente", () => {
    const local = annotation({ updatedAt: 200, note: "local" });
    const remote = annotation({ updatedAt: 100, note: "remota" });
    expect(mergeAnnotation(local, remote).note).toBe("local");
    expect(mergeAnnotation(local, { ...remote, updatedAt: 300 }).note).toBe(
      "remota",
    );
  });

  it("una lápida reciente borra una versión viva más vieja", () => {
    const local = annotation({ updatedAt: 100 });
    const remote = annotation({ updatedAt: 200, deleted: true });
    expect(mergeAnnotation(local, remote).deleted).toBe(true);
  });

  it("sin registro local se acepta el remoto", () => {
    const remote = annotation({});
    expect(mergeAnnotation(undefined, remote)).toBe(remote);
  });
});

describe("makeBookmark", () => {
  it("usa id fijo: un marcador por libro", () => {
    expect(makeBookmark("b1", 4, "ancla").id).toBe(BOOKMARK_ID);
    expect(makeBookmark("b1", 4).kind).toBe("bookmark");
  });
});

describe("makePassage", () => {
  it("normaliza el texto, guarda contexto y ancla de inicio", () => {
    const p = makePassage("b1", 2, "  algo   muy\n largo  ", "antes de", "después de");
    expect(p?.text).toBe("algo muy largo");
    expect(p?.anchor).toBe("algo muy largo");
    expect(p?.prefix).toBe("antes de");
    expect(p?.kind).toBe("passage");
    expect(p?.id).not.toBe(BOOKMARK_ID);
  });

  it("rechaza selecciones vacías", () => {
    expect(makePassage("b1", 0, "   ")).toBeNull();
  });
});
