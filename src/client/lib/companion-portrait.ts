// Retrato de lectura: el gato con su look y las cifras de quien lee, en una
// imagen que se puede descargar o compartir.
//
// El gato vive en un SVG que saca sus colores de clases CSS externas
// (`cat--coat-*`), así que serializarlo tal cual daría un dibujo sin relleno.
// `inlineSvgMarkup` recorre el árbol vivo y copia el estilo computado a
// atributos del clon; después el SVG se rasteriza en un canvas y el texto se
// dibuja con `fillText` (nada de fuentes embebidas: el retrato pesa KB y no
// depende de la red).
//
// Lo puro (cifras, reparto del lienzo, nombre del archivo) se prueba sin DOM;
// la rasterización depende de canvas y se verifica en el navegador.

import type { GameState } from "./gamification";
import { levelProgress } from "./gamification";

// ---- Datos del retrato ----

export interface PortraitFigures {
  name: string;
  level: string;
  lines: string[];
}

const hhmm = (minutes: number): string => {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
};

const plural = (n: number, one: string, many: string): string =>
  `${n} ${n === 1 ? one : many}`;

// Las cifras del retrato: horas, palabras, racha y libros. Se omiten las que
// están a cero — un retrato con «0 palabras» no presume de nada.
export function portraitFigures(
  state: GameState | null,
  name: string,
): PortraitFigures {
  if (!state) {
    return { name, level: "Lecta", lines: [] };
  }
  const prog = levelProgress(state.xp);
  const lines: string[] = [];
  if (state.stats.minutes > 0) lines.push(`${hhmm(state.stats.minutes)} leídas`);
  if (state.stats.saved > 0)
    lines.push(plural(state.stats.saved, "palabra guardada", "palabras guardadas"));
  if (state.stats.booksFinished > 0)
    lines.push(plural(state.stats.booksFinished, "libro terminado", "libros terminados"));
  if (state.stats.streakDays > 1)
    lines.push(plural(state.stats.streakDays, "día de racha", "días de racha"));
  return {
    name,
    // `levelProgress().level` es 0-based: el visible es +1.
    level: `Nivel ${prog.level + 1} · ${prog.name}`,
    lines,
  };
}

export function portraitFilename(name: string, now: Date = new Date()): string {
  const slug =
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\w]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "gato";
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
  return `lecta-${slug}-${stamp}.png`;
}

// Texto que acompaña al compartir (sin emojis: la app no los usa).
export function portraitShareText(figures: PortraitFigures): string {
  const tail = figures.lines.length ? ` · ${figures.lines.join(" · ")}` : "";
  return `${figures.name} y yo: ${figures.level}${tail}. Leído en Lecta.`;
}

// ---- Lienzo ----

export interface PortraitLayout {
  width: number;
  height: number;
  // Lado del recuadro del gato y su posición.
  catSize: number;
  catX: number;
  catY: number;
  // Dónde empieza el texto y cuánto baja cada línea.
  textX: number;
  nameY: number;
  levelY: number;
  firstLineY: number;
  lineGap: number;
  footerY: number;
}

// Reparto fijo: 1080×1350 (4:5, el alto que piden las redes) con el gato
// centrado arriba y el texto debajo. Una sola función para que el tamaño no
// se recalcule a mano en dos sitios.
export const PORTRAIT_WIDTH = 1080;
export const PORTRAIT_HEIGHT = 1350;

export function portraitLayout(lines: number): PortraitLayout {
  const catSize = 460;
  const lineGap = 62;
  const count = Math.max(0, lines);
  // El bloque (gato + nombre + cifras) se centra en el lienzo: con pocas
  // cifras el retrato no deja un tercio vacío al final. El pie va siempre
  // abajo, anclado.
  const textBlock = 150 + count * lineGap;
  const contentHeight = catSize + 90 + textBlock;
  const catY = Math.max(90, Math.round((PORTRAIT_HEIGHT - 120 - contentHeight) / 2));
  const nameY = catY + catSize + 100;
  return {
    width: PORTRAIT_WIDTH,
    height: PORTRAIT_HEIGHT,
    catSize,
    catX: Math.round((PORTRAIT_WIDTH - catSize) / 2),
    catY,
    textX: PORTRAIT_WIDTH / 2,
    nameY,
    levelY: nameY + 62,
    firstLineY: nameY + 62 + 70,
    lineGap,
    footerY: PORTRAIT_HEIGHT - 84,
  };
}

