// Generador y renderizador de tarjetas de citas tipográficas de Lecta.
// Formatos para historias de WhatsApp (9:16) y cuadrado (1:1).

export type QuoteCardFormat = "story" | "square";
export type QuoteCardTheme = "papel" | "blanco" | "noche" | "bermellon";

export type QuoteCardConfig = {
  text: string;
  author?: string;
  bookTitle?: string;
  chapterTitle?: string;
  format: QuoteCardFormat;
  theme: QuoteCardTheme;
  showAuthor: boolean;
  showBookTitle: boolean;
  showChapter: boolean;
  showBranding: boolean;
};

export const THEME_PALETTES: Record<
  QuoteCardTheme,
  {
    bg: string;
    border: string;
    quoteMark: string;
    text: string;
    meta: string;
    brand: string;
  }
> = {
  papel: {
    bg: "#f8f1e3",
    border: "#ddd4c4",
    quoteMark: "#c2452d", // bermellón
    text: "#2b2520",
    meta: "#6e6457",
    brand: "#9e3a23",
  },
  blanco: {
    bg: "#ffffff",
    border: "#e3ded3",
    quoteMark: "#9e3a23",
    text: "#26241f",
    meta: "#6e6a60",
    brand: "#9e3a23",
  },
  noche: {
    bg: "#1a1b1d",
    border: "#33363c",
    quoteMark: "#e07a5f",
    text: "#e6e9ee",
    meta: "#969ca6",
    brand: "#e07a5f",
  },
  bermellon: {
    bg: "#8c2e19",
    border: "#a83b22",
    quoteMark: "#f4d06f", // ocre suave
    text: "#fbf6ec",
    meta: "#e6cfc5",
    brand: "#fbf6ec",
  },
};

export const FORMAT_DIMENSIONS: Record<
  QuoteCardFormat,
  { width: number; height: number; label: string }
> = {
  story: { width: 1080, height: 1920, label: "Historia (9:16)" },
  square: { width: 1080, height: 1080, label: "Cuadrado (1:1)" },
};

/**
 * Divide el texto en líneas que quepan en el ancho especificado.
 */
export function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  const paragraphs = clean.split("\n");
  const lines: string[] = [];

  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }

    let current = words[0];
    for (let i = 1; i < words.length; i += 1) {
      const candidate = `${current} ${words[i]}`;
      const measure = ctx.measureText(candidate);
      if (measure.width <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        current = words[i];
      }
    }
    lines.push(current);
  }

  return lines;
}

/**
 * Renderiza la tarjeta de cita en un canvas HTML5 de alta resolución.
 */
