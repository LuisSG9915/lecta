import { describe, expect, it, vi } from "vitest";
import {
  activityToCsv,
  annotationsToMarkdown,
  bookReadingNoteToMarkdown,
  buildBackup,
  formatReadingDuration,
  fullNotebookToMarkdown,
  inspectBackupPayload,
  passagesToCsv,
  restoreBackupPayload,
  sanitizeFilename,
  sessionKeysForBackup,
  wordsToCsv,
  wordsToAnkiTsv,
  exportAnkiTsv,
} from "./export";
import type { SavedAnnotation, SavedInterval, SavedWord } from "./idb";

vi.mock("./idb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./idb")>();
  return {
    ...actual,
    restoreBackupToDb: vi.fn(async () => ({
      booksRestored: 1,
      positionsRestored: 1,
      wordsRestored: 1,
      annotationsRestored: 0,
      activityRestored: 0,
      reviewsRestored: 0,
      knowledgeRestored: 0,
    })),
  };
});

const bookName = (hash: string | undefined) =>
  hash === "b1" ? "Cien años de soledad" : undefined;

const base: SavedWord = {
  key: "es:casa",
  form: "casa",
  language: "es",
  savedAt: 1_700_000_000_000,
};

describe("wordsToCsv", () => {
  it("cabecera y fila básica con BOM", () => {
    const csv = wordsToCsv([{ ...base, meaning: "hogar", bookHash: "b1" }], bookName);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.split("\r\n");
    expect(lines[0]).toContain('"Palabra"');
    expect(lines[1]).toBe(
      '"casa","","","hogar","","Cien años de soledad","es","2023-11-14"',
    );
  });

  it("escapa comillas y aplana saltos", () => {
    const csv = wordsToCsv(
      [{ ...base, meaning: 'dijo "sí"\ny se fue', context: "línea1\nlínea2" }],
      bookName,
    );
    const row = csv.split("\r\n")[1];
    expect(row).toContain('"dijo ""sí"" y se fue"');
    expect(row).toContain('"línea1 línea2"');
  });

  it("neutraliza fórmulas", () => {
    const csv = wordsToCsv([{ ...base, form: "=SUMA(1;2)" }], bookName);
    expect(csv).toContain(`"'=SUMA(1;2)"`);
  });
});

describe("wordsToAnkiTsv", () => {
  it("frente, reverso con oración y etiquetas", () => {
    const tsv = wordsToAnkiTsv(
      [{ ...base, meaning: "hogar", context: "La <casa> grande", bookHash: "b1" }],
      bookName,
    );
    expect(tsv).toBe(
      "casa\thogar<br><i>«La &lt;casa&gt; grande»</i><br><small>Cien años de soledad</small>\tes Cien_años_de_soledad",
    );
  });

  it("sin libro ni contexto quedan vacíos", () => {
    const tsv = wordsToAnkiTsv([{ ...base, meaning: "hogar" }], bookName);
    expect(tsv).toBe("casa\thogar\tes");
  });
});

describe("exportAnkiTsv", () => {
  it("genera tarjetas con supresión de partes Cloze en contexto", () => {
    const tsv = exportAnkiTsv(
      [
        {
          ...base,
          form: "afrenta",
          lemma: "afrentar",
          pos: "sustantivo",
          meaning: "Ofensa grave que humilla",
          context: "Sería una afrenta para todo el reino.",
          bookHash: "b1",
        },
      ],
      bookName,
    );
    const [front, back, tags] = tsv.split("\t");
    expect(front).toBe("Sería una {{c1::afrenta}} para todo el reino.");
    expect(back).toContain("Ofensa grave que humilla");
    expect(back).toContain("<b>Lema:</b> afrentar");
    expect(back).toContain("<b>Categoría:</b> sustantivo");
    expect(back).toContain("<b>Libro:</b> Cien años de soledad");
    expect(tags).toBe("Lecta::es Lecta::cien-anos-de-soledad sustantivo");
  });

  it("ofrece fallback sin contexto a supresión directa de la palabra", () => {
    const tsv = exportAnkiTsv([{ ...base, form: "afrenta", meaning: "Ofensa" }], bookName);
    const [front, back, tags] = tsv.split("\t");
    expect(front).toBe("{{c1::afrenta}}");
    expect(back).toBe("Ofensa");
    expect(tags).toBe("Lecta::es");
  });

  it("respeta cloze: false generando tarjeta estándar", () => {
    const tsv = exportAnkiTsv(
      [{ ...base, form: "afrenta", meaning: "Ofensa", context: "Una afrenta total" }],
      bookName,
      { cloze: false },
    );
    const [front] = tsv.split("\t");
    expect(front).toBe("afrenta");
  });
});

