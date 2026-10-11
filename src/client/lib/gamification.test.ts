import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_FAMILY_ORDER,
  familyProgress,
  listFamilyProgress,
  applyGameEvent,
  catMood,
  catStageForLevel,
  emptyGameState,
  LEVELS,
  levelFor,
  levelProgress,
  openChest,
  pendingChests,
  requiredCoatLevel,
  unlockedAccessories,
  unlockedCoats,
  type GameState,
} from "./gamification";

const NOW = new Date("2025-06-10T12:00:00").getTime();
let seq = 0;
const idFor = () => `c${++seq}`;

const play = (state: GameState, events: Parameters<typeof applyGameEvent>[1][]) => {
  for (const ev of events) state = applyGameEvent(state, ev, NOW, idFor).state;
  return state;
};

describe("niveles", () => {
  it("xp acumulada define el nivel", () => {
    expect(levelFor(0)).toBe(0);
    expect(levelFor(29)).toBe(0);
    expect(levelFor(30)).toBe(1);
    expect(levelFor(LEVELS.at(-1)!.xp)).toBe(LEVELS.length - 1);
  });

  it("progreso dentro del nivel y tope final", () => {
    const mid = levelProgress(LEVELS[1].xp + 15);
    expect(mid.level).toBe(1);
    expect(mid.ratio).toBeCloseTo(0.25);
    expect(levelProgress(99999).ratio).toBe(1);
    expect(levelProgress(99999).ceil).toBeNull();
  });

  it("etapa del gato crece por bandas de nivel", () => {
    expect(catStageForLevel(0)).toBe(0);
    expect(catStageForLevel(2)).toBe(1);
    expect(catStageForLevel(5)).toBe(2);
    expect(catStageForLevel(7)).toBe(3);
    expect(catStageForLevel(9)).toBe(4);
  });
});

describe("xp por evento", () => {
  it("lectura suma minutos fraccionados", () => {
    const r = applyGameEvent(emptyGameState(), { kind: "read", ms: 90_000 }, NOW, idFor);
    expect(r.gained).toBeCloseTo(1.5);
    expect(r.state.stats.minutes).toBeCloseTo(1.5);
  });

  it("consultar da 2, guardar da 3 y la rara suma bonus", () => {
    let s = emptyGameState();
    s = play(s, [{ kind: "consulted" }]);
    expect(s.xp).toBe(2);
    // La primera guardada además desbloquea «palabra_1» (+10).
    s = play(s, [{ kind: "saved", zipf: 5.5 }]);
    expect(s.xp).toBe(15);
    expect(s.stats.rareSaved).toBe(0);
    s = play(s, [{ kind: "saved", zipf: 2.4 }]);
    expect(s.stats.rareSaved).toBe(1);
    expect(s.xp).toBe(22); // +3 base +4 rara
  });

  it("repaso puntúa por calificación", () => {
    let s = emptyGameState();
    s = play(s, [
      { kind: "review", rating: "good" },
      { kind: "review", rating: "again" },
      { kind: "review", rating: "easy" },
    ]);
    expect(s.xp).toBe(3 + 1 + 4);
    expect(s.stats.reviews).toBe(3);
  });

  it("libro terminado suma 50 una sola vez por libro", () => {
    let s = emptyGameState();
    s = play(s, [
      { kind: "book_finished", bookHash: "abc" },
      { kind: "book_finished", bookHash: "abc" },
      { kind: "book_finished", bookHash: "xyz" },
    ]);
    expect(s.stats.booksFinished).toBe(2);
  });
});