export async function renderQuoteCardToCanvas(
  config: QuoteCardConfig,
  targetCanvas?: HTMLCanvasElement,
): Promise<HTMLCanvasElement> {
  // Asegura que las fuentes estén listas antes de dibujar
  if (typeof document !== "undefined" && "fonts" in document) {
    try {
      await document.fonts.ready;
    } catch {
      // continua con fuentes disponibles
    }
  }

  const { width, height } = FORMAT_DIMENSIONS[config.format];
  const canvas = targetCanvas ?? document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const palette = THEME_PALETTES[config.theme] ?? THEME_PALETTES.papel;

  // Fondo
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, width, height);

  // Marco clásico sutil
  const inset = Math.round(width * 0.05);
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2);

  // Marco interior doble fino (estilo editorial)
  const innerInset = inset + 12;
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(innerInset, innerInset, width - innerInset * 2, height - innerInset * 2);

  // Área útil de contenido
  const contentWidth = width - (innerInset + 70) * 2;

  // Determinar tamaño de letra dinámico según la longitud del pasaje
  const textLen = config.text.length;
  let quoteFontSize = config.format === "story" ? 54 : 46;
  if (textLen > 400) quoteFontSize = config.format === "story" ? 36 : 32;
  else if (textLen > 250) quoteFontSize = config.format === "story" ? 42 : 36;
  else if (textLen > 140) quoteFontSize = config.format === "story" ? 48 : 40;

  const quoteFontFamily = '"Literata Variable", Literata, Georgia, serif';
  const quoteLineHeight = Math.round(quoteFontSize * 1.55);

  ctx.font = `normal 400 ${quoteFontSize}px ${quoteFontFamily}`;
  const lines = wrapCanvasText(ctx, config.text, contentWidth);
  const textBlockHeight = lines.length * quoteLineHeight;

  // Medición de metadatos inferiores
  const metaFontSize = 26;
  const metaFontFamily = '"Alegreya Sans", system-ui, sans-serif';
  const metaParts: string[] = [];
  if (config.showBookTitle && config.bookTitle) metaParts.push(config.bookTitle);
  if (config.showAuthor && config.author) metaParts.push(config.author);
  if (config.showChapter && config.chapterTitle) metaParts.push(config.chapterTitle);

  // Posicionamiento vertical centrado
  const quoteSymbolHeight = 80;
  const metaBlockHeight = metaParts.length > 0 ? 90 : 0;
  const brandingHeight = config.showBranding ? 50 : 0;
  const totalOccupied = quoteSymbolHeight + textBlockHeight + metaBlockHeight + brandingHeight;

  const startY = Math.max(
    innerInset + 80,
    Math.round((height - totalOccupied) / 2) + quoteSymbolHeight,
  );

  // Comilla inicial decorativa
  ctx.font = `italic 700 96px ${quoteFontFamily}`;
  ctx.fillStyle = palette.quoteMark;
  ctx.textAlign = "center";
  ctx.fillText("“", width / 2, startY - 20);

  // Cuerpo de la cita
  ctx.font = `normal 400 ${quoteFontSize}px ${quoteFontFamily}`;
  ctx.fillStyle = palette.text;
  ctx.textAlign = "center";

  let curY = startY + quoteFontSize * 0.4;
  for (const line of lines) {
    ctx.fillText(line, width / 2, curY);
    curY += quoteLineHeight;
  }

  // Divisor sutil si hay metadatos o marca
  if (metaParts.length > 0 || config.showBranding) {
    curY += 24;
    ctx.strokeStyle = palette.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(width / 2 - 60, curY);
    ctx.lineTo(width / 2 + 60, curY);
    ctx.stroke();
    curY += 36;
  }

  // Metadatos (libro, autor, capítulo)
  if (metaParts.length > 0) {
    ctx.font = `italic 400 ${metaFontSize}px ${quoteFontFamily}`;
    ctx.fillStyle = palette.meta;
    ctx.textAlign = "center";

    // Primera línea: libro y autor
    const mainMeta = [
      config.showBookTitle ? config.bookTitle : null,
      config.showAuthor ? config.author : null,
    ]
      .filter(Boolean)
      .join(" · ");

    if (mainMeta) {
      ctx.fillText(mainMeta, width / 2, curY);
      curY += 34;
    }

    if (config.showChapter && config.chapterTitle) {
      ctx.font = `normal 400 ${metaFontSize - 4}px ${metaFontFamily}`;
      ctx.fillText(config.chapterTitle, width / 2, curY);
    }
  }

  // Firma discreta de Lecta en el pie
  if (config.showBranding) {
    const bottomBrandY = height - innerInset - 40;
    ctx.font = `normal 500 22px ${metaFontFamily}`;
    ctx.fillStyle = palette.brand;
    ctx.textAlign = "center";
    ctx.fillText("Lecta · Cuaderno de lector", width / 2, bottomBrandY);
  }

  return canvas;
}

/**
 * Convierte el canvas renderizado a Blob PNG.
 */
export async function generateQuoteCardBlob(config: QuoteCardConfig): Promise<Blob> {
  const canvas = await renderQuoteCardToCanvas(config);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("No se pudo generar el archivo PNG"));
    }, "image/png");
  });
}

/**
 * Descarga el archivo de imagen directamente al dispositivo del usuario.
 */
export function downloadQuoteCard(blob: Blob, filename?: string): void {
  const name =
    filename ??
    `cita-lecta-${new Date().toISOString().slice(0, 10)}.png`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Copia la imagen de la tarjeta al portapapeles del sistema (WhatsApp Web, documentos, etc.).
 */
export async function copyQuoteCardToClipboard(blob: Blob): Promise<boolean> {
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof ClipboardItem !== "undefined"
  ) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Comparte la tarjeta mediante la Web Share API para enviarla directo a WhatsApp,
 * Instagram Stories o mensajería en dispositivos móviles.
 */
export async function shareQuoteCard(
  blob: Blob,
  config: QuoteCardConfig,
): Promise<"shared" | "copied" | "downloaded"> {
  const filename = `cita-lecta-${Date.now()}.png`;
  const file = new File([blob], filename, { type: "image/png" });
  const shareTitle = config.bookTitle ? `Cita de «${config.bookTitle}»` : "Cita de Lecta";

  if (
    typeof navigator !== "undefined" &&
    "canShare" in navigator &&
    navigator.canShare &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({
        files: [file],
        title: shareTitle,
        text: config.text,
      });
      return "shared";
    } catch (err) {
      if ((err as Error).name === "AbortError") return "shared";
      // si falló la ventana nativa de compartir, intentar copiar o descargar
    }
  }

  const copied = await copyQuoteCardToClipboard(blob);
  if (copied) return "copied";

  downloadQuoteCard(blob, filename);
  return "downloaded";
}
