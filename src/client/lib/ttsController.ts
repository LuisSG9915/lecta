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
import { createSpeaker, ensureVoices, type TtsSpeaker } from "./ttsSpeech";
import { loadTtsSettings, saveTtsSettings } from "./ttsSettings";
import { isTtsSupported } from "./ttsSettings";
import {
  TTS_IDLE,
  TTS_RATES,
  type SentenceLayoutItem,
  type TtsEndReason,
  type TtsPauseReason,
  type TtsRate,
  type TtsSnapshot,
  type TtsTargetContext,
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
};

export type TtsController = {
  snapshot(): TtsSnapshot;
  // Arranque desde el menú: `ctx` es el target que cubre la sección
  // actual; `startIndex` es la oración de arranque ya resuelta por el
  // Reader (posición guardada → primera visible → 0).
  start(ctx: TtsTargetContext, startIndex: number): void;
  pause(reason: TtsPauseReason): void;
  resume(): void;
  cycleRate(): TtsRate;
  stop(reason: TtsEndReason): void;
  // La sección que pidió el avance programático terminó de pintar.
  onSectionRendered(): void;
  // El DOM de la sección cambió bajo la sesión (líneas sintácticas,
  // hidratación tardía): re-ancla por huella o termina limpio.
  onDomMutated(): void;
  noteSavedWord(): void;
  destroy(): void;
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

  // Contadores de la sesión para tts_session_end.
  let startedAt = 0;
  let sentenceCount = 0;
  let lookupCount = 0;
  let savedWordCount = 0;
  let resumedCount = 0;
  let sectionAdvances = 0;
  let settings = loadTtsSettings();

  const publish = (next: Partial<TtsSnapshot>) => {
    snap = { ...snap, ...next };
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

  const speakCurrent = () => {
    const item = items[cursor];
    const root = deps.root();
    if (!item || !root) {
      advanceOrEnd();
      return;
    }
    clearTtsMarks(root);
    if (markSentence(root, item)) {
      const el = ttsMarkElement(root);
      if (el) deps.reveal(el);
    }
    speaker?.speak(item.text, settings.rate);
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
      : createSpeaker({ onEnded, onStalled });

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
    publish({ status: "stopping" });
    speaker?.cancel();
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
    publish({ ...TTS_IDLE, rate: settings.rate });
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
      if (reason === "word_lookup") lookupCount += 1;
      speaker?.pause();
      stopHeartbeat();
      // Último latido: el resto <30 s desde el anterior no se pierde.
      if (startedAt) deps.noteActivity();
      publish({ status: "paused", pauseReason: reason });
      emitPause(reason);
      // Pausa por ocultarse: si la pestaña no vuelve, la sesión se
      // cierra sola — una voz congelada a la espera es un zombie.
      if (reason === "visibility") {
        hiddenTimer = window.setTimeout(() => {
          hiddenTimer = 0;
          if (snap.status === "paused" && snap.pauseReason === "visibility" && document.hidden)
            finish("visibility");
        }, HIDDEN_STOP_MS);
      }
    },

    resume() {
      if (snap.status !== "paused") return;
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
      if (speaker?.speakingNow()) speaker.resume();
      else {
        if (!speaker) speaker = makeSpeaker();
        speakCurrent();
      }
      armHeartbeat();
    },

    cycleRate() {
      const at = TTS_RATES.indexOf(settings.rate);
      const rate = TTS_RATES[(at + 1) % TTS_RATES.length] ?? 1;
      settings = { ...settings, rate };
      saveTtsSettings(settings);
      publish({ rate });
      speaker?.setRate(rate);
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
