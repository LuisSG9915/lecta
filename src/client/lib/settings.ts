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

export type ReaderTheme = "paper" | "sepia" | "night" | ThemeChoice;

export const THEME_LABELS: Record<string, string> = {
  auto: "Auto",
  blanco: "Papel Crema",
  papel: "Sepia Cálido",
  noche: "Gris Tarde",
  oled: "Noche Tinta",
  paper: "Papel",
  sepia: "Sepia",
  night: "Noche",
};

// Muestra de cada paleta: el papel y la tinta tal como se ven al leer.
// «auto» parte el círculo en las dos caras que el sistema elige y no
// lleva letra porque ninguna tinta sola se leería sobre ambas mitades.
export const THEME_SWATCHES: Record<ThemeChoice, { bg: string; fg?: string; border?: string }> = {
  auto: { bg: "linear-gradient(135deg, #fdfbf7 50%, #1f2022 50%)" },
  blanco: { bg: "#fdfbf7", fg: "#26241f", border: "#e5ded4" },
  papel: { bg: "#f8f1e3", fg: "#2b2520", border: "#ddd4c4" },
  noche: { bg: "#1f2022", fg: "#d6d9de", border: "#3a3d43" },
  oled: { bg: "#000000", fg: "#e8e4dc", border: "#22252a" },
};

const THEME_KEY = "lecta:theme";
const READER_KEY = "lecta:reader";

export type ReaderFont =
  | "literata"
  | "source-serif"
  | "alegreya-sans"
  | "atkinson"
  | "opendyslexic"
  | "sans"
  | "serif"
  | "dyslexic";

export const FONT_LABELS: Record<string, { name: string; hint: string }> = {
  literata: { name: "Literata", hint: "Clásica y legible para novelas" },
  "source-serif": { name: "Source Serif", hint: "Elegante y nítida" },
  serif: { name: "Source Serif", hint: "Elegante y nítida" },
  "alegreya-sans": { name: "Alegreya Sans", hint: "Moderna y suave a la vista" },
  sans: { name: "Alegreya Sans", hint: "Moderna y suave a la vista" },
  atkinson: { name: "Atkinson", hint: "Diseñada para máxima distinción" },
  opendyslexic: { name: "OpenDyslexic", hint: "Base pesada que evita saltos" },
  dyslexic: { name: "OpenDyslexic", hint: "Base pesada que evita saltos" },
};

export type ReaderLineHeight = "compact" | "comfortable" | "spacious";
export const LINE_HEIGHT_LABELS: Record<ReaderLineHeight, string> = {
  compact: "Compacto",
  comfortable: "Cómodo",
  spacious: "Amplio",
};

export type ReaderMargins = "narrow" | "medium" | "wide";
export const MARGIN_LABELS: Record<ReaderMargins, string> = {
  narrow: "Estrecho",
  medium: "Medio",
  wide: "Amplio",
};

export interface ReaderFontOption {
  id: ReaderFont;
  label: string;
  family: string;
  help: string;
  sample: string;
}

