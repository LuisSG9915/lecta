import type { CalibrationProfile } from "../../shared/calibration-bank";

export type ThemeChoice = "auto" | "blanco" | "papel" | "noche" | "oled";
export type ResolvedTheme = Exclude<ThemeChoice, "auto">;

export const THEME_CHOICES: ThemeChoice[] = [
  "auto",
  "blanco",
  "papel",
  "noche",
  "oled",
];

export const THEME_LABELS: Record<ThemeChoice, string> = {
  auto: "Auto",
  blanco: "Día",
  papel: "Sepia",
  noche: "Pizarra",
  oled: "OLED",
};

// Muestra de cada paleta: el papel y la tinta tal como se ven al leer.
// «auto» parte el círculo en las dos caras que el sistema elige y no
// lleva letra porque ninguna tinta sola se leería sobre ambas mitades.
export const THEME_SWATCHES: Record<ThemeChoice, { bg: string; fg?: string }> = {
  auto: { bg: "linear-gradient(135deg, #ffffff 50%, #1f2022 50%)" },
  blanco: { bg: "#ffffff", fg: "#232019" },
  papel: { bg: "#f8f1e3", fg: "#2b2520" },
  noche: { bg: "#1f2022", fg: "#ddd9d3" },
  oled: { bg: "#000000", fg: "#e8e4dc" },
};

const THEME_KEY = "lecta:theme";
const READER_KEY = "lecta:reader";

export type ReaderFont = "literata" | "sans" | "serif" | "atkinson" | "dyslexic";

// `family` alimenta la vista previa del selector y readerCssVars: la
// misma fuente de verdad para el nombre y la variable CSS.
export const READER_FONTS: { id: ReaderFont; label: string; family: string }[] = [
  { id: "literata", label: "Literata", family: "var(--font-book)" },
  { id: "sans", label: "Alegreya Sans", family: "var(--font-sans-alt)" },
  { id: "serif", label: "Source Serif", family: "var(--font-source-serif)" },
  { id: "atkinson", label: "Atkinson", family: "var(--font-atkinson)" },
  { id: "dyslexic", label: "OpenDyslexic", family: "var(--font-dyslexic)" },
];

// Modo de concentración del lector: texto normal, párrafos cortados
// en líneas sintácticas, foco de párrafo atenuado, guía cromática o regla de foco.
export type FocusMode = "off" | "syntactic" | "paragraph" | "chromatic" | "ruler";
// Alto de la franja clara de la regla: 1 o 3 líneas, o un párrafo.
export type RulerSize = 1 | 3 | "paragraph";

export const FOCUS_MODES: { id: FocusMode; label: string }[] = [
  { id: "off", label: "Normal" },
  { id: "syntactic", label: "Líneas sintácticas" },
  { id: "paragraph", label: "Foco de párrafo" },
  { id: "chromatic", label: "Guía cromática" },
  { id: "ruler", label: "Regla de foco" },
];

export const RULER_SIZES: { id: RulerSize; label: string }[] = [
  { id: 1, label: "1 línea" },
  { id: 3, label: "3 líneas" },
  { id: "paragraph", label: "Párrafo" },
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
  /** Preparación de vocabulario al entrar a un capítulo nuevo. */
  preparationMode: PreparationMode;
  /** Separación silábica automática del navegador (hyphens: auto). */
  enableHyphenation: boolean;
  /** Estrategia de concentración visual del texto. */
  focusMode: FocusMode;
  /** Alto de la franja clara cuando la regla está activa. */
  rulerSize: RulerSize;
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
  preparationMode: "auto",
  enableHyphenation: false,
  focusMode: "off",
  rulerSize: 3,
};

export type PreparationMode = "auto" | "notice" | "off";

export const PREPARATION_MODES: { id: PreparationMode; label: string }[] = [
  { id: "auto", label: "Abrir antes de leer" },
  { id: "notice", label: "Solo avisar" },
  { id: "off", label: "No mostrar" },
];

export const READER_LIMITS = {
  size: { min: 16, max: 24 },
  leading: { min: 1.5, max: 1.9 },
} as const;

// Interlineado como tres pasos con nombre; los extremos coinciden con
// READER_LIMITS.leading para no ofrecer valores que el parseador rechaza.
export const LEADING_OPTIONS: { value: number; label: string }[] = [
  { value: 1.5, label: "Estrecho" },
  { value: 1.65, label: "Normal" },
  { value: 1.9, label: "Amplio" },
];

