// Escenas de voz (TTS), Kindle e-ink y el hero de día.
import { QUIJOTE, cat, f, filters, grain, lerp, rng, vignette } from "./kit.mjs";
import { LIGHT_CSS } from "./scenes-claras.mjs";

// ───────────────────────── Voz · lectura en voz alta
function voz() {
  const W = 1200;
  const H = 900;
  const r = rng(9);
  const cx = 600;
  const cy = 452;
  const text = QUIJOTE.join(" ");
  let defs = "";
  let rings = "";
  for (let i = 0; i < 8; i++) {
    const rad = 262 + i * 64;
    const size = 17 + i * 2.4;
    // Arco de 350°: el renglón se corta con un respiro, sin pisarse.
    const end = Math.PI + (350 * Math.PI) / 180;
    defs += `<path id="vr${i}" d="M ${cx - rad} ${cy} A ${rad} ${rad} 0 1 1 ${f(cx + rad * Math.cos(end))} ${f(cy + rad * Math.sin(end))}"/>`;
    rings += `<g transform="rotate(${f(lerp(0, 360, r()))} ${cx} ${cy})"><text font-size="${f(size)}" fill="${i % 2 ? "#ffd58a" : "#eaf2f4"}" opacity="${f(lerp(0.62, 0.1, i / 7))}" letter-spacing="${f(size * 0.06)}" ${i % 2 ? 'font-style="italic"' : ""}><textPath href="#vr${i}">${text.slice(i * 37)} ${text}</textPath></text></g>`;
    rings += `<circle cx="${cx}" cy="${cy}" r="${rad - size * 0.9}" fill="none" stroke="#9fd0d6" stroke-opacity="${f(lerp(0.2, 0.04, i / 7))}" stroke-width="1"/>`;
  }
  let bars = "";
  const n = 96;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const env = Math.sin(t * Math.PI) ** 0.6;
    const h = (8 + 74 * Math.abs(Math.sin(t * 19) * 0.6 + Math.sin(t * 47 + 1) * 0.4) * lerp(0.5, 1, r())) * env + 6;
    const x = 70 + t * (W - 140);
    bars += `<rect x="${f(x - 3.4)}" y="${f(826 - h / 2)}" width="6.8" height="${f(h)}" rx="3.4" fill="url(#vzBar)" opacity="${f(lerp(0.55, 1, env))}"/>`;
  }
  return {
    name: "voz",
    width: W,
    height: H,
    css: `${LIGHT_CSS}
      #stage{background:radial-gradient(ellipse 75% 70% at 50% 46%,#245064 0%,#15303f 45%,#0a1722 100%)}
      .plush svg{filter:url(#plush) drop-shadow(0 22px 26px rgba(0,0,0,.4))}`,
    html: `
      ${filters({ blur: 9, depth: 5, spec: 0.6, light: "#ffe2b0" })}
      <svg class="layer" viewBox="0 0 ${W} ${H}">
        <defs>${defs}
          <radialGradient id="vzGlow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffd9a0" stop-opacity=".5"/><stop offset=".55" stop-color="#f0a060" stop-opacity=".16"/><stop offset="1" stop-color="#f0a060" stop-opacity="0"/></radialGradient>
          <linearGradient id="vzFloor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a1722" stop-opacity="0"/><stop offset=".55" stop-color="#0a1722" stop-opacity=".92"/><stop offset="1" stop-color="#0a1722"/></linearGradient>
          <linearGradient id="vzBar" x1="0" y1="0" x2="1" y2="0" gradientUnits="userSpaceOnUse" x2="${W}"><stop offset="0" stop-color="#e9c46a"/><stop offset=".5" stop-color="#ff9a5a"/><stop offset="1" stop-color="#e9c46a"/></linearGradient>
        </defs>
        ${rings}
        <circle cx="${cx}" cy="${cy + 40}" r="300" fill="url(#vzGlow)"/>
        <rect x="0" y="${H - 250}" width="${W}" height="250" fill="url(#vzFloor)"/>
        <ellipse cx="${cx}" cy="752" rx="170" ry="22" fill="#02080d" opacity=".6" filter="url(#soft)"/>
        ${bars}
      </svg>
      ${cat({ stage: 3, coatId: "mist", mood: "happy", accessories: ["headphones_cozy", "scarf_amber"] }, `left:${cx - 235}px;top:306px;width:470px;height:470px`, "plush no-shadow")}
      ${vignette(0.55, "3,10,16")}
      ${grain(0.13, 0.85)}`,
  };
}

