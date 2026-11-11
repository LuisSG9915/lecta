// Escenas de día (papel): ficha de palabra, herbario, pelajes y evolución.
import { cat, f, filters, grain, lerp, rng } from "./kit.mjs";

export const LIGHT_CSS = `
  #stage{font-family:"Literata Variable",Literata,Georgia,serif;color:#1f1d1a}
  #stage svg text{font-family:"Literata Variable",Literata,Georgia,serif}
  .ui{font-family:"Alegreya Sans","Gill Sans",sans-serif}
  .layer{position:absolute;inset:0;width:100%;height:100%}
  .cat-slot{position:absolute}
  .cat-slot svg{display:block;overflow:visible}
  .no-shadow .cat-ground-shadow{display:none}
  .plush svg{filter:url(#plush) drop-shadow(0 14px 16px rgba(70,40,10,.24))}
`;

const sparkle = (x, y, s, fill, o = 1) =>
  `<path transform="translate(${f(x)} ${f(y)}) scale(${f(s)})" d="M0 -10 C1 -3 3 -1 10 0 C3 1 1 3 0 10 C-1 3 -3 1 -10 0 C-3 -1 -1 -3 0 -10Z" fill="${fill}" opacity="${o}"/>`;

// ───────────────────────── Ficha de palabra
function ficha() {
  const W = 1200;
  const H = 900;
  const r = rng(41);
  let sparks = "";
  for (let i = 0; i < 16; i++) sparks += sparkle(lerp(560, 1180, r()), lerp(40, 560, r()), lerp(0.4, 1.5, r() ** 2), i % 3 ? "#d4a43a" : "#a24317", lerp(0.35, 0.9, r()));
  return {
    name: "ficha-palabra",
    width: W,
    height: H,
    css: `${LIGHT_CSS}
      #stage{background:radial-gradient(ellipse 80% 70% at 62% 40%,#fff6e6 0%,#f1e3c8 60%,#e2cda6 100%)}
      .sun{position:absolute;left:640px;top:-190px;width:760px;height:760px;border-radius:50%;background:radial-gradient(circle at 40% 40%,#e9774c,#a8401f 70%,#8f3219);opacity:.96}
      .watermark{position:absolute;left:-30px;top:330px;font-size:780px;line-height:.6;font-style:italic;color:#a24317;opacity:.07}
      .page{position:absolute;left:64px;top:84px;width:610px;height:700px;box-sizing:border-box;padding:62px 60px;background:linear-gradient(100deg,#fffdf8,#fbf4e6);border-radius:6px;transform:rotate(-3deg);box-shadow:0 2px 0 #e6d9be,0 5px 0 #efe4cc,0 40px 70px -20px rgba(70,40,10,.45);font-size:30px;line-height:1.7}
      .page p{margin:0 0 .9em}
      .folio{font-size:17px;letter-spacing:.2em;text-transform:uppercase;color:#8a7b66}
      .page mark{background:linear-gradient(transparent 12%,#f6cdb9 12%,#f6cdb9 88%,transparent 88%);color:#8f3219;font-weight:600;padding:0 .12em;border-bottom:3px solid #a24317;border-radius:3px}
      .dim{color:#b9ac97}
      .card{position:absolute;left:560px;top:170px;width:520px;box-sizing:border-box;padding:38px 42px 36px;background:#fff;border-radius:26px;transform:rotate(2.2deg);box-shadow:0 1px 0 rgba(255,255,255,.9) inset,0 50px 90px -24px rgba(60,25,5,.55),0 12px 24px -8px rgba(60,25,5,.25)}
      .grab{width:54px;height:5px;border-radius:9px;background:#e3d8c4;margin:-14px auto 22px}
      .eyebrow{font-size:17px;letter-spacing:.18em;text-transform:uppercase;color:#a24317;font-weight:700}
      .word{font-size:86px;line-height:1;font-weight:500;margin:6px 0 14px;letter-spacing:-.02em}
      .def{font-size:27px;line-height:1.36}
      .card blockquote{margin:22px 0 26px;padding:2px 0 2px 18px;border-left:3px solid #d4a43a;font-style:italic;font-size:21px;line-height:1.45;color:#5c554d}
      .card blockquote b{color:#8f3219;font-style:normal}
      .row{display:flex;gap:12px;align-items:center}
      .btn{background:#a24317;color:#fff;border-radius:999px;padding:13px 24px;font-size:21px;font-weight:700;box-shadow:0 8px 16px -6px rgba(162,67,23,.7)}
      .ghost{border:1.5px solid #d9cbb3;color:#5c554d;border-radius:999px;padding:12px 20px;font-size:20px;font-weight:500}`,
    html: `
      ${filters({ blur: 7, depth: 5, az: 235, el: 58, spec: 0.55 })}
      <div class="sun"></div>
      <div class="watermark">p</div>
      <svg class="layer" viewBox="0 0 ${W} ${H}">${sparks}</svg>
      <div class="page">
        <p class="folio ui">Capítulo tres</p>
        <p>La casa olía a membrillo y a lluvia vieja. En el patio, un naranjo <mark>perenne</mark> seguía verde contra el invierno, terco, como si nadie le hubiera avisado del frío.</p>
        <p class="dim">Dejó el libro abierto sobre la mesa. Supo que esa palabra ya no se le iba a olvidar nunca, porque venía con su patio y su invierno.</p>
      </div>
      <div class="card">
        <div class="grab"></div>
        <div class="eyebrow ui">adjetivo</div>
        <div class="word">perenne</div>
        <div class="def">Que dura siempre o por mucho tiempo; que no pierde la hoja.</div>
        <blockquote>«…un naranjo <b>perenne</b> seguía verde contra el invierno…»</blockquote>
        <div class="row ui"><span class="btn">★ Guardar</span><span class="ghost">¿Qué significa aquí?</span></div>
      </div>
      ${cat({ stage: 2, coatId: "ginger", mood: "curious", lookAtX: -0.2, lookAtY: -1 }, "left:838px;top:552px;width:360px;height:360px", "plush no-shadow")}
      ${grain(0.2, 0.8, "multiply")}`,
  };
}

