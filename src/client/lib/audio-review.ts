import type { SavedWord } from "./idb";
import { speakWord, stopSpeaking } from "./speech";

export type AudioReviewPhase = "prompt" | "pause" | "reveal";
export type AudioReviewStatus = "idle" | "playing" | "paused" | "done";

export type AudioReviewWord = Pick<
  SavedWord,
  "key" | "form" | "lemma" | "meaning" | "language" | "context"
>;

export interface AudioReviewSnapshot {
  status: AudioReviewStatus;
  index: number;
  total: number;
  phase: AudioReviewPhase;
  currentWord: AudioReviewWord | null;
}

export interface AudioReviewOptions {
  pauseMs?: number;
  revealPauseMs?: number;
  includeContext?: boolean;
  speak?: (text: string, language?: string, rate?: number) => Promise<void>;
  stop?: () => void;
  wait?: (ms: number) => Promise<void>;
  onChange?: (snapshot: AudioReviewSnapshot) => void;
}

const defaultWait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function trimSentence(sentence?: string): string {
  const clean = sentence?.replace(/\s+/g, " ").trim() ?? "";
  if (!clean) return "";
  return clean.length <= 180 ? clean : `${clean.slice(0, 177).trimEnd()}…`;
}

export function createAudioReviewRunner(
  words: AudioReviewWord[],
  options: AudioReviewOptions = {},
) {
  const list = [...words];
  const pauseMs = options.pauseMs ?? 2800;
  const revealPauseMs = options.revealPauseMs ?? 1200;
  const includeContext = options.includeContext ?? true;
  const speak = options.speak ?? speakWord;
  const stopAudio = options.stop ?? stopSpeaking;
  const wait = options.wait ?? defaultWait;
  const onChange = options.onChange;

  let status: AudioReviewStatus = "idle";
  let index = 0;
  let phase: AudioReviewPhase = "prompt";
  let runGen = 0;

  const getSnapshot = (): AudioReviewSnapshot => ({
    status,
    index,
    total: list.length,
    phase,
    currentWord: status === "done" ? null : (list[index] ?? null),
  });

  const emit = () => {
    onChange?.(getSnapshot());
  };

  const runFromCurrent = async () => {
    const gen = ++runGen;
    if (list.length === 0) {
      status = "done";
      emit();
      return;
    }
    status = "playing";

    while (gen === runGen && index < list.length) {
      const item = list[index]!;
      const lang = item.language || "es";
      phase = "prompt";
      emit();

      await speak(item.form, lang, 0.9);
      if (gen !== runGen) return;

      const sentence = includeContext ? trimSentence(item.context) : "";
      if (sentence) {
        await speak(sentence, lang, 0.95);
        if (gen !== runGen) return;
      }

      phase = "pause";
      emit();
      if (pauseMs > 0) {
        await wait(pauseMs);
        if (gen !== runGen) return;
      }

      phase = "reveal";
      emit();
      const gloss = item.meaning?.trim();
      if (gloss) {
        await speak(gloss, "es", 0.95);
        if (gen !== runGen) return;
      }
      if (revealPauseMs > 0) {
        await wait(revealPauseMs);
        if (gen !== runGen) return;
      }

      index += 1;
    }

    if (gen !== runGen) return;
    status = "done";
    phase = "prompt";
    emit();
  };

  return {
    getSnapshot,
    start(startIndex = 0) {
      runGen += 1;
      stopAudio();
      index = Math.max(0, Math.min(startIndex, Math.max(0, list.length - 1)));
      phase = "prompt";
      if (list.length === 0) {
        status = "done";
        emit();
        return Promise.resolve();
      }
      return runFromCurrent();
    },
    pause() {
      if (status !== "playing") return;
      runGen += 1;
      stopAudio();
      status = "paused";
      emit();
    },
    resume() {
      if (status !== "paused") return Promise.resolve();
      return runFromCurrent();
    },
    next() {
      if (list.length === 0) return Promise.resolve();
      runGen += 1;
      stopAudio();
      if (index + 1 >= list.length) {
        index = list.length;
        status = "done";
        phase = "prompt";
        emit();
        return Promise.resolve();
      }
      index += 1;
      phase = "prompt";
      if (status === "paused") {
        emit();
        return Promise.resolve();
      }
      return runFromCurrent();
    },
    prev() {
      if (list.length === 0) return Promise.resolve();
      runGen += 1;
      stopAudio();
      index = Math.max(0, index - 1);
      phase = "prompt";
      if (status === "paused") {
        emit();
        return Promise.resolve();
      }
      return runFromCurrent();
    },
    stop() {
      runGen += 1;
      stopAudio();
      status = "idle";
      index = 0;
      phase = "prompt";
      emit();
    },
  };
}
