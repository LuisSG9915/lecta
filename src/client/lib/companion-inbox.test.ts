// Pruebas del inbox de festejos: qué premios quedan pendientes según
// proyección, baseline importada y recibos de visto. Las reglas duras
// son las del diseño: lo importado no celebra, lo visto no se repite,
// varios logros se agrupan y la etapa celebra solo el cambio.
import { describe, expect, it } from "vitest";
import { pendingCelebrations } from "./companion-inbox";
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

  it("cambio de etapa proyectado queda pendiente", () => {
    // 90 xp → nivel «Lector constante» (índice 2) → etapa 1.
    const items = pendingCelebrations({
      state: state({ xp: 95 }),
      baselines: [],
      receipts: [],
    });
    expect(items).toEqual([{ kind: "stage", stage: 1 }]);
  });

  it("la etapa de la baseline no celebra", () => {
    const items = pendingCelebrations({
      state: state({ xp: 95 }),
      baselines: [baseline({ xp: 95 })],
      receipts: [],
    });
    expect(items).toEqual([]);
  });

  it("una etapa ya celebrada (recibo) no se repite", () => {
    const items = pendingCelebrations({
      state: state({ xp: 95 }),
      baselines: [],
      receipts: [receipt("stage-seen", "1")],
    });
    expect(items).toEqual([]);
  });

  it("crecer dos etapas muestra solo la vigente — sustituye la vieja", () => {
    // xp suficiente para etapa 3 (nivel ≥6 → 800 xp).
    const items = pendingCelebrations({
      state: state({ xp: 900 }),
      baselines: [],
      receipts: [],
    });
    const stages = items.filter((i) => i.kind === "stage");
    expect(stages).toEqual([{ kind: "stage", stage: 3 }]);
  });

  it("logro + etapa pendientes salen como dos tarjetas en cola", () => {
    const items = pendingCelebrations({
      state: state({ xp: 95, achievements: { "palabra_1": 100 } }),
      baselines: [],
      receipts: [],
    });
    expect(items.map((i) => i.kind)).toEqual(["achievements", "stage"]);
  });
});
