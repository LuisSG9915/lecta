// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSentenceMap, sentenceFingerprint } from "./ttsSentences";
import { clearTtsMarks, markSentence, ttsMarkElement } from "./ttsMarks";
import {
  pickEnglishVoice,
  pickSpanishVoice,
  pickVoiceForLanguage,
  splitForSpeech,
} from "./ttsSpeech";
import {
  consentTts,
  isTtsSupported,
  loadTtsSettings,
  TTS_SETTINGS_DEFAULTS,
} from "./ttsSettings";
import {
  isTtsProgrammaticNav,
  isTtsProgrammaticScroll,
  noteTtsProgrammaticScroll,
  withTtsProgrammaticNav,
} from "./ttsGuards";
import { createTtsController, type TtsControllerDeps } from "./ttsController";
import type { TtsSnapshot, TtsTargetContext } from "./ttsTypes";

const section = (html: string) => {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
};

describe("ttsSentences", () => {
  it("segmenta oraciones con offsets absolutos sobre el texto concatenado", () => {
    const root = section("<p>Hola mundo. Adiós mundo.</p><p>Segunda línea.</p>");
    const { items, text } = buildSentenceMap(root, 3, "es");
    // Los bloques llevan un separador en el flujo: sin él,
    // «mundo.Segunda» quedaría pegada y el segmentador no cortaría.
    expect(text).toBe("Hola mundo. Adiós mundo.\nSegunda línea.");
    expect(items.map((i) => i.text)).toEqual([
      "Hola mundo.",
      "Adiós mundo.",
      "Segunda línea.",
    ]);
    expect(items[0].start).toBe(0);
    expect(items[0].sectionIndex).toBe(3);
    expect(items.map((i) => i.sentenceIndex)).toEqual([0, 1, 2]);
    for (const item of items)
      expect(item.fingerprint).toBe(sentenceFingerprint(item.text));
  });

  it("omite script, oculto y la tarjeta «Antes de leer»", () => {
    const root = section(
      "<p>Texto real.</p><script>var x = 1;</script>" +
        "<div hidden>Oculto.</div>" +
        '<div class="section-preview-slot"><p>Fila de tarjeta.</p></div>',
    );
    const { items, text } = buildSentenceMap(root, 0);
    expect(text).not.toContain("Fila de tarjeta");
    expect(text).not.toContain("var x");
    expect(items).toHaveLength(1);
  });

  it("descarta separadores sin letras («—», «…»)", () => {
    const root = section("<p>…</p><p>—</p><p>Texto hablable.</p>");
    const { items } = buildSentenceMap(root, 0);
    // Solo «Texto hablable.» cuenta: un segmento de pura puntuación
    // produciría una utterance vacía que avanzaría el puntero muda.
    expect(items.map((i) => i.text)).toEqual(["Texto hablable."]);
  });
});

describe("ttsMarks", () => {
  it("envuelve la oración activa aunque cruce nodos y la limpia después", () => {
    const root = section("<p>Dijo <i>ella</i> bajito. Otra frase.</p>");
    const { items } = buildSentenceMap(root, 0);
    const across = items.find((i) => i.text === "Dijo ella bajito.") ?? items[0];
    expect(markSentence(root, across)).toBe(true);
    const marks = root.querySelectorAll("[data-tts-sentence]");
    expect(marks.length).toBeGreaterThanOrEqual(1);
    expect(
      [...marks].map((m) => m.textContent).join(""),
    ).toContain("ella");
    // Una marca por oración activa: la segunda no queda marcada.
    for (const mark of marks)
      expect(mark.getAttribute("data-tts-sentence")).toBe(
        String(across.sentenceIndex),
      );
    clearTtsMarks(root);
    expect(root.querySelectorAll("[data-tts-sentence]")).toHaveLength(0);
    // Y el mapa se puede reconstruir idéntico tras limpiar.
    const rebuilt = buildSentenceMap(root, 0);
    expect(rebuilt.items.map((i) => i.fingerprint)).toEqual(
      items.map((i) => i.fingerprint),
    );
  });

  it("marca y limpia sin romper las oraciones siguientes", () => {
    const root = section("<p>Una frase larga de verdad. Otra más.</p>");
    const { items } = buildSentenceMap(root, 0);
    expect(markSentence(root, items[0])).toBe(true);
    // Marcar la segunda con la primera puesta: el resolve por offsets
    // debe seguir encontrando su tramo aunque el nodo ya esté partido.
    clearTtsMarks(root);
    expect(markSentence(root, items[1])).toBe(true);
    expect(ttsMarkElement(root)?.textContent).toContain("Otra más");
  });

  it("no marca si la huella ya no coincide (mapa obsoleto)", () => {
    const root = section("<p>Texto original.</p>");
    const { items } = buildSentenceMap(root, 0);
    // Simula un re-render: el contenedor tiene otro contenido.
    const other = section("<p>Contenido distinto del todo.</p>");
    expect(markSentence(other, items[0])).toBe(false);
    expect(other.querySelectorAll("[data-tts-sentence]")).toHaveLength(0);
  });
});