describe("passagesToCsv", () => {
  const passage: SavedAnnotation = {
    key: "b1:p1",
    id: "p1",
    bookHash: "b1",
    kind: "passage",
    sectionIndex: 3,
    text: "El mundo era tan reciente",
    note: "inicio memorable",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  };

  it("exporta pasajes con capítulo y nota, sin libro completo", () => {
    const csv = passagesToCsv([passage], bookName);
    const lines = csv.split("\r\n");
    expect(lines[0]).toContain('"Pasaje"');
    expect(lines[1]).toBe(
      '"Cien años de soledad","Capítulo 4","El mundo era tan reciente","inicio memorable","2023-11-14"',
    );
  });

  it("omite marcadores y respeta solo pasajes", () => {
    const csv = passagesToCsv(
      [passage, { ...passage, id: "m1", kind: "bookmark", text: undefined }],
      bookName,
    );
    expect(csv.split("\r\n")).toHaveLength(2);
  });
});

describe("annotationsToMarkdown", () => {
  const passage = (over: Partial<SavedAnnotation> = {}): SavedAnnotation => ({
    key: "b1:p1",
    id: "p1",
    bookHash: "b1",
    kind: "passage",
    sectionIndex: 3,
    text: "El mundo era tan reciente",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...over,
  });

  it("agrupa por libro y capítulo con cita en bloque y nota", () => {
    const md = annotationsToMarkdown(
      [passage({ note: "inicio memorable" })],
      bookName,
      1_700_000_000_000,
    );
    expect(md).toContain("# Notas y citas — Lecta");
    expect(md).toContain("_Exportado el 2023-11-14_");
    expect(md).toContain("## Cien años de soledad");
    expect(md).toContain("### Capítulo 4");
    expect(md).toContain("> El mundo era tan reciente");
    expect(md).toContain("**Nota:** inicio memorable");
  });

  it("un pasaje multilínea cita cada línea; la nota queda en una línea", () => {
    const md = annotationsToMarkdown(
      [passage({ text: "línea uno\nlínea dos", note: "nota\npartida" })],
      bookName,
    );
    expect(md).toContain("> línea uno\n> línea dos");
    expect(md).toContain("**Nota:** nota partida");
  });

  it("un marcador con solo nota exporta la nota sin cita", () => {
    const md = annotationsToMarkdown(
      [
        passage({
          kind: "bookmark",
          sectionIndex: 0,
          text: undefined,
          note: "retomar aquí",
        }),
      ],
      bookName,
    );
    expect(md).not.toContain(">");
    expect(md).toContain("**Nota:** retomar aquí");
    // Capítulo 1 no imprime subtítulo: sectionIndex 0 es el inicio.
    expect(md).not.toContain("### Capítulo");
  });

  it("omite borradas y entradas sin texto ni nota", () => {
    const md = annotationsToMarkdown(
      [
        passage({ deleted: true }),
        passage({ id: "p2", text: undefined, note: undefined }),
        passage({ id: "p3", text: "Sí queda" }),
      ],
      bookName,
    );
    expect(md).toContain("> Sí queda");
    expect(md.match(/^> /gm)).toHaveLength(1);
  });
});

describe("activityToCsv", () => {
  const MIN = 60_000;
  const interval = (
    id: string,
    bookHash: string,
    start: number,
    end: number,
  ): SavedInterval => ({ id, bookHash, startedAt: start, endedAt: end });

  it("reparte minutos por fecha y libro, ordenado", () => {
    const start = Date.UTC(2025, 5, 21, 23, 30); // UTC: cruza medianoche
    const csv = activityToCsv(
      [interval("a", "b1", start, start + 60 * MIN)],
      bookName,
      "UTC",
    );
    const lines = csv.split("\r\n");
    expect(lines[0]).toContain('"Minutos"');
    expect(lines[1]).toBe('"2025-06-21","Cien años de soledad","30"');
    expect(lines[2]).toBe('"2025-06-22","Cien años de soledad","30"');
  });

  it("omite filas de menos de un minuto", () => {
    const csv = activityToCsv(
      [interval("a", "b1", Date.UTC(2025, 5, 21, 9), Date.UTC(2025, 5, 21, 9) + 30_000)],
      bookName,
      "UTC",
    );
    expect(csv.split("\r\n")).toHaveLength(1);
  });
});

