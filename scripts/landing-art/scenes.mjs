// Escenas de la landing. Cada una: { name, width, height, theme, css, html }.
// El gato se pide con `cat({...props})` y `studio.tsx` monta ahí el
// componente real de la app (misma geometría, mismo CSS).
import { QUIJOTE, bezier, cat, f, filters, glyphField, grain, lerp, rng, vignette } from "./kit.mjs";
import { CLARAS } from "./scenes-claras.mjs";
import { EXTRA } from "./scenes-extra.mjs";
import { RECORTES } from "./scenes-recortes.mjs";

const COATS = ["tuxedo", "latte", "ginger", "mist", "calico"];
const ABC = "abcdefghijlmnopqrstuvyzáéíóúñ".split("");

const BASE_CSS = `
  #stage{font-family:"Literata Variable",Literata,Georgia,serif}
  #stage svg text{font-family:"Literata Variable",Literata,Georgia,serif}
  .layer{position:absolute;inset:0;width:100%;height:100%}
  .cat-slot{position:absolute}
  .cat-slot svg{display:block;overflow:visible}
  .no-shadow .cat-ground-shadow{display:none}
  .plush svg{filter:url(#plush)}
`;

// ───────────────────────── Hoja de contacto (referencia interna)
const sheet = {
  name: "_hoja-contacto",
  width: 1500,
  height: 1560,
  scale: 1,
  css: `${BASE_CSS}
    #stage{background:#f4efe4;font:16px "Alegreya Sans",sans-serif;color:#333}
    .grid{display:grid;grid-template-columns:repeat(5,300px)}
    .cell{width:300px;height:260px;position:relative}
    .cell .cat-slot{inset:10px 30px 30px}
    .cell span{position:absolute;left:8px;bottom:6px;font-size:13px}`,
  html: `<div class="grid">${[0, 1, 2, 3, 4]
    .map((stage) =>
      COATS.map(
        (coatId) =>
          `<div class="cell">${cat({ stage, coatId })}<span>s${stage} · ${coatId}</span></div>`,
      ).join(""),
    )
    .join("")}${[
    { stage: 3, accessories: ["bufanda", "anteojos"] },
    { stage: 3, accessories: ["headphones_cozy", "scarf_amber"] },
    { stage: 4, accessories: ["wizard_hat", "capa"] },
    { stage: 3, accessories: ["laurel_crown", "bowtie_scholar"] },
    { stage: 3, accessories: ["beret_poet", "glasses_round", "chaleco"] },
  ]
    .map((s) => `<div class="cell">${cat(s)}<span>${s.accessories.join(" + ")}</span></div>`)
    .join("")}</div>`,
};

// ───────────────────────── Piezas compartidas

