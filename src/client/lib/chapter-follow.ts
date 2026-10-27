import {
  CHAPTER_FOLLOW_PREFIX,
  listSessionKeys,
  loadSessionValue,
  saveSessionValue,
  type DbScope,
} from "./idb";

export type ChapterFollowLevel = "al-dia" | "mas-o-menos" | "perdido";

export const CHAPTER_FOLLOW_OPTIONS: ReadonlyArray<{ level: ChapterFollowLevel; label: string }> = [
  { level: "al-dia", label: "Seguí el hilo" },
  { level: "mas-o-menos", label: "Más o menos" },
  { level: "perdido", label: "Me perdí" },
];

const LEVELS = new Set<string>(CHAPTER_FOLLOW_OPTIONS.map((option) => option.level));

export function chapterFollowKey(bookId: string, chapterId: string): string {
  return `${CHAPTER_FOLLOW_PREFIX}${encodeURIComponent(bookId)}:${encodeURIComponent(chapterId)}`;
}

export function serializeChapterFollow(level: ChapterFollowLevel, now = Date.now()): string {
  return JSON.stringify({ version: 1, level, updatedAt: now });
}

export function parseChapterFollow(raw: string | null | undefined): ChapterFollowLevel | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { version?: unknown; level?: unknown };
    return value.version === 1 && typeof value.level === "string" && LEVELS.has(value.level)
      ? (value.level as ChapterFollowLevel)
      : null;
  } catch {
    return null;
  }
}

export async function saveChapterFollowAnswer(
  bookId: string,
  chapterId: string,
  level: ChapterFollowLevel,
  scope?: DbScope,
): Promise<void> {
  await saveSessionValue(
    chapterFollowKey(bookId, chapterId),
    serializeChapterFollow(level),
    scope,
  );
}

export async function summarizeChapterFollows(
  scope?: DbScope,
): Promise<{ answered: number; atEase: number }> {
  const keys = (await listSessionKeys(scope)).filter((key) =>
    key.startsWith(CHAPTER_FOLLOW_PREFIX),
  );
  const levels = await Promise.all(
    keys.map(async (key) => parseChapterFollow(await loadSessionValue(key, scope))),
  );
  const answered = levels.filter((level): level is ChapterFollowLevel => level !== null);
  return {
    answered: answered.length,
    atEase: answered.filter((level) => level === "al-dia").length,
  };
}
