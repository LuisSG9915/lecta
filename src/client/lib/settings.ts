export type ThemeChoice = "auto" | "papel" | "crema" | "noche";
export type ResolvedTheme = Exclude<ThemeChoice, "auto">;

export const THEME_CHOICES: ThemeChoice[] = ["auto", "papel", "crema", "noche"];

export const THEME_LABELS: Record<ThemeChoice, string> = {
  auto: "Automático",
  papel: "Papel",
  crema: "Crema",
  noche: "Noche",
};

const THEME_KEY = "lecta:theme";
const READER_KEY = "lecta:reader";

export type ReaderFont = "literata" | "sans" | "serif" | "atkinson" | "dyslexic";

export const READER_FONTS: { id: ReaderFont; label: string }[] = [
  { id: "literata", label: "Literata" },
  { id: "sans", label: "Alegreya Sans" },
  { id: "serif", label: "Source Serif" },
  { id: "atkinson", label: "Atkinson" },
  { id: "dyslexic", label: "OpenDyslexic" },
];

export interface ReaderSettings {
  font: ReaderFont;
  /** Tamaño del texto del libro, en px (16–24). */
  size: number;
  /** Interlineado (1.5–1.9). */
  leading: number;
  /** Ancho de la columna en caracteres (55 | 65 | 75). */
  measure: 55 | 65 | 75;
  justify: boolean;
  dropCap: boolean;
  /** Desplazamiento continuo o páginas de una/dos columnas. */
  layout: "scroll" | "pages";
  /** Columnas por página en modo paginado (degrada a 1 en móvil). */
  pageColumns: 1 | 2;
}

export const READER_DEFAULTS: ReaderSettings = {
  font: "literata",
  size: 18,
  leading: 1.65,
  measure: 65,
  justify: false,
  dropCap: false,
  layout: "scroll",
  pageColumns: 2,
};

export const READER_LIMITS = {
  size: { min: 16, max: 24 },
  leading: { min: 1.5, max: 1.9 },
} as const;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function parseTheme(raw: string | null): ThemeChoice {
  return raw === "papel" || raw === "crema" || raw === "noche" ? raw : "auto";
}

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): ResolvedTheme {
  if (choice !== "auto") return choice;
  return prefersDark ? "noche" : "papel";
}

export function parseReaderSettings(raw: string | null): ReaderSettings {
  if (!raw) return READER_DEFAULTS;
  try {
    const v = JSON.parse(raw) as Partial<ReaderSettings>;
    return {
      font: READER_FONTS.some((f) => f.id === v.font) ? (v.font as ReaderFont) : "literata",
      size:
        typeof v.size === "number"
          ? clamp(v.size, READER_LIMITS.size.min, READER_LIMITS.size.max)
          : READER_DEFAULTS.size,
      leading:
        typeof v.leading === "number"
          ? clamp(v.leading, READER_LIMITS.leading.min, READER_LIMITS.leading.max)
          : READER_DEFAULTS.leading,
      measure: v.measure === 55 || v.measure === 65 || v.measure === 75 ? v.measure : 65,
      justify: v.justify === true,
      dropCap: v.dropCap === true,
      layout: v.layout === "pages" ? "pages" : "scroll",
      pageColumns: v.pageColumns === 1 ? 1 : 2,
    };
  } catch {
    return READER_DEFAULTS;
  }
}

const READ_FONT_VARS: Record<ReaderFont, string> = {
  literata: "var(--font-book)",
  sans: "var(--font-sans-alt)",
  serif: "var(--font-source-serif)",
  atkinson: "var(--font-atkinson)",
  dyslexic: "var(--font-dyslexic)",
};

// Variables CSS que aplica el contenedor del lector.
export function readerCssVars(s: ReaderSettings): Record<string, string> {
  return {
    "--read-font": READ_FONT_VARS[s.font] ?? READ_FONT_VARS.literata,
    "--read-size": `${s.size}px`,
    "--read-leading": String(s.leading),
    "--read-measure": `${s.measure}ch`,
  };
}

const storage = () => (typeof localStorage === "undefined" ? null : localStorage);

export function loadTheme(): ThemeChoice {
  return parseTheme(storage()?.getItem(THEME_KEY) ?? null);
}

export function saveTheme(choice: ThemeChoice) {
  try {
    storage()?.setItem(THEME_KEY, choice);
  } catch {
    // almacenamiento lleno o bloqueado: el tema queda solo en memoria
  }
}

// Ajustes de lectura por libro: `lecta:reader:<hash>` guarda la
// preferencia de ese libro; sin clave propia hereda la global.
const readerKeyFor = (bookHash?: string) =>
  bookHash ? `${READER_KEY}:${bookHash}` : READER_KEY;

export function loadReaderSettings(bookHash?: string): ReaderSettings {
  if (bookHash) {
    const own = storage()?.getItem(readerKeyFor(bookHash));
    if (own !== null && own !== undefined) return parseReaderSettings(own);
  }
  return parseReaderSettings(storage()?.getItem(READER_KEY) ?? null);
}

export function saveReaderSettings(settings: ReaderSettings, bookHash?: string) {
  try {
    storage()?.setItem(readerKeyFor(bookHash), JSON.stringify(settings));
  } catch {
    // mismo criterio que saveTheme
  }
}

export function hasBookReaderSettings(bookHash: string): boolean {
  return storage()?.getItem(readerKeyFor(bookHash)) != null;
}

// «Usar mis ajustes generales»: el libro vuelve a heredar la global.
export function clearBookReaderSettings(bookHash: string) {
  try {
    storage()?.removeItem(readerKeyFor(bookHash));
  } catch {
    // mismo criterio que saveTheme
  }
}

const ACTIVITY_HIDDEN_KEY = "lecta:activity:hidden";

// Preferencia discreta: quien no quiera ver sus estadísticas las apaga
// aquí; el panel del Cuaderno y los puntos de la semana se ocultan.
export function loadActivityHidden(): boolean {
  try {
    return storage()?.getItem(ACTIVITY_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveActivityHidden(hidden: boolean) {
  try {
    if (hidden) storage()?.setItem(ACTIVITY_HIDDEN_KEY, "1");
    else storage()?.removeItem(ACTIVITY_HIDDEN_KEY);
  } catch {
    // mismo criterio que saveTheme
  }
}

// Sin elección manual ("auto") no se pone data-theme y la media query de
// prefers-color-scheme decide; así el cambio del sistema se refleja solo.
export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "auto") {
    root.removeAttribute("data-theme");
    root.style.colorScheme = "light dark";
  } else {
    root.dataset.theme = choice;
    root.style.colorScheme = choice === "noche" ? "dark" : "light";
  }
}
