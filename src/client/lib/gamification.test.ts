import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENTS,
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
});

describe("logros y cofres", () => {
  it("primera guardada desbloquea logro, xp y cofre", () => {
    const r = applyGameEvent(emptyGameState(), { kind: "saved", zipf: null }, NOW, idFor);
    expect(r.unlocked.map((a) => a.id)).toContain("palabra_1");
    expect(r.state.achievements.palabra_1).toBe(NOW);
    expect(r.newChests.some((c) => c.source === "achievement")).toBe(true);
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
