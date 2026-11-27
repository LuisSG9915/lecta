import type {
  ReaderSettings,
  TextSpacingPreset,
} from "./settings";

export type OpticalRecipeStepId = "spacing" | "measure" | "font" | "layout";
export type OpticalOptionId = "a" | "b";

export interface OpticalRecipeChoices {
  spacing: "normal" | "relaxed";
  measure: "standard" | "compact";
  font: "literata" | "atkinson";
  layout: "pages" | "scroll";
}

export interface OpticalRecipeOption {
  id: OpticalOptionId;
  label: string;
  tag: string;
  value: string;
  previewStyle: {
    fontFamily?: string;
    letterSpacing?: string;
    wordSpacing?: string;
    maxWidth?: string;
    lineHeight?: string;
  };
  previewHint?: string;
}

export interface OpticalRecipeStep {
  id: OpticalRecipeStepId;
  title: string;
  question: string;
  scienceNote: string;
  options: readonly [OpticalRecipeOption, OpticalRecipeOption];
}

export const OPTICAL_RECIPE_STEPS: readonly OpticalRecipeStep[] = [
  {
    id: "spacing",
    title: "Respiración del texto",
    question: "¿En cuál descansan más tus ojos?",
    scienceNote:
      "Un poco más de aire entre letras y palabras reduce el apiñamiento visual y la fatiga ocular.",
    options: [
      {
        id: "a",
        label: "Normal",
        tag: "Clásico",
        value: "normal",
        previewStyle: { letterSpacing: "0em", wordSpacing: "0em" },
      },
      {
        id: "b",
        label: "Holgado",
        tag: "Más aire",
        value: "relaxed",
        previewStyle: { letterSpacing: "0.025em", wordSpacing: "0.08em" },
      },
    ],
  },
  {
    id: "measure",
    title: "Ancho de columna",
    question: "¿En cuál sigues el salto de renglón sin esfuerzo?",
    scienceNote:
      "Líneas un poco más cortas evitan perder el hilo al volver al principio del siguiente renglón.",
    options: [
      {
        id: "a",
        label: "Estándar",
        tag: "65 caracteres",
        value: "standard",
        previewStyle: { maxWidth: "34ch" },
      },
      {
        id: "b",
        label: "Compacto",
        tag: "55 caracteres",
        value: "compact",
        previewStyle: { maxWidth: "26ch" },
      },
    ],
  },
  {
    id: "font",
    title: "Tipografía",
    question: "¿Qué trazo te resulta más nítido a primera vista?",
    scienceNote:
      "Cada ojo lee hasta un 35 % más rápido con la letra que mejor distingue.",
    options: [
      {
        id: "a",
        label: "Literata",
        tag: "Editorial con serifa",
        value: "literata",
        previewStyle: { fontFamily: "var(--font-book)" },
      },
      {
        id: "b",
        label: "Atkinson Next",
        tag: "Alta legibilidad",
        value: "atkinson",
        previewStyle: { fontFamily: "var(--font-atkinson)" },
      },
    ],
  },
  {
    id: "layout",
    title: "Forma de avanzar",
    question: "¿Cómo prefieres avanzar por el libro?",
    scienceNote:
      "Pasar páginas crea un mapa espacial del texto que facilita recordar dónde leíste cada idea.",
    options: [
      {
        id: "a",
        label: "Por páginas",
        tag: "Mapa mental claro",
        value: "pages",
        previewStyle: {},
        previewHint: "Pasa de pantalla completa, sin mover el texto",
      },
      {
        id: "b",
        label: "Desplazamiento",
        tag: "Flujo continuo",
        value: "scroll",
        previewStyle: {},
        previewHint: "Desliza hacia abajo de forma continua",
      },
    ],
  },
];

const FALLBACK_PASSAGES: Record<string, string> = {
  en: "The morning light crossed the wooden table slowly, catching the dust in the air as she opened the notebook to the page she had marked the night before.",
  es: "La luz de la mañana cruzó la mesa despacio, iluminando el polvo en el aire mientras abría el cuaderno justo por la página que había marcado la noche anterior.",
};

function isMostlyUpperCase(text: string): boolean {
  const letters = text.replace(/[^a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]/g, "");
  if (letters.length === 0) return false;
  return letters === letters.toUpperCase();
}

function trimPassage(candidate: string): string {
  if (candidate.length <= 210) return candidate;
  const slice = candidate.slice(0, 210);
  const sentenceEnd = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? "),
  );
  if (sentenceEnd >= 110) {
    return slice.slice(0, sentenceEnd + 1).trim();
  }
  const spaceIdx = slice.slice(0, 200).lastIndexOf(" ");
  if (spaceIdx >= 80) {
    return `${slice.slice(0, spaceIdx).trim()}…`;
  }
  return `${slice.slice(0, 200).trim()}…`;
}

export function extractSamplePassage(rawText: string, language?: string): string {
  const langKey = (language || "es").slice(0, 2).toLowerCase();
  const fallback = FALLBACK_PASSAGES[langKey] ?? FALLBACK_PASSAGES.es;

  const trimmed = (rawText ?? "").trim();
  if (!trimmed) return fallback;

  const paragraphs = trimmed
    .split(/\n+/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const goodParagraph = paragraphs.find(
    (p) => p.length >= 90 && !isMostlyUpperCase(p),
  );
  if (goodParagraph) {
    return trimPassage(goodParagraph);
  }

  const flat = trimmed.replace(/\s+/g, " ").trim();
  if (flat.length >= 60 && !isMostlyUpperCase(flat)) {
    return trimPassage(flat);
  }

  return fallback;
}

export function defaultOpticalChoicesFromSettings(
  settings: Pick<ReaderSettings, "textSpacing" | "measure" | "font" | "layout">,
): OpticalRecipeChoices {
  return {
    spacing: settings.textSpacing === "normal" ? "normal" : "relaxed",
    measure: settings.measure <= 58 ? "compact" : "standard",
    font: settings.font === "atkinson" ? "atkinson" : "literata",
    layout: settings.layout === "pages" ? "pages" : "scroll",
  };
}

export function buildOpticalRecipePatch(
  choices: OpticalRecipeChoices,
): Partial<ReaderSettings> {
  return {
    textSpacing: choices.spacing as TextSpacingPreset,
    measure: choices.measure === "compact" ? 55 : 65,
    margins: choices.measure === "compact" ? "wide" : "medium",
    font: choices.font as ReaderSettings["font"],
    layout: choices.layout,
  };
}

export function summarizeOpticalRecipe(
  choices: OpticalRecipeChoices,
): Array<{ label: string; value: string }> {
  return [
    {
      label: "Espaciado",
      value: choices.spacing === "relaxed" ? "Holgado" : "Normal",
    },
    {
      label: "Columna",
      value: choices.measure === "compact" ? "Compacta (55)" : "Estándar (65)",
    },
    {
      label: "Letra",
      value: choices.font === "atkinson" ? "Atkinson Next" : "Literata",
    },
    {
      label: "Paginación",
      value: choices.layout === "pages" ? "Por páginas" : "Desplazamiento",
    },
  ];
}
