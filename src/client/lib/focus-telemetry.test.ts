// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  detectFatigue,
  FATIGUE_AFTER_MS,
  FATIGUE_COOLDOWN_MS,
  FATIGUE_MIN_MOVES,
  FATIGUE_WINDOW_MS,
  dayWpm,
  detectDensePassageStall,
  DENSE_STALL_COOLDOWN_MS,
  DENSE_STALL_MAX_IDLE_MS,
  DENSE_STALL_MULTIPLIER,
  focusByDay,
  newDenseStallDetector,
  newFocusTracker,
  recordMove,
  resetDenseStallPage,
  TRACK_GAP_MS,
  DEFAULT_FOCUS_TELEMETRY_PROFILE,
  evaluateReadingFatigue,
  isFocusSuggestionMuted,
  loadFocusTelemetryProfile,
  muteBookFocusSuggestions,
  recordFocusAidOutcome,
  saveFocusTelemetryProfile,
  setFocusAutoSuggestEnabled,
  unmuteBookFocusSuggestions,
  type PageTurnTelemetryInput,
} from "./focus-telemetry";
import type { ReadingEvent } from "./idb";

const T0 = 1_000_000;
const TZ = "America/Mexico_City";

let seq = 0;
const event = (partial: Partial<ReadingEvent>): ReadingEvent =>
  ({
    id: `e${(seq += 1)}`,
    version: 1,
    visitId: "v1",
    bookHash: "b1",
    kind: "word_consulted",
    sectionIndex: 0,
    form: "x",
    origin: "text",
    createdAt: T0,
    ...partial,
  }) as ReadingEvent;

const moves = (t: ReturnType<typeof newFocusTracker>, at: number, pattern: boolean[]) => {
  for (const back of pattern) recordMove(t, at, back);
};

// Tramo continuo: actividad cada poco para que el hueco no reinicie
// la medición (así llega a 25+ min de lectura real).
const keepAlive = (
  t: ReturnType<typeof newFocusTracker>,
  until: number,
) => {
  for (let at = t.lastMoveAt; at <= until; at += TRACK_GAP_MS - 60_000)
    recordMove(t, at, false);
};

describe("registro de movimientos", () => {
  it("un hueco largo reinicia tramo y muestra", () => {
    const t = newFocusTracker(T0);
    moves(t, T0, [true, true, true]);
    recordMove(t, T0 + TRACK_GAP_MS + 1, false);
    expect(t.startedAt).toBe(T0 + TRACK_GAP_MS + 1);
    expect(t.moves).toHaveLength(1);
    expect(t.moves[0].back).toBe(false);
  });

  it("poda la ventana deslizante", () => {
    const t = newFocusTracker(T0);
    recordMove(t, T0, true);
    recordMove(t, T0 + FATIGUE_WINDOW_MS + 1, false);
    expect(t.moves).toHaveLength(1);
  });
});

describe("detectFatigue", () => {
  it("pide tramo largo, muestra suficiente y tasa alta", () => {
    // Antes del tramo mínimo: por más regresiones que haya, no avisa.
    const t = newFocusTracker(T0);
    moves(t, T0, [true, true, true, true, true, true, true, true]);
    expect(detectFatigue(t, T0 + 1000)).toBeNull();

    // Tramo de 25+ min con mayoría de retrocesos: avisa.
    const t2 = newFocusTracker(T0);
    const at = T0 + FATIGUE_AFTER_MS + 1000;
    keepAlive(t2, at);
    moves(t2, at, [false, true, false, true, true, false, true, true]);
    const hit = detectFatigue(t2, at);
    expect(hit).not.toBeNull();
    expect(hit!.backs).toBe(5);
    expect(hit!.moves).toBeGreaterThanOrEqual(FATIGUE_MIN_MOVES);
  });

  it("tasa baja de retrocesos no es fatiga", () => {
    const t = newFocusTracker(T0);
    const at = T0 + FATIGUE_AFTER_MS + 1000;
    keepAlive(t, at);
    moves(t, at, [false, false, false, true, false, false, false, true]);
    expect(detectFatigue(t, at)).toBeNull();
  });

  it("enfriamiento entre avisos y segundo aviso tras el lapso", () => {
    const t = newFocusTracker(T0);
    const at = T0 + FATIGUE_AFTER_MS + 1000;
    keepAlive(t, at);
    moves(t, at, [true, true, true, true, true, true, true, true]);
    expect(detectFatigue(t, at)).not.toBeNull();
    // Enfriamiento: aun con racha alta no vuelve a avisar.
    moves(t, at + 1, [true, true, true, true]);
    expect(detectFatigue(t, at + 2)).toBeNull();
    // Tras el enfriamiento (con el tramo aún vivo) vuelve a avisar.
    const later = at + FATIGUE_COOLDOWN_MS + 1;
    keepAlive(t, later);
    moves(t, later, [true, true, true, true, true, true, true, true]);
    expect(detectFatigue(t, later + 1)).not.toBeNull();
  });
});

