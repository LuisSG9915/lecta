import { describe, expect, it } from "vitest";
import {
  floatToWords,
  normalizeEnglishText,
  numberToEnglishWords,
  ordinalToWords,
  romanToWords,
} from "./kittenNormalize";

describe("kittenNormalize", () => {
  it("convierte números enteros a palabras en inglés", () => {
    expect(numberToEnglishWords(0)).toBe("zero");
    expect(numberToEnglishWords(1)).toBe("one");
    expect(numberToEnglishWords(12)).toBe("twelve");
    expect(numberToEnglishWords(42)).toBe("forty-two");
    expect(numberToEnglishWords(100)).toBe("one hundred");
    expect(numberToEnglishWords(1200)).toBe("twelve hundred");
    expect(numberToEnglishWords(1000)).toBe("one thousand");
    expect(numberToEnglishWords(15000)).toBe("fifteen thousand");
    expect(numberToEnglishWords(1000000)).toBe("one million");
    expect(numberToEnglishWords(-42)).toBe("negative forty-two");
  });

  it("convierte números decimales a palabras", () => {
    expect(floatToWords(3.14)).toBe("three point one four");
    expect(floatToWords(-0.5)).toBe("negative zero point five");
    expect(floatToWords("1.50")).toBe("one point five zero");
    expect(floatToWords("1200.99")).toBe("twelve hundred point nine nine");
  });

  it("convierte ordinales a palabras", () => {
    expect(ordinalToWords(1)).toBe("first");
    expect(ordinalToWords(2)).toBe("second");
    expect(ordinalToWords(3)).toBe("third");
    expect(ordinalToWords(4)).toBe("fourth");
    expect(ordinalToWords(21)).toBe("twenty-first");
    expect(ordinalToWords(100)).toBe("one hundredth");
  });

  it("convierte números romanos a palabras", () => {
    expect(romanToWords("I")).toBe("one");
    expect(romanToWords("IV")).toBe("four");
    expect(romanToWords("VIII")).toBe("eight");
    expect(romanToWords("XX")).toBe("twenty");
  });

  it("normaliza monedas, porcentajes y décadas", () => {
    expect(normalizeEnglishText("I paid $5 for this book.")).toBe("I paid five dollars for this book.");
    expect(normalizeEnglishText("Discount is 50% today.")).toBe("Discount is fifty percent today.");
    expect(normalizeEnglishText("Born in the '90s.")).toBe("Born in the nineties.");
    expect(normalizeEnglishText("The 1990s were great.")).toBe("The nineteen nineties were great.");
  });

  it("normaliza capítulos, diálogos y títulos reales", () => {
    const dialogue = '—"Chapter IV: King Henry VIII met Dr. Watson at St. Paul Church, 42 steps."';
    const normalized = normalizeEnglishText(dialogue);

    expect(normalized).toContain("Chapter four");
    expect(normalized).toContain("King Henry the eighth");
    expect(normalized).toContain("Doctor Watson");
    expect(normalized).toContain("Saint Paul Church");
    expect(normalized).toContain("forty-two steps");
    expect(normalized).not.toContain("—");
    expect(normalized).not.toContain('"');
  });

  it("expande abreviaturas comunes y literarias", () => {
    expect(normalizeEnglishText("Mr. and Mrs. Smith")).toBe("Mister and Missus Smith");
    expect(normalizeEnglishText("Prof. Higgins vs. Dr. John")).toBe("Professor Higgins versus Doctor John");
    expect(normalizeEnglishText("Capt. Nemo and Col. Brandon")).toBe("Captain Nemo and Colonel Brandon");
  });
});
