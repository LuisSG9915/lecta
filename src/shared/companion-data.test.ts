import { describe, expect, it } from "vitest";
import {
  bestStreak,
  canonicalChestKey,
  getEquippedItems,
  mergeCompanionRegister,
  mergeLegacyBaselines,
  parseReceiptId,
  pendingAchievementCredits,
  projectChests,
  projectGame,
  receiptIdFor,
  resolveCoatId,
  validateCompanionBatch,
  COMPANION_ARTICLES,
  COMPANION_COATS,
  COMPANION_COAT_IDS,
  type CompanionRegister,
  type CompanionSnapshot,
  type GameJournalEvent,
  type LegacyGameBaseline,
} from "./companion-data";
import { ACHIEVEMENTS, emptyGameState, type GameState } from "./gamification";

const T0 = new Date("2025-06-10T12:00:00").getTime();
const DAY = 86_400_000;

const makeState = (
  over: Partial<GameState> = {},
  stats: Partial<GameState["stats"]> = {},
): GameState => ({
  ...emptyGameState(),
  ...over,
  stats: { ...emptyGameState().stats, ...stats },
});

const baseline = (originId: string, state: GameState): LegacyGameBaseline => ({
  version: 1,
  originId,
  state,
});

const ev = (
  id: string,
  at: number,
  dayKey: string,
  event: GameJournalEvent["event"],
  extra: Partial<GameJournalEvent> = {},
): GameJournalEvent => ({
  version: 1,
  id,
  at,
  dayKey,
  streakBonus: false,
  event,
  ...extra,
});

const snap = (p: Partial<CompanionSnapshot> = {}): CompanionSnapshot => ({
  baselines: [],
  events: [],
  registers: [],
  receipts: [],
  ...p,
});

describe("mergeLegacyBaselines", () => {
  it("xp toma el máximo, no la suma; contadores toman el máximo por campo", () => {
    const a = baseline("a", makeState({ xp: 100 }, { minutes: 10, saved: 5 }));
    const b = baseline("b", makeState({ xp: 60 }, { minutes: 3, saved: 12 }));
    const merged = mergeLegacyBaselines([a, b]);
    expect(merged.xp).toBe(100);
    expect(merged.stats.minutes).toBe(10);
    expect(merged.stats.saved).toBe(12);
  });

  it("logros unen por id quedándose con el menor sello positivo", () => {
    const a = baseline("a", makeState({ achievements: { palabra_1: 200 } }));
    const b = baseline(
      "b",
      makeState({ achievements: { palabra_1: 150, raras_5: 300 } }),
    );
    const merged = mergeLegacyBaselines([a, b]);
    expect(merged.achievements).toEqual({ palabra_1: 150, raras_5: 300 });
  });

  it("la unión de finishedBooks levanta booksFinished", () => {
    const a = baseline(
      "a",
      makeState({ finishedBooks: ["h1"] }, { booksFinished: 1 }),
    );
    const b = baseline(
      "b",
      makeState({ finishedBooks: ["h1", "h2"] }, { booksFinished: 2 }),
    );
    const merged = mergeLegacyBaselines([a, b]);
    expect(merged.finishedBooks).toEqual(["h1", "h2"]);
    expect(merged.stats.booksFinished).toBe(2);
    // Y un contador mayor gana aunque la lista sea más corta.
    const c = baseline("c", makeState({}, { booksFinished: 5 }));
    expect(mergeLegacyBaselines([a, c]).stats.booksFinished).toBe(5);
  });

  it("la racha es la pareja del baseline con fecha más reciente", () => {
    const a = baseline(
      "a",
      makeState({}, { lastDayKey: "2025-06-09", streakDays: 9 }),
    );
    const b = baseline(
      "b",
      makeState({}, { lastDayKey: "2025-06-10", streakDays: 5 }),
    );
    const merged = mergeLegacyBaselines([a, b]);
    expect(merged.stats.lastDayKey).toBe("2025-06-10");
    expect(merged.stats.streakDays).toBe(5);
    // Empate de fecha: gana la racha más larga, no se suman.
    const c = baseline(
      "c",
      makeState({}, { lastDayKey: "2025-06-10", streakDays: 7 }),
    );
    expect(mergeLegacyBaselines([b, c]).stats.streakDays).toBe(7);
  });

  it("canonicaliza cofres por logro y nivel; lo irreconocible queda legacy", () => {
    const a = baseline(
      "a",
      makeState({
        chests: [
          {
            id: "uuid-a",
            source: "level",
            label: "Nivel 3 · Lector constante",
            reward: "bufanda",
            createdAt: 2000,
            openedAt: null,
          },
          {
            id: "uuid-b",
            source: "achievement",
            label: "Primera palabra",
            reward: "Estampa · Primera palabra",
            createdAt: 3000,
            openedAt: null,
          },
          {
            id: "uuid-c",
            source: "level",
            label: "Cofre raro de otra versión",
            reward: "???",
            createdAt: 1000,
            openedAt: null,
          },
        ],
      }),
    );
    const merged = mergeLegacyBaselines([a]);
    expect(merged.chests.map((c) => c.id)).toEqual([
      "legacy:uuid-c",
      "level:2",
      "achievement:palabra_1",
    ]);
  });

  it("cofres duplicados entre réplicas: abierto gana, createdAt mínimo", () => {
    const chest = (id: string, createdAt: number, openedAt: number | null) => ({
      id,
      source: "level" as const,
      label: "Nivel 3 · Lector constante",
      reward: "bufanda",
      createdAt,
      openedAt,
    });
    const a = baseline("a", makeState({ chests: [chest("uuid-1", 2000, null)] }));
    const b = baseline("b", makeState({ chests: [chest("uuid-2", 1500, 1800)] }));
    const merged = mergeLegacyBaselines([a, b]);
    expect(merged.chests).toHaveLength(1);
    expect(merged.chests[0]).toMatchObject({
      id: "level:2",
      createdAt: 1500,
      openedAt: 1800,
      reward: "bufanda",
    });
  });

  it("etiqueta de nivel que no cuadra con el catálogo queda legacy", () => {
    expect(
      canonicalChestKey({
        id: "x",
        source: "level",
        label: "Nivel 3 · Nombre inventado",
        reward: "bufanda",
        createdAt: 1,
        openedAt: null,
      }),
    ).toBe("legacy:x");
  });

  it("el merge es conmutativo: mismo conjunto, mismo resultado", () => {
    const a = baseline(
      "a",
      makeState({ xp: 80, finishedBooks: ["h1"], caredAt: 500 }),
    );
    const b = baseline(
      "b",
      makeState({ xp: 120, finishedBooks: ["h2"], caredAt: 900 }),
    );
    expect(mergeLegacyBaselines([a, b])).toEqual(mergeLegacyBaselines([b, a]));
  });
});