describe("focusByDay", () => {
  it("agrega dwell, retrocesos, consultas y fatiga por día", () => {
    const day = focusByDay(
      [
        event({ kind: "section_dwell", ms: 60_000, words: 240 }),
        event({ kind: "section_dwell", ms: 60_000, words: 60 }),
        event({ kind: "page_regressed" }),
        event({ kind: "word_consulted" }),
        event({ kind: "fatigue_flag", regressions: 5, moves: 8 }),
        // Los demás tipos de evento no cuentan aquí.
        event({ kind: "word_saved", form: "y" }),
      ],
      TZ,
    );
    expect(day).toHaveLength(1);
    expect(day[0].dwellMs).toBe(120_000);
    expect(day[0].words).toBe(300);
    expect(day[0].regressions).toBe(1);
    expect(day[0].consults).toBe(1);
    expect(day[0].fatigue).toBe(1);
    // 300 palabras en 2 min ≈ 150 ppm.
    expect(dayWpm(day[0])).toBe(150);
  });

  it("wpm pide muestra suficiente", () => {
    expect(dayWpm({ dwellMs: 5_000, words: 500 })).toBe(0);
    expect(dayWpm({ dwellMs: 60_000, words: 10 })).toBe(0);
    expect(dayWpm({ dwellMs: 60_000, words: 300 })).toBe(300);
  });
});

describe("detectDensePassageStall", () => {
  const WORDS = 100;
  const BASELINE_WPM = 200;
  // expectedMs = (100 / 200) * 60_000 = 30_000 ms.
  // thresholdMs = 30_000 * 2.2 = 66_000 ms.

  it("no se dispara si el tiempo en la página es inferior a 2.2x lo esperado", () => {
    expect(DENSE_STALL_MULTIPLIER).toBe(2.2);
    const detector = newDenseStallDetector(T0);
    const at = T0 + 65_000;
    const hit = detectDensePassageStall(detector, at, WORDS, BASELINE_WPM, at);
    expect(hit).toBe(false);
  });

  it("se dispara cuando supera 2.2x lo esperado con actividad de usuario", () => {
    const detector = newDenseStallDetector(T0);
    const at = T0 + 67_000;
    // Actividad reciente (hace 2 segundos)
    const hit = detectDensePassageStall(detector, at, WORDS, BASELINE_WPM, at - 2000);
    expect(hit).toBe(true);
    expect(detector.lastFlaggedAt).toBe(at);
  });

  it("no se dispara si el usuario dejó la pestaña abandonada (inactivo > 30s)", () => {
    const detector = newDenseStallDetector(T0);
    const at = T0 + 70_000;
    // Inactivo hace 35s
    const hit = detectDensePassageStall(
      detector,
      at,
      WORDS,
      BASELINE_WPM,
      at - (DENSE_STALL_MAX_IDLE_MS + 5000),
    );
    expect(hit).toBe(false);
  });

  it("respeta el enfriamiento de 60s antes de volver a dispararse", () => {
    const detector = newDenseStallDetector(T0);
    const at1 = T0 + 67_000;
    expect(detectDensePassageStall(detector, at1, WORDS, BASELINE_WPM, at1)).toBe(true);

    // 10s después, aún en la misma página con actividad, está en cooldown
    const at2 = at1 + 10_000;
    expect(detectDensePassageStall(detector, at2, WORDS, BASELINE_WPM, at2)).toBe(false);

    // Tras el cooldown de 60s, vuelve a dispararse
    const at3 = at1 + DENSE_STALL_COOLDOWN_MS + 1000;
    expect(detectDensePassageStall(detector, at3, WORDS, BASELINE_WPM, at3)).toBe(true);
  });

  it("resetDenseStallPage reinicia la marca de tiempo de entrada a la página", () => {
    const detector = newDenseStallDetector(T0);
    // Cambiamos de página en T0 + 60_000
    resetDenseStallPage(detector, T0 + 60_000);
    // En T0 + 67_000 solo lleva 7s en la nueva página
    const hit = detectDensePassageStall(
      detector,
      T0 + 67_000,
      WORDS,
      BASELINE_WPM,
      T0 + 67_000,
    );
    expect(hit).toBe(false);
  });
});

