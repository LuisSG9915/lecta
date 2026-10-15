import { describe, expect, it } from "vitest";
import { ENGLISH_STOPWORDS, SPANISH_STOPWORDS, isStopword } from "./stopwords";

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

  it("reconoce palabras funcionales frecuentes en inglés", () => {
    for (const form of [
      "the", "a", "an", "of", "in", "to", "for", "with", "and", "but",
      "he", "she", "it", "they", "this", "that", "what", "is", "was",
      "were", "have", "had", "will", "would", "can", "could", "not",
      "very", "one", "two", "ten", "first", "hello",
    ])
      expect(isStopword(form, "en")).toBe(true);
  });

  it("ignora mayúsculas y espacios en inglés", () => {
    expect(isStopword("  The  ", "en")).toBe(true);
    expect(isStopword("AND", "en")).toBe(true);
  });

  it("no marca vocabulario aprendible en inglés", () => {
    for (const form of ["perennial", "awkward", "whisper", "clandestine", "shadow"])
      expect(isStopword(form, "en")).toBe(false);
  });

  it("respeta el idioma indicado y no cruza listas", () => {
    expect(isStopword("the", "es")).toBe(false);
    expect(isStopword("la", "en")).toBe(false);
    expect(isStopword("the", "fr")).toBe(false);
  });

  it("exporta las listas completas de stopwords", () => {
    expect(Array.isArray(SPANISH_STOPWORDS)).toBe(true);
    expect(SPANISH_STOPWORDS.length).toBeGreaterThan(50);
    expect(Array.isArray(ENGLISH_STOPWORDS)).toBe(true);
    expect(ENGLISH_STOPWORDS.length).toBeGreaterThan(50);
  });
});