// Margen amplio = columna angosta: el orden de `measure` va al revés
// del nombre del margen.
export const MARGIN_OPTIONS: { value: ReaderSettings["measure"]; label: string }[] = [
  { value: 75, label: "Estrechos" },
  { value: 65, label: "Normal" },
  { value: 55, label: "Amplios" },
];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// El «crema» guardado migra a «papel»: la paleta sepia actual cubre
// el mismo papel cálido y la preferencia sigue siendo clara.
export function parseTheme(raw: string | null): ThemeChoice {
  if (raw === "crema") return "papel";
  return raw === "papel" ||
    raw === "noche" ||
    raw === "blanco" ||
    raw === "oled"
    ? raw
    : "auto";
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
      preparationMode: parsePreparationMode(v.preparationMode),
      enableHyphenation: v.enableHyphenation === true,
      focusMode:
        v.focusMode === "syntactic" ||
        v.focusMode === "paragraph" ||
        v.focusMode === "chromatic" ||
        v.focusMode === "ruler"
          ? v.focusMode
          : "off",
      rulerSize:
        v.rulerSize === 1 || v.rulerSize === 3 || v.rulerSize === "paragraph"
          ? v.rulerSize
          : 3,
    };
  } catch {
    return READER_DEFAULTS;
  }
}

export const parsePreparationMode = (v: unknown): PreparationMode =>
  v === "notice" || v === "off" ? v : "auto";

// ¿Hay una elección explícita de preparación aplicable a este libro?
// Lee el dato crudo, no el resuelto: un archivo de libro sin el campo
// no cuenta como elección, y el default «auto» tampoco.
export function hasExplicitPreparationMode(bookHash?: string): boolean {
  const explicit = (raw: string | null) => {
    try {
      const v = raw ? (JSON.parse(raw) as { preparationMode?: unknown }) : null;
      return (
        v?.preparationMode === "auto" ||
        v?.preparationMode === "notice" ||
        v?.preparationMode === "off"
      );
    } catch {
      return false;
    }
  };
  if (bookHash) {
    const own = storage()?.getItem(readerKeyFor(bookHash));
    if (own !== null && own !== undefined) return explicit(own);
  }
  return explicit(storage()?.getItem(READER_KEY) ?? null);
}

// Variables CSS que aplica el contenedor del lector.
export function readerCssVars(s: ReaderSettings): Record<string, string> {
  return {
    "--read-font":
      READER_FONTS.find((f) => f.id === s.font)?.family ?? "var(--font-book)",
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

export type PracticeCompanionMode = "animated" | "calm" | "off";

const PRACTICE_COMPANION_KEY = "lecta:companion:practice";

// Preferencia del compañero en los juegos y repasos del Cuaderno:
// «animated» (por defecto): reacciona con saltos, poses y combos en vivo.
// «calm»: acompaña en reposo (idle) sin interrumpir el ritmo y festeja al terminar.
// «off»: se oculta durante los ejercicios para máxima sobriedad.
export function loadPracticeCompanionMode(): PracticeCompanionMode {
  try {
    const val = storage()?.getItem(PRACTICE_COMPANION_KEY);
    if (val === "calm" || val === "off" || val === "animated") return val;
    return "animated";
  } catch {
    return "animated";
  }
}

export function savePracticeCompanionMode(mode: PracticeCompanionMode): void {
  try {
    if (mode === "animated") storage()?.removeItem(PRACTICE_COMPANION_KEY);
    else storage()?.setItem(PRACTICE_COMPANION_KEY, mode);
  } catch {
    // almacenamiento lleno o deshabilitado
  }
}

const NATIVE_LANGUAGE_KEY = "lecta:nativeLanguage";
const NATIVE_CONFIRMED_KEY = "lecta:nativeLanguageConfirmed";

export function loadNativeLanguage(): string {
  try {
    return storage()?.getItem(NATIVE_LANGUAGE_KEY) || "es";
  } catch {
    return "es";
  }
}

export function hasExplicitNativeLanguage(): boolean {
  try {
    return storage()?.getItem(NATIVE_CONFIRMED_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveNativeLanguage(language: string): void {
  try {
    storage()?.setItem(NATIVE_CONFIRMED_KEY, "1");
    if (language === "es") storage()?.removeItem(NATIVE_LANGUAGE_KEY);
    else storage()?.setItem(NATIVE_LANGUAGE_KEY, language);
  } catch {
    // almacenamiento lleno o deshabilitado
  }
}

export function readerProfileFor(
  nativeLanguage = loadNativeLanguage(),
  bookLanguage = "es",
): CalibrationProfile {
  return nativeLanguage === bookLanguage ? "native" : "learner";
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
    root.style.colorScheme =
      choice === "noche" || choice === "oled" ? "dark" : "light";
  }
}