// Libro abierto visto de frente: dos páginas que se curvan desde el lomo.
// Devuelve el SVG y las curvas de los renglones para escribir sobre ellas.
function openBook({ cx, y, w, h, paper = ["#f6ecd8", "#a79b8f"], lines = 8, text = QUIJOTE, hot = "hidalgo", hotLine = 1, ink = "#2a2433", hotFill = "#b8401a", fontSize = 21 }) {
  const L = cx - w;
  const R = cx + w;
  const lift = h * 0.2;
  const top = (side, off) => {
    const s = side;
    return [cx + s * 40, y + off + 6, cx + s * w * 0.3, y - lift + off, cx + s * w * 0.72, y - lift * 0.9 + off, cx + s * w, y + lift * 0.25 + off];
  };
  const page = (s) => {
    const p = top(s, 0);
    return `M ${cx} ${y + 14} L ${p[0]} ${p[1]} C ${p[2]} ${p[3]}, ${p[4]} ${p[5]}, ${p[6]} ${p[7]} L ${cx + s * (w + 40)} ${y + h} L ${cx} ${y + h} Z`;
  };
  let rows = "";
  for (let i = 0; i < lines; i++) {
    const off = 40 + i * (fontSize * 1.72);
    const pl = top(-1, off);
    const pr = top(1, off);
    // Izquierda: del borde exterior al lomo. Derecha: del lomo hacia fuera.
    rows += `<path id="bkL${i}" d="M ${pl[6] + 70} ${pl[7]} C ${pl[4]} ${pl[5]}, ${pl[2]} ${pl[3]}, ${pl[0] + 10} ${pl[1]}" fill="none"/>`;
    rows += `<path id="bkR${i}" d="M ${pr[0] + 26} ${pr[1]} C ${pr[2]} ${pr[3]}, ${pr[4]} ${pr[5]}, ${pr[6]} ${pr[7]}" fill="none"/>`;
  }
  const mark = (s, i) => (i === hotLine ? s.replace(hot, `<tspan class="hot" fill="${hotFill}">${hot}</tspan>`) : s);
  let words = "";
  for (let i = 0; i < lines; i++) {
    const size = fontSize + i * 0.9;
    words += `<text font-size="${f(size)}" fill="${ink}" opacity="${f(0.82 - i * 0.02)}"><textPath href="#bkL${i}">${mark(`${text[i % text.length]} ${text[(i + 1) % text.length]} ${text[(i + 2) % text.length]}`, i)}</textPath></text>`;
    words += `<text font-size="${f(size)}" fill="${ink}" opacity="${f(0.82 - i * 0.02)}"><textPath href="#bkR${i}">${text[(i + 5) % text.length]} ${text[(i + 6) % text.length]} ${text[(i + 7) % text.length]}</textPath></text>`;
  }
  return `
  <defs>
    <linearGradient id="bkPaperL" x1="1" y1="0" x2="0" y2="0.6"><stop offset="0" stop-color="${paper[0]}"/><stop offset="1" stop-color="${paper[1]}"/></linearGradient>
    <linearGradient id="bkPaperR" x1="0" y1="0" x2="1" y2="0.6"><stop offset="0" stop-color="${paper[0]}"/><stop offset="1" stop-color="${paper[1]}"/></linearGradient>
    <linearGradient id="bkGutter" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="0.5" stop-color="#1a1220" stop-opacity="0.55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>
    ${rows}
    <clipPath id="bkClip"><path d="${page(-1)} ${page(1)}"/></clipPath>
  </defs>
  <path d="${page(-1)}" transform="translate(0 16)" fill="#3a3340" opacity="0.9"/>
  <path d="${page(1)}" transform="translate(0 16)" fill="#3a3340" opacity="0.9"/>
  <path d="${page(-1)}" transform="translate(0 8)" fill="#cfc3ae"/>
  <path d="${page(1)}" transform="translate(0 8)" fill="#cfc3ae"/>
  <path d="${page(-1)}" fill="url(#bkPaperL)"/>
  <path d="${page(1)}" fill="url(#bkPaperR)"/>
  ${words}
  <rect x="${cx - 70}" y="${y - 6}" width="140" height="${h + 20}" fill="url(#bkGutter)"/>
  <!-- ${L} ${R} -->`;
}