describe("receipts", () => {
  it("receiptIdFor/parseReceiptId hacen round-trip con claves con ':'", () => {
    const id = receiptIdFor("chest-open", "level:2");
    expect(id).toBe("chest-open:level:2");
    expect(parseReceiptId(id)).toEqual({ kind: "chest-open", key: "level:2" });
    expect(parseReceiptId("achievement-credit:palabra_1")).toEqual({
      kind: "achievement-credit",
      key: "palabra_1",
    });
    expect(parseReceiptId("inventado:x")).toBeNull();
    expect(parseReceiptId("sinclave")).toBeNull();
  });
});

describe("projectGame", () => {
  it("XP proyectada = baseline + aportes únicos + XP de créditos", () => {
    const s = snap({
      baselines: [baseline("a", makeState({ xp: 100 }))],
      events: [
        ev("e1", T0, "2025-06-10", { kind: "consulted" }),
        ev("e2", T0 + 1, "2025-06-10", { kind: "saved", zipf: null }),
      ],
      receipts: [{ id: "achievement-credit:palabra_1", at: T0 + 2 }],
    });
    const p = projectGame(s);
    // 100 base + 2 consulta + 3 guardada + 10 del catálogo por palabra_1.
    expect(p.state.xp).toBe(115);
    expect(p.creditedAchievements).toEqual(["palabra_1"]);
    expect(p.state.achievements.palabra_1).toBe(T0 + 2);
    expect(p.contributions.get("e1")).toBe(2);
    expect(p.contributions.get("e2")).toBe(3);
  });

  it("permutar los eventos produce exactamente el mismo estado", () => {
    const events = [
      ev("e1", T0, "2025-06-10", { kind: "read", ms: 90_000 }),
      ev("e2", T0 + 1, "2025-06-10", { kind: "saved", zipf: 2.0 }),
      ev("e3", T0 + 2, "2025-06-11", { kind: "consulted" }, { streakBonus: true }),
      ev("e4", T0 + 3, "2025-06-11", { kind: "review", rating: "easy" }),
    ];
    const s1 = snap({ events });
    const s2 = snap({ events: [...events].reverse() });
    const p1 = projectGame(s1);
    const p2 = projectGame(s2);
    expect(p1.state).toEqual(p2.state);
    expect(p1.contributions).toEqual(p2.contributions);
  });

  it("el mismo eventId no suma dos veces; gana la primera copia en (at,id)", () => {
    const s = snap({
      events: [
        ev("dup", T0 + 5, "2025-06-10", { kind: "read", ms: 120_000 }),
        ev("dup", T0, "2025-06-10", { kind: "read", ms: 60_000 }),
      ],
    });
    const p = projectGame(s);
    expect(p.state.stats.minutes).toBeCloseTo(1);
    expect(p.state.xp).toBeCloseTo(1);
    expect([...p.contributions.keys()]).toEqual(["dup"]);
  });

  it("dos book_finished elegibles del mismo hash acreditan una sola vez", () => {
    const s = snap({
      events: [
        ev("b1", T0, "2025-06-10", { kind: "book_finished", bookHash: "h1" }, { bookCreditEligible: true }),
        ev("b2", T0 + 1, "2025-06-10", { kind: "book_finished", bookHash: "h1" }, { bookCreditEligible: true, streakBonus: true }),
        ev("b3", T0 + 2, "2025-06-10", { kind: "book_finished", bookHash: "h2" }, { bookCreditEligible: true }),
      ],
    });
    const p = projectGame(s);
    // h1 acredita una vez con el mayor aporte congelado (55 con bonus),
    // h2 acredita 50. Dos libros distintos sí cuentan.
    expect(p.state.xp).toBeCloseTo(105);
    expect(p.state.stats.booksFinished).toBe(2);
    expect(p.state.finishedBooks).toEqual(["h1", "h2"]);
    expect(p.contributions.get("b2")).toBe(55);
    expect(p.contributions.get("b1")).toBe(0);
    expect(p.contributions.get("b3")).toBe(50);
  });

  it("book_finished no elegible no aporta ni marca el libro", () => {
    const s = snap({
      events: [ev("b1", T0, "2025-06-10", { kind: "book_finished", bookHash: "h1" })],
    });
    const p = projectGame(s);
    expect(p.state.xp).toBe(0);
    expect(p.state.finishedBooks).toEqual([]);
    expect(p.contributions.get("b1")).toBe(0);
  });

  it("streakBonus congelado no cambia por el orden de llegada", () => {
    const events = [
      ev("a", T0, "2025-06-10", { kind: "saved", zipf: null }, { streakBonus: true }),
      ev("b", T0 + 1, "2025-06-10", { kind: "saved", zipf: null }),
    ];
    const forward = projectGame(snap({ events }));
    const backward = projectGame(snap({ events: [events[1], events[0]] }));
    expect(forward.state.xp).toBeCloseTo(3.3 + 3);
    expect(backward.state.xp).toBeCloseTo(forward.state.xp);
    expect(forward.contributions.get("a")).toBeCloseTo(3.3);
  });

  it("un crédito guardado no se retira aunque un baseline tardío tenga el logro", () => {
    const s = snap({
      baselines: [
        baseline("a", makeState({ xp: 100, achievements: { palabra_1: 50 } })),
      ],
      receipts: [{ id: "achievement-credit:palabra_1", at: T0 }],
    });
    // El +10 del crédito se conserva: lo ganado no baja por importar tarde.
    expect(projectGame(s).state.xp).toBe(110);
  });

  it("replica la racha por dayKey sin rebobinar el frente del baseline", () => {
    const s = snap({
      baselines: [
        baseline(
          "a",
          makeState({}, { lastDayKey: "2025-06-10", streakDays: 2 }),
        ),
      ],
      events: [
        // Día anterior al frente: ya está sellado en el baseline.
        ev("old", T0 - DAY, "2025-06-09", { kind: "consulted" }),
        ev("next", T0 + DAY, "2025-06-11", { kind: "consulted" }),
      ],
    });
    const p = projectGame(s);
    expect(p.state.stats.lastDayKey).toBe("2025-06-11");
    expect(p.state.stats.streakDays).toBe(3);
    // Y un hueco mayor a un día reinicia la racha, como en applyGameEvent.
    const s2 = snap({
      baselines: s.baselines,
      events: [ev("far", T0 + 5 * DAY, "2025-06-15", { kind: "consulted" })],
    });
    expect(projectGame(s2).state.stats.streakDays).toBe(1);

    // Pero si la racha previa es >= 3 y el hueco es de un solo día (gap === 2), el marcapáginas la salva.
    const sShield = snap({
      baselines: [
        baseline("a", makeState({}, { lastDayKey: "2025-06-10", streakDays: 3 })),
      ],
      events: [ev("skip1", T0 + 2 * DAY, "2025-06-12", { kind: "consulted" })],
    });
    expect(projectGame(sShield).state.stats.streakDays).toBe(4);
  });

  it("caredAt es el máximo entre baseline y eventos", () => {
    const s = snap({
      baselines: [baseline("a", makeState({ caredAt: T0 }))],
      events: [ev("e", T0 + 999, "2025-06-10", { kind: "consulted" })],
    });
    expect(projectGame(s).state.caredAt).toBe(T0 + 999);
  });

  it("`now` acota la proyección a una fecha", () => {
    const s = snap({
      events: [
        ev("e1", T0, "2025-06-10", { kind: "consulted" }),
        ev("e2", T0 + DAY, "2025-06-11", { kind: "consulted" }),
      ],
      receipts: [{ id: "achievement-credit:palabra_1", at: T0 + DAY }],
    });
    const early = projectGame(s, T0);
    expect(early.state.xp).toBe(2);
    expect(early.creditedAchievements).toEqual([]);
    expect(projectGame(s).state.xp).toBe(14);
  });
});

