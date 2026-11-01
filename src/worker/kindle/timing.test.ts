import { describe, expect, it } from "vitest";
import { createTimer } from "./timing";

describe("Kindle timer (Server-Timing)", () => {
  it("acumula cada marca con su nombre y cierra con total", () => {
    const t = createTimer();
    t.mark("session");
    t.mark("db");
    const header = t.header();
    expect(header).toMatch(/^session;dur=\d+(\.\d)?/);
    expect(header).toContain(", db;dur=");
    expect(header).toMatch(/total;dur=\d+(\.\d)?$/);
    expect(header.split(", ")).toHaveLength(3);
  });

  it("repetir un nombre acumula en la misma entrada", async () => {
    const t = createTimer();
    t.mark("db");
    await new Promise((r) => setTimeout(r, 2));
    t.mark("db");
    const names = t.header().split(", ").map((p) => p.split(";")[0]);
    expect(names.filter((n) => n === "db")).toHaveLength(1);
  });

  it("sin marcas emite solo el total", () => {
    const t = createTimer();
    expect(t.header()).toMatch(/^total;dur=\d+(\.\d)?$/);
  });
});