describe("Telemetría Adaptativa y Bandido Contextual de Neuro-Foco", () => {
  it("evalúa ritmo fluido normal sin disparar fatiga y actualiza la línea base", () => {
    const profile = { ...DEFAULT_FOCUS_TELEMETRY_PROFILE };
    const input: PageTurnTelemetryInput = {
      lang: "es",
      wordCountOnPage: 100,
      dwellTimeMs: 22_000, // 22s por 100 palabras (ritmo normal)
      direction: "forward",
      sessionMinutesElapsed: 5,
      recentBackwardCountInWindow: 0,
    };

    const res = evaluateReadingFatigue(profile, input, false);
    expect(res.isFatigued).toBe(false);
    expect(res.fatigueIndex).toBeLessThan(0.3);
    expect(res.reason).toBe("none");

    // Actualiza la línea base en 'es' (samples pasa a 1)
    const esBaseline = res.updatedProfile.paceByLang["es"];
    expect(esBaseline).toBeDefined();
    expect(esBaseline.samples).toBe(1);
    expect(esBaseline.meanSecPer100Words).toBe(22);
  });

  it("distingue lengua materna (L1, ~22s/100w) vs idioma extranjero (L2, ~34s/100w)", () => {
    const profile = { ...DEFAULT_FOCUS_TELEMETRY_PROFILE };
    // 34s por 100 palabras en L2 no es atasco, pero en L1 sí se consideraría lento
    const inputL2: PageTurnTelemetryInput = {
      lang: "en",
      wordCountOnPage: 100,
      dwellTimeMs: 34_000,
      direction: "forward",
      sessionMinutesElapsed: 5,
      recentBackwardCountInWindow: 0,
    };

    const resL2 = evaluateReadingFatigue(profile, inputL2, true);
    expect(resL2.isFatigued).toBe(false);
    // Para L2 se favorece syntactic-lines (+0.25)
    expect(resL2.recommendedAid).toBe("syntactic-lines");
  });

  it("detecta fatiga por estancamiento severo (Z_stall alto) con reason='stall'", () => {
    const profile = { ...DEFAULT_FOCUS_TELEMETRY_PROFILE };
    // El usuario se queda trabado 70 segundos en una página de 100 palabras
    const input: PageTurnTelemetryInput = {
      lang: "es",
      wordCountOnPage: 100,
      dwellTimeMs: 70_000,
      direction: "forward",
      sessionMinutesElapsed: 15,
      recentBackwardCountInWindow: 0,
    };

    const res = evaluateReadingFatigue(profile, input, false);
    expect(res.fatigueIndex).toBeGreaterThanOrEqual(0.68);
    expect(res.isFatigued).toBe(true);
    expect(res.reason).toBe("stall");
  });

  it("detecta fatiga por retrocesos acumulados (regresiones / zoning out)", () => {
    const profile = { ...DEFAULT_FOCUS_TELEMETRY_PROFILE };
    const input: PageTurnTelemetryInput = {
      lang: "es",
      wordCountOnPage: 80,
      dwellTimeMs: 15_000,
      direction: "backward",
      sessionMinutesElapsed: 30,
      recentBackwardCountInWindow: 2, // dirección backward suma +0.6 -> 2.6
    };

    const res = evaluateReadingFatigue(profile, input, false);
    expect(res.fatigueIndex).toBeGreaterThanOrEqual(0.68);
    expect(res.isFatigued).toBe(true);
    expect(res.reason).toBe("regressions");
  });

  it("aprende con el bandido contextual premiando la herramienta que restablece la fluidez", () => {
    let profile = { ...DEFAULT_FOCUS_TELEMETRY_PROFILE };
    expect(profile.aidEfficacyWeights["focus-ruler"]).toBe(0.9);

    // Usuario usó la regla y recuperó su ritmo fluido (recoveredFlow = true)
    // nextWeight = 0.8 * 0.9 + 0.2 * 1.5 = 0.72 + 0.3 = 1.02
    profile = recordFocusAidOutcome(profile, "focus-ruler", true);
    expect(profile.aidEfficacyWeights["focus-ruler"]).toBe(1.02);

    // Segundo éxito consecutivo
    // nextWeight = 0.8 * 1.02 + 0.2 * 1.5 = 0.816 + 0.3 = 1.116
    profile = recordFocusAidOutcome(profile, "focus-ruler", true);
    expect(profile.aidEfficacyWeights["focus-ruler"]).toBe(1.116);
    // Ahora focus-ruler supera a las demás (1.116 > 1.0)
    expect(profile.aidEfficacyWeights["focus-ruler"]).toBeGreaterThan(
      profile.aidEfficacyWeights["paragraph-focus"],
    );

    // Si desactiva otra herramienta enseguida (recoveredFlow = false), se penaliza
    profile = recordFocusAidOutcome(profile, "paragraph-focus", false);
    // 0.8 * 1.0 + 0.2 * 0.4 = 0.88
    expect(profile.aidEfficacyWeights["paragraph-focus"]).toBe(0.88);
  });

  it("permite silenciar sugerencias por libro y desactivarlas globalmente (Zero-Friction)", () => {
    let profile = { ...DEFAULT_FOCUS_TELEMETRY_PROFILE };
    const bookId = "book-quijote";

    // Silenciar libro
    profile = muteBookFocusSuggestions(profile, bookId);
    expect(isFocusSuggestionMuted(profile, bookId)).toBe(true);
    expect(isFocusSuggestionMuted(profile, "otro-libro")).toBe(false);

    // Si está silenciado para ese libro, no se dispara isFatigued
    const inputStall: PageTurnTelemetryInput = {
      bookId,
      lang: "es",
      wordCountOnPage: 100,
      dwellTimeMs: 80_000,
      direction: "forward",
      sessionMinutesElapsed: 40,
      recentBackwardCountInWindow: 3,
    };

    const resMuted = evaluateReadingFatigue(profile, inputStall, false);
    expect(resMuted.fatigueIndex).toBeGreaterThan(0.68);
    expect(resMuted.isFatigued).toBe(false); // Silenciado para este libro

    // Reactivar libro
    profile = unmuteBookFocusSuggestions(profile, bookId);
    expect(isFocusSuggestionMuted(profile, bookId)).toBe(false);
    const resUnmuted = evaluateReadingFatigue(profile, inputStall, false);
    expect(resUnmuted.isFatigued).toBe(true);

    // Desactivar globalmente
    profile = setFocusAutoSuggestEnabled(profile, false);
    expect(isFocusSuggestionMuted(profile, "cualquier-libro")).toBe(true);
    const resDisabled = evaluateReadingFatigue(profile, inputStall, false);
    expect(resDisabled.isFatigued).toBe(false);
  });

  it("persiste y recupera el perfil en localStorage", () => {
    const profile = {
      ...DEFAULT_FOCUS_TELEMETRY_PROFILE,
      mutedBookIds: ["book-123"],
      autoSuggestEnabled: false,
    };
    saveFocusTelemetryProfile(profile);
    const loaded = loadFocusTelemetryProfile();
    expect(loaded.mutedBookIds).toEqual(["book-123"]);
    expect(loaded.autoSuggestEnabled).toBe(false);
  });
});