describe("pendingAchievementCredits", () => {
  it("los baselines por sí solos no generan créditos", () => {
    const s = snap({
      baselines: [baseline("a", makeState({}, { saved: 10 }))],
    });
    expect(pendingAchievementCredits(s)).toEqual([]);
  });

  it("eventos nuevos que cruzan un umbral generan el crédito una vez", () => {
    const s = snap({
      baselines: [baseline("a", makeState({}, { saved: 9 }))],
      events: [ev("e", T0, "2025-06-10", { kind: "saved", zipf: null })],
    });
    const pending = pendingAchievementCredits(s);
    // saved llega a 10: palabra_1 y palabras_10 quedan pendientes.
    expect(pending).toEqual(
      expect.arrayContaining(["palabra_1", "palabras_10"]),
    );
    // Con el receipt ya guardado, deja de estar pendiente.
    const withReceipt = snap({
      ...s,
      receipts: [
        { id: "achievement-credit:palabra_1", at: T0 },
        { id: "achievement-credit:palabras_10", at: T0 },
      ],
    });
    expect(pendingAchievementCredits(withReceipt)).toEqual([]);
  });

  it("un logro que el baseline ya tenía no vuelve a estar pendiente", () => {
    const s = snap({
      baselines: [
        baseline(
          "a",
          makeState({ achievements: { palabra_1: 1 } }, { saved: 5 }),
        ),
      ],
      events: [ev("e", T0, "2025-06-10", { kind: "consulted" })],
    });
    expect(pendingAchievementCredits(s)).not.toContain("palabra_1");
  });
});

