// @vitest-environment jsdom
// Prerrequisito H8 (F17): un fallo seguido de rescate (o sin rescate posible)
// califica Again aunque el usuario acierte después.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Rating, newCard } from "../lib/fsrs";
import type { SavedWord } from "../lib/idb";
import type { QueueItem } from "../lib/notebook-model";
import { useReviewSession, type UseReviewSessionResult } from "./useReviewSession";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const recordReviewMock = vi.hoisted(() => vi.fn(async () => {}));
const updateSavedWordMock = vi.hoisted(() => vi.fn(async (w: unknown) => w));

vi.mock("../lib/idb", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/idb")>()),
  captureDbScope: vi.fn(() => ({})),
  updateSavedWord: (w: unknown) => updateSavedWordMock(w),
}));
vi.mock("../lib/reviews", () => ({ scheduleCapturedReview: vi.fn(), recordReview: (...a: unknown[]) => recordReviewMock(...(a as [])) }));
vi.mock("../lib/vocab", () => ({ pushWordsToServer: vi.fn(async () => {}) }));
vi.mock("../lib/lexicon", () => ({
  answerItem: vi.fn(async () => {}),
  batchLookup: vi.fn(async () => ({})),
  explainInContext: vi.fn(),
  fetchItems: vi.fn(async () => []),
  verifySentence: vi.fn(),
}));
vi.mock("../lib/account-plan", () => ({ useUserPlan: () => "lecta_plus" }));
vi.mock("../lib/haptics", () => ({ triggerHaptic: vi.fn(), triggerPurrHaptic: vi.fn() }));
vi.mock("../lib/companion-audio", () => ({ playCompanionSound: vi.fn() }));
vi.mock("../lib/practice", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/practice")>()),
  rescueChallenge: (c: object) => ({ ...c, level: 1, hint: null }),
}));

const word = {
  key: "es:casa",
  language: "es",
  form: "casa",
  meaning: "Edificio",
  card: newCard(),
  deleted: false,
} as unknown as SavedWord;

describe("useReviewSession: fallo + rescate = Again", () => {
  let container: HTMLDivElement;
  let root: Root;
  let session: UseReviewSessionResult;

  beforeEach(() => {
    recordReviewMock.mockClear();
    updateSavedWordMock.mockClear();
    container = document.createElement("div");
    root = createRoot(container);
    const companion = {
      combo: 0,
      setCatPose: vi.fn(),
      setCatSpeech: vi.fn(),
      setCombo: vi.fn(),
      settleCatAfter: vi.fn(),
      resultPose: "idle",
      setResultPose: vi.fn(),
      resetCat: vi.fn(),
    };
    function Probe() {
      session = useReviewSession({
        reviewWords: [word],
        scopedWords: [word],
        all: [word],
        retentionCheckCandidates: [],
        useAi: false,
        canHint: false,
        setWords: vi.fn(),
        wordsRef: { current: [word] },
        notifyVocabChange: vi.fn(),
        setSaveError: vi.fn(),
        practiceCompanion: companion as never,
      });
      return null;
    }
    act(() => root.render(h(Probe)));
  });

  afterEach(() => act(() => root.unmount()));

  async function gradeGood(item: QueueItem) {
    await act(async () => {
      await session.grade(item, Rating.Good);
    });
    return (recordReviewMock.mock.calls[0] as unknown as [{ rating: string }])[0].rating;
  }

  it("rescate de un reto de nivel 2: el acierto posterior se guarda como again", async () => {
    const item = {
      word,
      mode: "meaning",
      adaptiveChallenge: { level: 2, hint: null },
    } as unknown as QueueItem;
    act(() => session.setQueue({ total: 1, items: [item] }));
    let rescued = false;
    act(() => {
      rescued = session.tryRescue(item, "");
    });
    expect(rescued).toBe(true);
    expect(await gradeGood(item)).toBe("again");
  });

  it("sin fallo previo, el mismo acierto se guarda como good", async () => {
    const item = { word, mode: "meaning" } as unknown as QueueItem;
    act(() => session.setQueue({ total: 1, items: [item] }));
    expect(await gradeGood(item)).toBe("good");
  });
});
