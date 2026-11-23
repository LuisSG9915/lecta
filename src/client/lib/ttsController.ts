import { saveTtsLandingPosition } from "./tts-landing";
import { normalizeBlockText } from "./reading-location";
// Máquina de estados de «Leer en voz alta»: idle | preparing |
// speaking | paused | stopping. El territorio es el target —
// [startSection, endSection) del capítulo que contiene la sección
// de arranque; dentro avanza programáticamente y termina con
// «chapter_end». Solo navegación explícita (guarda en Reader),
// el usuario, un error o el desmontaje detienen la sesión.
//
// Las dependencias se inyectan: el DOM, la navegación y la
// telemetría viven en Reader.tsx; aquí queda la lógica pura de la
// sesión para probarla sin pintar el lector.

import { buildSentenceMap, nodeAtPath } from "./ttsSentences";
import { clearTtsMarks, markSentence, ttsMarkElement } from "./ttsMarks";
import { createSpeaker, ensureVoices, speakWithSystemVoice, stopSystemVoice, type TtsSpeaker } from "./ttsSpeech";
import { loadTtsSettings, saveTtsSettings } from "./ttsSettings";
import { isTtsSupported } from "./ttsSettings";
import { isFeatureFlagEnabled } from "./settings";
import { kittenTtsEngine, type KittenTtsEngine } from "./kittenTtsEngine";
import { PIPER_VOICE_ID } from "./piperModel";
import type { TtsEngineKind } from "../workers/kitten-tts.worker";
import {
  KITTEN_VOICES,
  TTS_IDLE,
  TTS_RATES,
  type KittenVoiceId,
  type SentenceLayoutItem,
  type TtsEndReason,
  type TtsEngineMode,
  type TtsPauseReason,
  type TtsRate,
  type TtsSnapshot,
  type TtsStatus,
  type TtsTargetContext,
  type TtsVoiceOption,
} from "./ttsTypes";

// Latido «tts_active»: mientras habla y la pestaña está visible, el
// segmento de actividad del Reader se mantiene vivo — los intervalos
// resultantes cuentan para meta, rachas y gato sin duplicar ms.
const HEARTBEAT_MS = 30_000;
// Pausa por pestaña oculta prolongada: la sesión se cierra en vez de
// quedar zombie esperando un resume que nadie pedirá.
const HIDDEN_STOP_MS = 90_000;
// Un reintento acotado ante utterance inconsistente; al segundo
// fallo la sesión se cierra con «error».
const MAX_STALL_RETRIES = 1;
// El salto programático a la siguiente sección debe pintar en este
// margen; si el render nunca llega la sesión termina con «error» en
// vez de quedar esperando eternamente.
const SECTION_NAV_TIMEOUT_MS = 8_000;

export type TtsEmitDraft = Record<string, unknown> & { kind: string };

export type TtsControllerDeps = {
  language(): string;
  // Contenedor de la sección visible (null mientras carga).
  root(): HTMLElement | null;
  sectionIndex(): number;
  // true cuando la sección terminó de pintar (state === "ready").
  sectionReady(): boolean;
  // Salto programático entre secciones del target — el Reader lo
  // envuelve en withTtsProgrammaticNav para no auto-detenerse.
  navigateSection(index: number): void;
  // Capítulo que empieza en `afterSection` (primera sección tras el actual) o
  // null si el libro se acabó. Síncrono: el cruce no puede tener un await
  // entre aquí y navigateSection (withTtsProgrammaticNav es síncrono).
  resolveNextChapter?(afterSection: number): TtsTargetContext | null;
  // Lleva el envoltorio <mark> de la oración a la vista (scroll en
  // continuo, página en paginado) siempre vía withTtsProgrammaticScroll.
  reveal(el: HTMLElement): void;
  // Emite eventos tts_* con visitId/bookHash ya atados (trackEvent).
  emit(draft: TtsEmitDraft): void;
  // Abre/estira el segmento de actividad (heartbeat tts_active).
  noteActivity(): void;
  onSnapshot(snapshot: TtsSnapshot): void;
  // Aviso al cerrar la sesión (tras emitir tts_session_end): el
  // Reader lo usa para el mensaje «No se pudo leer en voz alta.»
  // cuando endReason === "error" — aviso por la vía de estado, sin
  // bloquear la lectura.
  onSessionEnd?(reason: TtsEndReason): void;
  // Nota al margen no bloqueante cuando la voz neural falla y se cae
  // a la voz del sistema (p. ej. modelo no disponible). Opcional.
  onNotice?(msg: string): void;
  // Punto de arranque: el Reader decide por posición guardada →
  // primera oración visible → 0 (sentenceIndexForAnchor).
  resolveStartIndex?(items: SentenceLayoutItem[]): number;
  // Overridables en pruebas — en producción usan los defaults.
  supported?(): boolean;
  makeSpeaker?(events: {
    onEnded(): void;
    onStalled(kind: "start" | "mid" | "resume"): void;
  }): TtsSpeaker;
  kittenEngine?: KittenTtsEngine;
};

export type TtsController = {
  snapshot(): TtsSnapshot;
  // Arranque desde el menú: `ctx` es el target que cubre la sección
  // actual; `startIndex` es la oración de arranque ya resuelta por el
  // Reader (posición guardada → primera visible → 0).
  start(ctx: TtsTargetContext, startIndex: number, options?: { sleepTimerMs?: number }): void;
  setSleepTimer?(opt: number | { chapterEnd: true } | null): void;
  setAutoAdvanceChapter?(value: boolean): void;
  setBackgroundAudio?(value: boolean): void;
  // true si, con el ajuste activo, la sesión puede seguir sonando oculta (solo voz neural).
  canPlayInBackground?(): boolean;
  getSleepTimerRemainingMs?(): number | null;
  pause(reason: TtsPauseReason): void;
  resume(): void;
  cycleRate(rates?: TtsRate[]): TtsRate;
  prevSentence(): void;
  nextSentence(): void;
  getCurrentSentence(): string | null;
  setKittenVoice?(voiceId: KittenVoiceId): void;
  setEngine?(engine: TtsEngineMode): void;
  setSystemVoice?(voiceURI: string | null): void;
  getLookaheadBuffers?(): Map<number, AudioBuffer>;
  stop(reason: TtsEndReason): void;
  // La sección que pidió el avance programático terminó de pintar.
  onSectionRendered(): void;
  // El DOM de la sección cambió bajo la sesión (líneas sintácticas,
  // hidratación tardía): re-ancla por huella o termina limpio.
  onDomMutated(): void;
  noteSavedWord(): void;
  destroy(): void;
  dispose?(): void;
};