describe("projectChests", () => {
  it("un crédito crea su cofre con label/reward de applyGameEvent", () => {
    const s = snap({
      receipts: [{ id: "achievement-credit:palabra_1", at: T0 }],
    });
    const chests = projectChests(s);
    expect(chests).toHaveLength(1);
    expect(chests[0]).toMatchObject({
      id: "achievement:palabra_1",
      source: "achievement",
      label: "Primera palabra",
      reward: "Estampa · Primera palabra",
      createdAt: T0,
      openedAt: null,
    });
  });

  it("un crédito de libro genera cofre con Exlibris conmemorativo", () => {
    const s = snap({
      receipts: [{ id: "achievement-credit:libro_1", at: T0 }],
    });
    const chests = projectChests(s);
    const exlibris = chests.find((c) => c.id === "achievement:libro_1");
    expect(exlibris).toMatchObject({
      id: "achievement:libro_1",
      source: "achievement",
      label: "Primer libro cerrado",
      reward: "Exlibris conmemorativo",
      createdAt: T0,
      openedAt: null,
    });
  });

  it("cruzar un nivel crea el cofre fechado con el evento que lo cruzó", () => {
    const s = snap({
      baselines: [baseline("a", makeState({ xp: 85 }))], // nivel 1
      events: [
        ev("e", T0, "2025-06-10", { kind: "read", ms: 600_000 }), // +10 → 95 (nivel 2)
      ],
    });
    const chests = projectChests(s);
    const levelChest = chests.find((c) => c.id === "level:2");
    expect(levelChest).toMatchObject({
      source: "level",
      label: "Nivel 3 · Lector constante",
      reward: "bufanda",
      createdAt: T0,
    });
  });

  it("receipt chest-open marca la apertura y no duplica el cofre", () => {
    const s = snap({
      baselines: [
        baseline(
          "a",
          makeState({
            xp: 100,
            achievements: { palabra_1: 10 },
            chests: [
              {
                id: "uuid-1",
                source: "achievement",
                label: "Primera palabra",
                reward: "Estampa · Primera palabra",
                createdAt: 10,
                openedAt: null,
              },
            ],
          }),
        ),
      ],
      receipts: [
        { id: "achievement-credit:palabra_1", at: T0 },
        { id: "chest-open:achievement:palabra_1", at: T0 + 5 },
      ],
    });
    const chests = projectChests(s);
    expect(chests.filter((c) => c.id === "achievement:palabra_1")).toHaveLength(1);
    expect(chests[0].openedAt).toBe(T0 + 5);
  });
});