// ───────────────────────── HERO · «La noche de las palabras»
function heroNoche({ name, W, H, catX, moonR, catSize, bookY, hot, fontSize = W / 80, arc = 0.75, rise: up = 0.2, flow, bookW = W * 0.72, overlay = "", extraCss = "" }) {
  const r = rng(20261110);
  const moon = { x: catX, y: bookY - catSize * 0.66, r: moonR };
  const inMoon = (x, y) => Math.hypot(x - moon.x, y - moon.y) < moon.r + 26;

  const stars = glyphField({
    r, n: Math.round((W * H) / 5200), box: [0, 0, W, bookY - 70], glyphs: ABC,
    size: [7, 19], opacity: [0.14, 0.62], fill: "#dfe5ff", avoid: inMoon,
  });
  let dots = "";
  for (let i = 0; i < (W * H) / 4200; i++) {
    const x = r() * W;
    const y = r() ** 1.4 * (bookY - 40);
    if (inMoon(x, y)) continue;
    dots += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(lerp(0.5, 1.7, r() ** 3))}" fill="#fff" opacity="${f(lerp(0.2, 0.9, r()))}"/>`;
  }

  // Ciudad de libros en el horizonte.
  let city = "";
  let x = -20;
  while (x < W + 40) {
    const w = lerp(20, 58, r());
    const far = Math.abs(x - catX) / W;
    const h = lerp(30, 150, r()) * lerp(0.5, 1.15, far);
    const tone = ["#141a33", "#1a2140", "#101529", "#1f2748"][Math.floor(r() * 4)];
    const tilt = r() > 0.86 ? lerp(-9, 9, r()) : 0;
    const y0 = bookY + 30 - h;
    city += `<g transform="rotate(${f(tilt)} ${f(x + w / 2)} ${bookY + 30})"><rect x="${f(x)}" y="${f(y0)}" width="${f(w)}" height="${f(h + 40)}" rx="2" fill="${tone}"/>`;
    city += `<rect x="${f(x + 4)}" y="${f(y0 + 10)}" width="${f(w - 8)}" height="2" fill="#e9c46a" opacity="${f(lerp(0.15, 0.6, r()))}"/>`;
    if (r() > 0.45) city += `<rect x="${f(x + 4)}" y="${f(y0 + 17)}" width="${f(w - 8)}" height="2" fill="#e9c46a" opacity="0.18"/>`;
    if (r() > 0.6) city += `<rect x="${f(x + w / 2 - 3)}" y="${f(y0 + h * 0.45)}" width="6" height="8" rx="1" fill="#ffd58a" opacity="${f(lerp(0.5, 1, r()))}"/>`;
    city += `</g>`;
    x += w + lerp(-2, 5, r());
  }

  // Las letras se despegan de la página y suben hacia el cielo.
  const src = "hidalgoadargarocíngalgolanzaastillero".split("");
  const path = flow ?? [hot.x, hot.y, hot.x + W * 0.02, bookY - H * up, catX - W * 0.27, moon.y - moon.r * arc, catX - moon.r * 0.8, moon.y - moon.r * 0.36];
  let rise = "";
  const N = 86;
  for (let i = 0; i < N; i++) {
    const t = (i / N) ** 0.85;
    const p = bezier(path, t);
    const spread = lerp(3, 46, Math.sin(t * Math.PI) ** 0.7);
    const px = p.x + (r() - 0.5) * spread * 2;
    const py = p.y + (r() - 0.5) * spread;
    const size = lerp(13, 46, Math.sin(t * Math.PI) ** 1.2) * lerp(0.75, 1.25, r());
    const o = lerp(1, 0.7, t);
    const col = t < 0.3 ? "#ffd58a" : t < 0.75 ? "#fdeec8" : "#ffd9a0";
    rise += `<text x="${f(px)}" y="${f(py)}" font-size="${f(size)}" fill="${col}" opacity="${f(o)}" ${i % 3 ? "" : 'font-style="italic"'} font-weight="${i % 4 ? 400 : 600}" transform="rotate(${f(lerp(-40, 40, r()))} ${f(px)} ${f(py)})">${src[i % src.length]}</text>`;
  }

  // Luciérnagas en primer plano.
  let flies = "";
  for (let i = 0; i < 26; i++) {
    const fx = r() * W;
    const fy = lerp(bookY - 240, H, r());
    const fr = lerp(2, 9, r() ** 2);
    flies += `<circle cx="${f(fx)}" cy="${f(fy)}" r="${f(fr)}" fill="#ffd58a" opacity="${f(lerp(0.12, 0.5, r()))}" filter="url(#soft)"/><circle cx="${f(fx)}" cy="${f(fy)}" r="${f(fr * 0.3)}" fill="#fff6dc" opacity="0.9"/>`;
  }

  const ringR = moon.r * 0.84;
  const ringText = "el vocabulario nace del libro · leer y que las palabras se queden · ".repeat(2);
  const cs = catSize;
  const feet = bookY + 22;

  return {
    name,
    width: W,
    height: H,
    css: `${BASE_CSS}
      #stage{background:#080a12}
      .hero-cat svg{filter:url(#plush) drop-shadow(0 0 ${f(cs * 0.05)}px rgba(255,196,120,.55)) drop-shadow(0 0 ${f(cs * 0.16)}px rgba(240,140,80,.35))}
      .hot{font-weight:700}
      ${extraCss}`,
    html: `
      ${filters({ az: 250, el: 60, light: "#ffd9a8", depth: 5, blur: cs * 0.02, spec: 0.8 })}
      <svg class="layer" viewBox="0 0 ${W} ${H}">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#070914"/><stop offset="0.45" stop-color="#11163a"/>
            <stop offset="0.78" stop-color="#2a2152"/><stop offset="1" stop-color="#5b2f4d"/>
          </linearGradient>
          <radialGradient id="moonG" cx="0.42" cy="0.38" r="0.75">
            <stop offset="0" stop-color="#fff6de"/><stop offset="0.45" stop-color="#fbd98e"/>
            <stop offset="0.82" stop-color="#f0a35f"/><stop offset="1" stop-color="#e07a4b"/>
          </radialGradient>
          <radialGradient id="halo" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stop-color="#ffb26b" stop-opacity="0.75"/><stop offset="0.35" stop-color="#e8704a" stop-opacity="0.32"/>
            <stop offset="0.7" stop-color="#8a3a6a" stop-opacity="0.12"/><stop offset="1" stop-color="#3a2a6a" stop-opacity="0"/>
          </radialGradient>
          <path id="ring" d="M ${moon.x - ringR} ${moon.y} a ${ringR} ${ringR} 0 1 1 ${ringR * 2} 0 a ${ringR} ${ringR} 0 1 1 ${-ringR * 2} 0"/>
          <radialGradient id="pageLight" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stop-color="#ffcf8f" stop-opacity="0.62"/><stop offset="1" stop-color="#ffcf8f" stop-opacity="0"/>
          </radialGradient>
          <linearGradient id="nightWash" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#2a2a6a" stop-opacity="0.1"/><stop offset="1" stop-color="#0a0a22" stop-opacity="0.72"/>
          </linearGradient>
        </defs>
        <rect width="${W}" height="${H}" fill="url(#sky)"/>
        <g>${dots}</g>
        <g>${stars}</g>
        <circle cx="${moon.x}" cy="${moon.y}" r="${moon.r * 3.1}" fill="url(#halo)"/>
        <circle cx="${moon.x}" cy="${moon.y}" r="${moon.r}" fill="url(#moonG)"/>
        <text font-size="${f(moon.r * 0.062)}" fill="#b8562c" opacity="0.36" letter-spacing="${f(moon.r * 0.012)}" font-style="italic"><textPath href="#ring" textLength="${f(2 * Math.PI * ringR - 6)}" lengthAdjust="spacing">${ringText}</textPath></text>
        <circle cx="${moon.x}" cy="${moon.y}" r="${f(moon.r * 0.93)}" fill="none" stroke="#b8562c" stroke-opacity="0.22" stroke-width="1.2"/>
        <circle cx="${moon.x}" cy="${moon.y}" r="${f(moon.r * 0.75)}" fill="none" stroke="#b8562c" stroke-opacity="0.18" stroke-width="1.2"/>
        <g opacity="0.96">${city}</g>
        ${openBook({ cx: catX, y: bookY, w: bookW, h: H - bookY + 30, fontSize, lines: Math.ceil((H - bookY) / (fontSize * 1.72)) })}
        <rect x="0" y="${bookY - 80}" width="${W}" height="${H - bookY + 80}" fill="url(#nightWash)" style="mix-blend-mode:multiply" clip-path="url(#bkClip)"/>
        <ellipse cx="${catX}" cy="${bookY + 60}" rx="${W * 0.46}" ry="${(H - bookY) * 0.95}" fill="url(#pageLight)" style="mix-blend-mode:screen" clip-path="url(#bkClip)"/>
        <circle cx="${hot.x}" cy="${hot.y}" r="${W * 0.05}" fill="#ffb45e" opacity="0.38" filter="url(#softer)" style="mix-blend-mode:screen"/>
        <g filter="url(#glow)">${rise}</g>
        <ellipse cx="${catX}" cy="${feet + cs * 0.035}" rx="${cs * 0.34}" ry="${cs * 0.06}" fill="#0a0612" opacity="0.6" filter="url(#soft)"/>
        <path d="M ${catX - cs * 0.22} ${feet} L ${catX + cs * 0.22} ${feet} L ${catX + cs * 0.5} ${H} L ${catX - cs * 0.62} ${H} Z" fill="#0a0612" opacity="0.32" filter="url(#softer)"/>
      </svg>
      ${cat({ stage: 4, coatId: "tuxedo", accessories: ["bufanda"], lookAtX: -0.9, lookAtY: -1 }, `left:${catX - cs / 2}px;top:${feet - cs * 0.945}px;width:${cs}px;height:${cs}px`, "hero-cat no-shadow")}
      <svg class="layer" viewBox="0 0 ${W} ${H}">${flies}</svg>
      ${vignette(0.62, "4,5,14")}
      ${overlay}
      ${grain(0.22, 0.85)}`,
  };
}

