/**
 * Preferencias de lectura Kindle por cuenta (K2).
 *
 * Viven en `lecta_kindle_prefs` (migración 020) para que el celular las
 * configure y el Kindle las consuma. Este módulo es la única fuente del
 * vocabulario y de la normalización: lo usan el worker (API + /k/ajustes) y el
 * cliente (panel «Tu Kindle», K8). Valores inválidos o ausentes caen a los
 * defaults, nunca a un estado de render roto.
 */

export const KINDLE_FONT_FAMILIES = [
  "literata",
  "source-serif",
  "atkinson",
  "opendyslexic",
] as const;
export type KindleFontFamily = (typeof KINDLE_FONT_FAMILIES)[number];

export const KINDLE_FONT_SIZES = ["sm", "md", "lg", "xl", "xxl"] as const;
export type KindleFontSize = (typeof KINDLE_FONT_SIZES)[number];

export const KINDLE_LINE_HEIGHTS = ["compact", "normal", "loose"] as const;
export type KindleLineHeight = (typeof KINDLE_LINE_HEIGHTS)[number];

export const KINDLE_MARGINS = ["sm", "md", "lg"] as const;
export type KindleMarginPref = (typeof KINDLE_MARGINS)[number];

export const KINDLE_ALIGNS = ["justify", "left"] as const;
export type KindleAlign = (typeof KINDLE_ALIGNS)[number];

/** Enfoques de lectura: Limpio / Párrafos aireados / Anclas de lectura. */
export const KINDLE_APPROACHES = ["clean", "paragraphs", "anchors"] as const;
export type KindleApproach = (typeof KINDLE_APPROACHES)[number];

export const KINDLE_LAYOUTS = ["paged", "scroll"] as const;
export type KindleLayoutPref = (typeof KINDLE_LAYOUTS)[number];

export type KindlePrefs = {
  fontFamily: KindleFontFamily;
  fontSize: KindleFontSize;
  lineHeight: KindleLineHeight;
  margin: KindleMarginPref;
  align: KindleAlign;
  approach: KindleApproach;
  layout: KindleLayoutPref;
};

export const DEFAULT_KINDLE_PREFS: KindlePrefs = {
  fontFamily: "literata",
  fontSize: "md",
  lineHeight: "normal",
  margin: "md",
  align: "justify",
  approach: "clean",
  layout: "paged",
};

/* ── Estilos rápidos (presets) ─────────────────────────────────────────
   Combinaciones completas de las 7 preferencias, aprobadas por producto
   (fase G4). Son azúcar sobre el formulario: al servidor siempre viajan
   las prefs resueltas, nunca el id del preset. */
export const KINDLE_PRESETS = [
  {
    id: "clasico",
    label: "Clásico",
    prefs: {
      fontFamily: "literata",
      fontSize: "md",
      lineHeight: "normal",
      margin: "md",
      align: "justify",
      approach: "clean",
      layout: "paged",
    },
  },
  {
    id: "legible",
    label: "Alta legibilidad",
    prefs: {
      fontFamily: "atkinson",
      fontSize: "lg",
      lineHeight: "loose",
      margin: "md",
      align: "left",
      approach: "clean",
      layout: "paged",
    },
  },
  {
    id: "dislexia",
    label: "Dislexia",
    prefs: {
      fontFamily: "opendyslexic",
      fontSize: "lg",
      lineHeight: "loose",
      margin: "lg",
      align: "left",
      approach: "paragraphs",
      layout: "paged",
    },
  },
  {
    id: "agil",
    label: "Ágil",
    prefs: {
      fontFamily: "source-serif",
      fontSize: "md",
      lineHeight: "normal",
      margin: "sm",
      align: "left",
      approach: "anchors",
      layout: "scroll",
    },
  },
] as const satisfies ReadonlyArray<{ id: string; label: string; prefs: KindlePrefs }>;

/** Id del preset que coincide con las prefs actuales, o null si la
 *  combinación es personalizada (mezcla manual de ajustes). */
export function matchKindlePreset(prefs: KindlePrefs): string | null {
  const match = KINDLE_PRESETS.find((preset) =>
    (Object.keys(preset.prefs) as (keyof KindlePrefs)[]).every(
      (key) => preset.prefs[key] === prefs[key],
    ),
  );
  return match ? match.id : null;
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * Normaliza cualquier entrada (fila DB, JSON del cliente, FormData) a un
 * KindlePrefs válido. Los aliases («serif»/«sans», «left»/«justificado») se
 * aceptan para tolerancia con clientes viejos.
 */
export function normalizeKindlePrefs(input: unknown): KindlePrefs {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    fontFamily: pick(raw.fontFamily, KINDLE_FONT_FAMILIES, DEFAULT_KINDLE_PREFS.fontFamily),
    fontSize: pick(raw.fontSize, KINDLE_FONT_SIZES, DEFAULT_KINDLE_PREFS.fontSize),
    lineHeight: pick(raw.lineHeight, KINDLE_LINE_HEIGHTS, DEFAULT_KINDLE_PREFS.lineHeight),
    margin: pick(raw.margin, KINDLE_MARGINS, DEFAULT_KINDLE_PREFS.margin),
    align: pick(raw.align, KINDLE_ALIGNS, DEFAULT_KINDLE_PREFS.align),
    approach: pick(raw.approach, KINDLE_APPROACHES, DEFAULT_KINDLE_PREFS.approach),
    layout: pick(raw.layout, KINDLE_LAYOUTS, DEFAULT_KINDLE_PREFS.layout),
  };
}

