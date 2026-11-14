import { describe, expect, it } from "vitest";
import { nextReviewNote } from "./ReviewDone";

describe("nextReviewNote", () => {
  const end = 1_000_000;

  it("con vencidas pendientes dice cuántas quedan, no «vuelve en ahora»", () => {
    expect(nextReviewNote(1, end + 5_000, end)).toBe(" Te queda 1 palabra para repasar.");
    expect(nextReviewNote(12, end + 5_000, end)).toBe(" Te quedan 12 palabras para repasar.");
  });

  it("una palabra que vuelve en segundos se anuncia como «en un momento»", () => {
    expect(nextReviewNote(0, end + 20_000, end)).toBe(" La próxima vuelve en un momento.");
  });

  it("con una espera real da el intervalo", () => {
    expect(nextReviewNote(0, end + 10 * 60_000, end)).toBe(" La próxima vuelve en 10 min.");
    expect(nextReviewNote(0, end + 3 * 86_400_000, end)).toBe(" La próxima vuelve en 3 d.");
  });

  it("sin próximas fechas no hay nada pendiente", () => {
    expect(nextReviewNote(0, Infinity, end)).toBe(" Nada pendiente por ahora.");
    expect(nextReviewNote(0, end + 60_000, null)).toBe(" Nada pendiente por ahora.");
  });
});
