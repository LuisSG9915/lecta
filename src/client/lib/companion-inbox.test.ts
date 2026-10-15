// Pruebas del inbox de festejos: qué premios quedan pendientes según
// proyección, baseline importada y recibos de visto. Las reglas duras
// son las del diseño: lo importado no celebra, lo visto no se repite,
// varios logros se agrupan, las subidas de nivel se agrupan en el nivel
// más alto con su evolución si coincide.
import { describe, expect, it } from "vitest";
import {
  generateDeterministicCompanionLetter,
  parseCompanionLetters,
  pendingCelebrations,
} from "./companion-inbox";
import { receiptIdFor } from "../../shared/companion-data";
import type {
  CompanionReceipt,
  LegacyGameBaseline,
} from "../../shared/companion-data";
import { emptyGameState, type GameState } from "./gamification";

const state = (partial: Partial<GameState>): GameState => ({
  ...emptyGameState(),
  ...partial,
});

const baseline = (s: Partial<GameState>): LegacyGameBaseline => ({
  version: 1,
  originId: "legacy",
  state: state(s),
});

const receipt = (kind: string, key: string): CompanionReceipt => ({
  id: receiptIdFor(kind as never, key),
  at: 1_000,
});

describe("pendingCelebrations", () => {
  it("un logro nuevo queda pendiente", () => {
    const items = pendingCelebrations({
      state: state({ achievements: { "palabra_1": 100 } }),
      baselines: [],
      receipts: [],
    });
    expect(items).toEqual([
      {
        kind: "achievements",
        ids: ["palabra_1"],
        titles: [expect.any(String)],
      },
    ]);
  });

  it("un logro heredado de la baseline no celebra", () => {
    const items = pendingCelebrations({
      state: state({ achievements: { "palabra_1": 100 } }),
      baselines: [baseline({ achievements: { "palabra_1": 50 } })],
      receipts: [],
    });
    expect(items).toEqual([]);
  });

  it("un logro ya visto (recibo) no se repite", () => {
    const items = pendingCelebrations({
      state: state({ achievements: { "palabra_1": 100 } }),
      baselines: [],
      receipts: [receipt("achievement-seen", "palabra_1")],
    });
    expect(items).toEqual([]);
  });

  it("un id fuera del catálogo vigente no genera tarjeta", () => {
    const items = pendingCelebrations({
      state: state({ achievements: { "logro_viejo_x": 100 } }),
      baselines: [],
      receipts: [],
    });
    expect(items).toEqual([]);
  });

  it("varios logros nuevos se agrupan en una sola tarjeta", () => {
    const items = pendingCelebrations({
      state: state({
        achievements: { "palabra_1": 100, "racha_3": 200, "curioso_50": 300 },
      }),
      baselines: [],
      receipts: [],
    });
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("achievements");
    if (items[0].kind === "achievements") {
      expect(items[0].ids).toHaveLength(3);
      // Orden por sello de obtención: el primero titula la tarjeta.
      expect(items[0].ids[0]).toBe("palabra_1");
      expect(items[0].titles).toHaveLength(3);
    }
  });

  it("mezcla baseline + nuevo: solo el nuevo celebra", () => {
    const items = pendingCelebrations({
      state: state({
        achievements: { "palabra_1": 50, "palabras_10": 300 },
      }),
      baselines: [baseline({ achievements: { "palabra_1": 50 } })],
      receipts: [],
    });
    expect(items).toEqual([
      expect.objectContaining({ kind: "achievements", ids: ["palabras_10"] }),
    ]);
  });

  it("subida de nivel simple sin evolución", () => {
    // 35 xp → nivel «Lector curioso» (índice 1) → etapa 0 (sin evolución).
    const items = pendingCelebrations({
      state: state({ xp: 35 }),
      baselines: [],
      receipts: [],
    });
    expect(items).toEqual([{ kind: "level", level: 1, crossed: [1] }]);
  });

  it("cambio de etapa proyectado se agrupa en la tarjeta de nivel", () => {
    // 90 xp → nivel «Lector constante» (índice 2) → etapa 1.
    const items = pendingCelebrations({
      state: state({ xp: 95 }),
      baselines: [],
      receipts: [],
    });
    expect(items).toEqual([
      { kind: "level", level: 2, crossed: [1, 2], stage: 1 },
    ]);
  });

  it("la etapa y nivel de la baseline no celebran", () => {
    const items = pendingCelebrations({
      state: state({ xp: 95 }),
      baselines: [baseline({ xp: 95 })],
      receipts: [],
    });
    expect(items).toEqual([]);
  });

  it("un nivel y etapa ya celebrados (recibo) no se repiten", () => {
    const items = pendingCelebrations({
      state: state({ xp: 95 }),
      baselines: [],
      receipts: [
        receipt("level-seen", "1"),
        receipt("level-seen", "2"),
        receipt("stage-seen", "1"),
      ],
    });
    expect(items).toEqual([]);
  });

  it("si los niveles ya se vieron pero la etapa no, celebra stage como fallback", () => {
    const items = pendingCelebrations({
      state: state({ xp: 95 }),
      baselines: [],
      receipts: [receipt("level-seen", "1"), receipt("level-seen", "2")],
    });
    expect(items).toEqual([{ kind: "stage", stage: 1 }]);
  });

  it("salto de varios niveles muestra el nivel más alto y agrupa la etapa", () => {
    // xp suficiente para etapa 3 (nivel ≥6 → 800 xp).
    const items = pendingCelebrations({
      state: state({ xp: 900 }),
      baselines: [],
      receipts: [],
    });
    expect(items).toEqual([
      {
        kind: "level",
        level: 6,
        crossed: [1, 2, 3, 4, 5, 6],
        stage: 3,
      },
    ]);
  });

  it("logro + nivel pendientes salen como dos tarjetas en cola", () => {
    const items = pendingCelebrations({
      state: state({ xp: 95, achievements: { "palabra_1": 100 } }),
      baselines: [],
      receipts: [],
    });
    expect(items.map((i) => i.kind)).toEqual(["achievements", "level"]);
  });
});

describe("Cartas y Notas del Buzón del Gato (Lecta v2.0)", () => {
  it("genera carta determinista interpolando libro y palabra aprendida", () => {
    const letter = generateDeterministicCompanionLetter({
      catName: "Sombra",
      bookTitle: "Azul...",
      masteredWord: "alegoría",
    });

    expect(letter.title).toContain("alegoría");
    expect(letter.note).toContain("alegoría");
    expect(letter.note).toContain("Azul...");
    expect(letter.signOff).toContain("Sombra");
    expect(letter.fromCat).toBe(true);
    expect(letter.read).toBe(false);
  });

  it("genera carta para logros alcanzados", () => {
    const letter = generateDeterministicCompanionLetter({
      catName: "Michi",
      achievementTitle: "Primera palabra",
    });

    expect(letter.title).toContain("Primera palabra");
    expect(letter.note).toContain("Primera palabra");
  });

  it("parseCompanionLetters maneja entradas válidas e inválidas", () => {
    expect(parseCompanionLetters(null)).toEqual([]);
    expect(parseCompanionLetters("invalid-json")).toEqual([]);

    const sample = [
      { id: "l1", note: "Hola", title: "Nota", signOff: "Gato", read: false, fromCat: true, date: 100 },
    ];
    expect(parseCompanionLetters(JSON.stringify(sample))).toHaveLength(1);
  });
});