describe("racha de días", () => {
  const DAY = 86_400_000;

  it("día consecutivo sube la racha y aplica bonus", () => {
    const s = play(emptyGameState(), [{ kind: "consulted" }]);
    expect(s.stats.streakDays).toBe(1);
    const r = applyGameEvent(s, { kind: "consulted" }, NOW + DAY, idFor);
    expect(r.state.stats.streakDays).toBe(2);
    expect(r.gained).toBeCloseTo(2.2); // 2 × 1.1
  });

  it("un hueco mayor a un día reinicia", () => {
    const s = play(emptyGameState(), [{ kind: "consulted" }]);
    const r = applyGameEvent(s, { kind: "consulted" }, NOW + 3 * DAY, idFor);
    expect(r.state.stats.streakDays).toBe(1);
  });

  it("marcapáginas protector salva un día saltado cuando racha >= 3", () => {
    const s0 = play(emptyGameState(), [{ kind: "consulted" }]);
    const s1 = applyGameEvent(s0, { kind: "consulted" }, NOW + DAY, idFor).state;
    const s2 = applyGameEvent(s1, { kind: "consulted" }, NOW + 2 * DAY, idFor).state;
    expect(s2.stats.streakDays).toBe(3);

    // Salto de 1 día (gap 2): el protector sostiene la racha
    const rProtected = applyGameEvent(s2, { kind: "consulted" }, NOW + 4 * DAY, idFor);
    expect(rProtected.state.stats.streakDays).toBe(4);

    // Salto mayor (gap 3): reinicia a 1
    const rLost = applyGameEvent(s2, { kind: "consulted" }, NOW + 5 * DAY, idFor);
    expect(rLost.state.stats.streakDays).toBe(1);
  });
});