// ───────────────────────── Herbario (Cuaderno)
function sprig(r, { x, y, h, lean, n, len, fill, vein, bloom }) {
  const cx = x + lean * 0.15;
  const cy = y - h * 0.62;
  const ex = x + lean;
  const ey = y - h;
  let out = `<path d="M ${x} ${y} Q ${f(cx)} ${f(cy)} ${f(ex)} ${f(ey)}" fill="none" stroke="${vein}" stroke-width="3.2" stroke-linecap="round"/>`;
  for (let i = 0; i < n; i++) {
    const t = lerp(0.2, 0.96, i / (n - 1));
    const u = 1 - t;
    const px = u * u * x + 2 * u * t * cx + t * t * ex;
    const py = u * u * y + 2 * u * t * cy + t * t * ey;
    const ang = (Math.atan2(2 * u * (cy - y) + 2 * t * (ey - cy), 2 * u * (cx - x) + 2 * t * (ex - cx)) * 180) / Math.PI;
    const side = i % 2 ? 1 : -1;
    const l = len * lerp(1, 0.45, t) * lerp(0.85, 1.15, r());
    const w = l * lerp(0.2, 0.3, r());
    out += `<g transform="translate(${f(px)} ${f(py)}) rotate(${f(ang + side * lerp(38, 62, r()))})">
      <path d="M0 0 C ${f(l * 0.3)} ${f(-w)}, ${f(l * 0.8)} ${f(-w)}, ${f(l)} 0 C ${f(l * 0.8)} ${f(w)}, ${f(l * 0.3)} ${f(w)}, 0 0Z" fill="${fill}" opacity="${f(lerp(0.78, 0.96, r()))}"/>
      <path d="M2 0 L ${f(l * 0.92)} 0" stroke="${vein}" stroke-width="1.1" opacity=".55"/></g>`;
  }
  if (bloom) {
    for (let k = 0; k < 6; k++) out += `<ellipse cx="${f(ex)}" cy="${f(ey - 15)}" rx="7" ry="16" fill="${bloom}" opacity=".9" transform="rotate(${k * 60} ${f(ex)} ${f(ey)})"/>`;
    out += `<circle cx="${f(ex)}" cy="${f(ey)}" r="6" fill="#d4a43a"/>`;
  }
  return out;
}

