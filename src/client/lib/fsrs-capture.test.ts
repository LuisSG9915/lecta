import { describe, expect, it } from "vitest";
import {
  CAPTURE_SOURCE_PARAMS,
  newCard,
  newCardWithSource,
} from "./fsrs";

describe("Inicialización Inteligente en FSRS por CaptureSource (Fase 4.4)", () => {
  it("parámetros correctos para cada fuente de captura", () => {
    expect(CAPTURE_SOURCE_PARAMS.pre_reading).toEqual({ difficulty: 4.5, stability: 2.0 });
    expect(CAPTURE_SOURCE_PARAMS.reader_tap).toEqual({ difficulty: 5.5, stability: 1.0 });
    expect(CAPTURE_SOURCE_PARAMS.repeated_lookup).toEqual({ difficulty: 7.2, stability: 0.4 });
  });

  it("crea tarjeta para pre_reading con (D0=4.5, S0=2.0)", () => {
    const card = newCardWithSource("pre_reading");
    expect(card.difficulty).toBe(4.5);
    expect(card.stability).toBe(2.0);
  });

  it("crea tarjeta para reader_tap con (D0=5.5, S0=1.0)", () => {
    const card = newCardWithSource("reader_tap");
    expect(card.difficulty).toBe(5.5);
    expect(card.stability).toBe(1.0);
  });

  it("crea tarjeta para repeated_lookup con (D0=7.2, S0=0.4)", () => {
    const card = newCardWithSource("repeated_lookup");
    expect(card.difficulty).toBe(7.2);
    expect(card.stability).toBe(0.4);
  });

  it("newCard soporta segundo argumento source opcional", () => {
    const now = new Date("2026-10-13T12:00:00Z");
    const defaultCard = newCard(now);
    expect(defaultCard.difficulty).toBe(0); // ts-fsrs default
    expect(defaultCard.stability).toBe(0);

    const sourceCard = newCard(now, "reader_tap");
    expect(sourceCard.difficulty).toBe(5.5);
    expect(sourceCard.stability).toBe(1.0);
  });
});
