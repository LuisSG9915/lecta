import type { SegmenterRequest, SegmenterResponse } from "../workers/segmenter.worker";

let worker: Worker | undefined;
let nextRequestId = 1;
const pending = new Map<number, { resolve: (words: string[]) => void; reject: (error: Error) => void }>();

function getWorker() {
  worker ??= new Worker(new URL("../workers/segmenter.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (event: MessageEvent<SegmenterResponse>) => {
    const request = pending.get(event.data.id);
    if (!request) return;
    pending.delete(event.data.id);
    if (event.data.ok) request.resolve(event.data.words);
    else request.reject(new Error(event.data.error));
  };
  worker.onerror = () => {
    for (const request of pending.values()) {
      request.reject(new Error("No se pudo procesar el texto de la sección."));
    }
    pending.clear();
  };
  return worker;
}

export function extractUniqueWords(text: string, language = "es") {
  const id = nextRequestId++;
  return new Promise<string[]>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const request: SegmenterRequest = { id, text, language };
    getWorker().postMessage(request);
  });
}