export const SCENES = [
  sheet,
  heroNoche({ name: "hero-noche", W: 1600, H: 900, catX: 1100, moonR: 255, catSize: 430, bookY: 668, hot: { x: 256, y: 706 } }),
  heroNoche({ name: "hero-noche-movil", W: 900, H: 1600, catX: 470, moonR: 262, catSize: 440, bookY: 1210, hot: { x: 222, y: 1262 }, fontSize: 21, bookW: 520, flow: [222, 1262, 40, 1010, 110, 560, 452, 648] }),
  heroNoche({
    name: "og",
    W: 1200,
    H: 630,
    catX: 900,
    moonR: 186,
    catSize: 316,
    bookY: 476,
    hot: { x: 190, y: 508 },
    fontSize: 16,
    arc: -0.25,
    rise: 0.06,
    extraCss: `.og{position:absolute;left:72px;top:58px;color:#fff3dc;text-shadow:0 2px 24px rgba(8,10,30,.9)}
      .og h1{margin:0;font-size:124px;font-weight:500;font-style:italic;letter-spacing:-.02em;line-height:1}
      .og p{margin:14px 0 0 6px;font-size:33px;color:#f3d9a8}`,
    overlay: `<div class="og"><h1>Lecta</h1><p>Lee. Las palabras se quedan.</p></div>`,
  }),
  ...EXTRA,
  ...CLARAS,
  ...RECORTES,
];