describe("ttsSpeech", () => {
  it("no parte oraciones cortas", () => {
    expect(splitForSpeech("Hola mundo.")).toEqual(["Hola mundo."]);
  });

  it("parte en puntuación interna sin exceder el tope", () => {
    const body = "palabra, ".repeat(40).trim();
    const chunks = splitForSpeech(body, 60);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(60);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toContain("palabra");
  });

  it("sin puntuación útil corta en el último espacio", () => {
    const body = Array.from({ length: 30 }, () => "palabras").join(" ");
    const chunks = splitForSpeech(body, 50);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(50);
  });

  it("prefiere es-MX, luego es-US, luego cualquier es-*", () => {
    const voice = (lang: string) => ({ lang }) as SpeechSynthesisVoice;
    expect(pickSpanishVoice([voice("en-US"), voice("es-MX")])?.lang).toBe(
      "es-MX",
    );
    expect(pickSpanishVoice([voice("es-US"), voice("es-ES")])?.lang).toBe(
      "es-US",
    );
    expect(pickSpanishVoice([voice("en-US"), voice("es-AR")])?.lang).toBe(
      "es-AR",
    );
    expect(pickSpanishVoice([voice("en-US")])).toBeNull();
  });

  it("prefiere en-US, luego en-GB, luego cualquier en-*", () => {
    const voice = (lang: string) => ({ lang }) as SpeechSynthesisVoice;
    expect(pickEnglishVoice([voice("es-MX"), voice("en-US")])?.lang).toBe(
      "en-US",
    );
    expect(pickEnglishVoice([voice("en-GB"), voice("en-AU")])?.lang).toBe(
      "en-GB",
    );
    expect(pickEnglishVoice([voice("es-ES"), voice("en-CA")])?.lang).toBe(
      "en-CA",
    );
    expect(pickEnglishVoice([voice("es-ES")])).toBeNull();
  });

  it("selecciona la voz y tag de fallback según el idioma", () => {
    const voice = (lang: string) => ({ lang }) as SpeechSynthesisVoice;
    const voices = [voice("es-MX"), voice("en-US")];
    const enResult = pickVoiceForLanguage(voices, "en");
    expect(enResult.voice?.lang).toBe("en-US");
    expect(enResult.defaultLangTag).toBe("en-US");

    const esResult = pickVoiceForLanguage(voices, "es");
    expect(esResult.voice?.lang).toBe("es-MX");
    expect(esResult.defaultLangTag).toBe("es-MX");
  });
});