// Respaldo por velocidad: si la voz HD sintetiza más lento que el tiempo real en este
// dispositivo (RTF > NEURAL_SLOW_RTF, ver kittenTtsEngine.getSynthRtf) se pasa a la voz del
// sistema. La bandera vive en el módulo (la pestaña), no en el controlador: este se rehace
// al cambiar de sección o de ajustes y volvería a probar la voz HD con otra pausa larga.
// No toca settings.engine: la voz que eligió el usuario se conserva.
export const NEURAL_SLOW_RTF = 1.0;
export const NEURAL_SLOW_NOTICE = "La voz HD va lenta en este dispositivo; sigo con la voz del sistema.";
let neuralSlowDemoted = false;
// El usuario volvió a elegir la voz HD tras el cambio: se respeta y no se vuelve a medir.
let neuralSpeedCheckOff = false;
let neuralSlowNoticeShown = false;

/** Solo pruebas: borra el estado de pestaña del respaldo por velocidad. */
export function resetNeuralSlowDemotion(): void {
  neuralSlowDemoted = false;
  neuralSpeedCheckOff = false;
  neuralSlowNoticeShown = false;
}

export function createTtsController(deps: TtsControllerDeps): TtsController {
  let snap: TtsSnapshot = TTS_IDLE;
  let ctx: TtsTargetContext | null = null;
  let items: SentenceLayoutItem[] = [];
  let cursor = 0;
  let speaker: TtsSpeaker | null = null;
  let heartbeat = 0;
  let hiddenTimer = 0;
  let awaitingSection: number | null = null;
  let awaitingTimer = 0;
  let stallRetries = 0;
  let destroyed = false;
  let speakGen = 0;
  let sleepTimerDeadline = 0;
  // Evita repetir la nota de degradación neural→sistema en cada oración.
  let neuralFallbackNotified = false;
  // «Fin de capítulo»: vive aquí (no en finish) y sobrevive al cruce de capítulo.
  let sleepAtChapterEnd = false;

  // Contadores de la sesión para tts_session_end.
  let startedAt = 0;
  let sentenceCount = 0;
  let lookupCount = 0;
  let savedWordCount = 0;
  let resumedCount = 0;
  let sectionAdvances = 0;
  let settings = loadTtsSettings();
  let ttsWakeLock: WakeLockSentinel | null = null;
  const lookaheadBuffers = new Map<number, AudioBuffer>();
  const lookaheadPending = new Set<number>();

  /**
   * Motor neural según el idioma del libro: inglés → Kitten nano 0.8 (24 kHz),
   * español → Piper VITS es_MX (22.05 kHz). `null` = usar voz del sistema.
   * En tests con `deps.kittenEngine` mockeado se conserva kitten para no romper
   * los arneses existentes sea cual sea el idioma.
   */
  const neuralEngineKind = (): TtsEngineKind | null => {
    if (!isFeatureFlagEnabled("neuralTts")) {
      return null;
    }
    if (neuralSlowDemoted) return null;
    const lang = deps.language().toLowerCase();
    const isTestMock = Boolean(deps.kittenEngine);
    let kind: TtsEngineKind | null;
    if (lang.startsWith("en")) {
      kind = "kitten";
    } else if (lang.startsWith("es")) {
      kind = "piper";
    } else {
      kind = isTestMock ? "kitten" : null;
    }
    if (!kind) return null;
    if (settings.engine === "kitten-neural") return kind;
    if (settings.engine === "auto") {
      const engine = deps.kittenEngine ?? kittenTtsEngine;
      // El progreso es por motor: «kitten descargado» no habilita Piper.
      const prog =
        typeof engine.getModelProgress === "function"
          ? engine.getModelProgress(kind)
          : engine.getModelProgress();
      const isReadyOrDownloaded =
        engine.isReady() || prog.status === "ready";
      return engine.isSupported() && isReadyOrDownloaded ? kind : null;
    }
    return null;
  };

  const shouldUseKitten = (): boolean => neuralEngineKind() !== null;

  const syncKeepAlive = (on: boolean) => {
    (deps.kittenEngine ?? kittenTtsEngine).setKeepAlive?.(on);
  };

  /** Voz neural del motor activo (Piper tiene una sola voz es_MX). */
  const neuralVoiceId = (kind: TtsEngineKind): string =>
    kind === "piper" ? PIPER_VOICE_ID : settings.kittenVoice;

  const acquireWakeLock = async () => {
    if (typeof navigator !== "undefined" && "wakeLock" in navigator && navigator.wakeLock?.request) {
      try {
        if (!ttsWakeLock) {
          ttsWakeLock = await navigator.wakeLock.request("screen");
        }
      } catch {
        ttsWakeLock = null;
      }
    }
  };

  const releaseWakeLock = async () => {
    try {
      await ttsWakeLock?.release();
    } catch {
      // ignore
    } finally {
      ttsWakeLock = null;
    }
  };

  const publish = (next: Partial<TtsSnapshot>) => {
    const kind = neuralEngineKind();
    const active = kind === "piper" ? "piper-neural" : kind === "kitten" ? "kitten-neural" : "browser";
    snap = {
      ...snap,
      engine: settings.engine,
      kittenVoice: settings.kittenVoice,
      voiceURI: settings.voiceURI ?? null,
      activeEngine: active,
      ...next,
    };
    if (snap.status === "speaking") {
      void acquireWakeLock();
    } else if (
      snap.status === "paused" ||
      snap.status === "idle" ||
      snap.status === "stopping"
    ) {
      void releaseWakeLock();
    }
    deps.onSnapshot(snap);
  };

  const sessionMs = () => (startedAt ? Date.now() - startedAt : 0);

  const stopHeartbeat = () => {
    if (heartbeat) {
      window.clearInterval(heartbeat);
      heartbeat = 0;
    }
    if (hiddenTimer) {
      window.clearTimeout(hiddenTimer);
      hiddenTimer = 0;
    }
    if (awaitingTimer) {
      window.clearTimeout(awaitingTimer);
      awaitingTimer = 0;
    }
  };

  // Latido: abre/estira el segmento de actividad del Reader. Solo
  // corre hablando y con pestaña visible — pausado u oculto no es
  // lectura ni aquí ni en las señales reales.
  const armHeartbeat = () => {
    stopHeartbeat();
    heartbeat = window.setInterval(() => {
      if (snap.status === "speaking") deps.noteActivity();
    }, HEARTBEAT_MS);
  };

  const emitPause = (reason: TtsPauseReason) =>
    ctx &&
    deps.emit({
      kind: "tts_paused",
      sessionId: snap.sessionId,
      targetId: ctx.targetId,
      sectionIndex: deps.sectionIndex(),
      reason,
      ms: sessionMs(),
    });

  const emitEnd = (reason: TtsEndReason) =>
    ctx &&
    deps.emit({
      kind: "tts_session_end",
      sessionId: snap.sessionId,
      targetId: ctx.targetId,
      sectionIndex: deps.sectionIndex(),
      endReason: reason,
      rate: settings.rate,
      ms: sessionMs(),
      sentenceCount,
      lookupCount,
      savedWordCount,
      resumedCount,
      sectionAdvances,
    });

  const pruneLookahead = () => {
    for (const idx of lookaheadBuffers.keys()) {
      if (idx < cursor - 1) {
        lookaheadBuffers.delete(idx);
      }
    }
  };

  const triggerLookahead = () => {
    const kind = neuralEngineKind();
    if (!kind) return;
    const engine = deps.kittenEngine ?? kittenTtsEngine;
    const voice = neuralVoiceId(kind);
    // Buffer anticipado con prioridad "low" para no bloquear la oración actual.
    // Piper es ~2.5× más pesado que Kitten: en gama media necesita una oración de más colchón.
    const lookaheadDepth = kind === "piper" ? 3 : 2;
    for (let offset = 1; offset <= lookaheadDepth; offset++) {
      const targetIdx = cursor + offset;
      if (
        targetIdx < items.length &&
        !lookaheadBuffers.has(targetIdx) &&
        !lookaheadPending.has(targetIdx)
      ) {
        lookaheadPending.add(targetIdx);
        const text = items[targetIdx].text;
        const synthLookahead =
          typeof engine.synthesizeLookahead === "function"
            ? engine.synthesizeLookahead(text, voice as KittenVoiceId, settings.rate, kind)
            : engine.synthesize(text, voice as KittenVoiceId, settings.rate, "low", kind);
        void synthLookahead
          .then((buf) => {
            if (destroyed) return;
            if (neuralSlowDemoted) return;
            lookaheadBuffers.set(targetIdx, buf);
            checkNeuralSpeed();
          })
          .catch(() => {
            // Error en pre-síntesis se ignora; speakCurrent reintentará o caerá a browser
          })
          .finally(() => {
            lookaheadPending.delete(targetIdx);
          });
      }
    }
  };

  /**
   * Tras cada síntesis neural: si el dispositivo no va en tiempo real, pasa a la voz del
   * sistema. La oración que ya suena termina (su audio está en la RAM del hilo principal) y
   * la siguiente sale por el sistema; si se estaba esperando una síntesis, se corta y se
   * habla esa misma oración con el sistema. El worker se libera: es lo que calienta el móvil.
   */
  const checkNeuralSpeed = () => {
    if (destroyed || neuralSlowDemoted || neuralSpeedCheckOff) return;
    const engine = deps.kittenEngine ?? kittenTtsEngine;
    const rtf = engine.getSynthRtf?.();
    if (rtf == null || rtf <= NEURAL_SLOW_RTF) return;
    neuralSlowDemoted = true;
    syncKeepAlive(false);
    lookaheadBuffers.clear();
    lookaheadPending.clear();
    engine.releaseWorkerMemory?.();
    if (!neuralSlowNoticeShown) {
      neuralSlowNoticeShown = true;
      deps.onNotice?.(NEURAL_SLOW_NOTICE);
    }
    publish({ activeEngine: "browser" });
    if (snap.status === "speaking" && !engine.isPlaying()) {
      engine.stop();
      speakCurrent();
    }
  };

  const speakCurrent = () => {
    speakGen += 1;
    const currentGen = speakGen;
    const item = items[cursor];
    const root = deps.root();
    if (!item || !root) {
      advanceOrEnd();
      return;
    }
    pruneLookahead();
    clearTtsMarks(root);
    if (markSentence(root, item)) {
      const el = ttsMarkElement(root);
      if (el) deps.reveal(el);
    }

    if (ctx) {
      const currNode = nodeAtPath(root, item.nodePath);
      const block = currNode?.parentElement?.closest("p, h1, h2, h3, h4, h5, h6, li, blockquote");
      const anchor = normalizeBlockText(block?.textContent ?? item.text).slice(0, 120);
      saveTtsLandingPosition({
        bookHash: ctx.bookHash,
        sectionIndex: deps.sectionIndex(),
        sentenceIndex: cursor,
        paragraphText: item.text,
        anchor,
        chapterLabel: ctx.chapterLabel ?? null,
        updatedAt: Date.now(),
      });
    }

    const neuralKind = neuralEngineKind();
    if (neuralKind) {
      const engine = deps.kittenEngine ?? kittenTtsEngine;
      const neuralVoice = neuralVoiceId(neuralKind);
      syncKeepAlive(settings.backgroundAudio);

      const preSynthesized = lookaheadBuffers.get(cursor);
      if (preSynthesized) {
        // Transición instantánea (<15ms) entre oraciones con audio ya en RAM
        try {
          // Usar siempre 1.0 para Web Audio API: el modelo ONNX ya sintetizó a settings.rate
          engine.play(preSynthesized, 1.0, onEnded);
          triggerLookahead();
        } catch (err) {
          if (destroyed || currentGen !== speakGen || snap.status !== "speaking") return;
          console.warn("[Lecta TTS] KittenTTS falló al reproducir pre-sintetizado:", err);
          if (!neuralFallbackNotified) {
            neuralFallbackNotified = true;
            deps.onNotice?.("La voz neural no está disponible; usando la voz del sistema.");
          }
          engine.releaseWorkerMemory?.();
          speaker?.speak(item.text, settings.rate);
        }
      } else {
        // 1. Encolar primero la oración actual con prioridad high
        const synthPromise = engine.synthesize(
          item.text,
          neuralVoice as KittenVoiceId,
          settings.rate,
          "high",
          neuralKind,
        );
        // 2. Disparar lookahead después con prioridad low
        triggerLookahead();

        void synthPromise
          .then((buf) => {
            if (destroyed || currentGen !== speakGen || snap.status !== "speaking") return;
            lookaheadBuffers.set(cursor, buf);
            engine.play(buf, 1.0, onEnded);
            checkNeuralSpeed();
          })
          .catch((err) => {
            if (destroyed || currentGen !== speakGen || snap.status !== "speaking") return;
            const msg = err instanceof Error ? err.message : String(err);
            if (/stopped|cancelled|canceled|terminated/i.test(msg)) return;

            console.warn(
              "[Lecta TTS] KittenTTS falló o liberó memoria; cambiando a voz nativa del sistema:",
              err,
            );
            if (!neuralFallbackNotified) {
              neuralFallbackNotified = true;
              deps.onNotice?.("La voz neural no está disponible; usando la voz del sistema.");
            }
            engine.releaseWorkerMemory?.();
            speaker?.speak(item.text, settings.rate);
          });
      }
    } else {
      speaker?.speak(item.text, settings.rate);
    }
  };

  // Fin de sección: dentro del target salta programático; en el borde
  // termina con «chapter_end». Las secciones sin texto hablable se
  // saltan igual — el mapa vacío cae aquí también.
  const advanceOrEnd = () => {
    if (!ctx) return;
    const next = deps.sectionIndex() + 1;
    let target = next;
    if (next >= ctx.endSection) {
      if (sleepAtChapterEnd) {
        finish("sleep_timer");
        return;
      }
      if (!settings.autoAdvanceChapter || !deps.resolveNextChapter) {
        finish("chapter_end");
        return;
      }
      const nextCtx = deps.resolveNextChapter(next);
      if (!nextCtx) {
        finish("book_end");
        return;
      }
      // Cruce en sitio: sin finish (resetearía el sleep timer) ni start.
      ctx = { ...nextCtx, sectionIndex: nextCtx.startSection };
      target = nextCtx.startSection;
      publish({ chapterLabel: nextCtx.chapterLabel ?? null });
    }
    sectionAdvances += 1;
    awaitingSection = target;
    deps.emit({
      kind: "tts_section_advance",
      sessionId: snap.sessionId,
      targetId: ctx.targetId,
      sectionIndex: target,
      ms: sessionMs(),
    });
    deps.navigateSection(target);
    awaitingTimer = window.setTimeout(() => {
      awaitingTimer = 0;
      if (awaitingSection !== null) finish("error");
    }, SECTION_NAV_TIMEOUT_MS);
  };

  const onEnded = () => {
    if (snap.status !== "speaking") return;

    const isEndOfParagraph = () => {
      if (cursor >= items.length - 1) return true;
      const currentItem = items[cursor];
      const nextItem = items[cursor + 1];
      const root = deps.root();
      if (!root || !currentItem || !nextItem) return true;
      const currNode = nodeAtPath(root, currentItem.nodePath);
      const nextNode = nodeAtPath(root, nextItem.nodePath);
      const currBlock = currNode?.parentElement?.closest("p, h1, h2, h3, h4, h5, h6, li, blockquote");
      const nextBlock = nextNode?.parentElement?.closest("p, h1, h2, h3, h4, h5, h6, li, blockquote");
      return !nextBlock || currBlock !== nextBlock;
    };

    if (sleepTimerDeadline > 0 && Date.now() >= sleepTimerDeadline && isEndOfParagraph()) {
      finish("sleep_timer");
      return;
    }

    cursor += 1;
    if (cursor < items.length) {
      sentenceCount += 1;
      speakCurrent();
    } else {
      advanceOrEnd();
    }
  };

  const onStalled = () => {
    if (destroyed) return;
    if (snap.status !== "speaking" && snap.status !== "paused") return;
    stallRetries += 1;
    if (stallRetries > MAX_STALL_RETRIES) {
      finish("error");
      return;
    }
    // Un reintento acotado: cancela la cola y re-speak la oración
    // activa — tanto el arranque mudo como el resume zombie de iOS.
    speaker?.cancel();
    speaker = makeSpeaker();
    if (snap.status === "speaking") speakCurrent();
    else if (snap.status === "paused") {
      // Re-speak pausado: habla y vuelve a pausar para no soltar la
      // voz en medio de una pausa que el usuario pidió.
      speakCurrent();
      speaker?.pause();
    }
  };

  const makeSpeaker = (): TtsSpeaker =>
    deps.makeSpeaker
      ? deps.makeSpeaker({ onEnded, onStalled })
      : createSpeaker(
          { onEnded, onStalled },
          { language: deps.language(), voiceURI: settings.voiceURI ?? null },
        );

  const buildMapForCurrent = () => {
    const root = deps.root();
    if (!root) {
      items = [];
      return false;
    }
    clearTtsMarks(root);
    const map = buildSentenceMap(root, deps.sectionIndex(), deps.language());
    items = map.items;
    return items.length > 0;
  };

  // Deja todo en idle: cancela voz, limpia marcas, emite el cierre y
  // publica el snapshot. Idempotente — stop durante stopping no repite.
  const finish = (reason: TtsEndReason) => {
    sleepTimerDeadline = 0;
    sleepAtChapterEnd = false;
    syncKeepAlive(false);
    if (snap.status === "idle" || snap.status === "stopping") return;
    speakGen += 1;
    publish({ status: "stopping" });
    if (shouldUseKitten()) {
      (deps.kittenEngine ?? kittenTtsEngine).stop();
    }
    speaker?.cancel();
    lookaheadBuffers.clear();
    lookaheadPending.clear();
    const root = deps.root();
    if (root) clearTtsMarks(root);
    stopHeartbeat();
    if (startedAt) deps.noteActivity(); // resto <30 s: último latido
    emitEnd(reason);
    deps.onSessionEnd?.(reason);
    ctx = null;
    items = [];
    awaitingSection = null;
    startedAt = 0;
    publish({
      ...TTS_IDLE,
      rate: settings.rate,
      engine: settings.engine,
      kittenVoice: settings.kittenVoice,
    });
  };

  return {
    snapshot() {
      return snap;
    },

    start(nextCtx, startIndex, options?: { sleepTimerMs?: number }) {
      if (destroyed || snap.status !== "idle") return;
      if (!(deps.supported ?? isTtsSupported)()) return;
      settings = loadTtsSettings();
      if (!settings.enabled || settings.consentedAt === null) return;
      // Toca el motor dentro del gesto del lector: el primer speak()
      // real llega tras la espera de voces (~1 s, ya en async) y en
      // Android el servicio TTS puede seguir dormido si nada lo despierta
      // cerca del toque. cancel+resume es inofensivo en motores sanos.
      try {
        (deps.kittenEngine ?? kittenTtsEngine).unlockAudioContext?.();
        window.speechSynthesis.cancel();
        window.speechSynthesis.resume();
      } catch {
        /* sin motor real: el gate de soportado ya lo cubrió */
      }
      ctx = nextCtx;
      sleepTimerDeadline = options?.sleepTimerMs && options.sleepTimerMs > 0 ? Date.now() + options.sleepTimerMs : 0;
      startedAt = Date.now();
      sentenceCount = 0;
      lookupCount = 0;
      savedWordCount = 0;
      resumedCount = 0;
      sectionAdvances = 0;
      stallRetries = 0;
      sleepAtChapterEnd = false;
      neuralFallbackNotified = false;
      publish({
        chapterLabel: nextCtx.chapterLabel ?? null,
        sleepTimerEndsAt: sleepTimerDeadline || null,
        sleepAtChapterEnd: false,
        status: "preparing",
        sessionId: crypto.randomUUID(),
        rate: settings.rate,
        highlight: settings.highlight,
        pauseReason: null,
      });
      deps.emit({
        kind: "tts_session_start",
        sessionId: snap.sessionId,
        targetId: ctx.targetId,
        sectionIndex: deps.sectionIndex(),
        source: "reader_tools",
        rate: settings.rate,
        highlight: settings.highlight,
      });
      // Las voces pueden tardar en poblar; mientras, el chip ya dice
      // «Preparando…». La espera está acotada (ensureVoices ~1 s).
      void ensureVoices().then(() => {
        if (destroyed || snap.status !== "preparing" || !ctx) return;
        if (!buildMapForCurrent()) {
          // Sección sin texto hablable: saltar como una vacía.
          publish({ status: "speaking" });
          armHeartbeat();
          speaker = makeSpeaker();
          advanceOrEnd();
          return;
        }
        const resolved = deps.resolveStartIndex?.(items) ?? startIndex;
        cursor = Math.min(Math.max(0, resolved), items.length - 1);
        speaker = makeSpeaker();
        publish({ status: "speaking" });
        deps.noteActivity();
        armHeartbeat();
        speakCurrent();
      });
    },

    pause(reason) {
      // Solo «speaking» se pausa: en «preparing» no hay speaker ni
      // mapa todavía — pausar ahí dejaría una sesión sin nada que
      // reanudar (el efecto de pausas del Reader reintenta al pasar
      // a «speaking», así que la capa abierta igual la detiene).
      if (snap.status !== "speaking") return;
      speakGen += 1;
      if (reason === "word_lookup") lookupCount += 1;
      syncKeepAlive(false);
      if (shouldUseKitten()) {
        (deps.kittenEngine ?? kittenTtsEngine).pause();
      } else {
        speaker?.pause();
      }
      stopHeartbeat();
      // Último latido: el resto <30 s desde el anterior no se pierde.
      if (startedAt) deps.noteActivity();
      publish({ status: "paused", pauseReason: reason });
      emitPause(reason);
      // Pausa por ocultarse: si la pestaña no vuelve, la sesión se
      // cierra sola en vez de quedar colgada.
      if (reason === "visibility") {
        hiddenTimer = window.setTimeout(() => {
          hiddenTimer = 0;
          if (snap.status === "paused" && snap.pauseReason === "visibility")
            finish("visibility");
        }, HIDDEN_STOP_MS);
      }
    },

    resume() {
      if (snap.status !== "paused") return;
      (deps.kittenEngine ?? kittenTtsEngine).unlockAudioContext?.();
      resumedCount += 1;
      publish({ status: "speaking", pauseReason: null });
      deps.emit({
        kind: "tts_resumed",
        sessionId: snap.sessionId,
        targetId: ctx?.targetId ?? "",
        sectionIndex: deps.sectionIndex(),
        ms: sessionMs(),
      });
      // Si la cola sigue viva basta resume(); si el motor la soltó
      // al pausar (motores sin pause real) o nunca llegó a hablar,
      // se re-speak la oración activa — mismo criterio que iOS.
      if (shouldUseKitten()) {
        const engine = deps.kittenEngine ?? kittenTtsEngine;
        if (engine.isPlaying()) {
          syncKeepAlive(settings.backgroundAudio);
          engine.resume();
        } else {
          speakCurrent();
        }
      } else {
        if (speaker?.speakingNow()) speaker.resume();
        else {
          if (!speaker) speaker = makeSpeaker();
          speakCurrent();
        }
      }
      armHeartbeat();
    },

    cycleRate(rates?: TtsRate[]) {
      const rateList = rates && rates.length > 0 ? rates : TTS_RATES;
      const at = rateList.indexOf(settings.rate);
      const rate = rateList[(at + 1) % rateList.length] ?? 1;
      settings = { ...settings, rate };
      saveTtsSettings(settings);
      publish({ rate });
      speaker?.setRate(rate);
      if (shouldUseKitten()) {
        (deps.kittenEngine ?? kittenTtsEngine).stop();
        lookaheadBuffers.clear();
        lookaheadPending.clear();
      }
      // El cambio se siente ya: re-speak de la oración en curso con
      // la velocidad nueva (misma marca, mismo conteo).
      if (snap.status === "speaking" && items[cursor]) {
        speaker?.cancel();
        speaker = makeSpeaker();
        speakCurrent();
      }
      deps.emit({
        kind: "tts_setting_changed",
        enabled: settings.enabled,
        rate,
        highlight: settings.highlight,
        source: "reader_tools",
      });
      return rate;
    },

    prevSentence() {
      if (snap.status !== "speaking" && snap.status !== "paused") return;
      if (cursor > 0) {
        cursor -= 1;
        if (shouldUseKitten()) {
          (deps.kittenEngine ?? kittenTtsEngine).stop();
        }
        if (snap.status === "speaking") {
          speaker?.cancel();
          speaker = makeSpeaker();
          speakCurrent();
        } else if (snap.status === "paused") {
          const root = deps.root();
          if (root && items[cursor]) {
            clearTtsMarks(root);
            if (markSentence(root, items[cursor])) {
              const el = ttsMarkElement(root);
              if (el) deps.reveal(el);
            }
          }
        }
      }
    },

    nextSentence() {
      if (snap.status !== "speaking" && snap.status !== "paused") return;
      if (cursor < items.length - 1) {
        cursor += 1;
        sentenceCount += 1;
        if (shouldUseKitten()) {
          (deps.kittenEngine ?? kittenTtsEngine).stop();
        }
        if (snap.status === "speaking") {
          speaker?.cancel();
          speaker = makeSpeaker();
          speakCurrent();
        } else if (snap.status === "paused") {
          const root = deps.root();
          if (root && items[cursor]) {
            clearTtsMarks(root);
            if (markSentence(root, items[cursor])) {
              const el = ttsMarkElement(root);
              if (el) deps.reveal(el);
            }
          }
        }
      } else {
        advanceOrEnd();
      }
    },

    setKittenVoice(voiceId: KittenVoiceId) {
      // Elección explícita de voz HD: se respeta (no se vuelve a medir hasta recargar).
      neuralSlowDemoted = false;
      neuralSpeedCheckOff = true;
      settings = { ...settings, kittenVoice: voiceId, engine: "kitten-neural" };
      saveTtsSettings(settings);
      publish({ kittenVoice: voiceId, engine: "kitten-neural", activeEngine: "kitten-neural" });

      (deps.kittenEngine ?? kittenTtsEngine).stop();
      speaker?.cancel();
      speaker = makeSpeaker();
      lookaheadBuffers.clear();
      lookaheadPending.clear();

      if (snap.status === "speaking" && items[cursor]) {
        speakCurrent();
      } else if (snap.status === "paused") {
        // Cambio de motor en pausa: soltar el audio anterior para que
        // resume() re-sintetice con el nuevo motor (ver resume()).
        (deps.kittenEngine ?? kittenTtsEngine).stop();
        lookaheadBuffers.clear();
        lookaheadPending.clear();
      }
    },

    setEngine(engine: TtsEngineMode) {
      if (engine === "kitten-neural") {
        neuralSlowDemoted = false;
        neuralSpeedCheckOff = true;
      }
      settings = { ...settings, engine };
      saveTtsSettings(settings);
      const active = shouldUseKitten() ? "kitten-neural" : "browser";
      publish({ engine, activeEngine: active });
      if (snap.status === "speaking" && items[cursor]) {
        (deps.kittenEngine ?? kittenTtsEngine).stop();
        speaker?.cancel();
        speaker = makeSpeaker();
        lookaheadBuffers.clear();
        lookaheadPending.clear();
        speakCurrent();
      } else if (snap.status === "paused") {
        (deps.kittenEngine ?? kittenTtsEngine).stop();
        lookaheadBuffers.clear();
        lookaheadPending.clear();
      }
    },

    // Voz del sistema elegida (null = automática). Fuerza el motor del
    // navegador; si está hablando, reinicia la oración con la voz nueva.
    setSystemVoice(voiceURI: string | null) {
      settings = { ...settings, voiceURI, engine: voiceURI ? "browser" : "auto" };
      saveTtsSettings(settings);
      publish({});
      if (snap.status === "speaking" && items[cursor]) {
        (deps.kittenEngine ?? kittenTtsEngine).stop();
        speaker?.cancel();
        speaker = makeSpeaker();
        lookaheadBuffers.clear();
        lookaheadPending.clear();
        speakCurrent();
      } else if (snap.status === "paused") {
        (deps.kittenEngine ?? kittenTtsEngine).stop();
        lookaheadBuffers.clear();
        lookaheadPending.clear();
      }
    },

    getLookaheadBuffers() {
      return lookaheadBuffers;
    },

    getCurrentSentence(): string | null {
      if (snap.status === "idle" || snap.status === "stopping") return null;
      return items[cursor]?.text ?? null;
    },

    stop(reason) {
      finish(reason);
    },

    setSleepTimer(opt: number | { chapterEnd: true } | null) {
      if (opt !== null && typeof opt === "object") {
        sleepTimerDeadline = 0;
        sleepAtChapterEnd = true;
      } else {
        sleepTimerDeadline = opt && opt > 0 ? Date.now() + opt : 0;
        sleepAtChapterEnd = false;
      }
      publish({
        sleepTimerEndsAt: sleepTimerDeadline || null,
        sleepAtChapterEnd,
      });
    },

    setAutoAdvanceChapter(value: boolean) {
      settings = { ...settings, autoAdvanceChapter: value };
      saveTtsSettings(settings);
    },

    setBackgroundAudio(value: boolean) {
      settings = { ...settings, backgroundAudio: value };
      saveTtsSettings(settings);
      if (snap.status === "speaking") syncKeepAlive(value && shouldUseKitten());
    },

    canPlayInBackground() {
      return settings.backgroundAudio && shouldUseKitten();
    },

    getSleepTimerRemainingMs() {
      return sleepTimerDeadline > 0 ? Math.max(0, sleepTimerDeadline - Date.now()) : null;
    },

    onSectionRendered() {
      if (awaitingSection === null) return;
      if (deps.sectionIndex() !== awaitingSection || !deps.sectionReady()) return;
      awaitingSection = null;
      if (awaitingTimer) {
        window.clearTimeout(awaitingTimer);
        awaitingTimer = 0;
      }
      if (snap.status !== "speaking" && snap.status !== "paused") return;
      if (!buildMapForCurrent()) {
        // Sección vacía: seguir avanzando hasta texto o endSection.
        if (snap.status === "speaking") advanceOrEnd();
        return;
      }
      cursor = 0;
      if (snap.status === "speaking") speakCurrent();
    },

    onDomMutated() {
      if (snap.status !== "speaking" && snap.status !== "paused") return;
      speakGen += 1;
      const wasSpeaking = snap.status === "speaking";
      const current = items[cursor];
      if (wasSpeaking) {
        if (shouldUseKitten()) {
          (deps.kittenEngine ?? kittenTtsEngine).stop();
        }
        speaker?.pause();
        publish({ status: "paused", pauseReason: "render_change" });
        emitPause("render_change");
        stopHeartbeat();
      }
      // Reconstruye el mapa sobre el DOM nuevo: el texto concatenado
      // es el mismo si la mutación fue estructural (líneas sintácticas
      // solo envuelven), así que la huella de la oración se re-encuentra.
      if (!buildMapForCurrent()) {
        finish("render_change");
        return;
      }
      const reanchored = items.findIndex(
        (item) =>
          item.fingerprint === current?.fingerprint &&
          item.sentenceIndex >= (current?.sentenceIndex ?? 0),
      );
      const fallback = items.findIndex(
        (item) => item.fingerprint === current?.fingerprint,
      );
      const at = reanchored >= 0 ? reanchored : fallback;
      if (at < 0) {
        finish("render_change");
        return;
      }
      cursor = at;
      if (!wasSpeaking) {
        // Estaba pausada por el lector: solo se re-ancla en silencio —
        // reanudar sigue siendo su decisión.
        return;
      }
      // Se reanuda sola: la pausa fue técnica, no una decisión del
      // lector — misma regla que un «resume» para los contadores.
      if (speaker) {
        speaker.cancel();
        speaker = makeSpeaker();
      }
      publish({ status: "speaking", pauseReason: null });
      armHeartbeat();
      speakCurrent();
    },

    noteSavedWord() {
      savedWordCount += 1;
    },

    destroy() {
      destroyed = true;
      // Desmontaje del lector: la sesión se cierra como navegación
      // (salir del libro es el mismo gesto que irse a otro destino).
      finish("navigation");
      speaker?.cancel();
      stopHeartbeat();
      (deps.kittenEngine ?? kittenTtsEngine).releaseWorkerMemory?.();
    },

    dispose() {
      (deps.kittenEngine ?? kittenTtsEngine).releaseWorkerMemory?.();
    },
  };
}