describe("registros del perfil", () => {
  const reg = (
    field: CompanionRegister["field"],
    value: unknown,
    updatedAt: number,
    operationId: string,
  ): CompanionRegister => ({ field, value, updatedAt, operationId });

  it("un null explícito nuevo gana a una réplica vieja con valor", () => {
    const merged = mergeCompanionRegister([
      reg("equipped.neck", "bufanda", 100, "op-a"),
      reg("equipped.neck", null, 200, "op-b"),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].value).toBeNull();
  });

  it("a updatedAt empatado desempata operationId", () => {
    const merged = mergeCompanionRegister([
      reg("name", "Misifus", 100, "op-b"),
      reg("name", "Gato", 100, "op-a"),
    ]);
    expect(merged[0].value).toBe("Misifus");
  });

  it("getEquippedItems devuelve null por ranura ausente o quitada", () => {
    expect(getEquippedItems([])).toEqual({
      body: null,
      neck: null,
      head: null,
      face: null,
      coat: null,
    });
    const items = getEquippedItems([
      reg("equipped.neck", "bufanda", 1, "a"),
      reg("equipped.face", "anteojos", 1, "b"),
      reg("equipped.head", null, 1, "c"),
    ]);
    expect(items).toEqual({
      body: null,
      neck: "bufanda",
      head: null,
      face: "anteojos",
      coat: null,
    });
  });
});

