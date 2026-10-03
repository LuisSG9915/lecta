export type SegmenterRequest = {
  id: number;
  text: string;
  language: string;
};

export type SegmenterResponse =
  | { id: number; ok: true; words: string[] }
  | { id: number; ok: false; error: string };

self.onmessage = (event: MessageEvent<SegmenterRequest>) => {
  const { id, text, language } = event.data;

  try {
    const segmenter = new Intl.Segmenter(language, { granularity: "word" });
    const words = new Set<string>();

    for (const part of segmenter.segment(text)) {
      if (part.isWordLike) words.add(part.segment);
    }

    const response: SegmenterResponse = { id, ok: true, words: [...words] };
    self.postMessage(response);
  } catch (error) {
    const response: SegmenterResponse = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : "No se pudo dividir la sección.",
    };
    self.postMessage(response);
  }
};
