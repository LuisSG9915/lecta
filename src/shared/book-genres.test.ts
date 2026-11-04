import { describe, expect, it } from "vitest";
import { BOOK_GENRES, genreFromSubjects, isBookGenre } from "./book-genres";

describe("genreFromSubjects (dc:subject → género de la comunidad)", () => {
  it("mapea términos BISAC en inglés a la lista en español", () => {
    expect(genreFromSubjects(["Fantasy", "Magic"])).toBe("Fantasía");
    expect(genreFromSubjects(["Science Fiction", "Dystopia"])).toBe(
      "Ciencia ficción",
    );
    expect(genreFromSubjects(["Mystery", "Detective"])).toBe(
      "Misterio y thriller",
    );
    expect(genreFromSubjects(["Love Stories", "Romance"])).toBe("Romance");
    expect(genreFromSubjects(["Horror"])).toBe("Terror");
    expect(genreFromSubjects(["Biography & Autobiography"])).toBe("No ficción");
    expect(genreFromSubjects(["Adventure"])).toBe("Aventura");
    expect(genreFromSubjects(["Classics"])).toBe("Clásicos");
  });

  it("reconoce términos en español con y sin diacríticos", () => {
    expect(genreFromSubjects(["Ciencia ficción"])).toBe("Ciencia ficción");
    expect(genreFromSubjects(["Novela de misterio"])).toBe("Misterio y thriller");
    expect(genreFromSubjects(["Literatura juvenil"])).toBe("Juvenil");
  });

  it("los géneros específicos ganan a Juvenil cuando hay varios subjects", () => {
    // «Young Adult Fantasy» se categoriza por su género, no por la edad.
    expect(genreFromSubjects(["Young Adult", "Fantasy"])).toBe("Fantasía");
    // Sin género específico sí cae en Juvenil.
    expect(genreFromSubjects(["Juvenile Fiction", "Friendship"])).toBe(
      "Juvenil",
    );
  });

  it("devuelve vacío sin subjects o sin mapeo confiable — «Otros» jamás se adivina", () => {
    expect(genreFromSubjects([])).toBe("");
    expect(genreFromSubjects(["", "   "])).toBe("");
    expect(genreFromSubjects(["Fiction"])).toBe("");
    expect(genreFromSubjects(["Printed in Germany"])).toBe("");
  });
});

describe("isBookGenre", () => {
  it("acepta solo valores exactos de la lista", () => {
    for (const genre of BOOK_GENRES) expect(isBookGenre(genre)).toBe(true);
    expect(isBookGenre("fantasía")).toBe(false);
    expect(isBookGenre("Fantasy")).toBe(false);
    expect(isBookGenre("")).toBe(false);
    expect(isBookGenre(42)).toBe(false);
    expect(isBookGenre(null)).toBe(false);
  });
});
