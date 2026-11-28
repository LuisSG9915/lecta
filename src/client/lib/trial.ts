// «Probar con un clásico» (landing → /?probar=<id>): abre un libro del
// catálogo en el lector sin cuenta. Es la única excepción a la cuenta
// obligatoria (docs/designs/2026-11-12-planes-y-landing.md) y vale solo
// mientras dura esa lectura: al cerrar el libro vuelve Welcome. Lo que se
// guarde queda en la base anónima `lecta` y pasa a la cuenta al registrarse
// (`migrateAnonymousToUser`).
import type { CatalogBook } from "./catalog";

export type TrialBook = Pick<CatalogBook, "id" | "title" | "author" | "language">;

/** Allowlist: solo estos clásicos se abren sin cuenta. */
export const TRIAL_BOOKS: Record<string, TrialBook> = {
  marianela: { id: "marianela", title: "Marianela", author: "Benito Pérez Galdós", language: "es" },
  lazarillo: { id: "lazarillo", title: "El Lazarillo de Tormes", author: "Anónimo", language: "es" },
  "nino-bola": { id: "nino-bola", title: "El Niño de la Bola", author: "Pedro Antonio de Alarcón", language: "es" },
  "alice-wonderland": {
    id: "alice-wonderland",
    title: "Alice's Adventures in Wonderland",
    author: "Lewis Carroll",
    language: "en",
  },
  "christmas-carol": {
    id: "christmas-carol",
    title: "A Christmas Carol",
    author: "Charles Dickens",
    language: "en",
  },
  "call-of-the-wild": {
    id: "call-of-the-wild",
    title: "The Call of the Wild",
    author: "Jack London",
    language: "en",
  },
  "pride-and-prejudice": {
    id: "pride-and-prejudice",
    title: "Pride and Prejudice",
    author: "Jane Austen",
    language: "en",
  },
  frankenstein: {
    id: "frankenstein",
    title: "Frankenstein",
    author: "Mary Wollstonecraft Shelley",
    language: "en",
  },
  "picture-dorian-gray": {
    id: "picture-dorian-gray",
    title: "The Picture of Dorian Gray",
    author: "Oscar Wilde",
    language: "en",
  },
  "jekyll-hyde": {
    id: "jekyll-hyde",
    title: "The Strange Case of Dr. Jekyll and Mr. Hyde",
    author: "Robert Louis Stevenson",
    language: "en",
  },
};

const TRIAL_ID = /^[a-z0-9-]{1,64}$/;

/**
 * Síncrono (se llama en el useState inicial de App): solo valida el formato
 * y descarta los `pg-*` de Gutenberg. La existencia real del id se comprueba
 * al abrir contra el índice del catálogo (`/api/catalog`); un id que no
 * existe falla con 404 y cae a la bienvenida normal. Los de la allowlist
 * llevan título y autor; los demás, el id como título provisional.
 */
export function parseTrialBook(value: string | null): TrialBook | null {
  if (!value || !TRIAL_ID.test(value) || value.startsWith("pg-")) return null;
  return Object.prototype.hasOwnProperty.call(TRIAL_BOOKS, value)
    ? TRIAL_BOOKS[value]!
    : { id: value, title: value, author: "" };
}
