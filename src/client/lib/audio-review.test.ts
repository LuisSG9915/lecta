import { describe, expect, it, vi } from "vitest";
import { createAudioReviewRunner, type AudioReviewWord } from "./audio-review";

const WORDS: AudioReviewWord[] = [
  {
    key: "en:lantern",
    form: "lantern",
    lemma: "lantern",
    meaning: "farol o linterna",
    language: "en",
    context: "She raised the lantern against the mist.",
  },
  {
    key: "en:harbor",
    form: "harbor",
    lemma: "harbor",
    meaning: "puerto",
    language: "en",
    context: "",
  },
];

describe("M3 — createAudioReviewRunner (repaso manos libres)", () => {
  it("reproduce secuencia completa prompt (palabra + contexto) -> pause -> reveal (significado es) -> done", async () => {
    const events: string[] = [];
    const speaks: Array<{ text: string; lang?: string; rate?: number }> = [];

    const runner = createAudioReviewRunner(WORDS, {
      pauseMs: 2500,
      revealPauseMs: 900,
      speak: async (text, lang, rate) => {
        speaks.push({ text, lang, rate });
      },
      stop: vi.fn(),
      wait: async (ms) => {
        events.push(`wait:${ms}`);
      },
      onChange: (snap) => {
        events.push(`${snap.status}:${snap.index}:${snap.phase}`);
      },
    });

    await runner.start();

    expect(speaks).toEqual([
      { text: "lantern", lang: "en", rate: 0.9 },
      { text: "She raised the lantern against the mist.", lang: "en", rate: 0.95 },
      { text: "farol o linterna", lang: "es", rate: 0.95 },
      { text: "harbor", lang: "en", rate: 0.9 },
      { text: "puerto", lang: "es", rate: 0.95 },
    ]);
    expect(events).toContain("playing:0:prompt");
    expect(events).toContain("playing:0:pause");
    expect(events).toContain("playing:0:reveal");
    expect(events).toContain("wait:2500");
    expect(events).toContain("wait:900");
    expect(events.at(-1)).toBe("done:2:prompt");
  });

  it("pause detiene el audio y resume retoma desde la palabra actual; next/prev y stop cancelan pasos pendientes", async () => {
    const stopMock = vi.fn();
    const pending: Array<() => void> = [];
    const speakMock = vi.fn(
      () =>
        new Promise<void>((res) => {
          pending.push(res);
        }),
    );
    const flushAll = () => {
      while (pending.length > 0) pending.shift()!();
    };

    const runner = createAudioReviewRunner(WORDS, {
      pauseMs: 0,
      revealPauseMs: 0,
      speak: speakMock,
      stop: stopMock,
      wait: async () => undefined,
    });

    const pStart = runner.start();
    expect(runner.getSnapshot()).toMatchObject({ status: "playing", index: 0 });

    runner.pause();
    expect(stopMock).toHaveBeenCalledTimes(2); // 1 en start + 1 en pause
    expect(runner.getSnapshot()).toMatchObject({ status: "paused", index: 0 });
    flushAll();
    await pStart;
    // La promesa vieja quedó cancelada y NO avanzó al índice 1
    expect(runner.getSnapshot()).toMatchObject({ status: "paused", index: 0 });

    const pResume = runner.resume();
    expect(runner.getSnapshot()).toMatchObject({ status: "playing", index: 0 });

    const pNext = runner.next();
    expect(runner.getSnapshot()).toMatchObject({ status: "playing", index: 1 });

    const pPrev = runner.prev();
    expect(runner.getSnapshot()).toMatchObject({ status: "playing", index: 0 });

    runner.stop();
    expect(runner.getSnapshot()).toMatchObject({ status: "idle", index: 0, phase: "prompt" });
    flushAll();
    await Promise.all([pResume, pNext, pPrev]);
    expect(runner.getSnapshot()).toMatchObject({ status: "idle", index: 0 });
  });
});
