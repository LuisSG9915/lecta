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
  "alice-wonderland": {
    id: "alice-wonderland",
    title: "Alice's Adventures in Wonderland",
    author: "Lewis Carroll",
  },
};

export function parseTrialBook(value: string | null): TrialBook | null {
  if (!value) return null;
  return Object.prototype.hasOwnProperty.call(TRIAL_BOOKS, value)
    ? TRIAL_BOOKS[value]!
    : null;
}