/** Etiquetas en español por campo y valor — las mismas en /k/ajustes
 * (Kindle), la API y el panel «Tu Kindle» del celular. */
export const KINDLE_PREF_LABELS: Record<string, Record<string, string>> = {
  fontFamily: {
    literata: "Literata (recomendada)",
    "source-serif": "Source Serif",
    atkinson: "Atkinson (alta legibilidad)",
    opendyslexic: "OpenDyslexic",
  },
  fontSize: { sm: "Chica", md: "Normal", lg: "Grande", xl: "Muy grande", xxl: "Enorme" },
  lineHeight: { compact: "Compacto", normal: "Normal", loose: "Amplio" },
  margin: { sm: "Estrecho", md: "Normal", lg: "Amplio" },
  align: { justify: "Justificado", left: "A la izquierda" },
  approach: {
    clean: "Limpio",
    paragraphs: "Párrafos aireados",
    anchors: "Anclas de lectura",
  },
  layout: { paged: "Paginado (sin scroll)", scroll: "Scroll continuo" },
};

/** Leyenda de cada campo (orden del formulario). */
export const KINDLE_PREF_FIELDS: readonly { name: keyof KindlePrefs; legend: string }[] = [
  { name: "fontFamily", legend: "Tipografía" },
  { name: "fontSize", legend: "Tamaño de letra" },
  { name: "lineHeight", legend: "Interlineado" },
  { name: "margin", legend: "Margen" },
  { name: "align", legend: "Alineación" },
  { name: "approach", legend: "Enfoque de lectura" },
  { name: "layout", legend: "Disposición" },
];

/** Fila de `lecta_kindle_prefs` → preferencias. */
export function prefsFromRow(row: Record<string, unknown> | null | undefined): KindlePrefs {
  if (!row) return { ...DEFAULT_KINDLE_PREFS };
  return normalizeKindlePrefs({
    fontFamily: row.font_family,
    fontSize: row.font_size,
    lineHeight: row.line_height,
    margin: row.margin,
    align: row.align,
    approach: row.approach,
    layout: row.layout,
  });
}

/* ── Vista previa local ────────────────────────────────────────────────
   Valores reales del lector /k (src/worker/kindle/views.ts) para que la
   vista previa inmediata del panel «Tu Kindle» muestre lo mismo que el
   dispositivo. Una sola fuente: el worker y el cliente importan de aquí. */

export const KINDLE_PREVIEW_FONT_SIZES: Record<KindleFontSize, number> = {
  sm: 1.0,
  md: 1.18,
  lg: 1.35,
  xl: 1.55,
  xxl: 1.8,
};

export const KINDLE_PREVIEW_LINE_HEIGHTS: Record<KindleLineHeight, number> = {
  compact: 1.42,
  normal: 1.58,
  loose: 1.78,
};

/** Margen del lector en px (vertical / horizontal), como `.margin-*` del /k. */
export const KINDLE_PREVIEW_MARGINS: Record<KindleMarginPref, { y: number; x: number }> = {
  sm: { y: 6, x: 12 },
  md: { y: 8, x: 22 },
  lg: { y: 10, x: 38 },
};

export const KINDLE_PREVIEW_FONT_STACKS: Record<KindleFontFamily, string> = {
  literata: '"Literata", Georgia, "Times New Roman", serif',
  "source-serif": '"Source Serif 4", "Source Serif Pro", Georgia, serif',
  atkinson: '"Atkinson Hyperlegible", Verdana, sans-serif',
  opendyslexic: '"OpenDyslexic", "Atkinson Hyperlegible", Verdana, sans-serif',
};

/** Pasaje de muestra: el mismo que sirve /k/preview cuando la cuenta no
 *  tiene libros, ahora compartido para que el panel lo pinte en local. */
export const KINDLE_PREVIEW_SAMPLE = {
  title: "La casa encendida",
  paragraphs: [
    "La luz de la tarde entraba por la ventana y dibujaba rectángulos dorados sobre la mesa de madera. En la cocina sonaba una tetera, y el vapor subía despacio, como si también él tuviera paciencia.",
    "Mara abrió el cuaderno por la página marcada con una hoja seca. Había palabras que todavía no entendía del todo, pero cada una llevaba una anotación pequeña al margen, escrita con su letra redonda y tranquila.",
    "Afuera, el patio olía a tierra mojada. Un pájaro cruzó el aire sin prisa, y por un momento todo el cuarto pareció contener la respiración, como si la casa entera leyera con ella.",
  ],
} as const;

export function kindlePreviewSampleHtml(): string {
  return (
    `<h2>${KINDLE_PREVIEW_SAMPLE.title}</h2>` +
    KINDLE_PREVIEW_SAMPLE.paragraphs.map((p) => `<p>${p}</p>`).join("\n")
  );
}

/** Índice de corte de la «ancla de lectura»: ~40 % de las letras de la
 *  palabra (4→2, 6→3, 10→4); la apóstrofe queda dentro del prefijo si cae
 *  antes del límite. Devuelve 0 para palabras de menos de 4 letras. Lo
 *  usan el lector /k (`anchorifyWord`) y la vista previa local. */
export function anchorSplitIndex(word: string): number {
  const letters = word.match(/[\p{L}\p{M}]/gu) ?? [];
  if (letters.length < 4) return 0;
  const take = Math.ceil(letters.length * 0.4);
  let i = 0;
  let seen = 0;
  while (i < word.length && seen < take) {
    if (/[\p{L}\p{M}]/u.test(word[i])) seen += 1;
    i += 1;
  }
  return i;
}
