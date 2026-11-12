# workers

## Overview

Web Worker entry points for the client. They run off the main thread and talk to it only
through `postMessage`. Each worker is started from `../lib` with
`new Worker(new URL(...), { type: "module" })`:

- `lib/segmenter.ts` starts `segmenter.worker.ts`.
- `lib/kittenTtsEngine.ts` starts `kitten-tts.worker.ts`.

See [../lib/README.md](../lib/README.md).

## Interface

- [segmenter.worker.ts:self.onmessage] Receives
  [segmenter.worker.ts:SegmenterRequest] (`{ id, text, language }`). Replies with
  [segmenter.worker.ts:SegmenterResponse]: `{ id, ok: true, words }` or
  `{ id, ok: false, error }`. It uses `Intl.Segmenter(language, { granularity: "word" })` and
  keeps unique segments that are `isWordLike` and pass `isWordToken`
  (`src/shared/word-form.ts`).
- [kitten-tts.worker.ts:self.onmessage] Multi-engine TTS inference (Kitten nano 0.8 for
  English, Piper VITS es_MX for Spanish) on `onnxruntime-web/wasm`.
  - Request messages ([kitten-tts.worker.ts:WorkerRequest]): `INIT`, `SYNTHESIZE` and
    `CANCEL_EPOCH`. Each also has a lowercase alias.
  - Response messages ([kitten-tts.worker.ts:WorkerResponse]): `INIT_DONE`, `INIT_ERROR`,
    `SYNTHESIS_DONE` (`pcm`/`audioData`, `sampleRate`, `epoch`, `synthMs`) and
    `SYNTHESIS_ERROR`.
  - Other exports: [kitten-tts.worker.ts:TtsEngineKind] (`"kitten" | "piper"`),
    [kitten-tts.worker.ts:trimLeadingAndTrailingSilence],
    [kitten-tts.worker.ts:ORT_WASM_VERSION] (`"1.30.0"`),
    [kitten-tts.worker.ts:ORT_WASM_CDN_BASE], and a re-export of `normalizeEnglishText`.

## Invariants

- One ONNX `InferenceSession` at a time. [kitten-tts.worker.ts:ensureEngine] and the `INIT`
  handler release the other engine's session (`releaseSession`) before they create a new
  one.
- Epoch cancellation:
  - `CANCEL_EPOCH` sets `currentEpoch = msg.epoch` and removes queued jobs with an older
    epoch.
  - [kitten-tts.worker.ts:processNextJob] skips jobs with `epoch < currentEpoch` (old
    lookahead after a page change or stop).
- Priority queue ([kitten-tts.worker.ts:enqueueJob]):
  - A `high` job goes before the first `low` job.
  - A repeated `jobId` is not queued twice. If it comes back as `high`, the existing job is
    promoted to the front.
- Cached model check: [kitten-tts.worker.ts:createSessionFromCache] rejects a cached model
  smaller than `minBytes` (`10_000_000` for Kitten) as truncated.
- Threads ([kitten-tts.worker.ts:configureOrtWasmEnv]):
  - Without `crossOriginIsolated` and `SharedArrayBuffer`, it uses `numThreads = 1`.
  - Otherwise it uses `min(4, max(1, floor(hardwareConcurrency / 2)))`.
  - `proxy = false` in both cases.
- Default `SYNTHESIZE` values: engine `"kitten"`, voice `"expr-voice-2-f"`, speed `1`,
  priority `"high"`.
- Worker errors and unhandled rejections are reported as `INIT_ERROR` messages
  (`self.onerror` and `self.onunhandledrejection`).

## Side Effects

- CacheStorage reads: `caches.open(KITTEN_CACHE_NAME | PIPER_CACHE_NAME)` for the model and
  the Piper `.onnx.json` config. The worker never writes to the cache; the download and
  `cache.put` live in `../lib`.
- Network, in [kitten-tts.worker.ts:configureOrtWasmEnv]:
  - It sends `HEAD /assets/ort-wasm-simd-threaded.wasm` and `.mjs` requests.
  - If either is missing or served as HTML, it loads the ORT WASM runtime from the
    jsDelivr CDN instead (`ORT_WASM_CDN_BASE`, `cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0`).
- Network, Kitten `INIT` with no buffer and no cache hit: it calls
  `InferenceSession.create(url)` with `msg.modelUrl ?? KITTEN_MODEL_URL`.
- Transfers PCM `Float32Array` buffers to the main thread with `postMessage` and a transfer
  list.
- Uncommitted change on disk: `kitten-tts.worker.ts` includes the Piper engine path
  (`textToPiperIds`, `PIPER_MODEL_URL`, `PIPER_CONFIG_URL`).

## Verification

- Run: `pnpm test`. This directory has no test files of its own; the worker protocol is
  covered through `src/client/lib/kittenAudioEngine.test.ts` and `src/client/lib/tts.test.ts`.