// `family` alimenta la vista previa del selector y readerCssVars: la
// misma fuente de verdad para el nombre y la variable CSS.
export const READER_FONTS: ReaderFontOption[] = [
  {
    id: "literata",
    label: "Literata",
    family: "var(--font-book)",
    help: "Clásica editorial",
    sample: "Aa",
  },
  {
    id: "serif",
    label: "Source Serif 4",
    family: "var(--font-source-serif)",
    help: "Elegante y nítida",
    sample: "Aa",
  },
  {
    id: "sans",
    label: "Alegreya Sans",
    family: "var(--font-sans-alt)",
    help: "Moderna y ágil",
    sample: "Aa",
  },
  {
    id: "atkinson",
    label: "Atkinson Next",
    family: "var(--font-atkinson)",
    help: "Ideal para fatiga visual",
    sample: "Aa",
  },
  {
    id: "dyslexic",
    label: "OpenDyslexic",
    family: "var(--font-dyslexic)",
    help: "Especial para dislexia",
    sample: "Aa",
  },
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

export type ChromaticPalette = "editorial" | "ocean_amber" | "forest_plum" | "high_contrast";

export const CHROMATIC_PALETTES: {
  id: ChromaticPalette;
  label: string;
  preview: readonly [string, string];
}[] = [
  { id: "editorial", label: "Editorial", preview: ["#1D4E89", "#9E3B24"] },
  { id: "ocean_amber", label: "Océano y Ámbar", preview: ["#0077B6", "#D97706"] },
  { id: "forest_plum", label: "Bosque y Ciruela", preview: ["#2D6A4F", "#7209B7"] },
  { id: "high_contrast", label: "Alto Contraste", preview: ["#000000", "#C81D25"] },
];

export type SoundscapeSetting =
  | "none"
  | "purr"
  | "rain"
  | "hearth"
  | "night_library";

export type StrategyContrast = "soft" | "balanced" | "high";

export interface ConcentrationSettings {
  syntacticLines: boolean; // Agrupación/cascada por sintagmas semánticos
  chromaticGuide: boolean; // Gradiente cromático de barrido ocular (Return Sweep)
  chromaticPalette: ChromaticPalette;
  bionicAnchors: boolean; // Resaltado sutil de las primeras letras en palabras léxicas clave
  strategyContrast: StrategyContrast; // Calibración de luminancia y contraste ('soft' | 'balanced' | 'high')
  paragraphFocus: boolean; // Atenuación de párrafos inactivos
  focusRuler: boolean; // Regla de lectura deslizable
  ambientPurr: boolean; // Ronroneo ambiental suave de concentración (Body Doubling)
  soundscape: SoundscapeSetting; // Paisaje sonoro procedural Web Audio o ronroneo
  visualPacer: boolean; // Marcapasos visual suave ("Ritmo Guiado" para TDAH)
  pacerWpm: number; // Velocidad del marcapasos en palabras por minuto (WPM)
}

// Presets cognitivos de estrategia de lectura.
export type ReadingPreset = "clean" | "adhd" | "guided" | "custom";

export interface ReaderModePresetConfig {
  id: ReadingPreset;
  icon: string;
  label: string;
  shortLabel: string;
  description: string;
}

export const READING_PRESETS: ReaderModePresetConfig[] = [
  {
    id: "clean",
    icon: "📖",
    label: "Lectura Limpia",
    shortLabel: "Limpia",
    description: "Editorial clásico sin ayudas visuales",
  },
  {
    id: "adhd",
    icon: "⚡",
    label: "Enfoque TDAH",
    shortLabel: "Enfoque",
    description: "Párrafo activo nítido + anclas de atención",
  },
  {
    id: "guided",
    icon: "🌊",
    label: "Ritmo Guiado",
    shortLabel: "Ritmo",
    description: "Frases cortas + guía cromática de alto contraste",
  },
];

export type ReadingStrategyPreset =
  | "clean"
  | "adhd"
  | "guided"
  | "immersive"
  | "focus"
  | "lexical"
  | "audio"
  | "custom";

export type StrategyPreset = ReadingStrategyPreset;

export interface ReadingStrategyPresetItem {
  id: ReadingStrategyPreset;
  title: string;
  description: string;
  icon: "retreat" | "search" | "journey" | "headphones" | "strategy" | "sparkles";
}

export const READING_STRATEGY_PRESETS: ReadingStrategyPresetItem[] = [
  {
    id: "immersive",
    title: "Inmersivo",
    description: "Lectura limpia sin distracciones visuales",
    icon: "retreat",
  },
  {
    id: "focus",
    title: "Neuro-Enfoque (TDAH)",
    description: "Guía cromática, líneas sintácticas y foco de párrafo",
    icon: "sparkles",
  },
  {
    id: "lexical",
    title: "Explorador Léxico",
    description: "Líneas sintácticas y relieve de vocabulario",
    icon: "journey",
  },
  {
    id: "audio",
    title: "Audio-Lectura",
    description: "Voz guiada con resaltado de oraciones",
    icon: "headphones",
  },
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
  /** Estrategia de concentración visual del texto (retrocompatibilidad). */
  focusMode: FocusMode;
  /** Alto de la franja clara cuando la regla está activa. */
  rulerSize: RulerSize;
  /** Modo de estrategia cognitiva activo. */
  strategyPreset: ReadingStrategyPreset;
  /** Regla de lectura visual que sigue al puntero. */
  focusRuler: boolean;
  /** Foco de párrafo con atenuación del texto inactivo al 35%. */
  paragraphFocus: boolean;
  /** Segmentación del párrafo en líneas sintácticas. */
  syntacticLines: boolean;
  /** Guía cromática continua de barrido ocular para asistir el retorno sacádico. */
  chromaticGuide: boolean;
  /** Paleta de color calibrada para la guía cromática. */
  chromaticPalette: ChromaticPalette;
  /** Resaltado tipográfico sutil de fijación en la primera parte de palabras clave (TDAH). */
  bionicAnchors: boolean;
  /** Intensidad de contraste de las ayudas cognitivas ('soft' | 'balanced' | 'high'). */
  strategyContrast: StrategyContrast;
  /** Ronroneo ambiental suave de concentración (Body Doubling). */
  ambientPurr: boolean;
  /** Paisaje sonoro procedural Web Audio o ronroneo. */
  soundscape: SoundscapeSetting;
  /** Subrayado sutil de palabras candidatas del capítulo y locuciones. */
  highlightLexical: boolean;
  /** Oculta indicadores secundarios para lectura sin distracciones. */
  hideSecondaryIndicators: boolean;
  /** Marcapasos visual suave ("Ritmo Guiado") para concentración TDAH. */
  visualPacer: boolean;
  /** Velocidad del marcapasos visual en palabras por minuto (WPM). */
  pacerWpm: number;
  /** Preset de lectura activo ('clean' | 'adhd' | 'guided' | 'custom'). */
  readingPreset?: ReadingPreset;
  /** Guía de color / guía cromática. */
  colorGuide?: boolean;
  /** Modo de preparación adaptativa de vocabulario antes de cada capítulo (Track 6) */
  chapterPrimingMode?: ChapterPrimingMode;
  /** Máximo de palabras por capítulo (Cowan: 3 a 5) */
  maxPrimingWords?: 3 | 4 | 5 | 7;
  /** IDs de libros silenciados para pre-lectura */
  mutedPrimingBookIds?: string[];
  /** Subrayado sutil en el texto para palabras pre-vistas */
  subtleInTextAnchor?: boolean;
  /** Memoria de personajes sin spoilers (Track 8) */
  characterMemoryEnabled?: boolean;
  mutedCharacterMemoryBookIds?: string[];
  /** Neuro-foco adaptativo y telemetría de fatiga (Track 9) */
  focusAutoSuggestEnabled?: boolean;
  mutedFocusBookIds?: string[];
  /** Micro-reto de consolidación episódica al cerrar capítulo (Track 10) */
  postChapterConsolidationEnabled?: boolean;
  mutedConsolidationBookIds?: string[];
  /** Andamiaje bilingüe multinivel en L2 (Track 11) */
  bilingualScaffoldingMode?: "auto" | "tier-1-only" | "tier-3-always" | "off";
  mutedBilingualBookIds?: string[];
  theme?: ReaderTheme;
  fontSize?: number;
  lineHeight?: ReaderLineHeight | number;
  margins?: ReaderMargins | number;
  bionicReading?: boolean;
  syllableBreaks?: boolean;
  bilingueEnabled?: boolean;
  chapterPreview?: boolean | "auto" | "off" | "minimal";
  companionEnabled?: boolean;
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
  strategyPreset: "immersive",
  focusRuler: false,
  paragraphFocus: false,
  syntacticLines: false,
  chromaticGuide: false,
  chromaticPalette: "editorial",
  bionicAnchors: false,
  strategyContrast: "high",
  ambientPurr: false,
  soundscape: "none",
  highlightLexical: false,
  hideSecondaryIndicators: true,
  visualPacer: false,
  pacerWpm: 210,
  theme: "paper",
  fontSize: 18,
  lineHeight: "comfortable",
  margins: "medium",
  bionicReading: false,
  syllableBreaks: false,
  bilingueEnabled: false,
  chapterPreview: true,
  companionEnabled: true,
  chapterPrimingMode: "auto",
  maxPrimingWords: 4,
  mutedPrimingBookIds: [],
  subtleInTextAnchor: true,
  characterMemoryEnabled: true,
  mutedCharacterMemoryBookIds: [],
  focusAutoSuggestEnabled: true,
  mutedFocusBookIds: [],
  postChapterConsolidationEnabled: true,
  mutedConsolidationBookIds: [],
  bilingualScaffoldingMode: "auto",
  mutedBilingualBookIds: [],
};

export const DEFAULT_SETTINGS: ReaderSettings = READER_DEFAULTS;

export type ChapterPrimingMode = "auto" | "on-demand" | "off";

export interface ChapterPrimingSettings {
  /**
   * 'auto': Muestra de 3 a 5 palabras clave antes del capítulo si superan el umbral cognitivo.
   * 'on-demand': No abre nada automáticamente; muestra una píldora discreta en el encabezado.
   * 'off': Desactivado por completo.
   */
  mode: ChapterPrimingMode;
  /** Máximo de palabras por capítulo (basado en el límite de memoria de trabajo de Cowan: 3 a 5) */
  maxWordsPerChapter: 3 | 4 | 5 | 7;
  /** IDs de libros donde el usuario eligió "Ocultar en este libro" */
  mutedBookIds: string[];
  /** Activa el subrayado punteado sutil en el capítulo para las palabras pre-vistas */
  subtleInTextAnchor: boolean;
}

export const DEFAULT_CHAPTER_PRIMING_SETTINGS: ChapterPrimingSettings = {
  mode: "auto",
  maxWordsPerChapter: 4,
  mutedBookIds: [],
  subtleInTextAnchor: true,
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

export function applyReadingPreset(
  current: ReaderSettings,
  preset: Exclude<ReadingPreset, "custom">,
): ReaderSettings {
  switch (preset) {
    case "clean":
      return {
        ...current,
        readingPreset: "clean",
        strategyPreset: "clean",
        focusRuler: false,
        paragraphFocus: false,
        syntacticLines: false,
        chromaticGuide: false,
        colorGuide: false,
        bionicAnchors: false,
        focusMode: "off",
        visualPacer: false,
        highlightLexical: false,
        hideSecondaryIndicators: true,
      };

    case "adhd":
      return {
        ...current,
        readingPreset: "adhd",
        strategyPreset: "adhd",
        paragraphFocus: true,
        bionicAnchors: true,
        focusRuler: false,
        syntacticLines: false,
        chromaticGuide: false,
        colorGuide: false,
        focusMode: "paragraph",
        visualPacer: false,
        highlightLexical: false,
        hideSecondaryIndicators: false,
      };

    case "guided":
      return {
        ...current,
        readingPreset: "guided",
        strategyPreset: "guided",
        syntacticLines: true,
        chromaticGuide: true,
        colorGuide: true,
        paragraphFocus: false,
        focusRuler: false,
        bionicAnchors: false,
        focusMode: "chromatic",
        visualPacer: false,
        highlightLexical: false,
        hideSecondaryIndicators: false,
      };

    default:
      return current;
  }
}

export function detectActiveReadingPreset(settings: ReaderSettings): ReadingPreset {
  if (
    !settings.focusRuler &&
    !settings.paragraphFocus &&
    !settings.syntacticLines &&
    !settings.chromaticGuide &&
    !settings.bionicAnchors &&
    !settings.visualPacer
  ) {
    return "clean";
  }
  if (
    settings.paragraphFocus &&
    settings.bionicAnchors &&
    !settings.syntacticLines &&
    !settings.chromaticGuide
  ) {
    return "adhd";
  }
  if (
    settings.syntacticLines &&
    settings.chromaticGuide &&
    !settings.paragraphFocus &&
    !settings.focusRuler
  ) {
    return "guided";
  }
  if (settings.strategyPreset === "clean" || settings.strategyPreset === "immersive") return "clean";
  if (settings.strategyPreset === "adhd" || settings.strategyPreset === "focus") return "adhd";
  if (settings.strategyPreset === "guided") return "guided";
  return "custom";
}

export function applyStrategyPreset(
  preset: ReadingStrategyPreset,
  currentSettings: ReaderSettings,
): ReaderSettings {
  switch (preset) {
    case "clean":
      return applyReadingPreset(currentSettings, "clean");
    case "adhd":
      return applyReadingPreset(currentSettings, "adhd");
    case "guided":
      return applyReadingPreset(currentSettings, "guided");
    case "immersive":
      return {
        ...currentSettings,
        strategyPreset: "immersive",
        focusRuler: false,
        paragraphFocus: false,
        syntacticLines: false,
        focusMode: "off",
        highlightLexical: false,
        hideSecondaryIndicators: true,
      };
    case "focus":
      return {
        ...currentSettings,
        strategyPreset: "focus",
        focusRuler: false,
        paragraphFocus: true,
        syntacticLines: true,
        chromaticGuide: true,
        bionicAnchors: true,
        focusMode: "chromatic",
        highlightLexical: false,
        hideSecondaryIndicators: false,
      };
    case "lexical":
      return {
        ...currentSettings,
        strategyPreset: "lexical",
        syntacticLines: true,
        focusRuler: false,
        paragraphFocus: false,
        focusMode: "syntactic",
        highlightLexical: true,
        hideSecondaryIndicators: false,
      };
    case "audio":
      return {
        ...currentSettings,
        strategyPreset: "audio",
        focusRuler: false,
        paragraphFocus: false,
        syntacticLines: false,
        focusMode: "off",
        highlightLexical: false,
        hideSecondaryIndicators: false,
      };
    case "custom":
      return {
        ...currentSettings,
        strategyPreset: "custom",
      };
    default:
      return currentSettings;
  }
}

export function isStrategyPresetActive(
  preset: ReadingStrategyPreset,
  settings: ReaderSettings,
): boolean {
  if (preset === "custom") return settings.strategyPreset === "custom";
  if (preset === "clean" || preset === "immersive") {
    return (
      settings.strategyPreset === "clean" ||
      settings.strategyPreset === "immersive" ||
      (!settings.focusRuler &&
        !settings.paragraphFocus &&
        !settings.syntacticLines &&
        !settings.chromaticGuide &&
        settings.strategyPreset !== "audio")
    );
  }
  if (preset === "adhd") {
    return (
      settings.strategyPreset === "adhd" ||
      (settings.paragraphFocus && settings.bionicAnchors && !settings.syntacticLines)
    );
  }
  if (preset === "guided") {
    return (
      settings.strategyPreset === "guided" ||
      (settings.syntacticLines && settings.chromaticGuide && !settings.paragraphFocus)
    );
  }
  if (preset === "focus") {
    return (
      settings.strategyPreset === "focus" ||
      (settings.syntacticLines && settings.chromaticGuide && settings.paragraphFocus) ||
      (settings.focusRuler && settings.paragraphFocus && !settings.syntacticLines)
    );
  }
  if (preset === "lexical") {
    return (
      settings.strategyPreset === "lexical" ||
      (settings.syntacticLines && !settings.focusRuler && !settings.paragraphFocus && !settings.chromaticGuide)
    );
  }
  if (preset === "audio") {
    return settings.strategyPreset === "audio";
  }
  return false;
}

export function parseReaderSettings(raw: string | null): ReaderSettings {
  if (!raw) return READER_DEFAULTS;
  try {
    const v = JSON.parse(raw) as Partial<ReaderSettings>;
    if (!v || typeof v !== "object" || Array.isArray(v)) return READER_DEFAULTS;
    const focusMode: FocusMode =
      v.focusMode === "syntactic" ||
      v.focusMode === "paragraph" ||
      v.focusMode === "chromatic" ||
      v.focusMode === "ruler"
        ? v.focusMode
        : "off";

    const focusRuler =
      typeof v.focusRuler === "boolean"
        ? v.focusRuler
        : focusMode === "ruler";

    const paragraphFocus =
      typeof v.paragraphFocus === "boolean"
        ? v.paragraphFocus
        : focusMode === "paragraph";

    const syntacticLines =
      typeof v.syntacticLines === "boolean"
        ? v.syntacticLines
        : focusMode === "syntactic" || focusMode === "chromatic";

    const chromaticGuide =
      typeof v.chromaticGuide === "boolean"
        ? v.chromaticGuide
        : focusMode === "chromatic";

    const chromaticPalette: ChromaticPalette =
      v.chromaticPalette === "ocean_amber" ||
      v.chromaticPalette === "forest_plum" ||
      v.chromaticPalette === "high_contrast"
        ? v.chromaticPalette
        : "editorial";

    const bionicAnchors =
      typeof v.bionicAnchors === "boolean"
        ? v.bionicAnchors
        : false;

    const strategyContrast: StrategyContrast =
      v.strategyContrast === "soft" ||
      v.strategyContrast === "balanced" ||
      v.strategyContrast === "high"
        ? v.strategyContrast
        : "high";

    const ambientPurr =
      typeof v.ambientPurr === "boolean"
        ? v.ambientPurr
        : false;

    let strategyPreset: ReadingStrategyPreset;
    if (
      v.strategyPreset === "clean" ||
      v.strategyPreset === "adhd" ||
      v.strategyPreset === "guided" ||
      v.strategyPreset === "immersive" ||
      v.strategyPreset === "focus" ||
      v.strategyPreset === "lexical" ||
      v.strategyPreset === "audio" ||
      v.strategyPreset === "custom"
    ) {
      strategyPreset = v.strategyPreset;
    } else if (
      (syntacticLines && chromaticGuide && paragraphFocus) ||
      (focusRuler && paragraphFocus && !syntacticLines)
    ) {
      strategyPreset = "focus";
    } else if (syntacticLines && !focusRuler && !paragraphFocus) {
      strategyPreset = "lexical";
    } else if (focusRuler || paragraphFocus || syntacticLines || chromaticGuide) {
      strategyPreset = "custom";
    } else {
      strategyPreset = "immersive";
    }

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
      focusMode,
      rulerSize:
        v.rulerSize === 1 || v.rulerSize === 3 || v.rulerSize === "paragraph"
          ? v.rulerSize
          : 3,
      strategyPreset,
      focusRuler,
      paragraphFocus,
      syntacticLines,
      chromaticGuide,
      chromaticPalette,
      bionicAnchors,
      strategyContrast,
      ambientPurr,
      soundscape:
        v.soundscape === "purr" ||
        v.soundscape === "rain" ||
        v.soundscape === "hearth" ||
        v.soundscape === "night_library"
          ? v.soundscape
          : ambientPurr
            ? "purr"
            : "none",
      highlightLexical:
        typeof v.highlightLexical === "boolean"
          ? v.highlightLexical
          : strategyPreset === "lexical",
      hideSecondaryIndicators:
        typeof v.hideSecondaryIndicators === "boolean"
          ? v.hideSecondaryIndicators
          : strategyPreset === "immersive",
      visualPacer: v.visualPacer === true,
      pacerWpm:
        typeof v.pacerWpm === "number" && v.pacerWpm >= 60 && v.pacerWpm <= 600
          ? v.pacerWpm
          : 210,
      ...(v.chapterPrimingMode !== undefined
        ? {
            chapterPrimingMode:
              v.chapterPrimingMode === "auto" ||
              v.chapterPrimingMode === "on-demand" ||
              v.chapterPrimingMode === "off"
                ? v.chapterPrimingMode
                : "auto",
          }
        : {}),
      ...(v.maxPrimingWords !== undefined
        ? {
            maxPrimingWords:
              v.maxPrimingWords === 3 ||
              v.maxPrimingWords === 4 ||
              v.maxPrimingWords === 5 ||
              v.maxPrimingWords === 7
                ? v.maxPrimingWords
                : 4,
          }
        : {}),
      ...(v.mutedPrimingBookIds !== undefined
        ? {
            mutedPrimingBookIds: Array.isArray(v.mutedPrimingBookIds)
              ? v.mutedPrimingBookIds.filter((id): id is string => typeof id === "string")
              : [],
          }
        : {}),
      ...(v.subtleInTextAnchor !== undefined
        ? {
            subtleInTextAnchor:
              typeof v.subtleInTextAnchor === "boolean" ? v.subtleInTextAnchor : true,
          }
        : {}),
      ...(v.characterMemoryEnabled !== undefined
        ? { characterMemoryEnabled: v.characterMemoryEnabled === true }
        : {}),
      ...(v.mutedCharacterMemoryBookIds !== undefined
        ? {
            mutedCharacterMemoryBookIds: Array.isArray(v.mutedCharacterMemoryBookIds)
              ? v.mutedCharacterMemoryBookIds.filter((id): id is string => typeof id === "string")
              : [],
          }
        : {}),
      ...(v.focusAutoSuggestEnabled !== undefined
        ? { focusAutoSuggestEnabled: v.focusAutoSuggestEnabled !== false }
        : {}),
      ...(v.mutedFocusBookIds !== undefined
        ? {
            mutedFocusBookIds: Array.isArray(v.mutedFocusBookIds)
              ? v.mutedFocusBookIds.filter((id): id is string => typeof id === "string")
              : [],
          }
        : {}),
      ...(v.postChapterConsolidationEnabled !== undefined
        ? { postChapterConsolidationEnabled: v.postChapterConsolidationEnabled !== false }
        : {}),
      ...(v.mutedConsolidationBookIds !== undefined
        ? {
            mutedConsolidationBookIds: Array.isArray(v.mutedConsolidationBookIds)
              ? v.mutedConsolidationBookIds.filter((id): id is string => typeof id === "string")
              : [],
          }
        : {}),
      ...(v.bilingualScaffoldingMode !== undefined
        ? {
            bilingualScaffoldingMode:
              v.bilingualScaffoldingMode === "auto" ||
              v.bilingualScaffoldingMode === "tier-1-only" ||
              v.bilingualScaffoldingMode === "tier-3-always" ||
              v.bilingualScaffoldingMode === "off"
                ? v.bilingualScaffoldingMode
                : "auto",
          }
        : {}),
      ...(v.mutedBilingualBookIds !== undefined
        ? {
            mutedBilingualBookIds: Array.isArray(v.mutedBilingualBookIds)
              ? v.mutedBilingualBookIds.filter((id): id is string => typeof id === "string")
              : [],
          }
        : {}),
      ...(v.readingPreset !== undefined ? { readingPreset: v.readingPreset } : {}),
      ...(v.colorGuide !== undefined ? { colorGuide: v.colorGuide } : {}),
    };
  } catch {
    return READER_DEFAULTS;
  }
}

export interface UnifiedSmartAssistsPrefs {
  chapterPrimingMode: ChapterPrimingMode;
  mutedPrimingBookIds: string[];
  characterMemoryEnabled: boolean;
  mutedCharacterMemoryBookIds: string[];
  focusAutoSuggestEnabled: boolean;
  mutedFocusBookIds: string[];
  postChapterConsolidationEnabled: boolean;
  mutedConsolidationBookIds: string[];
  bilingualScaffoldingMode: "auto" | "tier-1-only" | "tier-3-always" | "off";
  mutedBilingualBookIds: string[];
}

export function loadUnifiedSmartAssists(bookId?: string): UnifiedSmartAssistsPrefs {
  const settings = loadReaderSettings(bookId);
  const priming = loadChapterPrimingSettings();
  const mutedPriming = settings.mutedPrimingBookIds && settings.mutedPrimingBookIds.length > 0
    ? settings.mutedPrimingBookIds
    : priming.mutedBookIds ?? [];
  return {
    chapterPrimingMode: priming.mode ?? settings.chapterPrimingMode ?? "auto",
    mutedPrimingBookIds: mutedPriming,
    characterMemoryEnabled: settings.characterMemoryEnabled !== false,
    mutedCharacterMemoryBookIds: settings.mutedCharacterMemoryBookIds ?? [],
    focusAutoSuggestEnabled: settings.focusAutoSuggestEnabled !== false,
    mutedFocusBookIds: settings.mutedFocusBookIds ?? [],
    postChapterConsolidationEnabled: settings.postChapterConsolidationEnabled !== false,
    mutedConsolidationBookIds: settings.mutedConsolidationBookIds ?? [],
    bilingualScaffoldingMode: settings.bilingualScaffoldingMode ?? "auto",
    mutedBilingualBookIds: settings.mutedBilingualBookIds ?? [],
  };
}

export function saveUnifiedSmartAssists(
  updates: Partial<UnifiedSmartAssistsPrefs>,
  bookId?: string,
): void {
  const current = loadReaderSettings(bookId);
  const next: ReaderSettings = {
    ...current,
    ...(updates.chapterPrimingMode !== undefined ? { chapterPrimingMode: updates.chapterPrimingMode } : {}),
    ...(updates.mutedPrimingBookIds !== undefined ? { mutedPrimingBookIds: updates.mutedPrimingBookIds } : {}),
    ...(updates.characterMemoryEnabled !== undefined ? { characterMemoryEnabled: updates.characterMemoryEnabled } : {}),
    ...(updates.mutedCharacterMemoryBookIds !== undefined ? { mutedCharacterMemoryBookIds: updates.mutedCharacterMemoryBookIds } : {}),
    ...(updates.focusAutoSuggestEnabled !== undefined ? { focusAutoSuggestEnabled: updates.focusAutoSuggestEnabled } : {}),
    ...(updates.mutedFocusBookIds !== undefined ? { mutedFocusBookIds: updates.mutedFocusBookIds } : {}),
    ...(updates.postChapterConsolidationEnabled !== undefined ? { postChapterConsolidationEnabled: updates.postChapterConsolidationEnabled } : {}),
    ...(updates.mutedConsolidationBookIds !== undefined ? { mutedConsolidationBookIds: updates.mutedConsolidationBookIds } : {}),
    ...(updates.bilingualScaffoldingMode !== undefined ? { bilingualScaffoldingMode: updates.bilingualScaffoldingMode } : {}),
    ...(updates.mutedBilingualBookIds !== undefined ? { mutedBilingualBookIds: updates.mutedBilingualBookIds } : {}),
  };
  saveReaderSettings(next, bookId);

  if (updates.chapterPrimingMode !== undefined || updates.mutedPrimingBookIds !== undefined) {
    const priming = loadChapterPrimingSettings();
    saveChapterPrimingSettings({
      ...priming,
      ...(updates.chapterPrimingMode !== undefined ? { mode: updates.chapterPrimingMode } : {}),
      ...(updates.mutedPrimingBookIds !== undefined ? { mutedBookIds: updates.mutedPrimingBookIds } : {}),
    });
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

export const loadSettings = loadReaderSettings;

export function saveReaderSettings(settings: ReaderSettings, bookHash?: string) {
  try {
    storage()?.setItem(readerKeyFor(bookHash), JSON.stringify(settings));
  } catch {
    // mismo criterio que saveTheme
  }
}

export const saveSettings = saveReaderSettings;

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

export type NativeLanguage = "es" | "en" | string;

const NATIVE_LANGUAGE_KEY = "lecta:nativeLanguage";
const NATIVE_CONFIRMED_KEY = "lecta:nativeLanguageConfirmed";

export function loadNativeLanguage(): NativeLanguage {
  try {
    return (storage()?.getItem(NATIVE_LANGUAGE_KEY) as NativeLanguage) || "es";
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

export const THEME_META_COLORS: Record<string, string> = {
  paper: "#FBF7F0",
  papel: "#FBF7F0",
  white: "#FFFFFF",
  blanco: "#FFFFFF",
  night: "#141619",
  noche: "#141619",
  oled: "#000000",
};

// Sin elección manual ("auto") no se pone data-theme y la media query de
// prefers-color-scheme decide; así el cambio del sistema se refleja solo.
export function applyTheme(choice: ThemeChoice | "paper" | "white" | "night") {
  const root = document.documentElement;
  const canonical =
    choice === "paper"
      ? "papel"
      : choice === "white"
        ? "blanco"
        : choice === "night"
          ? "noche"
          : choice;
  if (canonical === "auto") {
    root.removeAttribute("data-theme");
    root.style.colorScheme = "light dark";
  } else {
    root.dataset.theme = canonical;
    root.style.colorScheme =
      canonical === "noche" || canonical === "oled" ? "dark" : "light";
  }

  if (typeof document !== "undefined") {
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "theme-color");
      document.head?.appendChild(meta);
    }
    const isDark =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
    const color = THEME_META_COLORS[choice] ?? (isDark ? "#141619" : "#FBF7F0");
    meta.setAttribute("content", color);
  }
}

export const CHAPTER_PRIMING_KEY = "lecta:chapter_priming:v1";

export function loadChapterPrimingSettings(): ChapterPrimingSettings {
  try {
    const raw = storage()?.getItem(CHAPTER_PRIMING_KEY);
    if (!raw) return { ...DEFAULT_CHAPTER_PRIMING_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<ChapterPrimingSettings>;
    return {
      mode:
        parsed.mode === "auto" || parsed.mode === "on-demand" || parsed.mode === "off"
          ? parsed.mode
          : DEFAULT_CHAPTER_PRIMING_SETTINGS.mode,
      maxWordsPerChapter:
        parsed.maxWordsPerChapter === 3 ||
        parsed.maxWordsPerChapter === 4 ||
        parsed.maxWordsPerChapter === 5 ||
        parsed.maxWordsPerChapter === 7
          ? parsed.maxWordsPerChapter
          : DEFAULT_CHAPTER_PRIMING_SETTINGS.maxWordsPerChapter,
      mutedBookIds: Array.isArray(parsed.mutedBookIds)
        ? parsed.mutedBookIds.filter((id): id is string => typeof id === "string")
        : [],
      subtleInTextAnchor:
        typeof parsed.subtleInTextAnchor === "boolean"
          ? parsed.subtleInTextAnchor
          : DEFAULT_CHAPTER_PRIMING_SETTINGS.subtleInTextAnchor,
    };
  } catch {
    return { ...DEFAULT_CHAPTER_PRIMING_SETTINGS };
  }
}

export function saveChapterPrimingSettings(settings: ChapterPrimingSettings): void {
  try {
    storage()?.setItem(CHAPTER_PRIMING_KEY, JSON.stringify(settings));
  } catch {
    // Almacenamiento lleno o inaccesible
  }
}

export function muteBookForPriming(bookId: string): void {
  if (!bookId) return;
  const current = loadChapterPrimingSettings();
  if (!current.mutedBookIds.includes(bookId)) {
    saveChapterPrimingSettings({
      ...current,
      mutedBookIds: [...current.mutedBookIds, bookId],
    });
  }
}

export function unmuteBookForPriming(bookId: string): void {
  if (!bookId) return;
  const current = loadChapterPrimingSettings();
  saveChapterPrimingSettings({
    ...current,
    mutedBookIds: current.mutedBookIds.filter((id) => id !== bookId),
  });
}

export function isPrimingMutedForBook(bookId: string): boolean {
  if (!bookId) return false;
  const current = loadChapterPrimingSettings();
  return current.mutedBookIds.includes(bookId);
}

export function disablePrimingGlobally(): void {
  const current = loadChapterPrimingSettings();
  saveChapterPrimingSettings({
    ...current,
    mode: "off",
  });
  saveUnifiedSmartAssists({
    chapterPrimingMode: "off",
  });
}

export function setChapterPrimingMode(mode: ChapterPrimingMode): void {
  const current = loadChapterPrimingSettings();
  saveChapterPrimingSettings({
    ...current,
    mode,
  });
  saveUnifiedSmartAssists({
    chapterPrimingMode: mode,
  });
}

