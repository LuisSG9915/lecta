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
import { kittenTtsEngine, type KittenTtsEngine } from "./kittenTtsEngine";
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
  start(ctx: TtsTargetContext, startIndex: number): void;
  pause(reason: TtsPauseReason): void;
  resume(): void;
  cycleRate(rates?: TtsRate[]): TtsRate;
  prevSentence(): void;
  nextSentence(): void;
  getCurrentSentence(): string | null;
  setKittenVoice?(voiceId: KittenVoiceId): void;
  setEngine?(engine: TtsEngineMode): void;
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

  const shouldUseKitten = (): boolean => {
    const isEn = deps.language().toLowerCase().startsWith("en");
    const isTestMock = Boolean(deps.kittenEngine);
    if (!isEn && !isTestMock) {
      return false;
    }
    if (settings.engine === "kitten-neural") return true;
    if (settings.engine === "auto") {
      const engine = deps.kittenEngine ?? kittenTtsEngine;
      const isReadyOrDownloaded =
        engine.isReady() ||
        engine.getModelProgress().status === "ready";
      return isEn && engine.isSupported() && isReadyOrDownloaded;
    }
    return false;
  };

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
    const active = shouldUseKitten() ? "kitten-neural" : "browser";
    snap = {
      ...snap,
      engine: settings.engine,
      kittenVoice: settings.kittenVoice,
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
      if (snap.status === "speaking" && !document.hidden) deps.noteActivity();
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
    if (!shouldUseKitten()) return;
    const engine = deps.kittenEngine ?? kittenTtsEngine;
    // Buffer anticipado lookahead = 2 con prioridad "low" para no bloquear la oración actual
    for (let offset = 1; offset <= 2; offset++) {
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
            ? engine.synthesizeLookahead(text, settings.kittenVoice, settings.rate)
            : engine.synthesize(text, settings.kittenVoice, settings.rate, "low");
        void synthLookahead
          .then((buf) => {
            if (destroyed) return;
            lookaheadBuffers.set(targetIdx, buf);
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

    if (shouldUseKitten()) {
      const engine = deps.kittenEngine ?? kittenTtsEngine;

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
          engine.releaseWorkerMemory?.();
          speaker?.speak(item.text, settings.rate);
        }
      } else {
        // 1. Encolar primero la oración actual con prioridad high
        const synthPromise = engine.synthesize(item.text, settings.kittenVoice, settings.rate);
        // 2. Disparar lookahead después con prioridad low
        triggerLookahead();

        void synthPromise
          .then((buf) => {
            if (destroyed || currentGen !== speakGen || snap.status !== "speaking") return;
            lookaheadBuffers.set(cursor, buf);
            engine.play(buf, 1.0, onEnded);
          })
          .catch((err) => {
            if (destroyed || currentGen !== speakGen || snap.status !== "speaking") return;
            const msg = err instanceof Error ? err.message : String(err);
            if (/stopped|cancelled by epoch|terminated/i.test(msg)) return;

            console.warn(
              "[Lecta TTS] KittenTTS falló o liberó memoria; cambiando a voz nativa del sistema:",
              err,
            );
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
    if (next >= ctx.endSection) {
      finish("chapter_end");
      return;
    }
    sectionAdvances += 1;
    awaitingSection = next;
    deps.emit({
      kind: "tts_section_advance",
      sessionId: snap.sessionId,
      targetId: ctx.targetId,
      sectionIndex: next,
      ms: sessionMs(),
    });
    deps.navigateSection(next);
    awaitingTimer = window.setTimeout(() => {
      awaitingTimer = 0;
      if (awaitingSection !== null) finish("error");
    }, SECTION_NAV_TIMEOUT_MS);
  };

  const onEnded = () => {
    if (snap.status !== "speaking") return;
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
      : createSpeaker({ onEnded, onStalled }, { language: deps.language() });

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

    start(nextCtx, startIndex) {
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
      startedAt = Date.now();
      sentenceCount = 0;
      lookupCount = 0;
      savedWordCount = 0;
      resumedCount = 0;
      sectionAdvances = 0;
      stallRetries = 0;
      publish({
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
      }
    },

    setEngine(engine: TtsEngineMode) {
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
    onHighlightSentence,
    onFinishPage,
    isCancelled,
  } = params;

  // Desbloqueo síncrono del AudioContext dentro de la interacción del usuario
  kittenTtsEngine.unlockAudioContext();

  let canUseKitten =
    (engineMode === "kitten-hd" || engineMode === "kitten-neural") &&
    (await kittenTtsEngine.isModelDownloaded());

  for (let i = startIndex; i < sentences.length; i++) {
    if (isCancelled()) break;

    if (canUseKitten) {
      try {
        // Reproduce la oración i y pre-sintetiza automáticamente i+1 e i+2 en segundo plano
        await kittenTtsEngine.speakSentenceWithLookahead({
          sentences,
          currentIndex: i,
          voiceId,
          speed,
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
  onStateChange: (snap: {
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

  constructor(options: TtsControllerOptions) {
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
    for (const kv of KITTEN_VOICES) {
      voices.push({
        id: `kitten:${kv.id}`,
        name: `${kv.name} (Neural HD)`,
        lang: "en-US",
        isNeural: true,
      });
    }
    this.options.onVoicesChange?.(voices);
  }

  attachDocument(doc: Document | null): void {
    if (doc?.body) {
      const text = doc.body.textContent || "";
      const docLang = doc.documentElement?.lang?.trim() || "en";
      this.docLang = docLang;
      const seg = new Intl.Segmenter(docLang, { granularity: "sentence" });
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
    this.options.onStateChange({
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
      engineMode: this.voiceURI?.startsWith("kitten:") ? "kitten-neural" : "browser",
      voiceId: this.voiceURI?.replace("kitten:", "") || "",
      speed: this.rate,
      language: this.docLang,
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