describe("validateCompanionBatch", () => {
  const validEvent = {
    version: 1,
    id: "read:abc",
    at: T0,
    dayKey: "2025-06-10",
    streakBonus: false,
    event: { kind: "read", ms: 60_000 },
    interval: { startedAt: T0 - 60_000, endedAt: T0 },
  };
  const validBaseline = {
    version: 1,
    originId: "dev-1",
    state: makeState({ xp: 42.5, finishedBooks: ["h1"], caredAt: T0 }),
  };
  const validField = {
    field: "equipped.neck",
    value: "bufanda",
    updatedAt: T0,
    operationId: "op-1",
  };
  const validReceipt = { id: "achievement-credit:palabra_1", at: T0 };

  it("un lote bien formado pasa y devuelve el batch normalizado", () => {
    const r = validateCompanionBatch({
      version: 1,
      baselines: [validBaseline],
      events: [validEvent],
      fields: [validField],
      receipts: [validReceipt],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.batch.events[0].id).toBe("read:abc");
      expect(r.batch.baselines[0].state.xp).toBe(42.5);
    }
  });

  it("más de 120 elementos en total se rechaza", () => {
    const r = validateCompanionBatch({
      version: 1,
      baselines: [],
      events: [],
      fields: [],
      receipts: Array.from({ length: 121 }, () => ({
        id: "achievement-seen:palabra_1",
        at: T0,
      })),
    });
    expect(r).toEqual({ ok: false, reason: "batch too large" });
  });

  it("read con ms que no coincide con el intervalo se rechaza", () => {
    const bad = {
      ...validEvent,
      event: { kind: "read", ms: 90_000 },
    };
    const r = validateCompanionBatch({
      version: 1,
      baselines: [],
      events: [bad],
      fields: [],
      receipts: [],
    });
    expect(r.ok).toBe(false);
  });

  it("un read de más de 30 minutos se rechaza", () => {
    const r = validateCompanionBatch({
      version: 1,
      baselines: [],
      events: [
        { ...validEvent, event: { kind: "read", ms: 31 * 60_000 }, interval: undefined },
      ],
      fields: [],
      receipts: [],
    });
    expect(r.ok).toBe(false);
  });

  it("achievement-credit con id fuera del catálogo se rechaza", () => {
    const r = validateCompanionBatch({
      version: 1,
      baselines: [],
      events: [],
      fields: [],
      receipts: [{ id: "achievement-credit:no_existe", at: T0 }],
    });
    expect(r.ok).toBe(false);
  });

  it("equipped.coat acepta un pelaje y rechaza una prenda", () => {
    const field = (field: string, value: unknown) =>
      validateCompanionBatch({
        version: 1,
        baselines: [],
        events: [],
        fields: [
          { field, value, updatedAt: T0, operationId: "op-1" },
        ],
        receipts: [],
      });
    expect(field("equipped.coat", "pelaje-gris").ok).toBe(true);
    expect(field("equipped.coat", "pelaje-calico").ok).toBe(true);
    expect(field("equipped.coat", "pelaje-negro").ok).toBe(true);
    expect(field("equipped.coat", null).ok).toBe(true);
    expect(field("equipped.head", "boina").ok).toBe(true);
    expect(field("equipped.body", "capa").ok).toBe(true);
    expect(field("equipped.neck", "corbatin").ok).toBe(true);
    expect(field("equipped.face", "monoculo").ok).toBe(true);
    // Una prenda de otra ranura no cuela en la ranura de pelaje.
    expect(field("equipped.coat", "bufanda").ok).toBe(false);
    expect(field("equipped.neck", "pelaje-gris").ok).toBe(false);
    expect(field("equipped.face", "boina").ok).toBe(false);
  });

  it("un baseline corrupto se rechaza (xp negativa, stats incompletos)", () => {
    const corrupt = {
      version: 1,
      originId: "dev-1",
      state: { version: 1, xp: -5, stats: { minutes: 1 } },
    };
    expect(
      validateCompanionBatch({
        version: 1,
        baselines: [corrupt],
        events: [],
        fields: [],
        receipts: [],
      }).ok,
    ).toBe(false);
  });

  it("dayKey con formato o fecha imposible se rechaza", () => {
    for (const dayKey of ["2025-02-30", "2025-6-1", "10/06/2025"]) {
      const r = validateCompanionBatch({
        version: 1,
        baselines: [],
        events: [{ ...validEvent, dayKey }],
        fields: [],
        receipts: [],
      });
      expect(r.ok).toBe(false);
    }
    // Y 29 de febrero sí es válido en año bisiesto.
    expect(
      validateCompanionBatch({
        version: 1,
        baselines: [],
        events: [{ ...validEvent, dayKey: "2024-02-29" }],
        fields: [],
        receipts: [],
      }).ok,
    ).toBe(true);
  });

  it("mismo id de evento con payload distinto dentro del lote se rechaza", () => {
    const other = { ...validEvent, event: { kind: "read", ms: 30_000 } };
    // sin interval para que difiera del original
    delete (other as Record<string, unknown>).interval;
    const r = validateCompanionBatch({
      version: 1,
      baselines: [],
      events: [validEvent, other],
      fields: [],
      receipts: [],
    });
    expect(r).toEqual({ ok: false, reason: "conflicting event id" });
    // La misma entrada repetida idéntica sí pasa (reenvío idempotente).
    expect(
      validateCompanionBatch({
        version: 1,
        baselines: [],
        events: [validEvent, { ...validEvent }],
        fields: [],
        receipts: [],
      }).ok,
    ).toBe(true);
  });

  it("stage-seen solo acepta índices 0..4 y campos cerrados", () => {
    const badStage = validateCompanionBatch({
      version: 1,
      baselines: [],
      events: [],
      fields: [],
      receipts: [{ id: "stage-seen:5", at: T0 }],
    });
    expect(badStage.ok).toBe(false);
    // Una prenda conocida en la ranura equivocada tampoco pasa.
    const wrongSlot = validateCompanionBatch({
      version: 1,
      baselines: [],
      events: [],
      fields: [
        { field: "equipped.face", value: "bufanda", updatedAt: T0, operationId: "o" },
      ],
      receipts: [],
    });
    expect(wrongSlot.ok).toBe(false);
  });

  it("los ids del catálogo sí pasan las categorías de logro", () => {
    // Sanity: todos los ids reales son válidos para credit/seen.
    for (const a of ACHIEVEMENTS.slice(0, 3)) {
      for (const kind of ["achievement-credit", "achievement-seen"]) {
        expect(
          validateCompanionBatch({
            version: 1,
            baselines: [],
            events: [],
            fields: [],
            receipts: [{ id: `${kind}:${a.id}`, at: T0 }],
          }).ok,
        ).toBe(true);
      }
    }
  });

  it("level-seen solo acepta índices válidos de nivel (1..9)", () => {
    // Índices válidos 1..9
    for (let i = 1; i <= 9; i++) {
      expect(
        validateCompanionBatch({
          version: 1,
          baselines: [],
          events: [],
          fields: [],
          receipts: [{ id: `level-seen:${i}`, at: T0 }],
        }).ok,
      ).toBe(true);
    }

    // Inválidos: 0 (Inicio no se festeja), >= 10, no canónicos o negativos
    for (const bad of ["0", "10", "foo", "-1", "01"]) {
      expect(
        validateCompanionBatch({
          version: 1,
          baselines: [],
          events: [],
          fields: [],
          receipts: [{ id: `level-seen:${bad}`, at: T0 }],
        }).ok,
      ).toBe(false);
    }
  });

  it("sync tolerante hacia adelante conserva recibos desconocidos al bajar y el PUT los rechaza", () => {
    const batchWithUnknown = {
      version: 1,
      baselines: [],
      events: [],
      fields: [],
      receipts: [
        { id: "achievement-seen:logro_futuro_999", at: T0 },
        { id: "categoria-futura:clave_nueva", at: T0 },
      ],
    };

    // Modo estricto (servidor / PUT predeterminado): rechaza
    const strictResult = validateCompanionBatch(batchWithUnknown);
    expect(strictResult.ok).toBe(false);

    // Modo tolerante (pull / cleanPage con unknownCatalog: "keep"): acepta
    const tolerantResult = validateCompanionBatch(batchWithUnknown, { unknownCatalog: "keep" });
    expect(tolerantResult.ok).toBe(true);
    if (tolerantResult.ok) {
      expect(tolerantResult.batch.receipts).toHaveLength(2);
      expect(tolerantResult.batch.receipts.map((r) => r.id)).toEqual([
        "achievement-seen:logro_futuro_999",
        "categoria-futura:clave_nueva",
      ]);
    }
  });
});