function herbario() {
  const W = 1200;
  const H = 900;
  const r = rng(77);
  const plants = [
    { word: "arrebol", kind: "sustantivo", fill: "#b5532f", vein: "#6e2c16", bloom: "#e08a58", n: 9, len: 62, lean: 30 },
    { word: "sosiego", kind: "sustantivo", fill: "#5b8262", vein: "#2f4c37", n: 13, len: 54, lean: -26 },
    { word: "bruma", kind: "sustantivo", fill: "#8aa3a8", vein: "#4c6268", bloom: "#c3d3d8", n: 8, len: 70, lean: 18 },
    { word: "linde", kind: "sustantivo", fill: "#c99a2e", vein: "#7a5a12", n: 11, len: 58, lean: -34 },
    { word: "desvelo", kind: "sustantivo", fill: "#43694d", vein: "#22382a", bloom: "#a24317", n: 10, len: 66, lean: 24 },
  ];
  let svg = "";
  let labels = "";
  plants.forEach((p, i) => {
    const x = 200 + i * 160;
    const base = 640 - (i % 2) * 26;
    const h = lerp(300, 380, r());
    svg += sprig(r, { x, y: base, h, ...p });
    svg += `<rect x="${x - 34}" y="${base - 70}" width="68" height="20" rx="2" fill="#e9c46a" opacity=".62" transform="rotate(${f(lerp(-9, 9, r()))} ${x} ${base - 60})"/>`;
    labels += `<div class="tag" style="left:${x - 78}px;top:${base + 22}px;transform:rotate(${f(lerp(-2.5, 2.5, r()))}deg)"><i>${p.word}</i><span class="ui">${p.kind}</span></div>`;
  });
  return {
    name: "cuaderno-herbario",
    width: W,
    height: H,
    css: `${LIGHT_CSS}
      #stage{background:radial-gradient(ellipse 90% 80% at 40% 35%,#35503d 0%,#22362a 60%,#14221a 100%)}
      .sheet{position:absolute;left:84px;top:56px;width:1010px;height:770px;background:linear-gradient(160deg,#fbf5e7,#efe3c8);border-radius:5px;transform:rotate(-1.4deg);box-shadow:0 60px 90px -30px rgba(0,0,0,.7),0 0 0 1px rgba(120,95,70,.18)}
      .sheet:before{content:"";position:absolute;inset:22px;border:1.5px solid rgba(120,95,70,.28);border-radius:2px}
      .head{position:absolute;left:150px;top:96px;transform:rotate(-1.4deg);transform-origin:0 0}
      .head h1{margin:0;font-size:74px;font-weight:500;font-style:italic;letter-spacing:-.01em;line-height:1}
      .head p{margin:10px 0 0 4px;font-size:21px;letter-spacing:.2em;text-transform:uppercase;color:#8a7b66}
      .tag{position:absolute;width:156px;box-sizing:border-box;padding:10px 8px 9px;text-align:center;background:#fffdf7;border:1.5px solid rgba(120,95,70,.35);box-shadow:0 6px 10px -5px rgba(70,40,10,.35)}
      .tag i{display:block;font-size:30px;line-height:1.05}
      .tag span{display:block;margin-top:5px;font-size:14px;letter-spacing:.18em;text-transform:uppercase;color:#a24317;font-weight:700}
      .stamp{position:absolute;left:940px;top:92px;width:118px;height:118px;border-radius:50%;border:3px solid #a24317;color:#a24317;display:grid;place-items:center;text-align:center;font-size:15px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;line-height:1.3;transform:rotate(11deg);opacity:.75}`,
    html: `
      ${filters({ blur: 7, depth: 5, spec: 0.55 })}
      <div class="sheet"></div>
      <div class="head"><h1>Herbario</h1><p class="ui">palabras recogidas leyendo</p></div>
      <div class="stamp ui">del libro<br>al<br>cuaderno</div>
      <svg class="layer" viewBox="0 0 ${W} ${H}" style="transform:rotate(-1.4deg)">${svg}</svg>
      <div class="layer" style="transform:rotate(-1.4deg)">${labels}</div>
      ${cat({ stage: 3, coatId: "tuxedo", mood: "happy", accessories: ["glasses_round", "scarf_amber"] }, "left:872px;top:508px;width:390px;height:390px", "plush no-shadow")}
      ${grain(0.22, 0.8, "multiply")}`,
  };
}