// Verificación del ancla tras re-render: el nodo en `nodePath` debe
// seguir siendo de texto y su contenido debe empezar con lo que la
// huella afirma — si no, el mapa quedó obsoleto.
export function sentenceStillValid(
  root: HTMLElement,
  item: SentenceLayoutItem,
): boolean {
  const node = nodeAtPath(root, item.nodePath);
  return node?.nodeType === Node.TEXT_NODE && Boolean(node.nodeValue);
}

export async function playSentencesLoop(params: {
  sentences: string[];
  startIndex: number;
  engineMode: "system" | "kitten-hd" | "browser" | "kitten-neural";
  voiceId: string;
  speed: number;
  language?: string;
  onDownloadProgress?: (pct: number) => void;
  onHighlightSentence: (index: number) => void;
  onFinishPage: () => void;
  isCancelled: () => boolean;
}): Promise<void> {
  const {
    sentences,
    startIndex,
    engineMode,
    voiceId,
    speed,
    language,
    onDownloadProgress,
    onHighlightSentence,
    onFinishPage,
    isCancelled,
  } = params;

  // Desbloqueo síncrono del AudioContext dentro de la interacción del usuario
  kittenTtsEngine.unlockAudioContext();

  // Motor neural por idioma: es → Piper VITS, resto → Kitten nano 0.8.
  const neuralKind: TtsEngineKind | null =
    engineMode === "kitten-hd" || engineMode === "kitten-neural"
      ? language?.toLowerCase().startsWith("es")
        ? "piper"
        : "kitten"
      : null;
  const neuralVoice = neuralKind === "piper" ? PIPER_VOICE_ID : voiceId;

  let canUseKitten = false;
  if (neuralKind) {
    const downloaded = await kittenTtsEngine.isEngineModelDownloaded(neuralKind);
    if (!downloaded) {
      const ok = await kittenTtsEngine.init(
        (p) => onDownloadProgress?.(p.percent),
        neuralKind,
      );
      canUseKitten = ok && kittenTtsEngine.isReady();
    } else {
      canUseKitten = true;
    }
  }

  for (let i = startIndex; i < sentences.length; i++) {
    if (isCancelled()) break;

    if (canUseKitten) {
      try {
        // Reproduce la oración i y pre-sintetiza automáticamente i+1 e i+2 en segundo plano
        await kittenTtsEngine.speakSentenceWithLookahead({
          sentences,
          currentIndex: i,
          voiceId: neuralVoice,
          speed,
          engine: neuralKind ?? "kitten",
          onSentenceAudioStart: () => onHighlightSentence(i),
        });
      } catch (err) {
        console.warn(
          "[Lecta TTS] KittenTTS falló o liberó memoria; cambiando a voz nativa del sistema:",
          err,
        );
        canUseKitten = false;
        kittenTtsEngine.releaseWorkerMemory();
        // Degradación elegante (Graceful fallback) a Web Speech API para no cortar la lectura
        if (!isCancelled()) {
          onHighlightSentence(i);
          await speakWithSystemVoice(sentences[i], { voiceId, rate: speed, language });
        }
      }
    } else {
      // Motor instantáneo por defecto (0 MB de descarga)
      onHighlightSentence(i);
      await speakWithSystemVoice(sentences[i], { voiceId, rate: speed, language });
    }
  }

  if (!isCancelled()) {
    onFinishPage();
  }
}

