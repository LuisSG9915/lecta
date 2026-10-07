import { describe, expect, it } from "vitest";
import { isStopword } from "./stopwords";

describe("isStopword", () => {
  it("reconoce palabras funcionales frecuentes", () => {
    for (const form of ["la", "de", "pero", "es", "hay", "quien", "más"])
      expect(isStopword(form)).toBe(true);
  });

  it("ignora mayúsculas y espacios", () => {
    expect(isStopword("  La  ")).toBe(true);
    expect(isStopword("QUE")).toBe(true);
  });

  it("no marca vocabulario aprendible", () => {
    for (const form of ["perenne", "estrecha", "leer", "umbrío", "comprobar"])
      expect(isStopword(form)).toBe(false);
  });

  it("reconoce numerales en texto, saludos y adverbios locativos", () => {
    for (const form of [
      "uno", "diez", "veinticinco", "cincuenta", "cien", "doscientas",
      "mil", "millones", "primero", "tercera", "décima",
      "hola", "adiós", "eh", "ah", "vale", "órale", "ojalá",
      "abajo", "arriba", "atrás", "detrás", "obstante", "afuera",
      "ayer", "todavía", "pronto",
    ])
      expect(isStopword(form)).toBe(true);
  });

  it("sigue sin marcar vocabulario aprendible nuevo", () => {
    for (const form of ["vehemente", "perenne", "tomándose", "cualidad"])
      expect(isStopword(form)).toBe(false);
  });

  it("solo aplica al español por ahora", () => {
    expect(isStopword("the", "en")).toBe(false);
    expect(isStopword("la", "en")).toBe(false);
  });
});
