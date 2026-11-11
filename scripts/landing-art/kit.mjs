// Utilería de las escenas: azar con semilla, grano de papel, filtros de
// luz y pequeñas piezas SVG reutilizables. Todo se genera aquí para que
// las escenas sean reproducibles byte a byte.

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const lerp = (a, b, t) => a + (b - a) * t;
export const f = (n) => Math.round(n * 10) / 10;

// Punto y tangente de una Bézier cúbica.
export function bezier(p, t) {
  const u = 1 - t;
  const x = u * u * u * p[0] + 3 * u * u * t * p[2] + 3 * u * t * t * p[4] + t * t * t * p[6];
  const y = u * u * u * p[1] + 3 * u * u * t * p[3] + 3 * u * t * t * p[5] + t * t * t * p[7];
  const dx = 3 * u * u * (p[2] - p[0]) + 6 * u * t * (p[4] - p[2]) + 3 * t * t * (p[6] - p[4]);
  const dy = 3 * u * u * (p[3] - p[1]) + 6 * u * t * (p[5] - p[3]) + 3 * t * t * (p[7] - p[5]);
  return { x, y, a: (Math.atan2(dy, dx) * 180) / Math.PI };
}

// El gato real: `studio.tsx` monta el componente en este hueco.
export const cat = (spec, style = "", cls = "") =>
  `<div class="cat-slot ${cls}" style="${style}" data-cat='${JSON.stringify(spec)}'></div>`;

// Grano de papel a pantalla completa (se mezcla encima de todo).
export const grain = (opacity = 0.16, freq = 0.8, blend = "soft-light") => `
<svg class="fx-grain" style="position:absolute;inset:0;width:100%;height:100%;mix-blend-mode:${blend};opacity:${opacity};pointer-events:none">
  <filter id="fxGrain" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="3" seed="7"/>
    <feColorMatrix type="saturate" values="0"/>
  </filter>
  <rect width="100%" height="100%" filter="url(#fxGrain)"/>
</svg>`;

export const vignette = (strength = 0.55, color = "0,0,0") =>
  `<div style="position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 75% 70% at 55% 48%, rgba(${color},0) 55%, rgba(${color},${strength}) 100%)"></div>`;

// Filtros compartidos. `plush` da volumen de peluche al gato plano:
// usa su silueta desenfocada como mapa de altura y la ilumina.
export const filters = ({ az = 235, el = 52, light = "#fff1d6", depth = 7, blur = 9, spec = 0.9 } = {}) => `
<svg width="0" height="0" style="position:absolute">
  <defs>
    <filter id="plush" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceAlpha" stdDeviation="${blur}" result="bump"/>
      <feDiffuseLighting in="bump" surfaceScale="${depth}" diffuseConstant="${f(1 / Math.sin((el * Math.PI) / 180))}" lighting-color="#ffffff" result="diff">
        <feDistantLight azimuth="${az}" elevation="${el}"/>
      </feDiffuseLighting>
      <feComposite in="diff" in2="SourceAlpha" operator="in" result="diffIn"/>
      <feBlend in="SourceGraphic" in2="diffIn" mode="multiply" result="shaded"/>
      <feSpecularLighting in="bump" surfaceScale="${depth}" specularConstant="${spec}" specularExponent="26" lighting-color="${light}" result="spec">
        <feDistantLight azimuth="${az}" elevation="30"/>
      </feSpecularLighting>
      <feComposite in="spec" in2="SourceAlpha" operator="in" result="specIn"/>
      <feComposite in="specIn" in2="shaded" operator="arithmetic" k1="0" k2="1" k3="1" k4="0"/>
    </filter>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="5" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>
    <filter id="softer" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="40"/></filter>
    <filter id="ink" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="11" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="9" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  </defs>
</svg>`;

// Letras sueltas como estrellas o polen.
export function glyphField({ r, n, box, glyphs, size, opacity, fill, avoid, italic = true }) {
  let out = "";
  let made = 0;
  let guard = 0;
  while (made < n && guard++ < n * 20) {
    const x = lerp(box[0], box[2], r());
    const y = lerp(box[1], box[3], r());
    if (avoid && avoid(x, y)) continue;
    const g = glyphs[Math.floor(r() * glyphs.length)];
    const s = lerp(size[0], size[1], r() ** 2.2);
    const o = lerp(opacity[0], opacity[1], r());
    out += `<text x="${f(x)}" y="${f(y)}" font-size="${f(s)}" opacity="${f(o * 100) / 100}" fill="${fill}" ${italic && r() > 0.5 ? 'font-style="italic"' : ""} transform="rotate(${f(lerp(-28, 28, r()))} ${f(x)} ${f(y)})">${g}</text>`;
    made++;
  }
  return out;
}

export const QUIJOTE = [
  "En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho",
  "tiempo que vivía un hidalgo de los de lanza en astillero, adarga antigua,",
  "rocín flaco y galgo corredor. Una olla de algo más vaca que carnero,",
  "salpicón las más noches, duelos y quebrantos los sábados, lantejas los",
  "viernes, algún palomino de añadidura los domingos, consumían las tres",
  "partes de su hacienda. El resto della concluían sayo de velarte, calzas",
  "de velludo para las fiestas, con sus pantuflos de lo mesmo, y los días",
  "de entresemana se honraba con su vellorí de lo más fino. Tenía en su casa",
  "una ama que pasaba de los cuarenta, y una sobrina que no llegaba a los",
  "veinte, y un mozo de campo y plaza, que así ensillaba el rocín como",
];