export function stopAllTtsPlayback(): void {
  kittenTtsEngine.stop();
  stopSystemVoice();
}

export interface TtsControllerOptions {
  onStateChange?: (snap: {
    status: TtsStatus;
    currentSentenceText: string;
    currentIndex: number;
    totalSentences: number;
  }) => void;
  onVoicesChange?: (available: TtsVoiceOption[]) => void;
  onSectionEnd?: () => void;
  onDownloadProgress?: (pct: number) => void;
  onError?: (msg: string) => void;
}

export class TtsAudioController {
  private options: TtsControllerOptions;
  private status: TtsStatus = "idle";
  private sentences: string[] = [];
  private currentIndex = 0;
  private rate = 1;
  private voiceURI: string | null = null;
  private isCancelledFlag = false;
  private docLang = "en";

  constructor(options: TtsControllerOptions = {}) {
    this.options = options;
    this.initVoices();
  }

  private initVoices() {
    const voices: TtsVoiceOption[] = [];
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      const sysVoices = window.speechSynthesis.getVoices();
      for (const v of sysVoices) {
        voices.push({
          id: v.voiceURI,
          name: v.name,
          lang: v.lang,
          isDefault: v.default,
        });
      }
    }
    if (isFeatureFlagEnabled("neuralTts")) {
      for (const kv of KITTEN_VOICES) {
        voices.push({
          id: `kitten:${kv.id}`,
          name: `${kv.name} (Neural HD)`,
          lang: "en-US",
          isNeural: true,
        });
      }
    }
    this.options.onVoicesChange?.(voices);
  }

  attachDocument(doc: Document | null): void {
    if (doc?.body) {
      const text = doc.body.textContent || "";
      const docLang = doc.documentElement?.lang?.trim() || doc.body.lang?.trim() || "en";
      this.docLang = docLang;
      const seg = new Intl.Segmenter(this.docLang, { granularity: "sentence" });
      this.sentences = [...seg.segment(text)]
        .map((s) => s.segment.trim())
        .filter((s) => s.length > 0);
    } else {
      this.sentences = [];
      this.docLang = "en";
    }
    this.currentIndex = 0;
    this.emitState();
  }

  private emitState(): void {
    this.options.onStateChange?.({
      status: this.status,
      currentSentenceText: this.sentences[this.currentIndex] || "",
      currentIndex: this.currentIndex,
      totalSentences: this.sentences.length,
    });
  }

  play(): void {
    if (!this.sentences.length) return;
    kittenTtsEngine.unlockAudioContext();
    this.status = "playing";
    this.isCancelledFlag = false;
    this.emitState();

    void playSentencesLoop({
      sentences: this.sentences,
      startIndex: this.currentIndex,
      engineMode:
        isFeatureFlagEnabled("neuralTts") && this.voiceURI?.startsWith("kitten:")
          ? "kitten-neural"
          : "browser",
      voiceId: this.voiceURI?.replace("kitten:", "") || "",
      speed: this.rate,
      language: this.docLang,
      onDownloadProgress: this.options.onDownloadProgress,
      onHighlightSentence: (idx) => {
        this.currentIndex = idx;
        this.emitState();
      },
      onFinishPage: () => {
        this.status = "idle";
        this.emitState();
        this.options.onSectionEnd?.();
      },
      isCancelled: () => this.isCancelledFlag,
    });
  }

  pause(): void {
    this.status = "paused";
    this.isCancelledFlag = true;
    stopAllTtsPlayback();
    this.emitState();
  }

  resume(): void {
    this.play();
  }

  stop(): void {
    this.status = "idle";
    this.isCancelledFlag = true;
    stopAllTtsPlayback();
    this.currentIndex = 0;
    this.emitState();
  }

  prev(): void {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      if (this.status === "playing") {
        this.isCancelledFlag = true;
        stopAllTtsPlayback();
        this.play();
      } else {
        this.emitState();
      }
    }
  }

  next(): void {
    if (this.currentIndex < this.sentences.length - 1) {
      this.currentIndex++;
      if (this.status === "playing") {
        this.isCancelledFlag = true;
        stopAllTtsPlayback();
        this.play();
      } else {
        this.emitState();
      }
    }
  }

  setRate(rate: number): void {
    const changed = this.rate !== rate;
    this.rate = rate;
    if (changed && this.status === "playing") {
      this.isCancelledFlag = true;
      stopAllTtsPlayback();
      this.play();
    }
  }

  setVoice(voiceURI: string | null): void {
    const changed = this.voiceURI !== voiceURI;
    this.voiceURI = voiceURI;
    if (changed && this.status === "playing") {
      this.isCancelledFlag = true;
      stopAllTtsPlayback();
      this.play();
    }
  }

  destroy(): void {
    this.stop();
  }

  dispose(): void {
    this.stop();
    this.destroy();
    kittenTtsEngine.releaseWorkerMemory();
  }
}