// ───────────────────────── Pelajes
function pelajes() {
  const W = 1600;
  const H = 900;
  const cast = [
    { coatId: "tuxedo", name: "Tinta y Crema", bg: ["#f0bd55", "#d99a2b"], ink: "#3b2606", spec: { accessories: ["bufanda"] } },
    { coatId: "latte", name: "Crema Canela", bg: ["#3f7896", "#28566f"], ink: "#eaf4fa", spec: { accessories: ["glasses_round"] } },
    { coatId: "ginger", name: "Naranja Miel", bg: ["#2a3160", "#191e42"], ink: "#e9ecff", spec: { mood: "happy" } },
    { coatId: "mist", name: "Gris Neblina", bg: ["#b34a2c", "#8f3219"], ink: "#ffe9df", spec: { accessories: ["headphones_cozy"] } },
    { coatId: "calico", name: "Calicó Literario", bg: ["#4d7859", "#33543e"], ink: "#eaf5ec", spec: { accessories: ["beret_poet"] } },
  ];
  const bw = W / 5;
  const skew = 110;
  let bands = "";
  let cats = "";
  let names = "";
  cast.forEach((c, i) => {
    const x0 = i * bw;
    bands += `<linearGradient id="pb${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.bg[0]}"/><stop offset="1" stop-color="${c.bg[1]}"/></linearGradient>
      <path d="M ${x0 + skew - 60} -10 L ${x0 + bw + skew + 60} -10 L ${x0 + bw - skew + 60} ${H + 10} L ${x0 - skew - 60} ${H + 10} Z" fill="url(#pb${i})"/>
      <circle cx="${x0 + bw / 2}" cy="${H * 0.47}" r="${bw * 0.44}" fill="#fff" opacity=".09"/>
      <ellipse cx="${x0 + bw / 2}" cy="${H * 0.735}" rx="${bw * 0.34}" ry="20" fill="#000" opacity=".28" filter="url(#soft)"/>`;
    const lift = i % 2 ? 26 : -18;
    cats += cat({ stage: 3, coatId: c.coatId, ...c.spec }, `left:${x0 + bw / 2 - 170}px;top:${H * 0.75 - 322 + lift * 0}px;width:340px;height:340px`, "plush no-shadow");
    names += `<div class="pn" style="left:${x0}px;width:${bw}px;color:${c.ink}"><i>${c.name}</i></div>`;
  });
  return {
    name: "pelajes",
    width: W,
    height: H,
    css: `${LIGHT_CSS}
      #stage{background:#191e42}
      .plush svg{filter:url(#plush) drop-shadow(0 10px 14px rgba(0,0,0,.3))}
      .pn{position:absolute;top:${H * 0.8}px;text-align:center;font-size:33px;letter-spacing:-.005em}`,
    html: `
      ${filters({ blur: 7, depth: 5 })}
      <svg class="layer" viewBox="0 0 ${W} ${H}"><defs></defs>${bands}</svg>
      ${cats}${names}
      ${grain(0.2, 0.8, "soft-light")}`,
  };
}

