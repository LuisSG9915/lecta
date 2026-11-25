import { describe, expect, it } from "vitest";
import { DISPOSABLE_EMAIL_DOMAINS, isDisposableEmail, normalizeEmail } from "./email-normalize";

describe("normalizeEmail", () => {
  it("minúsculas y quita +etiqueta", () => {
    expect(normalizeEmail(" Ana+Prueba@Example.COM ")).toBe("ana@example.com");
  });
  it("quita puntos solo en gmail", () => {
    expect(normalizeEmail("a.n.a+x@gmail.com")).toBe("ana@gmail.com");
    expect(normalizeEmail("a.n.a@googlemail.com")).toBe("ana@googlemail.com");
    expect(normalizeEmail("a.n.a@outlook.com")).toBe("a.n.a@outlook.com");
  });
  it("sin arroba no revienta", () => {
    expect(normalizeEmail("Raro")).toBe("raro");
  });
});

describe("isDisposableEmail", () => {
  it("detecta desechables y subdominios", () => {
    expect(isDisposableEmail("x@mailinator.com")).toBe(true);
    expect(isDisposableEmail("X@YOPMAIL.com")).toBe(true);
    expect(isDisposableEmail("x@foo.guerrillamail.com")).toBe(true);
  });
  it("deja pasar proveedores legítimos y las cuentas smoke", () => {
    for (const d of [
      "gmail.com",
      "outlook.com",
      "hotmail.com",
      "yahoo.com",
      "icloud.com",
      "proton.me",
      "example.com",
      "lectal.app",
    ]) {
      expect(isDisposableEmail(`x@${d}`)).toBe(false);
    }
  });
  it("la lista no contiene dominios legítimos y tiene tamaño razonable", () => {
    expect(DISPOSABLE_EMAIL_DOMAINS.size).toBeGreaterThan(100);
    expect(DISPOSABLE_EMAIL_DOMAINS.has("gmail.com")).toBe(false);
  });
});
