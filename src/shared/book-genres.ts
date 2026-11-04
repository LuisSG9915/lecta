// Vocabulario de géneros de la biblioteca comunitaria: lista corta en
// español pensada para pills de filtro. El género se detecta de los
// `dc:subject` del EPUB al subir y quien comparte puede corregirlo;
// `user_books.genre` guarda uno de estos valores (o "" = sin clasificar).

export const BOOK_GENRES = [
  "Fantasía",
  "Ciencia ficción",
  "Romance",
  "Misterio y thriller",
  "Juvenil",
  "Clásicos",
  "Terror",
  "Aventura",
  "No ficción",
  "Otros",
] as const;

export type BookGenre = (typeof BOOK_GENRES)[number];

export const isBookGenre = (value: unknown): value is BookGenre =>
  typeof value === "string" &&
  (BOOK_GENRES as readonly string[]).includes(value);

// Orden = prioridad cuando un libro trae varios subjects: los géneros
// específicos ganan (un «Young Adult Fantasy» queda en Fantasía, no en
// Juvenil). Los regex corren sobre el subject normalizado (minúsculas,
// sin diacríticos) y aceptan los términos ingleses típicos del BISAC
// que usan la mayoría de los EPUB.
const GENRE_PATTERNS: ReadonlyArray<readonly [BookGenre, RegExp]> = [
  ["Ciencia ficción", /ciencia ficcion|science fiction|sci-?fi|cyberpunk|space opera|distopi|dystopi/],
  ["Fantasía", /fantas|sword and sorcery|magic\b|magia\b/],
  ["Terror", /horror|terror|gothic|gotic/],
  ["Misterio y thriller", /mystery|thriller|suspense|crime|detective|noir|policiac|misterio|crimen|whodunit|asesinato/],
  ["Romance", /romance|romantic|amor\b|erotic/],
  ["Juvenil", /juvenil|young adult|juvenile|children'?s|infantil|middle grade|coming of age/],
  ["Clásicos", /classic|clasico/],
  ["No ficción", /non-?fiction|no ficcion|biograph|biografi|memoir|memorias|self-?help|autoayuda|essay|ensayo|histor|philosoph|filosofi|psycholog|psicolog|business|negocios|divulgaci|true crime/],
  ["Aventura", /adventure|aventura|action\b|accion\b|swashbuckl/],
];

const normalizeSubject = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();


/**
 * Traduce los `dc:subject` crudos de un EPUB a un género de la lista,
 * o "" si ninguno mapea con confianza («Otros» nunca se adivina: es
 * una elección manual de quien comparte).
 */
export function genreFromSubjects(subjects: readonly string[]): BookGenre | "" {
  const normalized = subjects
    .map((subject) => normalizeSubject(subject).trim())
    .filter(Boolean);
  if (!normalized.length) return "";
  for (const [genre, pattern] of GENRE_PATTERNS) {
    if (normalized.some((subject) => pattern.test(subject))) return genre;
  }
  return "";
}
