// «Probar con un clásico» (landing → /?probar=<id>): abre un libro del
// catálogo en el lector sin cuenta. Es la única excepción a la cuenta
// obligatoria (docs/designs/2026-11-12-planes-y-landing.md) y vale solo
// mientras dura esa lectura: al cerrar el libro vuelve Welcome. Lo que se
// guarde queda en la base anónima `lecta` y pasa a la cuenta al registrarse
// (`migrateAnonymousToUser`).
import type { CatalogBook } from "./catalog";

export type TrialBook = Pick<CatalogBook, "id" | "title" | "author">;

/** Allowlist: solo estos clásicos se abren sin cuenta. */
export const TRIAL_BOOKS: Record<string, TrialBook> = {
  marianela: { id: "marianela", title: "Marianela", author: "Benito Pérez Galdós" },
  lazarillo: { id: "lazarillo", title: "El Lazarillo de Tormes", author: "Anónimo" },
  "nino-bola": { id: "nino-bola", title: "El Niño de la Bola", author: "Pedro Antonio de Alarcón" },
  "alice-wonderland": {
    id: "alice-wonderland",
    title: "Alice's Adventures in Wonderland",
    author: "Lewis Carroll",
  },
  "christmas-carol": {
    id: "christmas-carol",
    title: "A Christmas Carol",
    author: "Charles Dickens",
  },
  "call-of-the-wild": {
    id: "call-of-the-wild",
    title: "The Call of the Wild",
    author: "Jack London",
  },
};

export function parseTrialBook(value: string | null): TrialBook | null {
  if (!value) return null;
  return Object.prototype.hasOwnProperty.call(TRIAL_BOOKS, value)
    ? TRIAL_BOOKS[value]!
    : null;
}