describe("bestStreak", () => {
  it("conserva la racha inicial del baseline si no hay eventos", () => {
    const s = snap({
      baselines: [baseline("b1", makeState({}, { streakDays: 7, lastDayKey: "2025-06-10" }))],
    });
    expect(bestStreak(s)).toBe(7);
  });

  it("sube con días consecutivos y protege huecos con marcapáginas", () => {
    // Baseline con racha 3 al 2025-06-10
    const b = baseline("b1", makeState({}, { streakDays: 3, lastDayKey: "2025-06-10" }));
    const events = [
      ev("e1", T0 + 1 * DAY, "2025-06-11", { kind: "read", ms: 60_000 }), // día 4
      ev("e2", T0 + 2 * DAY, "2025-06-12", { kind: "read", ms: 60_000 }), // día 5
      // Hueco de un día: salta el 2025-06-13, lee el 2025-06-14 (gap = 2, racha >= 3 protegida por marcapáginas)
      ev("e3", T0 + 4 * DAY, "2025-06-14", { kind: "read", ms: 60_000 }), // día 6
      // Hueco de 3 días: salta 15, 16, 17 y lee el 18 -> reinicia a 1
      ev("e4", T0 + 8 * DAY, "2025-06-18", { kind: "read", ms: 60_000 }), // día 1
      ev("e5", T0 + 9 * DAY, "2025-06-19", { kind: "read", ms: 60_000 }), // día 2
    ];

    const s = snap({ baselines: [b], events });
    // La racha actual en la proyección será 2, pero bestStreak debe ser 6
    expect(projectGame(s).state.stats.streakDays).toBe(2);
    expect(bestStreak(s)).toBe(6);
  });
});