// ───────────────────────── Evolución · «crece contigo»
function evolucion() {
  const W = 1680;
  const H = 720;
  const r = rng(5);
  const names = ["recién llegado", "curioso", "joven lector", "lector", "bibliotecario"];
  const sizes = [190, 235, 280, 325, 370];
  let cats = "";
  let tags = "";
  let dots = "";
  const ground = (x) => 600 - (x / W) ** 1.25 * 150;
  sizes.forEach((s, i) => {
    const x = 190 + i * 322;
    const gy = ground(x);
    cats += cat({ stage: i, coatId: "ginger", mood: i === 4 ? "happy" : "idle", accessories: i === 4 ? ["bufanda"] : [] }, `left:${x - s / 2}px;top:${f(gy - s * 0.93)}px;width:${s}px;height:${s}px`, "plush no-shadow");
    tags += `<div class="et" style="left:${x - 110}px;top:${f(gy + 34)}px"><b>${i + 1}</b><i>${names[i]}</i></div>`;
    dots += `<ellipse cx="${x}" cy="${f(gy + 3)}" rx="${s * 0.3}" ry="${s * 0.045}" fill="#2a1a0e" opacity=".3" filter="url(#soft)"/>`;
  });
  let path = `M -40 ${ground(0) + 10}`;
  for (let x = 0; x <= W + 40; x += 70) path += ` L ${x} ${f(ground(x) + 8 + Math.sin(x / 90) * 5)}`;
  let leaves = "";
  for (let i = 0; i < 30; i++) {
    const lx = r() * W;
    const ly = lerp(30, 360, r());
    leaves += `<text x="${f(lx)}" y="${f(ly)}" font-size="${f(lerp(16, 46, r() ** 2))}" font-style="italic" fill="#8f3219" opacity="${f(lerp(0.08, 0.3, r()))}" transform="rotate(${f(lerp(-30, 30, r()))} ${f(lx)} ${f(ly)})">${"palabras"[i % 8]}</text>`;
  }
  return {
    name: "evolucion",
    width: W,
    height: H,
    css: `${LIGHT_CSS}
      #stage{background:linear-gradient(180deg,#fbf3e2 0%,#f4e6c9 62%,#ecd9b3 100%)}
      .et{position:absolute;width:220px;text-align:center}
      .et b{display:block;font:700 20px "Alegreya Sans",sans-serif;letter-spacing:.24em;color:#a24317}
      .et i{display:block;font-size:27px;margin-top:2px;color:#2a211a}`,
    html: `
      ${filters({ blur: 6, depth: 5, spec: 0.5 })}
      <svg class="layer" viewBox="0 0 ${W} ${H}">
        <defs><radialGradient id="evSun" cx=".4" cy=".4" r=".7"><stop offset="0" stop-color="#ec7a4e"/><stop offset="1" stop-color="#9a361b"/></radialGradient></defs>
        <circle cx="1390" cy="250" r="225" fill="url(#evSun)"/>
        <circle cx="1390" cy="250" r="262" fill="none" stroke="#a24317" stroke-opacity=".3" stroke-width="1.5" stroke-dasharray="2 9"/>
        ${leaves}
        <path d="${path}" fill="none" stroke="#1f1d1a" stroke-width="15" stroke-linecap="round" filter="url(#ink)"/>
        <path d="${path}" fill="none" stroke="#1f1d1a" stroke-width="3" stroke-linecap="round" opacity=".5" transform="translate(0 16)" stroke-dasharray="60 30 140 50" filter="url(#ink)"/>
        ${dots}
      </svg>
      ${cats}${tags}
      ${grain(0.2, 0.8, "multiply")}`,
  };
}

export const CLARAS = [ficha(), herbario(), pelajes(), evolucion()];