describe("sessionKeysForBackup", () => {
  it("incluye preferencias, calibración y registros del ciclo por libro", () => {
    const keys = sessionKeysForBackup([
      "bookStart:v1:b1",
      "preparation:v1:b1:cap1",
      "preparation:v1:b2:cap9",
      "unrelated:key",
      "authState",
    ]);
    for (const expected of [
      "readingWpm",
      "suggestionLevel",
      "calibrationDone",
      "calibrationDraft",
      "readingGoal:v1",
      "learnExposure:v1",
      "useAi",
      "bookStart:v1:b1",
      "preparation:v1:b1:cap1",
      "preparation:v1:b2:cap9",
      // El compañero: el rastro v1 sellado y las claves nuevas.
      "gameState",
      "companion",
      "companionBaselines:v1",
      "companionProfile:v1",
      "companionDevicePrefs:v1",
      "companionMigration:v1",
      "companionAcked:v1",
    ])
      expect(keys).toContain(expected);
  });

  it("no respalda claves arbitrarias ni duplica", () => {
    const keys = sessionKeysForBackup(["readingWpm", "unrelated:key"]);
    expect(keys).not.toContain("unrelated:key");
    expect(keys.filter((k) => k === "readingWpm")).toHaveLength(1);
  });
});

describe("buildBackup", () => {
  it("genera JSON parseable con todas las secciones y las palabras pasadas", () => {
    const json = buildBackup(
      {
        words: [{ ...base, meaning: "hogar", bookHash: "b1" }],
        reviews: [
          {
            id: "r1",
            language: "es",
            form: "casa",
            kind: "meaning",
            rating: "good",
            hints: 0,
            createdAt: 1_700_000_000_000,
          },
        ],
        annotations: [],
        activity: [],
        positions: [
          {
            bookHash: "b1",
            sectionIndex: 2,
            scrollTop: 0,
            ratio: 0.4,
            updatedAt: 1_700_000_000_000,
          },
        ],
        knowledge: [
          {
            key: "es:perenne",
            language: "es",
            lemma: "perenne",
            known: true,
            source: "calibration",
            updatedAt: 1_700_000_000_000,
          },
        ],
        books: [{ hash: "b1", name: "cien.epub", addedAt: 1, title: "Cien años" }],
        readingDays: [1_699_200_000_000],
        events: [],
        companionEvents: [
          {
            version: 1,
            id: "read:i1",
            at: 1_700_000_000_000,
            dayKey: "2023-11-14",
            streakBonus: false,
            event: { kind: "read", ms: 60_000 },
            interval: {
              startedAt: 1_700_000_000_000 - 60_000,
              endedAt: 1_700_000_000_000,
            },
          },
        ],
        companionReceipts: [
          { id: "achievement-credit:palabra_1", at: 1_700_000_000_000 },
        ],
        session: { useAi: "1", readingWpm: "240" },
      },
      1_700_000_000_000,
    );
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.version).toBe(1);
    expect(parsed.exportedAt).toBe("2023-11-14T22:13:20.000Z");
    for (const key of [
      "words",
      "reviews",
      "annotations",
      "activity",
      "positions",
      "knowledge",
      "books",
      "readingDays",
      "events",
      "companionEvents",
      "companionReceipts",
      "session",
    ])
      expect(parsed).toHaveProperty(key);
    // Las secciones del compañero viajan tal cual están en los stores.
    expect(parsed.companionEvents).toEqual([
      expect.objectContaining({ id: "read:i1" }),
    ]);
    expect(parsed.companionReceipts).toEqual([
      { id: "achievement-credit:palabra_1", at: 1_700_000_000_000 },
    ]);
    expect(parsed.knowledge).toEqual([
      {
        key: "es:perenne",
        language: "es",
        lemma: "perenne",
        known: true,
        source: "calibration",
        updatedAt: 1_700_000_000_000,
      },
    ]);
    expect(parsed.words).toEqual([{ ...base, meaning: "hogar", bookHash: "b1" }]);
    expect((parsed.session as Record<string, string>).useAi).toBe("1");
    // El libro viaja solo como metadatos: nunca blobs (data/cover).
    expect(parsed.books).toEqual([
      { hash: "b1", name: "cien.epub", addedAt: 1, title: "Cien años" },
    ]);
  });
});