// ───────────────────────── Kindle · e-ink
function kindle() {
  const W = 1200;
  const H = 900;
  return {
    name: "kindle",
    width: W,
    height: H,
    css: `${LIGHT_CSS}
      #stage{background:radial-gradient(ellipse 80% 75% at 60% 40%,#f3ede0 0%,#ddd3c0 60%,#c2b69f 100%)}
      .moon{position:absolute;left:610px;top:70px;width:560px;height:560px;border-radius:50%;background:radial-gradient(circle at 38% 36%,#fffaf0,#efe4cd 70%,#e2d3b6);box-shadow:0 0 0 2px rgba(162,67,23,.45),0 0 0 34px rgba(162,67,23,.06)}
      .dev{position:absolute;left:120px;top:78px;width:520px;height:730px;border-radius:36px;background:linear-gradient(145deg,#3a393c,#232224);transform:rotate(-5deg);box-shadow:0 1px 0 #5a595c inset,0 70px 90px -30px rgba(40,25,10,.65),0 20px 30px -12px rgba(40,25,10,.4)}
      .scr{position:absolute;left:34px;top:34px;right:34px;bottom:86px;background:#e9e6dc;border-radius:3px;box-shadow:0 0 0 1px #111 inset;padding:30px 34px;box-sizing:border-box;color:#1c1c1c;font-size:21.5px;line-height:1.58;overflow:hidden;filter:grayscale(1) contrast(1.05)}
      .scr h4{margin:0 0 16px;font:700 13px "Alegreya Sans",sans-serif;letter-spacing:.24em;text-transform:uppercase;text-align:center;color:#444}
      .scr p{margin:0;text-align:justify;hyphens:auto}
      .scr u{text-decoration:none;border-bottom:2px dotted #111;font-weight:600}
      .look{margin:14px 0 14px;border:2px solid #111;padding:10px 14px;font-size:18.5px;line-height:1.35;background:#f2efe6}
      .look b{font-size:23px}
      .foot{position:absolute;left:0;right:0;bottom:0;padding:12px 34px 14px;background:#e9e6dc;border-top:1.5px solid #555;display:flex;justify-content:space-between;font:500 14px "Alegreya Sans",sans-serif;letter-spacing:.12em;color:#444}
      .logo{position:absolute;left:0;right:0;bottom:30px;text-align:center;font-style:italic;font-size:22px;color:#8d8b8e;letter-spacing:.04em}
      .code{position:absolute;left:806px;top:668px;transform:rotate(4deg);background:#fffdf7;padding:16px 20px 18px;border-radius:8px;box-shadow:0 22px 30px -14px rgba(60,35,10,.5),0 0 0 1px rgba(120,95,70,.2)}
      .code small{display:block;font:700 13px "Alegreya Sans",sans-serif;letter-spacing:.22em;text-transform:uppercase;color:#a24317;margin-bottom:9px}
      .code div{display:flex;gap:8px}
      .code span{width:46px;height:56px;display:grid;place-items:center;border:2px solid #1f1d1a;border-radius:6px;font-size:32px;font-weight:600}
      .plush svg{filter:url(#plush) drop-shadow(0 16px 18px rgba(50,30,10,.3))}`,
    html: `
      ${filters({ blur: 9, depth: 5, spec: 0.5 })}
      <div class="moon"></div>
      <div class="dev">
        <div class="scr">
          <h4>Don Quijote de la Mancha</h4>
          <p>En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho tiempo que vivía un hidalgo de los de lanza en astillero, <u>adarga</u> antigua, rocín flaco y galgo corredor.</p>
          <div class="look"><b>adarga</b> · sustantivo<br>Escudo de cuero, ovalado o de forma de corazón.</div>
          <p>Una olla de algo más vaca que carnero, salpicón las más noches, duelos y quebrantos los sábados, lantejas los viernes, algún palomino de añadidura los domingos, consumían las tres partes de su hacienda.</p>
          <div class="foot"><span>‹ anterior</span><span>4 / 11</span><span>siguiente ›</span></div>
        </div>
        <div class="logo">Lecta</div>
      </div>
      ${cat({ stage: 3, coatId: "tuxedo", mood: "sleeping", accessories: ["bufanda"] }, "left:660px;top:190px;width:480px;height:480px", "plush")}
      <svg class="layer" viewBox="0 0 1200 900"><g font-style="italic" fill="#a24317"><text x="1010" y="250" font-size="34" opacity=".9">z</text><text x="1048" y="204" font-size="48" opacity=".7">z</text><text x="1098" y="146" font-size="66" opacity=".5">z</text></g></svg>
      <div class="code"><small class="ui">código de vinculación</small><div><span>M</span><span>I</span><span>A</span><span>U</span></div></div>
      ${grain(0.2, 0.8, "multiply")}`,
  };
}

