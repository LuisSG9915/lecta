// Geometría del gato de Lecta rediseñado (Bloque 1): silueta orgánica
// estilo "Cozy Editorial / Ghibli" en lienzo 160×160 — mejillas suaves
// abullonadas, orejas independientes, ojos con doble catchlight,
// medallón de pecho esponjoso, cola articulada en (108, 124) y patitas
// con almohadillas ("toe beans").

export const CAT_BOX = 160;

export type EyeKind = "open" | "half" | "sleep" | "happy" | "blink";
export type MouthKind =
  | "cat"
  | "eat"
  | "smile"
  | "yawn"
  | "tongue";

export interface EyeGeom {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface Stroke {
  d: string;
  w: number;
}

export interface StageArt {
  // Cabeza y cara.
  head: string;
  headShade: string;
  earInnerL: string;
  earInnerR: string;
  earL: string;
  earR: string;
  tuft?: string;
  muzzle: string;
  nose: string;
  mouth: {
    cat: string;
    open: string;
    smile: string;
    yawn: string;
    tongue: string;
    tongueFill: string;
    munch: string;
  };
  eyesOpen: [EyeGeom, EyeGeom];
  eyesHalf: [string, string];
  eyesClosed: [string, string];
  eyesHappy: [string, string];
  whiskerL: string;
  whiskerR: string;
  blushL: { cx: number; cy: number; rx: number; ry: number };
  blushR: { cx: number; cy: number; rx: number; ry: number };
  // Cuerpo y extremidades.
  body: string;
  belly?: string;
  chestFluff: string;
  paws: string[];
  tail: Stroke;
  pawUp?: Stroke;
  wave: Stroke;
  cheerL: Stroke;
  cheerR: Stroke;
  book?: string[];
  // Rayas del pelaje atigrado / calicó (al menos 5 trazos por etapa).
  marks: string[];
  shadow: { cx: number; cy: number; rx: number; ry: number };
  // Ropa por ranura.
  wear: {
    bufanda?: string[];
    collar?: string[];
    moño?: string[];
    anteojos?: string[];
    chaleco?: string[];
    boina?: string[];
    capa?: string[];
    corbatin?: string[];
    monoculo?: string[];
    beret_poet?: string[];
    wizard_hat?: string[];
    laurel_crown?: string[];
    headphones_cozy?: string[];
    scarf_amber?: string[];
    cape_modernist?: string[];
    bowtie_scholar?: string[];
    detective_cape?: string[];
    glasses_round?: string[];
    monocle_gold?: string[];
    panuelo?: string[];
    gafas_sol?: string[];
    abrigo?: string[];
    pluma?: string[];
  };
  // Anclas de platito, pelota, taza, vela y zZz.
  propX: number;
  propY: number;
  zAt: { x: number; y: number }[];
}

const cx = 80;

const ell = (x: number, y: number, rx: number, ry: number): string =>
  `M ${n(x - rx)} ${n(y)} A ${n(rx)} ${n(ry)} 0 1 0 ${n(x + rx)} ${n(y)} ` +
  `A ${n(rx)} ${n(ry)} 0 1 0 ${n(x - rx)} ${n(y)} Z`;

const n = (v: number) => Math.round(v * 10) / 10;

// Oreja redondeada en lienzo 160×160
const earPath = (bx: number, baseY: number, ew: number, eh: number, slant = 0): string =>
  `M ${n(bx - ew)} ${n(baseY)} ` +
  `Q ${n(bx - ew * 0.5 + slant * 0.4)} ${n(baseY - eh * 0.65)} ${n(bx + slant)} ${n(baseY - eh)} ` +
  `Q ${n(bx + ew * 0.5 + slant * 0.4)} ${n(baseY - eh * 0.65)} ${n(bx + ew)} ${n(baseY)} Z`;

// Interior de oreja con interior color rosa melocotón
const earInnerPath = (bx: number, baseY: number, ew: number, eh: number, slant = 0): string => {
  const s = 0.58;
  const iy = baseY - eh * 0.12;
  return earPath(bx + slant * 0.2, iy, ew * s, eh * s, slant * 0.6);
};

interface CatParams {
  headW: number;
  headR: number;
  headCy: number;
  earW: number;
  earH: number;
  eyeRx: number;
  eyeRy: number;
  eyeDx: number;
  eyeDy: number;
  muzzleW: number;
  muzzleH: number;
  muzzleDy: number;
  noseDy: number;
  whiskers: boolean;
  blush: boolean;
  bodyRx: number;
  bodyRy: number;
  bodyCy: number;
  belly: boolean;
  feet: boolean;
  pawUp: boolean;
  book: boolean;
  tailD: string;
  tailW: number;
  tuft: boolean;
}

const catMouth = (mx: number, my: number, w: number): string =>
  `M ${n(mx - w)} ${n(my)} Q ${n(mx - w * 0.45)} ${n(my + 3.2)} ${n(mx)} ${n(my + 1.2)} ` +
  `Q ${n(mx + w * 0.45)} ${n(my + 3.2)} ${n(mx + w)} ${n(my)}`;

function makeStage(p: CatParams): StageArt {
  const headTop = p.headCy - p.headR;
  const headBottom = p.headCy + p.headR;
  const eyeY = p.headCy + p.eyeDy;
  const muzzleY = p.headCy + p.muzzleDy;
  const noseY = p.headCy + p.noseDy;
  const mouthY = noseY + 5.2;

  // Cabeza: silueta orgánica con mejillas ensanchadas en la mitad inferior (chubby cheeks)
  const hw = p.headW / 2;
  const head =
    `M ${n(cx - hw)} ${n(p.headCy - p.headR * 0.1)} ` +
    `C ${n(cx - hw - 3)} ${n(p.headCy + p.headR * 0.45)} ${n(cx - hw * 0.72)} ${n(headBottom)} ${n(cx)} ${n(headBottom)} ` +
    `C ${n(cx + hw * 0.72)} ${n(headBottom)} ${n(cx + hw + 3)} ${n(p.headCy + p.headR * 0.45)} ${n(cx + hw)} ${n(p.headCy - p.headR * 0.1)} ` +
    `C ${n(cx + hw)} ${n(headTop + 6)} ${n(cx + hw * 0.62)} ${n(headTop)} ${n(cx)} ${n(headTop)} ` +
    `C ${n(cx - hw * 0.62)} ${n(headTop)} ${n(cx - hw)} ${n(headTop + 6)} ${n(cx - hw)} ${n(p.headCy - p.headR * 0.1)} Z`;

  // Sombra suave en el lateral
  const headShade =
    `M ${n(cx + hw * 0.4)} ${n(headTop + 3)} ` +
    `Q ${n(cx + hw * 0.98)} ${n(p.headCy)} ${n(cx + hw * 0.92)} ${n(headBottom - 6)} ` +
    `Q ${n(cx + hw * 0.65)} ${n(headBottom - 2)} ${n(cx + hw * 0.38)} ${n(headBottom - 4)} ` +
    `Q ${n(cx + hw * 0.58)} ${n(p.headCy)} ${n(cx + hw * 0.4)} ${n(headTop + 3)} Z`;

  // Orejas independientes: con base redondeada y leve ángulo
  const earBaseY = headTop + p.headR * 0.32;
  const earSpread = hw * 0.64;
  const earL = earPath(cx - earSpread, earBaseY, p.earW, p.earH, -4);
  const earR = earPath(cx + earSpread, earBaseY, p.earW, p.earH, 4);
  const earInnerL = earInnerPath(cx - earSpread, earBaseY, p.earW, p.earH, -4);
  const earInnerR = earInnerPath(cx + earSpread, earBaseY, p.earW, p.earH, 4);

  // Mechón sutil en la frente
  const tuft = p.tuft
    ? `M ${n(cx - 5)} ${n(headTop + 2)} Q ${n(cx - 3.5)} ${n(headTop + 8)} ${n(cx - 4.5)} ${n(headTop + 13)} ` +
      `M ${n(cx + 5)} ${n(headTop + 2)} Q ${n(cx + 3.5)} ${n(headTop + 8)} ${n(cx + 4.5)} ${n(headTop + 13)}`
    : undefined;

  // Hocico suave: dos suaves óvalos juntos
  const mw = p.muzzleW / 2;
  const muzzle =
    `${ell(cx - mw * 0.42, muzzleY, mw * 0.62, p.muzzleH / 2)} ` +
    `${ell(cx + mw * 0.42, muzzleY, mw * 0.62, p.muzzleH / 2)}`;

  // Nariz pequeña en triángulo invertido redondeado
  const nose =
    `M ${n(cx - 3.8)} ${n(noseY)} Q ${n(cx)} ${n(noseY - 2.2)} ${n(cx + 3.8)} ${n(noseY)} ` +
    `Q ${n(cx + 2.8)} ${n(noseY + 3.8)} ${n(cx)} ${n(noseY + 4.8)} ` +
    `Q ${n(cx - 2.8)} ${n(noseY + 3.8)} ${n(cx - 3.8)} ${n(noseY)} Z`;

  const mouth = {
    cat: catMouth(cx, mouthY, 6.2),
    open:
      `M ${n(cx - 3.4)} ${n(mouthY)} Q ${n(cx)} ${n(mouthY + 1.4)} ${n(cx + 3.4)} ${n(mouthY)} ` +
      `Q ${n(cx + 2.5)} ${n(mouthY + 5.2)} ${n(cx)} ${n(mouthY + 5.6)} ` +
      `Q ${n(cx - 2.5)} ${n(mouthY + 5.2)} ${n(cx - 3.4)} ${n(mouthY)} Z`,
    smile:
      `M ${n(cx - 5.8)} ${n(mouthY - 0.6)} Q ${n(cx)} ${n(mouthY + 2)} ${n(cx + 5.8)} ${n(mouthY - 0.6)} ` +
      `Q ${n(cx + 4.4)} ${n(mouthY + 6.8)} ${n(cx)} ${n(mouthY + 7.2)} ` +
      `Q ${n(cx - 4.4)} ${n(mouthY + 6.8)} ${n(cx - 5.8)} ${n(mouthY - 0.6)} Z`,
    yawn:
      `M ${n(cx - 4.6)} ${n(mouthY - 1)} Q ${n(cx)} ${n(mouthY + 1)} ${n(cx + 4.6)} ${n(mouthY - 1)} ` +
      `Q ${n(cx + 4)} ${n(mouthY + 8.5)} ${n(cx)} ${n(mouthY + 9)} ` +
      `Q ${n(cx - 4)} ${n(mouthY + 8.5)} ${n(cx - 4.6)} ${n(mouthY - 1)} Z`,
    tongue:
      `M ${n(cx - 3.6)} ${n(mouthY)} Q ${n(cx)} ${n(mouthY + 1.2)} ${n(cx + 3.6)} ${n(mouthY)} ` +
      `M ${n(cx - 2.8)} ${n(mouthY + 3.6)} Q ${n(cx)} ${n(mouthY + 7)} ${n(cx + 2.8)} ${n(mouthY + 3.6)}`,
    tongueFill:
      `M ${n(cx - 2.8)} ${n(mouthY + 3)} Q ${n(cx)} ${n(mouthY + 4)} ${n(cx + 2.8)} ${n(mouthY + 3)} ` +
      `L ${n(cx + 2.2)} ${n(mouthY + 7.4)} Q ${n(cx)} ${n(mouthY + 9.2)} ${n(cx - 2.2)} ${n(mouthY + 7.4)} Z`,
    munch: `M ${n(cx - 3.6)} ${n(mouthY + 1.6)} Q ${n(cx)} ${n(mouthY + 4)} ${n(cx + 3.6)} ${n(mouthY + 1.6)}`,
  };

  // Ojos grandes expresivos
  const eyesOpen: [EyeGeom, EyeGeom] = [
    { cx: cx - p.eyeDx, cy: eyeY, rx: p.eyeRx, ry: p.eyeRy },
    { cx: cx + p.eyeDx, cy: eyeY, rx: p.eyeRx, ry: p.eyeRy },
  ];

  const lidFor = (e: EyeGeom) =>
    `M ${n(e.cx - e.rx - 1)} ${n(e.cy - e.ry - 1.5)} ` +
    `Q ${n(e.cx)} ${n(e.cy - e.ry - 3)} ${n(e.cx + e.rx + 1)} ${n(e.cy - e.ry - 1.5)} ` +
    `L ${n(e.cx + e.rx + 1)} ${n(e.cy - e.ry * 0.1)} ` +
    `Q ${n(e.cx)} ${n(e.cy - e.ry * 0.72)} ${n(e.cx - e.rx - 1)} ${n(e.cy - e.ry * 0.1)} Z`;

  const eyesHalf: [string, string] = [
    lidFor(eyesOpen[0]),
    lidFor(eyesOpen[1]),
  ];

  const closedFor = (e: EyeGeom) =>
    `M ${n(e.cx - e.rx)} ${n(e.cy)} Q ${n(e.cx)} ${n(e.cy + e.ry * 0.85)} ${n(e.cx + e.rx)} ${n(e.cy)}`;
  const happyFor = (e: EyeGeom) =>
    `M ${n(e.cx - e.rx)} ${n(e.cy + 1.5)} Q ${n(e.cx)} ${n(e.cy - e.ry * 0.9)} ${n(e.cx + e.rx)} ${n(e.cy + 1.5)}`;

  const eyesClosed: [string, string] = [
    closedFor(eyesOpen[0]),
    closedFor(eyesOpen[1]),
  ];
  const eyesHappy: [string, string] = [
    happyFor(eyesOpen[0]),
    happyFor(eyesOpen[1]),
  ];

  // Bigotes curvos de alto contraste
  const whiskerL = p.whiskers
    ? `M ${n(cx - hw * 0.68)} ${n(muzzleY - 1.5)} Q ${n(cx - hw - 8)} ${n(muzzleY - 4.5)} ${n(cx - hw - 15)} ${n(muzzleY - 7.5)} ` +
      `M ${n(cx - hw * 0.68)} ${n(muzzleY + 4)} Q ${n(cx - hw - 8)} ${n(muzzleY + 6)} ${n(cx - hw - 15)} ${n(muzzleY + 9)}`
    : "";
  const whiskerR = p.whiskers
    ? `M ${n(cx + hw * 0.68)} ${n(muzzleY - 1.5)} Q ${n(cx + hw + 8)} ${n(muzzleY - 4.5)} ${n(cx + hw + 15)} ${n(muzzleY - 7.5)} ` +
      `M ${n(cx + hw * 0.68)} ${n(muzzleY + 4)} Q ${n(cx + hw + 8)} ${n(muzzleY + 6)} ${n(cx + hw + 15)} ${n(muzzleY + 9)}`
    : "";

  const blushRx = p.blush ? p.eyeRx * 0.72 : 0;
  const blushY = muzzleY - p.muzzleH * 0.08;
  const blushL = {
    cx: cx - hw * 0.62,
    cy: blushY,
    rx: blushRx,
    ry: blushRx * 0.6,
  };
  const blushR = {
    cx: cx + hw * 0.62,
    cy: blushY,
    rx: blushRx,
    ry: blushRx * 0.6,
  };

  // Cuerpo y Pecho Esponjoso
  const body =
    `M ${n(cx - p.bodyRx * 0.5)} ${n(p.bodyCy - p.bodyRy * 0.85)} ` +
    `C ${n(cx - p.bodyRx * 0.88)} ${n(p.bodyCy - p.bodyRy * 0.2)} ${n(cx - p.bodyRx * 1.05)} ${n(p.bodyCy + p.bodyRy * 0.55)} ${n(cx - p.bodyRx * 0.95)} ${n(p.bodyCy + p.bodyRy)} ` +
    `C ${n(cx - p.bodyRx * 0.55)} ${n(p.bodyCy + p.bodyRy + 4)} ${n(cx + p.bodyRx * 0.55)} ${n(p.bodyCy + p.bodyRy + 4)} ${n(cx + p.bodyRx * 0.95)} ${n(p.bodyCy + p.bodyRy)} ` +
    `C ${n(cx + p.bodyRx * 1.05)} ${n(p.bodyCy + p.bodyRy * 0.55)} ${n(cx + p.bodyRx * 0.88)} ${n(p.bodyCy - p.bodyRy * 0.2)} ${n(cx + p.bodyRx * 0.5)} ${n(p.bodyCy - p.bodyRy * 0.85)} Z`;

  const belly = p.belly
    ? ell(cx, p.bodyCy + p.bodyRy * 0.32, p.bodyRx * 0.52, p.bodyRy * 0.56)
    : undefined;

  // Medallón de pecho esponjoso (cat-chest-fluff): mechón color crema cálido en el pecho
  const chestFluff =
    `M ${n(cx)} ${n(p.bodyCy - p.bodyRy * 0.8)} ` +
    `C ${n(cx - 15)} ${n(p.bodyCy - p.bodyRy * 0.8)} ${n(cx - 20)} ${n(p.bodyCy - p.bodyRy * 0.2)} ${n(cx - 18)} ${n(p.bodyCy + p.bodyRy * 0.15)} ` +
    `C ${n(cx - 12)} ${n(p.bodyCy + p.bodyRy * 0.42)} ${n(cx - 5)} ${n(p.bodyCy + p.bodyRy * 0.55)} ${n(cx)} ${n(p.bodyCy + p.bodyRy * 0.65)} ` +
    `C ${n(cx + 5)} ${n(p.bodyCy + p.bodyRy * 0.55)} ${n(cx + 12)} ${n(p.bodyCy + p.bodyRy * 0.42)} ${n(cx + 18)} ${n(p.bodyCy + p.bodyRy * 0.15)} ` +
    `C ${n(cx + 20)} ${n(p.bodyCy - p.bodyRy * 0.2)} ${n(cx + 15)} ${n(p.bodyCy - p.bodyRy * 0.8)} ${n(cx)} ${n(p.bodyCy - p.bodyRy * 0.8)} Z`;

  // Patas delanteras
  const paws: string[] = [];
  const pawGap = p.bodyRx * 0.42;
  const pawY = p.bodyCy + p.bodyRy - 1;
  const pawR = Math.min(7.5, p.bodyRx * 0.32);
  paws.push(ell(cx - pawGap, pawY, pawR, pawR * 0.82));
  paws.push(ell(cx + pawGap, pawY, pawR, pawR * 0.82));
  if (p.feet) {
    paws.push(ell(cx - p.bodyRx * 0.82, pawY + 0.8, pawR + 1.2, pawR * 0.75));
    paws.push(ell(cx + p.bodyRx * 0.82, pawY + 0.8, pawR + 1.2, pawR * 0.75));
  }

  const tail: Stroke = { d: p.tailD, w: p.tailW };
  const pawUp: Stroke | undefined = p.pawUp
    ? { d: `M ${n(cx + pawGap)} ${n(pawY - 1)} L ${n(cx + pawGap + 7)} ${n(pawY - 15)}`, w: pawR * 2.2 }
    : undefined;

  const pawBaseY = headBottom - 14;
  const pawBaseX = hw * 0.58;
  const pawCtrlY = p.headCy + p.headR * 0.55;
  const cheerTipX = hw + 8;
  const cheerTipY = earBaseY + p.earH * 0.1;
  const wave: Stroke = {
    d: `M ${n(cx + pawBaseX)} ${n(pawBaseY)} Q ${n(cx + hw + 9)} ${n(p.headCy + p.headR * 0.4)} ${n(cx + hw + 12)} ${n(earBaseY - p.earH * 0.7)}`,
    w: pawR * 2.35,
  };
  const cheerL: Stroke = {
    d: `M ${n(cx - pawBaseX)} ${n(pawBaseY)} Q ${n(cx - hw - 4)} ${n(pawCtrlY)} ${n(cx - cheerTipX)} ${n(cheerTipY)}`,
    w: pawR * 2.2,
  };
  const cheerR: Stroke = {
    d: `M ${n(cx + pawBaseX)} ${n(pawBaseY)} Q ${n(cx + hw + 4)} ${n(pawCtrlY)} ${n(cx + cheerTipX)} ${n(cheerTipY)}`,
    w: pawR * 2.2,
  };

  // Libro abierto para el bibliotecario
  const book = p.book
    ? [
        `M ${n(cx - 24)} ${n(pawY - 10)} L ${n(cx)} ${n(pawY - 15)} L ${n(cx + 24)} ${n(pawY - 10)} L ${n(cx + 24)} ${n(pawY + 6)} L ${n(cx)} ${n(pawY + 1)} L ${n(cx - 24)} ${n(pawY + 6)} Z`,
        `M ${n(cx - 22)} ${n(pawY - 11.5)} L ${n(cx)} ${n(pawY - 16.5)} L ${n(cx + 22)} ${n(pawY - 11.5)} L ${n(cx + 22)} ${n(pawY + 3.5)} L ${n(cx)} ${n(pawY - 1)} L ${n(cx - 22)} ${n(pawY + 3.5)} Z`,
        `M ${n(cx)} ${n(pawY - 16.5)} L ${n(cx)} ${n(pawY - 1)} ` +
          `M ${n(cx - 16)} ${n(pawY - 7.5)} L ${n(cx - 5)} ${n(pawY - 10.5)} ` +
          `M ${n(cx - 16)} ${n(pawY - 3.5)} L ${n(cx - 5)} ${n(pawY - 6.5)} ` +
          `M ${n(cx + 5)} ${n(pawY - 10.5)} L ${n(cx + 16)} ${n(pawY - 7.5)} ` +
          `M ${n(cx + 5)} ${n(pawY - 6.5)} L ${n(cx + 16)} ${n(pawY - 3.5)}`,
      ]
    : undefined;

  // Rayas atigradas (mínimo 5 marcas)
  const marks: string[] = [
    `M ${n(cx - p.eyeDx - 2)} ${n(headTop + p.headR * 0.18)} Q ${n(cx - p.eyeDx - 1)} ${n(headTop + p.headR * 0.4)} ${n(cx - p.eyeDx - 3)} ${n(headTop + p.headR * 0.58)}`,
    `M ${n(cx + p.eyeDx + 2)} ${n(headTop + p.headR * 0.18)} Q ${n(cx + p.eyeDx + 1)} ${n(headTop + p.headR * 0.4)} ${n(cx + p.eyeDx + 3)} ${n(headTop + p.headR * 0.58)}`,
    `M ${n(cx - p.bodyRx * 0.72)} ${n(p.bodyCy - p.bodyRy * 0.35)} Q ${n(cx - p.bodyRx * 0.45)} ${n(p.bodyCy - p.bodyRy * 0.15)} ${n(cx - p.bodyRx * 0.6)} ${n(p.bodyCy + p.bodyRy * 0.18)}`,
    `M ${n(cx - p.bodyRx * 0.78)} ${n(p.bodyCy + p.bodyRy * 0.3)} Q ${n(cx - p.bodyRx * 0.52)} ${n(p.bodyCy + p.bodyRy * 0.45)} ${n(cx - p.bodyRx * 0.58)} ${n(p.bodyCy + p.bodyRy * 0.65)}`,
    `M ${n(cx + p.bodyRx * 0.72)} ${n(p.bodyCy - p.bodyRy * 0.35)} Q ${n(cx + p.bodyRx * 0.45)} ${n(p.bodyCy - p.bodyRy * 0.15)} ${n(cx + p.bodyRx * 0.6)} ${n(p.bodyCy + p.bodyRy * 0.18)}`,
    `M ${n(cx + p.bodyRx * 0.78)} ${n(p.bodyCy + p.bodyRy * 0.3)} Q ${n(cx + p.bodyRx * 0.52)} ${n(p.bodyCy + p.bodyRy * 0.45)} ${n(cx + p.bodyRx * 0.58)} ${n(p.bodyCy + p.bodyRy * 0.65)}`,
  ];

  const shadow = {
    cx,
    cy: 148,
    rx: p.bodyRx + 12,
    ry: 4.8,
  };

  // Prendas adaptadas a 160×160
  const wear: StageArt["wear"] = {};
  const jawY = headBottom - 6;
  const jawW = hw * 0.75;

  wear.bufanda = [
    `M ${n(cx - jawW)} ${n(jawY - 2)} Q ${n(cx)} ${n(jawY + 12)} ${n(cx + jawW)} ${n(jawY - 2)} ` +
      `L ${n(cx + jawW - 4)} ${n(jawY + 7)} Q ${n(cx)} ${n(jawY + 20)} ${n(cx - jawW + 4)} ${n(jawY + 7)} Z`,
    `M ${n(cx + jawW * 0.3)} ${n(jawY + 5)} L ${n(cx + jawW * 0.3 + 13)} ${n(jawY + 2)} ` +
      `L ${n(cx + jawW * 0.3 + 15)} ${n(jawY + 22)} L ${n(cx + jawW * 0.3 + 8)} ${n(jawY + 18)} ` +
      `L ${n(cx + jawW * 0.3 + 2)} ${n(jawY + 22)} Z`,
  ];

  wear.collar = [
    `M ${n(cx - jawW * 0.8)} ${n(jawY + 1)} Q ${n(cx)} ${n(jawY + 9)} ${n(cx + jawW * 0.8)} ${n(jawY + 1)} ` +
      `L ${n(cx + jawW * 0.8)} ${n(jawY + 5)} Q ${n(cx)} ${n(jawY + 13)} ${n(cx - jawW * 0.8)} ${n(jawY + 5)} Z`,
    ell(cx, jawY + 10, 3.5, 3.5),
  ];

  {
    const bx = cx + earSpread + p.earW * 0.35;
    const by = earBaseY - p.earH * 0.55;
    wear.moño = [
      `M ${n(bx)} ${n(by)} L ${n(bx - 9)} ${n(by - 6.5)} L ${n(bx - 8.5)} ${n(by + 6)} Z`,
      `M ${n(bx)} ${n(by)} L ${n(bx + 9)} ${n(by - 6.5)} L ${n(bx + 8.5)} ${n(by + 6)} Z`,
      ell(bx, by, 3.2, 2.8),
    ];
  }

  {
    const fr = Math.max(p.eyeRx, p.eyeRy) + 4.5;
    wear.anteojos = [
      ell(cx - p.eyeDx, eyeY, fr, fr),
      ell(cx + p.eyeDx, eyeY, fr, fr),
      `M ${n(cx - p.eyeDx + fr)} ${n(eyeY - 1)} L ${n(cx + p.eyeDx - fr)} ${n(eyeY - 1)} ` +
        `M ${n(cx - p.eyeDx - fr)} ${n(eyeY - 1.2)} L ${n(cx - hw - 1)} ${n(eyeY - 6)} ` +
        `M ${n(cx + p.eyeDx + fr)} ${n(eyeY - 1.2)} L ${n(cx + hw + 1)} ${n(eyeY - 6)}`,
    ];
  }

  {
    const vTopY = p.bodyCy - p.bodyRy * 0.65;
    const vBotY = p.bodyCy + p.bodyRy - 5;
    const vOutTopX = p.bodyRx * 0.65;
    const vOutBotX = p.bodyRx * 0.95;
    wear.chaleco = [
      `M ${n(cx - vOutTopX)} ${n(vTopY)} C ${n(cx - p.bodyRx * 1.05)} ${n(p.bodyCy)} ${n(cx - vOutBotX)} ${n(vBotY)} ${n(cx - vOutBotX + 2)} ${n(vBotY)} ` +
        `L ${n(cx - p.bodyRx * 0.22)} ${n(vBotY)} L ${n(cx - p.bodyRx * 0.28)} ${n(vTopY + 4)} Z`,
      `M ${n(cx + vOutTopX)} ${n(vTopY)} C ${n(cx + p.bodyRx * 1.05)} ${n(p.bodyCy)} ${n(cx + vOutBotX)} ${n(vBotY)} ${n(cx + vOutBotX - 2)} ${n(vBotY)} ` +
        `L ${n(cx + p.bodyRx * 0.22)} ${n(vBotY)} L ${n(cx + p.bodyRx * 0.28)} ${n(vTopY + 4)} Z`,
    ];
  }

  {
    const bTopY = headTop - 8;
    const bBotY = headTop + p.headR * 0.42;
    const bLeftX = cx - hw * 0.92;
    const bRightX = cx + hw * 0.78;
    wear.boina = [
      `M ${n(bLeftX)} ${n(bBotY)} ` +
        `Q ${n(bLeftX + 6)} ${n(bTopY)} ${n(cx - 2)} ${n(bTopY - 4)} ` +
        `Q ${n(bRightX)} ${n(bTopY)} ${n(bRightX)} ${n(bBotY - 4)} ` +
        `Q ${n(cx + hw * 0.1)} ${n(bBotY + 4)} ${n(bLeftX)} ${n(bBotY)} Z`,
      `M ${n(cx - 2)} ${n(bTopY - 4)} Q ${n(cx - 3)} ${n(bTopY - 9)} ${n(cx - 1)} ${n(bTopY - 11)}`,
    ];
  }

  {
    const cTopY = jawY + 2;
    const cBotY = p.bodyCy + p.bodyRy - 3;
    const cTopW = jawW * 0.85;
    const cBotW = p.bodyRx * 1.15;
    wear.capa = [
      `M ${n(cx - cTopW)} ${n(cTopY)} Q ${n(cx)} ${n(cTopY + 8)} ${n(cx + cTopW)} ${n(cTopY)} ` +
        `L ${n(cx + cBotW)} ${n(cBotY)} Q ${n(cx)} ${n(cBotY + 12)} ${n(cx - cBotW)} ${n(cBotY)} Z`,
      `M ${n(cx - cTopW)} ${n(cTopY)} Q ${n(cx)} ${n(cTopY + 9)} ${n(cx + cTopW)} ${n(cTopY)} ` +
        `L ${n(cx + cTopW - 3)} ${n(cTopY + 6)} Q ${n(cx)} ${n(cTopY + 14)} ${n(cx - cTopW + 3)} ${n(cTopY + 6)} Z`,
      ell(cx, cTopY + 9, 3.5, 3.5),
    ];
  }

  {
    const bMidY = jawY + 6;
    const bSpan = 14;
    wear.corbatin = [
      `M ${n(cx)} ${n(bMidY)} L ${n(cx - bSpan)} ${n(bMidY - 7)} L ${n(cx - bSpan + 2)} ${n(bMidY + 7)} Z`,
      `M ${n(cx)} ${n(bMidY)} L ${n(cx + bSpan)} ${n(bMidY - 7)} L ${n(cx + bSpan - 2)} ${n(bMidY + 7)} Z`,
      ell(cx, bMidY, 4, 3.5),
    ];
  }

  {
    const mr = Math.max(p.eyeRx, p.eyeRy) + 4.8;
    const mx = cx + p.eyeDx;
    wear.monoculo = [
      ell(mx, eyeY, mr, mr),
      `M ${n(mx + mr * 0.72)} ${n(eyeY + mr * 0.72)} ` +
        `Q ${n(mx + mr + 8)} ${n(eyeY + mr + 12)} ${n(cx + hw * 0.82)} ${n(jawY + 12)}`,
    ];
  }

  // Nuevas prendas Fase 3 redibujadas a 160×160
  {
    const bTopY = headTop - 10;
    const bBotY = headTop + p.headR * 0.44;
    const bLeftX = cx - hw * 0.95;
    const bRightX = cx + hw * 0.82;
    wear.beret_poet = [
      `M ${n(bLeftX)} ${n(bBotY)} ` +
        `Q ${n(bLeftX + 6)} ${n(bTopY)} ${n(cx - 3)} ${n(bTopY - 5)} ` +
        `Q ${n(bRightX)} ${n(bTopY)} ${n(bRightX)} ${n(bBotY - 4)} ` +
        `Q ${n(cx + hw * 0.1)} ${n(bBotY + 5)} ${n(bLeftX)} ${n(bBotY)} Z`,
      `M ${n(cx - 3)} ${n(bTopY - 5)} Q ${n(cx - 4)} ${n(bTopY - 11)} ${n(cx - 2)} ${n(bTopY - 14)}`,
    ];
  }

  {
    const brimY = headTop + p.headR * 0.32;
    const brimW = hw * 1.05;
    wear.wizard_hat = [
      `M ${n(cx - brimW)} ${n(brimY)} Q ${n(cx)} ${n(brimY + 7)} ${n(cx + brimW)} ${n(brimY)} ` +
        `Q ${n(cx)} ${n(brimY - 5)} ${n(cx - brimW)} ${n(brimY)} Z`,
      `M ${n(cx - brimW * 0.65)} ${n(brimY - 1)} ` +
        `C ${n(cx - brimW * 0.45)} ${n(headTop - 15)} ${n(cx + 8)} ${n(headTop - 38)} ${n(cx + 18)} ${n(headTop - 42)} ` +
        `C ${n(cx + 10)} ${n(headTop - 25)} ${n(cx + brimW * 0.55)} ${n(headTop - 8)} ${n(cx + brimW * 0.65)} ${n(brimY - 1)} Z`,
      ell(cx, brimY + 2, 5.5, 3.2),
    ];
  }

  {
    const crownY = headTop + p.headR * 0.55;
    const crownW = hw * 0.82;
    wear.laurel_crown = [
      `M ${n(cx - crownW)} ${n(crownY)} Q ${n(cx)} ${n(crownY + 8)} ${n(cx + crownW)} ${n(crownY)}`,
      ell(cx - crownW * 0.7, crownY - 1, 4.5, 2.5),
      ell(cx - crownW * 0.35, crownY + 2, 4.8, 2.6),
      ell(cx, crownY + 4, 5, 2.8),
      ell(cx + crownW * 0.35, crownY + 2, 4.8, 2.6),
      ell(cx + crownW * 0.7, crownY - 1, 4.5, 2.5),
    ];
  }

  {
    const hpTopY = headTop - 6;
    const hpSideW = hw * 0.95;
    const hpEarY = eyeY - 2;
    wear.headphones_cozy = [
      `M ${n(cx - hpSideW)} ${n(hpEarY)} ` +
        `Q ${n(cx - hpSideW * 0.95)} ${n(hpTopY)} ${n(cx)} ${n(hpTopY)} ` +
        `Q ${n(cx + hpSideW * 0.95)} ${n(hpTopY)} ${n(cx + hpSideW)} ${n(hpEarY)}`,
      ell(cx - hpSideW, hpEarY, 6.5, 9.5),
      ell(cx + hpSideW, hpEarY, 6.5, 9.5),
    ];
  }

  wear.scarf_amber = [
    `M ${n(cx - jawW)} ${n(jawY - 2)} Q ${n(cx)} ${n(jawY + 12)} ${n(cx + jawW)} ${n(jawY - 2)} ` +
      `L ${n(cx + jawW - 4)} ${n(jawY + 8)} Q ${n(cx)} ${n(jawY + 21)} ${n(cx - jawW + 4)} ${n(jawY + 8)} Z`,
    `M ${n(cx + jawW * 0.25)} ${n(jawY + 5)} L ${n(cx + jawW * 0.25 + 14)} ${n(jawY + 2)} ` +
      `L ${n(cx + jawW * 0.25 + 16)} ${n(jawY + 24)} L ${n(cx + jawW * 0.25 + 8)} ${n(jawY + 20)} ` +
      `L ${n(cx + jawW * 0.25 + 2)} ${n(jawY + 24)} Z`,
  ];

  {
    const cTopY = jawY + 2;
    const cBotY = p.bodyCy + p.bodyRy - 2;
    const cTopW = jawW * 0.85;
    const cBotW = p.bodyRx * 1.15;
    wear.cape_modernist = [
      `M ${n(cx - cTopW)} ${n(cTopY)} Q ${n(cx)} ${n(cTopY + 8)} ${n(cx + cTopW)} ${n(cTopY)} ` +
        `L ${n(cx + cBotW)} ${n(cBotY)} Q ${n(cx)} ${n(cBotY + 12)} ${n(cx - cBotW)} ${n(cBotY)} Z`,
      `M ${n(cx - cTopW)} ${n(cTopY)} Q ${n(cx)} ${n(cTopY + 9)} ${n(cx + cTopW)} ${n(cTopY)} ` +
        `L ${n(cx + cTopW - 3)} ${n(cTopY + 6)} Q ${n(cx)} ${n(cTopY + 14)} ${n(cx - cTopW + 3)} ${n(cTopY + 6)} Z`,
      ell(cx, cTopY + 9, 3.8, 3.8),
    ];
  }

  {
    const bMidY = jawY + 6;
    const bSpan = 15;
    wear.bowtie_scholar = [
      `M ${n(cx)} ${n(bMidY)} L ${n(cx - bSpan)} ${n(bMidY - 7.5)} L ${n(cx - bSpan + 2.5)} ${n(bMidY + 7.5)} Z`,
      `M ${n(cx)} ${n(bMidY)} L ${n(cx + bSpan)} ${n(bMidY - 7.5)} L ${n(cx + bSpan - 2.5)} ${n(bMidY + 7.5)} Z`,
      ell(cx, bMidY, 4.2, 3.8),
    ];
  }

  {
    const dTopY = jawY + 2;
    const dBotY = p.bodyCy + p.bodyRy * 0.35;
    const dTopW = jawW * 0.82;
    const dBotW = p.bodyRx * 0.98;
    wear.detective_cape = [
      `M ${n(cx - dTopW)} ${n(dTopY)} Q ${n(cx)} ${n(dTopY + 7)} ${n(cx + dTopW)} ${n(dTopY)} ` +
        `L ${n(cx + dBotW)} ${n(dBotY)} Q ${n(cx)} ${n(dBotY + 8)} ${n(cx - dBotW)} ${n(dBotY)} Z`,
      `M ${n(cx)} ${n(dTopY + 4)} L ${n(cx)} ${n(dBotY + 4)}`,
      ell(cx - 7, dTopY + 10, 2.2, 2.2),
      ell(cx + 7, dTopY + 10, 2.2, 2.2),
    ];
  }

  {
    const fr = Math.max(p.eyeRx, p.eyeRy) + 4.2;
    wear.glasses_round = [
      ell(cx - p.eyeDx, eyeY, fr, fr),
      ell(cx + p.eyeDx, eyeY, fr, fr),
      `M ${n(cx - p.eyeDx + fr)} ${n(eyeY - 1)} L ${n(cx + p.eyeDx - fr)} ${n(eyeY - 1)} ` +
        `M ${n(cx - p.eyeDx - fr)} ${n(eyeY - 1.2)} L ${n(cx - hw - 1)} ${n(eyeY - 5)} ` +
        `M ${n(cx + p.eyeDx + fr)} ${n(eyeY - 1.2)} L ${n(cx + hw + 1)} ${n(eyeY - 5)}`,
    ];
  }

  {
    const mr = Math.max(p.eyeRx, p.eyeRy) + 4.6;
    const mx = cx + p.eyeDx;
    wear.monocle_gold = [
      ell(mx, eyeY, mr, mr),
      `M ${n(mx + mr * 0.72)} ${n(eyeY + mr * 0.72)} ` +
        `Q ${n(mx + mr + 8)} ${n(eyeY + mr + 12)} ${n(cx + hw * 0.82)} ${n(jawY + 12)}`,
    ];
  }

  // ---- Prendas de plantilla (2026-10-26) ----
  // Cuatro ejemplos completos, dibujados sobre las medidas del gato, no sobre
  // números fijos: le quedan a las cinco etapas.

  // Pañuelo de lectura (cuello): banda fina sobre la mandíbula y triángulo al
  // pecho, con el nudo a la derecha.
  {
    const bandY = jawY + 2;
    wear.panuelo = [
      `M ${n(cx - jawW)} ${n(bandY - 2)} Q ${n(cx)} ${n(bandY + 8)} ${n(cx + jawW)} ${n(bandY - 2)} ` +
        `L ${n(cx + jawW - 2)} ${n(bandY + 4)} Q ${n(cx)} ${n(bandY + 14)} ${n(cx - jawW + 2)} ${n(bandY + 4)} Z`,
      `M ${n(cx - 13)} ${n(bandY + 3)} L ${n(cx + 13)} ${n(bandY + 3)} ` +
        `L ${n(cx + 1)} ${n(bandY + 26)} Q ${n(cx - 1)} ${n(bandY + 29)} ${n(cx - 3)} ${n(bandY + 26)} Z`,
      `M ${n(cx + 4)} ${n(bandY + 5)} L ${n(cx + 12)} ${n(bandY + 2)} ` +
        `L ${n(cx + 11)} ${n(bandY + 11)} L ${n(cx + 3)} ${n(bandY + 12)} Z`,
    ];
  }

  // Gafas de sol (ojos): dos lentes rellenas, puente y patillas.
  {
    const lx = p.eyeRx + 3.4;
    const ly = p.eyeRy + 2.2;
    wear.gafas_sol = [
      ell(cx - p.eyeDx, eyeY, lx, ly),
      ell(cx + p.eyeDx, eyeY, lx, ly),
      `M ${n(cx - p.eyeDx + lx)} ${n(eyeY - 1)} L ${n(cx + p.eyeDx - lx)} ${n(eyeY - 1)} ` +
        `M ${n(cx - p.eyeDx - lx)} ${n(eyeY - 2)} L ${n(cx - hw - 1)} ${n(eyeY - 6)} ` +
        `M ${n(cx + p.eyeDx + lx)} ${n(eyeY - 2)} L ${n(cx + hw + 1)} ${n(eyeY - 6)}`,
    ];
  }

  // Abrigo de invierno (cuerpo): dos faldones hasta el suelo del cuerpo, cuello
  // alto y dos botones.
  {
    const coatTop = p.bodyCy - p.bodyRy * 0.85;
    const coatBottom = p.bodyCy + p.bodyRy + 2;
    const coatOut = p.bodyRx * 1.06;
    const coatIn = p.bodyRx * 0.12;
    const collarW = jawW * 0.52;
    wear.abrigo = [
      `M ${n(cx - p.bodyRx * 0.86)} ${n(coatTop)} ` +
        `C ${n(cx - coatOut - 2)} ${n(p.bodyCy - p.bodyRy * 0.2)} ${n(cx - coatOut)} ${n(coatBottom - 4)} ` +
        `${n(cx - coatOut)} ${n(coatBottom)} ` +
        `L ${n(cx - coatIn)} ${n(coatBottom)} L ${n(cx - coatIn - 1)} ${n(coatTop + 3)} Z`,
      `M ${n(cx + p.bodyRx * 0.86)} ${n(coatTop)} ` +
        `C ${n(cx + coatOut + 2)} ${n(p.bodyCy - p.bodyRy * 0.2)} ${n(cx + coatOut)} ${n(coatBottom - 4)} ` +
        `${n(cx + coatOut)} ${n(coatBottom)} ` +
        `L ${n(cx + coatIn)} ${n(coatBottom)} L ${n(cx + coatIn + 1)} ${n(coatTop + 3)} Z`,
      `M ${n(cx - collarW)} ${n(jawY - 1)} Q ${n(cx)} ${n(jawY + 9)} ${n(cx + collarW)} ${n(jawY - 1)} ` +
        `Q ${n(cx)} ${n(jawY + 16)} ${n(cx - collarW)} ${n(jawY - 1)} Z`,
      ell(cx + p.bodyRx * 0.2, p.bodyCy - p.bodyRy * 0.1, 1.7, 1.7),
      ell(cx + p.bodyRx * 0.2, p.bodyCy + p.bodyRy * 0.45, 1.7, 1.7),
    ];
  }

  // Pluma de escribano (cabeza): pluma de ave detrás de la oreja derecha.
  {
    const fx = cx + hw * 0.58;
    const fy = headTop + 12;
    const tipX = cx + hw * 1.1;
    const tipY = Math.max(10, headTop - 16);
    wear.pluma = [
      `M ${n(fx)} ${n(fy)} ` +
        `C ${n(fx + 12)} ${n(headTop + 2)} ${n(tipX - 3)} ${n(tipY + 12)} ${n(tipX)} ${n(tipY)} ` +
        `C ${n(tipX - 18)} ${n(tipY + 10)} ${n(fx + 5)} ${n(headTop + 8)} ${n(fx - 7)} ${n(fy + 6)} Z`,
      `M ${n(fx + 1)} ${n(fy + 1)} Q ${n((fx + tipX) / 2 + 1)} ${n((fy + tipY) / 2 + 3)} ${n(tipX - 1)} ${n(tipY + 3)}`,
    ];
  }

  return {
    head,
    headShade,
    earInnerL,
    earInnerR,
    earL,
    earR,
    tuft,
    muzzle,
    nose,
    mouth,
    eyesOpen,
    eyesHalf,
    eyesClosed,
    eyesHappy,
    whiskerL,
    whiskerR,
    blushL,
    blushR,
    body,
    belly,
    chestFluff,
    paws,
    tail,
    pawUp,
    wave,
    cheerL,
    cheerR,
    book,
    marks,
    shadow,
    wear,
    propX: cx - 24,
    propY: pawY - 4,
    zAt: [
      { x: cx + hw * 0.65, y: headTop - 4 },
      { x: cx + hw * 0.92, y: headTop - 16 },
      { x: cx + hw * 1.15, y: headTop - 28 },
    ],
  };
}

export const PROPS = {
  bowl: [
    `M -14 0 Q 0 8 14 0 L 11 12 Q 0 17 -11 12 Z`,
    `M -10 2 Q 0 6 10 2 Q 0 -1 -10 2 Z`,
  ],
  ball: [
    ell(0, 0, 9.5, 9.5),
    `M -9.5 0 Q 0 5 9.5 0 Q 0 -5 -9.5 0 Z`,
  ],
  tea: {
    saucer: `M -13 8 Q 0 10.5 13 8 L 10.5 11 Q 0 12.5 -10.5 11 Z`,
    cup: `M -9.5 0 L 9.5 0 L 7.5 7.5 Q 0 9 -7.5 7.5 Z`,
    liquid: `M -7.8 0.6 Q 0 1.9 7.8 0.6 Q 0 -0.6 -7.8 0.6 Z`,
    handle: `M 8 1.2 Q 13 1.2 12.2 4.5 Q 11.5 7.2 7 6.7`,
    steam: [
      `M -2.8 -3 Q -5.8 -7.5 -2.8 -11.5 Q 0 -15.5 -2 -19.5`,
      `M 2.8 -3.5 Q 5.8 -8 2.8 -12.5 Q 0.3 -16.5 2.2 -21`,
    ],
  },
  candle: {
    dish: `M -11 7 Q 0 9.5 11 7 L 8.8 9.5 Q 0 11 -8.8 9.5 Z`,
    handle: `M 8.8 5.5 Q 13.5 4 12 8.8 Q 10.5 9.5 8 8.3`,
    wax: `M -5 -1.5 L 5 -1.5 L 5 7.5 L -5 7.5 Z`,
    wick: `M 0 -1.5 L 0 -4.5`,
    flame: `M 0 -4.8 C -2.5 -7.4 -1.9 -10.6 0 -13.5 C 1.9 -10.6 2.5 -7.4 0 -4.8 Z`,
  },
  spark:
    `M 0 -7 L 1.9 -1.9 L 7 0 L 1.9 1.9 L 0 7 ` +
    `L -1.9 1.9 L -7 0 L -1.9 -1.9 Z`,
  sparkAt: [
    { x: 32, y: 22 },
    { x: 128, y: 19 },
    { x: 26, y: 74 },
    { x: 134, y: 70 },
  ],
};

// Las 5 etapas adaptadas con proporciones naturales
const S0 = makeStage({
  headW: 98,
  headR: 40,
  headCy: 66,
  earW: 15,
  earH: 18,
  eyeRx: 9.8,
  eyeRy: 11.2,
  eyeDx: 18,
  eyeDy: 3,
  muzzleW: 42,
  muzzleH: 18,
  muzzleDy: 20,
  noseDy: 18,
  whiskers: false,
  blush: true,
  bodyRx: 21,
  bodyRy: 14,
  bodyCy: 130,
  belly: false,
  feet: false,
  pawUp: false,
  book: false,
  tailD: "M 96 134 Q 112 127 109 113",
  tailW: 7,
  tuft: false,
});

const S1 = makeStage({
  headW: 82,
  headR: 34,
  headCy: 58,
  earW: 14,
  earH: 22,
  eyeRx: 8.5,
  eyeRy: 9.8,
  eyeDx: 15,
  eyeDy: 2,
  muzzleW: 34,
  muzzleH: 15,
  muzzleDy: 17,
  noseDy: 15,
  whiskers: true,
  blush: true,
  bodyRx: 26,
  bodyRy: 21,
  bodyCy: 118,
  belly: true,
  feet: false,
  pawUp: false,
  book: false,
  tailD: "M 101 132 Q 122 124 119 100",
  tailW: 8.2,
  tuft: true,
});

const S2 = makeStage({
  headW: 75,
  headR: 31,
  headCy: 52,
  earW: 12.5,
  earH: 20.5,
  eyeRx: 7.7,
  eyeRy: 9.2,
  eyeDx: 13.8,
  eyeDy: 1.8,
  muzzleW: 31,
  muzzleH: 14,
  muzzleDy: 16.5,
  noseDy: 14,
  whiskers: true,
  blush: true,
  bodyRx: 28,
  bodyRy: 28,
  bodyCy: 112,
  belly: true,
  feet: false,
  pawUp: true,
  book: false,
  tailD: "M 104 130 Q 127 121 122 94",
  tailW: 8.8,
  tuft: true,
});

const S3 = makeStage({
  headW: 72,
  headR: 30,
  headCy: 46,
  earW: 11.8,
  earH: 19,
  eyeRx: 7.2,
  eyeRy: 8.7,
  eyeDx: 13,
  eyeDy: 1.6,
  muzzleW: 29,
  muzzleH: 13,
  muzzleDy: 15.5,
  noseDy: 13,
  whiskers: true,
  blush: false,
  bodyRx: 31,
  bodyRy: 33,
  bodyCy: 108,
  belly: true,
  feet: true,
  pawUp: false,
  book: false,
  tailD: "M 108 126 Q 132 122 126 94 Q 124 81 116 75",
  tailW: 9.8,
  tuft: true,
});

const S4 = makeStage({
  headW: 72,
  headR: 30,
  headCy: 43,
  earW: 11.8,
  earH: 19,
  eyeRx: 7.2,
  eyeRy: 8.7,
  eyeDx: 13,
  eyeDy: 1.6,
  muzzleW: 29,
  muzzleH: 13,
  muzzleDy: 15.5,
  noseDy: 13,
  whiskers: true,
  blush: false,
  bodyRx: 31,
  bodyRy: 33,
  bodyCy: 103,
  belly: true,
  feet: true,
  pawUp: false,
  book: true,
  tailD: "M 108 124 Q 132 120 126 92 Q 124 79 116 73",
  tailW: 9.8,
  tuft: true,
});

export const STAGES: readonly StageArt[] = [S0, S1, S2, S3, S4];