describe("sanitizeFilename", () => {
  it("normaliza títulos con acentos y espacios", () => {
    expect(sanitizeFilename("Cien años de soledad")).toBe("cien-anos-de-soledad");
    expect(sanitizeFilename("El Aleph (Edición Crítica)")).toBe("el-aleph-edicion-critica");
  });

  it("ofrece fallback para nombres vacíos", () => {
    expect(sanitizeFilename("")).toBe("lectura");
    expect(sanitizeFilename("---")).toBe("lectura");
  });
});

describe("formatReadingDuration", () => {
  it("formatea minutos y horas", () => {
    expect(formatReadingDuration(0)).toBe("< 1 min");
    expect(formatReadingDuration(25)).toBe("25 min");
    expect(formatReadingDuration(60)).toBe("1 h");
    expect(formatReadingDuration(95)).toBe("1 h 35 min");
  });
});

describe("bookReadingNoteToMarkdown", () => {
  const sampleBook = {
    hash: "b1",
    title: "Cien años de soledad",
    author: "Gabriel García Márquez",
    language: "es",
  };

  const sampleWords: SavedWord[] = [
    {
      key: "es:diáfano",
      form: "diáfana",
      lemma: "diáfano",
      pos: "adj.",
      meaning: "Claro, que deja pasar la luz",
      context: "El mundo era tan reciente y diáfana la luz.",
      language: "es",
      bookHash: "b1",
      savedAt: 1_700_000_000_000,
    },
  ];

  const sampleAnnotations: SavedAnnotation[] = [
    {
      key: "b1:p1",
      id: "p1",
      bookHash: "b1",
      kind: "passage",
      sectionIndex: 0,
      text: "Muchos años después, frente al pelotón de fusilamiento...",
      note: "Inicio memorable.",
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    },
  ];

  const sampleIntervals: SavedInterval[] = [
    {
      id: "i1",
      bookHash: "b1",
      startedAt: 1_700_000_000_000,
      endedAt: 1_700_000_000_000 + 45 * 60_000,
    },
  ];

  it("genera YAML frontmatter estructurado y secciones enriquecidas", () => {
    const md = bookReadingNoteToMarkdown({
      book: sampleBook,
      words: sampleWords,
      annotations: sampleAnnotations,
      intervals: sampleIntervals,
      position: {
        bookHash: "b1",
        sectionIndex: 2,
        progress: 0.85,
        ratio: 0.5,
        scrollTop: 100,
        updatedAt: 1_700_000_000_000,
      },
      exportedAt: 1_700_000_000_000,
    });

    expect(md.startsWith("---")).toBe(true);
    expect(md).toContain('title: "Cien años de soledad"');
    expect(md).toContain('author: "Gabriel García Márquez"');
    expect(md).toContain("source: Lecta");
    expect(md).toContain('progress: "85%"');
    expect(md).toContain('reading_time: "45 min"');
    expect(md).toContain("words_saved: 1");
    expect(md).toContain("passages_saved: 1");
    expect(md).toContain("lecta/libro");

    // Título y metadatos
    expect(md).toContain("# Cien años de soledad");
    expect(md).toContain("*Autor:* **Gabriel García Márquez**");

    // Citas con callout
    expect(md).toContain("## Citas y pasajes destacados");
    expect(md).toContain("> Muchos años después, frente al pelotón de fusilamiento...");
    expect(md).toContain("> [!note] Reflexión");
    expect(md).toContain("> Inicio memorable.");

    // Vocabulario en tabla estructurada (Lecta v3.0)
    expect(md).toContain("## Vocabulario adquirido");
    expect(md).toContain("| Palabra | Lema | Categoría | Significado | Oración en el libro |");
    expect(md).toContain("| **diáfana** | diáfano | adj. | Claro, que deja pasar la luz | El mundo era tan reciente y diáfana la luz. |");

    // Sesiones
    expect(md).toContain("## Sesiones de lectura");
    expect(md).toContain("- **Tiempo total registrado:** 45 min");
    expect(md).toContain("- **Sesiones completadas:** 1");
  });

  it("permite exportar vocabulario en formato de lista clásica si se solicita", () => {
    const md = bookReadingNoteToMarkdown({
      book: sampleBook,
      words: sampleWords,
      annotations: [],
      vocabFormat: "list",
    });
    expect(md).toContain("## Vocabulario adquirido");
    expect(md).toContain("- **diáfana** *(adj.)* — lema: *diáfano*");
    expect(md).toContain("- **Significado:** Claro, que deja pasar la luz");
    expect(md).toContain("- *«El mundo era tan reciente y diáfana la luz.»*");
  });
});