// ───────────────────────── Hero de día · «El sol de las palabras»
function heroPapel() {
  const W = 1600;
  const H = 900;
  const r = rng(314);
  const catX = 1085;
  const sun = { x: 1130, y: 372, r: 262 };
  const ridge = (base, amp, k, ph) => {
    let d = `M -10 ${H + 10} L -10 ${base}`;
    for (let x = 0; x <= W + 20; x += 20) d += ` L ${x} ${f(base - amp * (Math.sin(x / k + ph) * 0.6 + Math.sin(x / (k * 0.37) + ph * 2) * 0.25 + Math.sin(x / (k * 2.3)) * 0.4))}`;
    return `${d} L ${W + 10} ${H + 10} Z`;
  };
  const books = [
    { w: 470, h: 58, c: "#27305c", dx: -10 },
    { w: 410, h: 50, c: "#43694d", dx: 26 },
    { w: 440, h: 62, c: "#c99a2e", dx: -22 },
    { w: 372, h: 48, c: "#8f3219", dx: 8 },
  ];
  let stack = "";
  let y = 812;
  for (const b of books) {
    y -= b.h;
    const x = catX - b.w / 2 + b.dx;
    stack += `<g><rect x="${x}" y="${y}" width="${b.w}" height="${b.h}" rx="7" fill="${b.c}"/>
      <rect x="${x + b.w - 40}" y="${y + 6}" width="34" height="${b.h - 12}" rx="3" fill="#f6ecd6"/>
      ${[0.25, 0.5, 0.75].map((k) => `<path d="M ${x + b.w - 38} ${f(y + 6 + (b.h - 12) * k)} h 30" stroke="#cdbf9f" stroke-width="1.2"/>`).join("")}
      <rect x="${x + 22}" y="${y}" width="9" height="${b.h}" fill="#000" opacity=".16"/>
      <rect x="${x + 60}" y="${y + b.h / 2 - 2.5}" width="${b.w * 0.34}" height="5" rx="2.5" fill="#f6ecd6" opacity=".7"/>
      <rect x="${x}" y="${y}" width="${b.w}" height="7" rx="3" fill="#fff" opacity=".13"/></g>`;
  }
  const top = y;
  // Corona de palabras alrededor del sol: [palabra, x, y, tamaño, giro].
  const words = [
    ["alba", 1452, 646, 30, -10], ["umbral", 1494, 548, 38, -22], ["quimera", 1498, 436, 44, -6],
    ["hidalgo", 1494, 306, 38, 14], ["sosiego", 1436, 166, 50, 22], ["linde", 1252, 78, 42, 8],
    ["arrebol", 1008, 64, 58, -5], ["bruma", 838, 128, 42, -20], ["desvelo", 742, 240, 34, -30],
    ["ínsula", 694, 350, 28, -38], ["vereda", 664, 448, 22, -44], ["rocío", 1548, 232, 24, 34],
  ];
  let wind = "";
  words.forEach(([w, px, py, size, rot], i) => {
    wind += `<text x="${px}" y="${py}" text-anchor="middle" font-size="${size}" font-style="italic" font-weight="${i % 3 ? 400 : 600}" fill="${i % 3 === 0 ? "#a24317" : "#1f1d1a"}" opacity="${f(lerp(0.55, 0.95, size / 58))}" transform="rotate(${rot} ${px} ${py})">${w}</text>`;
  });
  let motes = "";
  for (let i = 0; i < 60; i++) {
    const mx = r() * W;
    const my = r() * 700;
    motes += `<circle cx="${f(mx)}" cy="${f(my)}" r="${f(lerp(1, 3.4, r() ** 2))}" fill="${Math.hypot(mx - sun.x, my - sun.y) < sun.r ? "#ffe9c9" : "#b8862a"}" opacity="${f(lerp(0.2, 0.7, r()))}"/>`;
  }
  const ringR = sun.r * 0.84;
  const cs = 400;
  return {
    name: "hero-papel",
    width: W,
    height: H,
    css: `${LIGHT_CSS}
      #stage{background:linear-gradient(180deg,#fdf6e7 0%,#f8ecd2 55%,#f0dcb6 100%)}
      .plush svg{filter:url(#plush) drop-shadow(0 12px 12px rgba(70,30,5,.35))}`,
    html: `
      ${filters({ blur: 8, depth: 5, spec: 0.6, az: 230 })}
      <svg class="layer" viewBox="0 0 ${W} ${H}">
        <defs>
          <radialGradient id="hpSun" cx=".4" cy=".36" r=".75"><stop offset="0" stop-color="#f08a5a"/><stop offset=".6" stop-color="#c24e26"/><stop offset="1" stop-color="#98351a"/></radialGradient>
          <radialGradient id="hpHalo" cx=".5" cy=".5" r=".5"><stop offset=".62" stop-color="#e9774c" stop-opacity=".22"/><stop offset="1" stop-color="#e9774c" stop-opacity="0"/></radialGradient>
          <path id="hpRing" d="M ${sun.x - ringR} ${sun.y} a ${ringR} ${ringR} 0 1 1 ${ringR * 2} 0 a ${ringR} ${ringR} 0 1 1 ${-ringR * 2} 0"/>
        </defs>
        <circle cx="${sun.x}" cy="${sun.y}" r="${sun.r * 1.5}" fill="url(#hpHalo)"/>
        <circle cx="${sun.x}" cy="${sun.y}" r="${sun.r}" fill="url(#hpSun)"/>
        <text font-size="16.5" fill="#ffd9bd" opacity=".55" letter-spacing="3.2" font-style="italic"><textPath href="#hpRing" textLength="${f(2 * Math.PI * ringR - 6)}" lengthAdjust="spacing">${"el vocabulario nace del libro · leer y que las palabras se queden · ".repeat(2)}</textPath></text>
        <circle cx="${sun.x}" cy="${sun.y}" r="${f(sun.r * 0.93)}" fill="none" stroke="#ffd9bd" stroke-opacity=".3" stroke-width="1.2"/>
        <circle cx="${sun.x}" cy="${sun.y}" r="${f(sun.r * 0.75)}" fill="none" stroke="#ffd9bd" stroke-opacity=".22" stroke-width="1.2"/>
        ${motes}
        <path d="${ridge(640, 70, 260, 0.4)}" fill="#efdcb4"/>
        <path d="${ridge(715, 60, 190, 2.1)}" fill="#e6cb98"/>
        <path d="${ridge(790, 40, 150, 4.4)}" fill="#d9b677"/>
        <path d="M -20 818 C 300 800, 700 826, 1100 812 S 1500 806, 1640 818" fill="none" stroke="#1f1d1a" stroke-width="13" stroke-linecap="round" filter="url(#ink)"/>
        <ellipse cx="${catX}" cy="816" rx="270" ry="16" fill="#2a1a0e" opacity=".35" filter="url(#soft)"/>
        ${stack}
        <ellipse cx="${catX}" cy="${top + 4}" rx="${cs * 0.3}" ry="10" fill="#1a0e06" opacity=".45" filter="url(#soft)"/>
        ${wind}
      </svg>
      ${cat({ stage: 4, coatId: "tuxedo", accessories: ["scarf_amber"], lookAtX: 0.9, lookAtY: -1 }, `left:${catX - cs / 2}px;top:${f(top - cs * 0.945)}px;width:${cs}px;height:${cs}px`, "plush no-shadow")}
      ${grain(0.22, 0.8, "multiply")}`,
  };
}

export const EXTRA = [heroPapel(), voz(), kindle()];