describe("retroactividad de logros", () => {
  it("un usuario con historial acredita los logros nuevos una sola vez", () => {
    // Usuario con 300 palabras guardadas y 100 horas leídas en el baseline
    const b = baseline(
      "b1",
      makeState(
        {
          achievements: { palabra_1: T0, palabras_10: T0, palabras_50: T0, palabras_100: T0 },
        },
        { saved: 300, minutes: 6000 },
      ),
    );

    // Sin eventos nuevos, no hay créditos pendientes
    const s0 = snap({ baselines: [b], events: [] });
    expect(pendingAchievementCredits(s0)).toEqual([]);

    // Al llegar un evento nuevo posterior a la migración
    const event = ev("e1", T0 + 1000, "2025-06-11", { kind: "consulted" });
    const s1 = snap({ baselines: [b], events: [event] });

    const pending = pendingAchievementCredits(s1);
    // Debe acreditar palabras_250, lectura_1h, lectura_10h, lectura_25h, lectura_50h, lectura_100h
    expect(pending).toContain("palabras_250");
    expect(pending).toContain("lectura_25h");
    expect(pending).toContain("lectura_100h");

    // Una vez que se agrega el recibo achievement-credit, ya no queda pendiente
    const s2 = snap({
      baselines: [b],
      events: [event],
      receipts: [
        { id: "achievement-credit:palabras_250", at: T0 + 1000 },
        { id: "achievement-credit:lectura_25h", at: T0 + 1000 },
        { id: "achievement-credit:lectura_100h", at: T0 + 1000 },
      ],
    });
    const remainingPending = pendingAchievementCredits(s2);
    expect(remainingPending).not.toContain("palabras_250");
    expect(remainingPending).not.toContain("lectura_25h");
    expect(remainingPending).not.toContain("lectura_100h");
  });
});

describe("catálogo de pelajes y prendas del compañero", () => {
  it("contiene los 5 pelajes principales con paletas de alto contraste", () => {
    expect(COMPANION_COAT_IDS).toEqual(["tuxedo", "latte", "ginger", "mist", "calico"]);
    for (const id of COMPANION_COAT_IDS) {
      const coat = COMPANION_COATS[id];
      expect(coat.id).toBe(id);
      expect(coat.name).toBeTruthy();
      expect(coat.description).toBeTruthy();
      expect(coat.fur).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(coat.chest).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(coat.eyes).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(coat.nose).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(coat.earInner).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(coat.pawPads).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
    // Tuxedo tiene rimLight para modo oscuro
    expect(COMPANION_COATS.tuxedo.rimLight).toBe("#4A5264");
  });

  it("resolveCoatId resuelve correctamente IDs directos y artículos heredados", () => {
    expect(resolveCoatId()).toBe("tuxedo");
    expect(resolveCoatId(null)).toBe("tuxedo");
    expect(resolveCoatId("tuxedo")).toBe("tuxedo");
    expect(resolveCoatId("pelaje-tuxedo")).toBe("tuxedo");
    expect(resolveCoatId("pelaje-negro")).toBe("tuxedo");
    expect(resolveCoatId("latte")).toBe("latte");
    expect(resolveCoatId("pelaje-siames")).toBe("latte");
    expect(resolveCoatId("ginger")).toBe("ginger");
    expect(resolveCoatId("pelaje-atigrado")).toBe("ginger");
    expect(resolveCoatId("mist")).toBe("mist");
    expect(resolveCoatId("pelaje-gris")).toBe("mist");
    expect(resolveCoatId("calico")).toBe("calico");
    expect(resolveCoatId("pelaje-calico")).toBe("calico");
  });

  it("todos los artículos pertenecen a una ranura válida", () => {
    const validSlots = ["head", "neck", "face", "body", "coat"];
    for (const [article, slot] of Object.entries(COMPANION_ARTICLES)) {
      expect(article).toBeTruthy();
      expect(validSlots).toContain(slot);
    }
  });

  it("getEquippedItems asigna cada prenda a su ranura correspondiente", () => {
    const regs: CompanionRegister[] = [
      { field: "equipped.head", value: "beret_poet", updatedAt: 100, operationId: "o1" },
      { field: "equipped.neck", value: "scarf_amber", updatedAt: 100, operationId: "o2" },
      { field: "equipped.face", value: "glasses_round", updatedAt: 100, operationId: "o3" },
      { field: "equipped.body", value: "cape_modernist", updatedAt: 100, operationId: "o4" },
      { field: "equipped.coat", value: "tuxedo", updatedAt: 100, operationId: "o5" },
    ];
    const items = getEquippedItems(regs);
    expect(items.head).toBe("beret_poet");
    expect(items.neck).toBe("scarf_amber");
    expect(items.face).toBe("glasses_round");
    expect(items.body).toBe("cape_modernist");
    expect(items.coat).toBe("tuxedo");
  });
});

