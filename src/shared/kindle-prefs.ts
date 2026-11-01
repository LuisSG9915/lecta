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