describe("fullNotebookToMarkdown", () => {
  it("genera consolidado con índice y múltiples libros", () => {
    const md = fullNotebookToMarkdown({
      books: [
        { hash: "b1", title: "El Aleph", author: "Borges", language: "es" },
        { hash: "b2", title: "Ficciones", author: "Borges", language: "es" },
      ],
      words: [
        {
          key: "es:laberinto",
          form: "laberinto",
          meaning: "Lugar confuso",
          language: "es",
          bookHash: "b1",
          savedAt: 1_700_000_000_000,
        },
        {
          key: "es:suelta",
          form: "suelta",
          meaning: "Palabra sin libro",
          language: "es",
          savedAt: 1_700_000_000_000,
        },
      ],
      annotations: [
        {
          key: "b1:a1",
          id: "a1",
          bookHash: "b1",
          kind: "passage",
          sectionIndex: 1,
          text: "Vi el populoso mar...",
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
        },
      ],
      exportedAt: 1_700_000_000_000,
    });

    expect(md).toContain('title: "Cuaderno de Lectura — Lecta"');
    expect(md).toContain("## Índice de obras");
    expect(md).toContain("- **El Aleph** (Borges) · 1 palabra(s) · 1 pasaje(s)");
    expect(md).toContain("## El Aleph");
    expect(md).toContain("> Vi el populoso mar...");
    expect(md).toContain("- **laberinto**");
    expect(md).toContain("## Otras notas y palabras");
    expect(md).toContain("- **suelta**: Palabra sin libro");
  });
});

describe("inspectBackupPayload", () => {
  it("valida y extrae el resumen de un respaldo válido", () => {
    const backupJson = JSON.stringify({
      version: 1,
      exportedAt: "2026-10-21T00:00:00.000Z",
      words: [{ key: "es:casa", form: "casa" }],
      books: [{ hash: "b1", name: "libro.epub" }],
      positions: [{ bookHash: "b1", sectionIndex: 0, scrollTop: 100 }],
      annotations: [{ key: "b1:a1", id: "a1" }],
      reviews: [{ id: "r1" }],
      activity: [{ id: "act1" }],
      companionEvents: [{ id: "ce1" }],
      session: { comp_xp: "100" },
    });

    const summary = inspectBackupPayload(backupJson);
    expect(summary.version).toBe(1);
    expect(summary.exportedAt).toBe("2026-10-21T00:00:00.000Z");
    expect(summary.wordsCount).toBe(1);
    expect(summary.booksCount).toBe(1);
    expect(summary.positionsCount).toBe(1);
    expect(summary.annotationsCount).toBe(1);
    expect(summary.reviewsCount).toBe(1);
    expect(summary.activityCount).toBe(1);
    expect(summary.hasCompanionState).toBe(true);
  });

  it("rechaza archivo vacío", () => {
    expect(() => inspectBackupPayload("")).toThrow("vacío");
    expect(() => inspectBackupPayload("   ")).toThrow("vacío");
  });

  it("rechaza JSON inválido", () => {
    expect(() => inspectBackupPayload("{ not json }")).toThrow("formato JSON");
  });

  it("rechaza versión incompatible o ausente", () => {
    expect(() => inspectBackupPayload(JSON.stringify({ words: [] }))).toThrow("versión");
    expect(() =>
      inspectBackupPayload(JSON.stringify({ version: 99, words: [] })),
    ).toThrow("más reciente");
  });
});

describe("restoreBackupPayload", () => {
  it("restaura los registros resolviendo por merge", async () => {
    const backupData = {
      words: [
        {
          key: "es:palabra",
          form: "palabra",
          language: "es",
          savedAt: 1000,
          updatedAt: 2000,
        },
      ],
      books: [{ hash: "hash1", name: "prueba.epub", addedAt: 1000 }],
      positions: [{ bookHash: "hash1", sectionIndex: 1, scrollTop: 50, updatedAt: 2000 }],
      annotations: [],
      activity: [],
      reviews: [],
      knowledge: [],
      readingDays: [],
      events: [],
      companionEvents: [],
      companionReceipts: [],
      session: {},
    };

    const res = await restoreBackupPayload(backupData);
    expect(res).toBeDefined();
    expect(res.wordsRestored).toBeGreaterThanOrEqual(1);
    expect(res.positionsRestored).toBeGreaterThanOrEqual(1);
  });
});