// ---- SVG con estilo propio ----

// Atributos que el CSS pinta y que sin copiar dejarían el dibujo en negro.
const STYLE_PROPS = [
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "opacity",
  "display",
  "visibility",
] as const;

// Copia el estilo computado de cada nodo vivo a su clon. Devuelve el markup
// listo para un `data:` URL.
export function inlineSvgMarkup(
  source: SVGSVGElement,
  width: number,
  height: number,
): string {
  const clone = source.cloneNode(true) as SVGSVGElement;
  const liveNodes = [source, ...Array.from(source.querySelectorAll("*"))];
  const cloneNodes = [clone, ...Array.from(clone.querySelectorAll("*"))];
  for (let i = 0; i < liveNodes.length && i < cloneNodes.length; i += 1) {
    const live = liveNodes[i];
    const copy = cloneNodes[i] as Element;
    const computed = getComputedStyle(live);
    for (const prop of STYLE_PROPS) {
      const value = computed.getPropertyValue(prop);
      if (!value || value === "none" && prop !== "display" && prop !== "visibility") {
        continue;
      }
      copy.setAttribute(prop, value);
    }
  }
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.removeAttribute("class");
  clone.removeAttribute("aria-hidden");
  return new XMLSerializer().serializeToString(clone);
}

// Color de un token del tema (con respaldo por si el token no existe).
export function themeColor(token: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(token)
    .trim();
  return value || fallback;
}

function loadSvgImage(markup: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("no se pudo dibujar el gato"));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("el navegador no pudo crear la imagen"));
    }, "image/png");
  });
}

export interface PortraitOptions {
  cat: SVGSVGElement;
  figures: PortraitFigures;
  // Tokens del tema para el fondo y la tinta.
  paper: string;
  ink: string;
  inkSoft: string;
  accent: string;
}

// Dibuja el retrato y devuelve el PNG. Todo ocurre en memoria: no se sube
// nada a ningún sitio.
export async function buildPortraitPng({
  cat,
  figures,
  paper,
  ink,
  inkSoft,
  accent,
}: PortraitOptions): Promise<Blob> {
  const layout = portraitLayout(figures.lines.length);
  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("sin contexto 2D");

  // Fondo y filete de la casa.
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.fillStyle = accent;
  ctx.fillRect(layout.width / 2 - 40, 96, 80, 4);

  // El gato, con su look, tal como está en pantalla.
  const markup = inlineSvgMarkup(cat, layout.catSize, layout.catSize);
  const img = await loadSvgImage(markup);
  ctx.drawImage(img, layout.catX, layout.catY, layout.catSize, layout.catSize);

  // Texto centrado: nombre, nivel y cifras.
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = ink;
  ctx.font = "600 64px Georgia, 'Times New Roman', serif";
  ctx.fillText(figures.name, layout.textX, layout.nameY);
  ctx.fillStyle = inkSoft;
  ctx.font = "400 30px Georgia, 'Times New Roman', serif";
  ctx.fillText(figures.level, layout.textX, layout.levelY);
  figures.lines.forEach((line, index) => {
    ctx.fillText(line, layout.textX, layout.firstLineY + index * layout.lineGap);
  });
  ctx.fillStyle = accent;
  ctx.font = "600 26px Georgia, 'Times New Roman', serif";
  ctx.fillText("LECTA", layout.textX, layout.footerY);

  return canvasToBlob(canvas);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // El navegador todavía está leyendo el blob al soltar el enlace.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Compartir nativo cuando hay soporte de archivos; si no, descarga.
export async function sharePortrait(
  blob: Blob,
  filename: string,
  text: string,
): Promise<"shared" | "downloaded"> {
  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
  };
  const file = new File([blob], filename, { type: "image/png" });
  if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], text });
      return "shared";
    } catch (error) {
      // Cancelar el diálogo del sistema no es un fallo: se cae a la descarga.
      if ((error as Error)?.name === "AbortError") return "downloaded";
    }
  }
  downloadBlob(blob, filename);
  return "downloaded";
}
