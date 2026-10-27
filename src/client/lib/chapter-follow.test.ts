import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  chapterFollowKey,
  parseChapterFollow,
  saveChapterFollowAnswer,
  serializeChapterFollow,
  summarizeChapterFollows,
} from "./chapter-follow";
import { listSessionKeys, loadSessionValue, saveSessionValue } from "./idb";

vi.mock("./idb", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./idb")>()),
  listSessionKeys: vi.fn(async () => []),
  loadSessionValue: vi.fn(async () => undefined),
  saveSessionValue: vi.fn(async () => undefined),
}));

const listKeysMock = vi.mocked(listSessionKeys);
const loadMock = vi.mocked(loadSessionValue);
const saveMock = vi.mocked(saveSessionValue);

describe("autoevaluación del capítulo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cada capítulo tiene su propia clave y los identificadores con dos puntos no chocan", () => {
    expect(chapterFollowKey("libro1", "cap-1").startsWith("chapterFollow:v1:libro1:")).toBe(true);
    expect(chapterFollowKey("libro1", "cap-1")).not.toBe(chapterFollowKey("libro1", "cap-2"));
    expect(chapterFollowKey("libro1", "a:b")).not.toBe(chapterFollowKey("libro1:a", "b"));
  });

  it("el identificador del índice viaja codificado: sin barras ni almohadillas en la clave", () => {
    expect(chapterFollowKey("libro1", "OEBPS/cap.xhtml#sec")).not.toMatch(/[/#]/);
  });

  it("solo acepta respuestas válidas", () => {
    expect(parseChapterFollow(serializeChapterFollow("perdido", 1))).toBe("perdido");
    expect(parseChapterFollow(null)).toBeNull();
    expect(parseChapterFollow("no es json")).toBeNull();
    expect(parseChapterFollow("null")).toBeNull();
    expect(parseChapterFollow(JSON.stringify({ version: 2, level: "al-dia" }))).toBeNull();
    expect(parseChapterFollow(JSON.stringify({ version: 1, level: "comprendido" }))).toBeNull();
  });

  it("guarda la respuesta bajo la clave del capítulo", async () => {
    await saveChapterFollowAnswer("libro1", "cap-1", "al-dia");
    expect(saveMock).toHaveBeenCalledWith(
      chapterFollowKey("libro1", "cap-1"),
      expect.stringContaining('"level":"al-dia"'),
      undefined,
    );
  });

  it("cuenta capítulos respondidos y cuántos se sintieron al día, ignorando otras claves", async () => {
    listKeysMock.mockResolvedValue([
      chapterFollowKey("libro1", "cap-1"),
      chapterFollowKey("libro1", "cap-2"),
      chapterFollowKey("libro1", "cap-3"),
      "preparation:v1:libro1:cap1",
    ]);
    loadMock.mockImplementation(async (key: string) => {
      if (key === chapterFollowKey("libro1", "cap-1")) return serializeChapterFollow("al-dia", 1);
      if (key === chapterFollowKey("libro1", "cap-2")) return serializeChapterFollow("perdido", 2);
      return undefined;
    });
    expect(await summarizeChapterFollows()).toEqual({ answered: 2, atEase: 1 });
  });

  it("sin respuestas el resumen sale en cero", async () => {
    listKeysMock.mockResolvedValue([]);
    expect(await summarizeChapterFollows()).toEqual({ answered: 0, atEase: 0 });
  });
});
