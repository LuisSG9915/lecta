import { describe, expect, it } from "vitest";
import { newCard } from "./fsrs";

describe("newCard", () => {
  it("nace vacía: la primera calificación real es la que fija D y S", () => {
    const now = new Date("2026-10-13T12:00:00Z");
    const card = newCard(now);
    expect(card.difficulty).toBe(0);
    expect(card.stability).toBe(0);
    expect(card.reps).toBe(0);
    expect(card.state).toBe(0);
    expect(new Date(card.due).getTime()).toBe(now.getTime());
  });
});