describe("ttsSettings", () => {
  beforeEach(() => localStorage.clear());

  it("por defecto apagado y sin consentimiento", () => {
    expect(loadTtsSettings()).toEqual(TTS_SETTINGS_DEFAULTS);
  });

  it("el consentimiento guarda epoch ms y enciende", () => {
    const next = consentTts(1_700_000_000_000);
    expect(next.enabled).toBe(true);
    expect(next.consentedAt).toBe(1_700_000_000_000);
    expect(loadTtsSettings().enabled).toBe(true);
  });

  it("JSON roto cae a defaults y rate inválido a 1", () => {
    localStorage.setItem("lecta:tts", "{no json");
    expect(loadTtsSettings()).toEqual(TTS_SETTINGS_DEFAULTS);
    localStorage.setItem(
      "lecta:tts",
      JSON.stringify({ enabled: true, consentedAt: 5, rate: 3.4 }),
    );
    expect(loadTtsSettings().rate).toBe(1);
  });

  it("isTtsSupported exige speechSynthesis", () => {
    // jsdom no trae speechSynthesis → no soportado aquí.
    expect(isTtsSupported()).toBe(false);
  });
});

describe("ttsGuards", () => {
  it("los envoltorios marcan solo durante la llamada", () => {
    expect(isTtsProgrammaticNav()).toBe(false);
    let inside = false;
    withTtsProgrammaticNav(() => {
      inside = isTtsProgrammaticNav();
    });
    expect(inside).toBe(true);
    expect(isTtsProgrammaticNav()).toBe(false);

    // El guard de scroll es una ventana de tiempo (el evento llega
    // asíncrono tras scrollIntoView): dentro vigente, fuera no.
    vi.useFakeTimers();
    try {
      noteTtsProgrammaticScroll();
      expect(isTtsProgrammaticScroll()).toBe(true);
      vi.advanceTimersByTime(700);
      expect(isTtsProgrammaticScroll()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------- Controlador: máquina de estados con speaker falso ----------

type FakeSpeaker = {
  spoken: string[];
  ended(): void;
  stalled(kind: "start" | "mid" | "resume"): void;
  pauseCount: number;
  resumeCount: number;
  cancelCount: number;
  // false simula un motor que soltó la cola al pausar (sin pause
  // real): resume() entonces debe re-speak la oración activa.
  alive?: boolean;
};

const makeDeps = (roots: HTMLElement[]) => {
  const events: Record<string, unknown>[] = [];
  const snaps: TtsSnapshot[] = [];
  const speakers: FakeSpeaker[] = [];
  let current = 0;
  let activities = 0;
  const deps: TtsControllerDeps = {
    language: () => "es",
    root: () => roots[current] ?? null,
    sectionIndex: () => current,
    sectionReady: () => true,
    navigateSection: (i) => {
      current = i;
    },
    reveal: () => undefined,
    emit: (d) => events.push(d),
    noteActivity: () => {
      activities += 1;
    },
    onSnapshot: (s) => snaps.push(s),
    supported: () => true,
    makeSpeaker: (ev) => {
      const fake: FakeSpeaker = {
        spoken: [],
        pauseCount: 0,
        resumeCount: 0,
        cancelCount: 0,
        ended: () => ev.onEnded(),
        stalled: (k) => ev.onStalled(k),
      };
      const speaker = {
        speak: (t: string) => void fake.spoken.push(t),
        pause: () => void fake.pauseCount++,
        resume: () => void fake.resumeCount++,
        cancel: () => void fake.cancelCount++,
        speakingNow: () => fake.alive !== false,
        setRate: () => undefined,
      };
      speakers.push(fake);
      return speaker;
    },
  };
  return {
    deps,
    events,
    snaps,
    speakers,
    activities: () => activities,
  };
};

const CTX: TtsTargetContext = {
  bookHash: "h",
  targetId: "t1",
  startSection: 0,
  endSection: 3,
  sectionIndex: 0,
};

// Los ajustes se leen del localStorage: el consentimiento es puerta.
const consent = () => consentTts(1_000);

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("ttsController", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("no arranca sin consentimiento guardado", async () => {
    const { deps, events, snaps } = makeDeps([section("<p>Una. Otra.</p>")]);
    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    await flush();
    // La puerta corta antes de publicar: no hay evento ni cambio.
    expect(ctl.snapshot().status).toBe("idle");
    expect(events).toHaveLength(0);
    void snaps;
  });

  it("habla las oraciones en orden y emite inicio", async () => {
    consent();
    const { deps, events, speakers } = makeDeps([
      section("<p>Una frase. Otra frase.</p>"),
    ]);
    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    await flush();
    expect(ctl.snapshot().status).toBe("speaking");
    expect(speakers[0].spoken).toEqual(["Una frase."]);
    expect(events[0].kind).toBe("tts_session_start");
    speakers[0].ended();
    expect(speakers[0].spoken).toEqual(["Una frase.", "Otra frase."]);
  });

  it("al terminar la sección avanza dentro del target y termina en chapter_end", async () => {
    consent();
    const roots = [
      section("<p>Solo una.</p>"),
      section("<p>Siguiente sección.</p>"),
      section(""),
    ];
    const navigated: number[] = [];
    const { deps, events, speakers } = makeDeps(roots);
    const nav = deps.navigateSection;
    deps.navigateSection = (i) => {
      navigated.push(i);
      nav(i);
    };
    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    await flush();
    speakers[0].ended(); // fin sección 0 → navega a 1
    expect(navigated).toEqual([1]);
    ctl.onSectionRendered();
    expect(speakers[0].spoken.at(-1)).toBe("Siguiente sección.");
    speakers[0].ended(); // fin sección 1 → navega a 2 (vacía)
    ctl.onSectionRendered();
    // Sección 2 sin texto → sigue avanzando; 3 = endSection → chapter_end
    expect(navigated).toEqual([1, 2]);
    speakers[0].ended();
    ctl.onSectionRendered();
    const end = events.find((e) => e.kind === "tts_session_end");
    expect(end?.endReason).toBe("chapter_end");
    expect(end?.sectionAdvances).toBe(2);
    expect(ctl.snapshot().status).toBe("idle");
  });

  it("pausa y reanuda emitiendo eventos; el heartbeat alimenta actividad", async () => {
    consent();
    const { deps, events, speakers, activities } = makeDeps([
      section("<p>Larga una. Larga dos. Larga tres.</p>"),
    ]);
    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    await flush();
    vi.advanceTimersByTime(30_000);
    expect(activities()).toBeGreaterThanOrEqual(1);
    ctl.pause("word_lookup");
    expect(ctl.snapshot().status).toBe("paused");
    expect(speakers[0].pauseCount).toBe(1);
    expect(
      events.some((e) => e.kind === "tts_paused" && e.reason === "word_lookup"),
    ).toBe(true);
    ctl.resume();
    expect(speakers[0].resumeCount).toBe(1);
    expect(events.some((e) => e.kind === "tts_resumed")).toBe(true);
    ctl.stop("user");
    const end = events.find((e) => e.kind === "tts_session_end");
    expect(end?.endReason).toBe("user");
    expect(end?.lookupCount).toBe(1);
    expect(end?.resumedCount).toBe(1);
  });

  it("un stall reintenta una vez; el segundo cierra con error", async () => {
    consent();
    const { deps, events, speakers } = makeDeps([section("<p>Frase.</p>")]);
    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    await flush();
    speakers[0].stalled("start");
    // Reintento: cancela y re-speak — un speaker nuevo.
    expect(speakers.length).toBe(2);
    speakers[1].stalled("start");
    expect(
      events.find((e) => e.kind === "tts_session_end")?.endReason,
    ).toBe("error");
  });

  it("cicla velocidades 1→1.2→0.8→1 y re-speak la oración", async () => {
    consent();
    const { deps, speakers } = makeDeps([section("<p>Frase única.</p>")]);
    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    await flush();
    expect(ctl.cycleRate()).toBe(1.2);
    expect(speakers.at(-1)?.spoken.at(-1)).toBe("Frase única.");
    expect(ctl.cycleRate()).toBe(0.8);
    expect(ctl.cycleRate()).toBe(1);
    expect(loadTtsSettings().rate).toBe(1);
  });

  it("visibilidad prolongada termina la sesión por su cuenta", async () => {
    consent();
    const { deps, events } = makeDeps([section("<p>Frase.</p>")]);
    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    await flush();
    const realHidden = Object.getOwnPropertyDescriptor(document, "hidden");
    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });
    ctl.pause("visibility");
    vi.advanceTimersByTime(91_000);
    expect(
      events.find((e) => e.kind === "tts_session_end")?.endReason,
    ).toBe("visibility");
    if (realHidden) Object.defineProperty(document, "hidden", realHidden);
  });

  it("pausar en «preparing» no cuaja: al pintar la voz arranca igual", async () => {
    consent();
    const { deps, speakers } = makeDeps([section("<p>Frase.</p>")]);
    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    // La pausa llega antes de ensureVoices: no hay speaker ni mapa —
    // no debe dejar una sesión zombie sin nada que reanudar.
    ctl.pause("panel_opened");
    await flush();
    expect(ctl.snapshot().status).toBe("speaking");
    expect(speakers[0].spoken).toEqual(["Frase."]);
  });

  it("un salto de sección que nunca pinta termina la sesión con error", async () => {
    consent();
    const { deps, events, speakers } = makeDeps([section("<p>Única.</p>")]);
    // La navegación acepta pero jamás llega el render (carga fallida).
    deps.navigateSection = () => undefined;
    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    await flush();
    speakers[0].ended(); // fin de sección → pide avanzar a 1
    vi.advanceTimersByTime(9_000);
    expect(
      events.find((e) => e.kind === "tts_session_end")?.endReason,
    ).toBe("error");
    expect(ctl.snapshot().status).toBe("idle");
  });

  it("reanudar con la cola soltada re-speak la oración activa", async () => {
    consent();
    const { deps, speakers } = makeDeps([section("<p>Una. Dos.</p>")]);
    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    await flush();
    ctl.pause("user");
    speakers[0].alive = false; // el motor vació la cola al pausar
    ctl.resume();
    // No se resume nada: se re-speak desde la oración en curso.
    expect(speakers[0].resumeCount).toBe(0);
    expect(speakers[0].spoken.at(-1)).toBe("Una.");
  });

  it("avanza y retrocede de frase con nextSentence y prevSentence", async () => {
    consent();
    const { deps, speakers } = makeDeps([section("<p>Primera. Segunda. Tercera.</p>")]);
    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    await flush();

    expect(ctl.getCurrentSentence()).toBe("Primera.");
    ctl.nextSentence();
    expect(ctl.getCurrentSentence()).toBe("Segunda.");
    expect(speakers.at(-1)?.spoken.at(-1)).toBe("Segunda.");

    ctl.nextSentence();
    expect(ctl.getCurrentSentence()).toBe("Tercera.");

    ctl.prevSentence();
    expect(ctl.getCurrentSentence()).toBe("Segunda.");
    expect(speakers.at(-1)?.spoken.at(-1)).toBe("Segunda.");

    ctl.prevSentence();
    expect(ctl.getCurrentSentence()).toBe("Primera.");

    // prevSentence en el inicio no se desborda
    ctl.prevSentence();
    expect(ctl.getCurrentSentence()).toBe("Primera.");
  });

  it("permite ciclar velocidades personalizadas con cycleRate(customRates)", async () => {
    consent();
    const { deps } = makeDeps([section("<p>Frase.</p>")]);
    const ctl = createTtsController(deps);
    ctl.start(CTX, 0);
    await flush();

    const customRates: [0.9, 1, 1.15, 1.3] = [0.9, 1, 1.15, 1.3];
    expect(ctl.cycleRate(customRates)).toBe(1.15);
    expect(ctl.cycleRate(customRates)).toBe(1.3);
    expect(ctl.cycleRate(customRates)).toBe(0.9);
    expect(ctl.cycleRate(customRates)).toBe(1);
  });
});