describe("logros y cofres", () => {
  it("primera guardada desbloquea logro, xp y cofre", () => {
    const r = applyGameEvent(emptyGameState(), { kind: "saved", zipf: null }, NOW, idFor);
    expect(r.unlocked.map((a) => a.id)).toContain("palabra_1");
    expect(r.state.achievements.palabra_1).toBe(NOW);
    expect(r.newChests.some((c) => c.source === "achievement")).toBe(true);
  });

  it("terminar un libro genera cofre con Exlibris conmemorativo", () => {
    const s = emptyGameState();
    const r = applyGameEvent(s, { kind: "book_finished", bookHash: "book-1" }, NOW, idFor);
    const exlibris = r.newChests.find(
      (c) => c.source === "achievement" && c.reward === "Exlibris conmemorativo",
    );
    expect(exlibris).toBeTruthy();
    expect(exlibris?.label).toBe("Primer libro cerrado");
  });

  it("subir de nivel genera cofre con accesorio", () => {
    const s = { ...emptyGameState(), xp: 85 };
    const r = applyGameEvent(s, { kind: "saved", zipf: null }, NOW, idFor);
    expect(r.leveledTo).toBe(2);
    expect(r.newChests.some((c) => c.source === "level" && c.reward === "bufanda")).toBe(
      true,
    );
  });

  it("el bonus de logro también puede cruzar un nivel", () => {
    // xp=90 (nivel 2): el libro da +50 → 140 (sin cruzar); el logro
    // «libro_1» +80 → 220 cruza el umbral de nivel 3 (180).
    const s = { ...emptyGameState(), xp: 90 };
    const r = applyGameEvent(s, { kind: "book_finished", bookHash: "b" }, NOW, idFor);
    expect(r.state.xp).toBeCloseTo(220);
    expect(r.leveledTo).toBe(3);
    expect(r.newChests.filter((c) => c.source === "level")).toHaveLength(1);
    expect(r.newChests.filter((c) => c.source === "achievement")).toHaveLength(1);
  });

  it("abrir un cofre lo marca y revela su accesorio", () => {
    const s = { ...emptyGameState(), xp: 85 };
    const r = applyGameEvent(s, { kind: "saved", zipf: null }, NOW, idFor);
    const chest = r.newChests.find((c) => c.source === "level")!;
    expect(pendingChests(r.state).map((c) => c.id)).toContain(chest.id);
    const opened = openChest(r.state, chest.id, NOW + 1000);
    expect(pendingChests(opened).map((c) => c.id)).not.toContain(chest.id);
    expect(unlockedAccessories(opened)).toContain(chest.reward);
  });

  it("todos los logros tienen id única", () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("pelajes del gato", () => {
  it("se desbloquean por nivel proyectado, no por cofre", () => {
    expect(unlockedCoats(emptyGameState())).toEqual([]);
    // Nivel 1 (xp 30, índice 1) regala el atigrado.
    expect(unlockedCoats({ ...emptyGameState(), xp: 30 })).toEqual([
      "pelaje-atigrado",
    ]);
    // Nivel máximo: los siete pelajes.
    expect(unlockedCoats({ ...emptyGameState(), xp: 2200 })).toHaveLength(7);
    // Retroactivo: un usuario ya en nivel 8 tiene seis pelajes sin
    // tocar ningún cofre.
    expect(unlockedCoats({ ...emptyGameState(), xp: 1150 })).toContain(
      "pelaje-tuxedo",
    );
  });

  it("requiredCoatLevel da el nivel visible o null", () => {
    expect(requiredCoatLevel("pelaje-dorado")).toBe(10);
    expect(requiredCoatLevel("pelaje-atigrado")).toBe(2);
    expect(requiredCoatLevel("pelaje-calico")).toBe(3);
    expect(requiredCoatLevel("pelaje-negro")).toBe(7);
    expect(requiredCoatLevel("bufanda")).toBeNull();
  });
});

describe("humor del gato", () => {
  it("despierto con actividad reciente, dormido tras 4 días", () => {
    const base = { ...emptyGameState(), caredAt: NOW };
    expect(catMood(base, NOW + 1_000)).toBe("awake");
    expect(catMood(base, NOW + 2 * 86_400_000)).toBe("sleepy");
    expect(catMood(base, NOW + 5 * 86_400_000)).toBe("asleep");
    // Cualquier evento lo despierta.
    const r = applyGameEvent(base, { kind: "consulted" }, NOW + 5 * 86_400_000, idFor);
    expect(catMood(r.state, NOW + 5 * 86_400_000)).toBe("awake");
  });
});

describe("familias y catálogo de logros", () => {
  const ORIGINAL_24 = [
    { id: "palabra_1", title: "Primera palabra", desc: "Guarda tu primera palabra", xp: 10, goal: 1 },
    { id: "palabras_10", title: "Vocabulario joven", desc: "Guarda 10 palabras", xp: 20, goal: 10 },
    { id: "palabras_50", title: "Vocabulario firme", desc: "Guarda 50 palabras", xp: 60, goal: 50 },
    { id: "palabras_100", title: "Cien en el cuaderno", desc: "Guarda 100 palabras", xp: 120, goal: 100 },
    { id: "palabras_500", title: "Diccionario propio", desc: "Guarda 500 palabras", xp: 250, goal: 500 },
    { id: "raras_5", title: "Cazarraras", desc: "Guarda 5 palabras raras", xp: 50, goal: 5 },
    { id: "raras_25", title: "Ojo de filólogo", desc: "Guarda 25 palabras raras", xp: 150, goal: 25 },
    { id: "curioso_50", title: "Curioso", desc: "Consulta 50 palabras", xp: 40, goal: 50 },
    { id: "curioso_200", title: "No suelta el diccionario", desc: "Consulta 200 palabras", xp: 100, goal: 200 },
    { id: "lectura_1h", title: "Primera hora", desc: "Lee 1 hora en total", xp: 30, goal: 1 },
    { id: "lectura_10h", title: "Lector de oficio", desc: "Lee 10 horas en total", xp: 150, goal: 10 },
    { id: "lectura_50h", title: "Habitante del estante", desc: "Lee 50 horas en total", xp: 400, goal: 50 },
    { id: "maraton", title: "Maratón", desc: "Lee 30 minutos de una sentada", xp: 40, goal: 30 },
    { id: "racha_3", title: "Tres días seguidos", desc: "Lee 3 días en racha", xp: 30, goal: 3 },
    { id: "racha_7", title: "Semana lectora", desc: "Lee 7 días en racha", xp: 80, goal: 7 },
    { id: "racha_30", title: "Mes de tinta", desc: "Lee 30 días en racha", xp: 300, goal: 30 },
    { id: "repasos_5", title: "Primeros repasos", desc: "Haz 5 repasos de vocabulario", xp: 15, goal: 5 },
    { id: "repasos_25", title: "Memoria en marcha", desc: "Haz 25 repasos de vocabulario", xp: 40, goal: 25 },
    { id: "repasos_50", title: "Mente en forma", desc: "Haz 50 repasos de vocabulario", xp: 70, goal: 50 },
    { id: "repasos_100", title: "Memoria de acero", desc: "Haz 100 repasos de vocabulario", xp: 120, goal: 100 },
    { id: "repasos_200", title: "Léxico de hierro", desc: "Haz 200 repasos de vocabulario", xp: 180, goal: 200 },
    { id: "repasos_400", title: "Archivo viviente", desc: "Haz 400 repasos de vocabulario", xp: 300, goal: 400 },
    { id: "libro_1", title: "Primer libro cerrado", desc: "Termina un libro", xp: 80, goal: 1 },
    { id: "libro_3", title: "Devoralibros", desc: "Termina 3 libros", xp: 200, goal: 3 },
  ];

  it("los 24 logros originales conservan exactamente id, título, desc, xp y umbrales (invariante)", () => {
    expect(ACHIEVEMENTS.length).toBe(36);
    for (let i = 0; i < ORIGINAL_24.length; i++) {
      const orig = ORIGINAL_24[i];
      const actual = ACHIEVEMENTS[i];
      expect(actual.id).toBe(orig.id);
      expect(actual.title).toBe(orig.title);
      expect(actual.desc).toBe(orig.desc);
      expect(actual.xp).toBe(orig.xp);
      expect(actual.goal).toBe(orig.goal);

      // Verificación de check en goal - ε y en goal
      const statsBelow = emptyGameState().stats;
      const statsAt = emptyGameState().stats;

      if (actual.family === "palabras") {
        statsBelow.saved = orig.goal - 1;
        statsAt.saved = orig.goal;
      } else if (actual.family === "raras") {
        statsBelow.rareSaved = orig.goal - 1;
        statsAt.rareSaved = orig.goal;
      } else if (actual.family === "consultas") {
        statsBelow.consulted = orig.goal - 1;
        statsAt.consulted = orig.goal;
      } else if (actual.family === "lectura") {
        statsBelow.minutes = orig.goal * 60 - 1;
        statsAt.minutes = orig.goal * 60;
      } else if (actual.family === "sesion") {
        statsBelow.longestSessionMin = orig.goal - 1;
        statsAt.longestSessionMin = orig.goal;
      } else if (actual.family === "racha") {
        statsBelow.streakDays = orig.goal - 1;
        statsAt.streakDays = orig.goal;
      } else if (actual.family === "repasos") {
        statsBelow.reviews = orig.goal - 1;
        statsAt.reviews = orig.goal;
      } else if (actual.family === "libros") {
        statsBelow.booksFinished = orig.goal - 1;
        statsAt.booksFinished = orig.goal;
      }

      expect(actual.check(statsBelow)).toBe(false);
      expect(actual.check(statsAt)).toBe(true);
    }
  });

  it("los 12 logros nuevos tienen títulos, descripciones y puntos correctos", () => {
    const newOnes = ACHIEVEMENTS.slice(24);
    expect(newOnes).toHaveLength(12);

    const map = new Map(newOnes.map((a) => [a.id, a]));
    expect(map.get("palabras_250")).toMatchObject({ title: "Cuaderno lleno", xp: 180, goal: 250 });
    expect(map.get("palabras_1000")).toMatchObject({ title: "Mil palabras propias", xp: 400, goal: 1000 });
    expect(map.get("raras_75")).toMatchObject({ title: "Coleccionista de rarezas", xp: 250, goal: 75 });
    expect(map.get("curioso_500")).toMatchObject({ title: "Lector con lupa", xp: 180, goal: 500 });
    expect(map.get("lectura_25h")).toMatchObject({ title: "Lector de tardes largas", xp: 250, goal: 25 });
    expect(map.get("lectura_100h")).toMatchObject({ title: "Cien horas de tinta", xp: 600, goal: 100 });
    expect(map.get("sesion_60")).toMatchObject({ title: "Hora sin interrupciones", xp: 70, goal: 60 });
    expect(map.get("racha_14")).toMatchObject({ title: "Dos semanas seguidas", xp: 150, goal: 14 });
    expect(map.get("racha_100")).toMatchObject({ title: "Cien días de lectura", xp: 700, goal: 100 });
    expect(map.get("repasos_800")).toMatchObject({ title: "Memoria de archivo", xp: 450, goal: 800 });
    expect(map.get("libro_5")).toMatchObject({ title: "Estante propio", xp: 300, goal: 5 });
    expect(map.get("libro_10")).toMatchObject({ title: "Diez libros cerrados", xp: 500, goal: 10 });
  });

  it("cada familia tiene logros con metas estrictamente crecientes", () => {
    for (const fam of ACHIEVEMENT_FAMILY_ORDER) {
      const famAchievements = ACHIEVEMENTS.filter((a) => a.family === fam).sort((a, b) => a.goal - b.goal);
      expect(famAchievements.length).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < famAchievements.length - 1; i++) {
        expect(famAchievements[i].goal).toBeLessThan(famAchievements[i + 1].goal);
      }
    }
  });

  describe("familyProgress", () => {
    it("con estado vacío calcula progreso 0 y apunta al primer logro", () => {
      const empty = emptyGameState();
      const prog = familyProgress(empty);
      expect(Object.keys(prog)).toEqual(ACHIEVEMENT_FAMILY_ORDER);

      const pal = prog.palabras;
      expect(pal.ranksEarned).toBe(0);
      expect(pal.ranksTotal).toBe(7); // 1, 10, 50, 100, 250, 500, 1000
      expect(pal.current).toBe(0);
      expect(pal.goal).toBe(1);
      expect(pal.ratio).toBe(0);
      expect(pal.nextAchievement?.id).toBe("palabra_1");
    });

    it("calcula horas fraccionarias y ratios correctamente", () => {
      const state = emptyGameState();
      // 90 minutos = 1.5 horas.
      // Logros ganados: lectura_1h (meta 1h).
      state.stats.minutes = 90;
      state.achievements["lectura_1h"] = NOW;

      const prog = familyProgress(state);
      const lec = prog.lectura;
      expect(lec.ranksEarned).toBe(1);
      expect(lec.ranksTotal).toBe(5); // 1, 10, 25, 50, 100
      expect(lec.current).toBe(1.5);
      expect(lec.goal).toBe(10); // siguiente logro es lectura_10h
      expect(lec.ratio).toBeCloseTo(1.5 / 10);
      expect(lec.nextAchievement?.id).toBe("lectura_10h");
    });

    it("cuando una familia está completa reporta ratio 1 y nextAchievement null", () => {
      const state = emptyGameState();
      state.stats.booksFinished = 15;
      for (const id of ["libro_1", "libro_3", "libro_5", "libro_10"]) {
        state.achievements[id] = NOW;
      }

      const prog = familyProgress(state);
      const lib = prog.libros;
      expect(lib.ranksEarned).toBe(4);
      expect(lib.ranksTotal).toBe(4);
      expect(lib.nextAchievement).toBeNull();
      expect(lib.current).toBe(15);
      expect(lib.goal).toBe(10);
      expect(lib.ratio).toBe(1);
    });

    it("listFamilyProgress devuelve las familias en el orden canónico", () => {
      const list = listFamilyProgress(emptyGameState());
      expect(list.map((f) => f.family)).toEqual(ACHIEVEMENT_FAMILY_ORDER);
    });
  });
});
