// Geometría del gato de Lecta: cinco etapas de caricatura suave —
// formas redondas, ojos grandes con brillo y mejillas rosadas sobre
// la paleta --cat-* del tema. Companion.tsx dibuja estas rutas.
//
// A diferencia de una ilustración fija, cada etapa se genera por
// parámetros (tamaño de cabeza, ojos, orejas, cuerpo): la proporción
// del bebé cabezón al adulto sentado cambia de verdad y las anclas
// de ropa/expresiones se derivan de esas mismas medidas, así que una
// prenda o una sonrisa siempre caen donde deben.

export const CAT_BOX = 96;

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
  paws: string[];
  tail: Stroke;
  pawUp?: Stroke;
  wave: Stroke;
  cheerL: Stroke;
  cheerR: Stroke;
  book?: string[];
  // Rayas del pelaje atigrado: trazos que solo se dibujan cuando el
  // artículo «pelaje-atigrado» está puesto (ranura equipped.coat).
  marks: string[];
  shadow: { cx: number; cy: number; rx: number; ry: number };
  // Ropa por ranura; las anclas se derivan de la etapa.
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
  };
  // Ancla de platito/pelota (punto superior izquierdo del atrejo).
  propX: number;
  propY: number;
  zAt: { x: number; y: number }[];
}

// ---------- Plegables de dibujo ----------

const cx = 48;

// Elipse como path (los sub-sprites se componen igual que el resto).
const ell = (x: number, y: number, rx: number, ry: number): string =>
  `M ${x - rx} ${y} A ${rx} ${ry} 0 1 0 ${x + rx} ${y} ` +
  `A ${rx} ${ry} 0 1 0 ${x - rx} ${y} Z`;

const n = (v: number) => Math.round(v * 10) / 10;

// Oreja redondeada: base de ancho `ew` apoyada en la línea de la
// cabeza, punta suavizada a `eh` de altura.
const ear = (bx: number, baseY: number, ew: number, eh: number): string =>
  `M ${n(bx - ew)} ${n(baseY)} ` +
  `Q ${n(bx - ew * 0.7)} ${n(baseY - eh * 0.62)} ${n(bx)} ${n(baseY - eh)} ` +
  `Q ${n(bx + ew * 0.7)} ${n(baseY - eh * 0.62)} ${n(bx + ew)} ${n(baseY)} Z`;

// Interior de la oreja: el mismo triángulo achicado y bajado.
const earInner = (
  bx: number,
  baseY: number,
  ew: number,
  eh: number,
): string => {
  const s = 0.55;
  const iy = baseY - eh * 0.12;
  return ear(bx, iy, ew * s, eh * s);
};

// Parámetros que definen cada edad: las proporciones, no solo el
// tamaño, separan al bebé del adulto.
interface CatParams {
  headW: number; // ancho de la cabeza
  headR: number; // alto medio (radio vertical)
  headCy: number;
  earW: number;
  earH: number;
  eyeRx: number;
  eyeRy: number;
  eyeDx: number; // distancia del ojo al eje
  eyeDy: number; // altura del ojo respecto a headCy
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

// Boca de gatito «ω»: dos arcos desde la nariz hacia los lados.
const catMouth = (mx: number, my: number, w: number): string =>
  `M ${n(mx - w)} ${n(my)} Q ${n(mx - w * 0.45)} ${n(my + 2.2)} ${n(mx)} ${n(my + 0.7)} ` +
  `Q ${n(mx + w * 0.45)} ${n(my + 2.2)} ${n(mx + w)} ${n(my)}`;

function makeStage(p: CatParams): StageArt {
  const headTop = p.headCy - p.headR;
  const headBottom = p.headCy + p.headR;
  const eyeY = p.headCy + p.eyeDy;
  const muzzleY = p.headCy + p.muzzleDy;
  const noseY = p.headCy + p.noseDy;
  const mouthY = noseY + 3.4;

  // Cabeza: óvalo ancho con las mejillas apenas más abiertas que la
  // frente — la forma amable del cartoon, no un círculo perfecto.
  const hw = p.headW / 2;
  const head =
    `M ${n(cx - hw)} ${n(p.headCy - p.headR * 0.15)} ` +
    `C ${n(cx - hw - 1)} ${n(p.headCy + p.headR * 0.35)} ${n(cx - hw * 0.72)} ${n(headBottom)} ${n(cx)} ${n(headBottom)} ` +
    `C ${n(cx + hw * 0.72)} ${n(headBottom)} ${n(cx + hw + 1)} ${n(p.headCy + p.headR * 0.35)} ${n(cx + hw)} ${n(p.headCy - p.headR * 0.15)} ` +
    `C ${n(cx + hw)} ${n(headTop + 4)} ${n(cx + hw * 0.6)} ${n(headTop)} ${n(cx)} ${n(headTop)} ` +
    `C ${n(cx - hw * 0.6)} ${n(headTop)} ${n(cx - hw)} ${n(headTop + 4)} ${n(cx - hw)} ${n(p.headCy - p.headR * 0.15)} Z`;

  // Orejas apoyadas sobre la línea superior de la cabeza.
  const earBaseY = headTop + p.headR * 0.3;
  const earSpread = hw * 0.62;
  const earL = ear(cx - earSpread, earBaseY, p.earW, p.earH);
  const earR = ear(cx + earSpread, earBaseY, p.earW, p.earH);

  // Sombra suave del lado derecho de la cara: media luna tenue.
  const headShade =
    `M ${n(cx + hw * 0.38)} ${n(headTop + 2)} ` +
    `Q ${n(cx + hw * 0.98)} ${n(p.headCy - 2)} ${n(cx + hw * 0.92)} ${n(headBottom - 4)} ` +
    `Q ${n(cx + hw * 0.66)} ${n(headBottom - 1)} ${n(cx + hw * 0.4)} ${n(headBottom - 3)} ` +
    `Q ${n(cx + hw * 0.6)} ${n(p.headCy)} ${n(cx + hw * 0.38)} ${n(headTop + 2)} Z`;

  // Mechón de la frente: dos trazos cortos de sombra (gatito atigrado
  // sutil — sin él la cara queda demasiado vacía en etapas grandes).
  const tuft = p.tuft
    ? `M ${n(cx - 3.5)} ${n(headTop + 1)} Q ${n(cx - 2.5)} ${n(headTop + 5)} ${n(cx - 3)} ${n(headTop + 8)} ` +
      `M ${n(cx + 3.5)} ${n(headTop + 1)} Q ${n(cx + 2.5)} ${n(headTop + 5)} ${n(cx + 3)} ${n(headTop + 8)}`
    : undefined;

  // Hocico claro: dos óvalos unidos (mejillas del focinho).
  const mw = p.muzzleW / 2;
  const muzzle =
    `${ell(cx - mw * 0.42, muzzleY, mw * 0.62, p.muzzleH / 2)} ` +
    `${ell(cx + mw * 0.42, muzzleY, mw * 0.62, p.muzzleH / 2)}`;

  // Nariz: corazón chiquito.
  const nose =
    `M ${n(cx - 2.4)} ${n(noseY)} Q ${n(cx)} ${n(noseY - 1.4)} ${n(cx + 2.4)} ${n(noseY)} ` +
    `Q ${n(cx + 1.8)} ${n(noseY + 2.4)} ${n(cx)} ${n(noseY + 3)} ` +
    `Q ${n(cx - 1.8)} ${n(noseY + 2.4)} ${n(cx - 2.4)} ${n(noseY)} Z`;

  const mouth = {
    cat: catMouth(cx, mouthY, 4.2),
    open:
      `M ${n(cx - 2.2)} ${n(mouthY)} Q ${n(cx)} ${n(mouthY + 1)} ${n(cx + 2.2)} ${n(mouthY)} ` +
      `Q ${n(cx + 1.6)} ${n(mouthY + 3.4)} ${n(cx)} ${n(mouthY + 3.6)} ` +
      `Q ${n(cx - 1.6)} ${n(mouthY + 3.4)} ${n(cx - 2.2)} ${n(mouthY)} Z`,
    smile:
      `M ${n(cx - 4)} ${n(mouthY - 0.4)} Q ${n(cx)} ${n(mouthY + 1.2)} ${n(cx + 4)} ${n(mouthY - 0.4)} ` +
      `Q ${n(cx + 3)} ${n(mouthY + 4.6)} ${n(cx)} ${n(mouthY + 4.8)} ` +
      `Q ${n(cx - 3)} ${n(mouthY + 4.6)} ${n(cx - 4)} ${n(mouthY - 0.4)} Z`,
    yawn:
      `M ${n(cx - 3)} ${n(mouthY - 0.6)} Q ${n(cx)} ${n(mouthY + 0.6)} ${n(cx + 3)} ${n(mouthY - 0.6)} ` +
      `Q ${n(cx + 2.6)} ${n(mouthY + 5.4)} ${n(cx)} ${n(mouthY + 5.8)} ` +
      `Q ${n(cx - 2.6)} ${n(mouthY + 5.4)} ${n(cx - 3)} ${n(mouthY - 0.6)} Z`,
    tongue:
      `M ${n(cx - 2.4)} ${n(mouthY)} Q ${n(cx)} ${n(mouthY + 0.8)} ${n(cx + 2.4)} ${n(mouthY)} ` +
      `M ${n(cx - 1.8)} ${n(mouthY + 2.4)} Q ${n(cx)} ${n(mouthY + 4.6)} ${n(cx + 1.8)} ${n(mouthY + 2.4)}`,
    tongueFill:
      `M ${n(cx - 1.8)} ${n(mouthY + 2)} Q ${n(cx)} ${n(mouthY + 2.6)} ${n(cx + 1.8)} ${n(mouthY + 2)} ` +
      `L ${n(cx + 1.4)} ${n(mouthY + 4.8)} Q ${n(cx)} ${n(mouthY + 6)} ${n(cx - 1.4)} ${n(mouthY + 4.8)} Z`,
    munch: `M ${n(cx - 2.4)} ${n(mouthY + 1)} Q ${n(cx)} ${n(mouthY + 2.6)} ${n(cx + 2.4)} ${n(mouthY + 1)}`,
  };

  // Ojos: óvalos oscuros con brillo (el componente añade los glints).
  const eyesOpen: [EyeGeom, EyeGeom] = [
    { cx: cx - p.eyeDx, cy: eyeY, rx: p.eyeRx, ry: p.eyeRy },
    { cx: cx + p.eyeDx, cy: eyeY, rx: p.eyeRx, ry: p.eyeRy },
  ];
  // Párpado a medio cerrar: casquete de pelaje sobre el ojo.
  const lidFor = (e: EyeGeom) =>
    `M ${n(e.cx - e.rx - 0.6)} ${n(e.cy - e.ry - 1)} ` +
    `Q ${n(e.cx)} ${n(e.cy - e.ry - 2)} ${n(e.cx + e.rx + 0.6)} ${n(e.cy - e.ry - 1)} ` +
    `L ${n(e.cx + e.rx + 0.6)} ${n(e.cy - e.ry * 0.1)} ` +
    `Q ${n(e.cx)} ${n(e.cy - e.ry * 0.75)} ${n(e.cx - e.rx - 0.6)} ${n(e.cy - e.ry * 0.1)} Z`;
  const eyesHalf: [string, string] = [
    lidFor(eyesOpen[0]),
    lidFor(eyesOpen[1]),
  ];
  // Cerrados: arco bajo (sueño); felices: arco alto (^ ^).
  const closedFor = (e: EyeGeom) =>
    `M ${n(e.cx - e.rx)} ${n(e.cy)} Q ${n(e.cx)} ${n(e.cy + e.ry * 0.8)} ${n(e.cx + e.rx)} ${n(e.cy)}`;
  const happyFor = (e: EyeGeom) =>
    `M ${n(e.cx - e.rx)} ${n(e.cy + 1)} Q ${n(e.cx)} ${n(e.cy - e.ry * 0.85)} ${n(e.cx + e.rx)} ${n(e.cy + 1)}`;
  const eyesClosed: [string, string] = [
    closedFor(eyesOpen[0]),
    closedFor(eyesOpen[1]),
  ];
  const eyesHappy: [string, string] = [
    happyFor(eyesOpen[0]),
    happyFor(eyesOpen[1]),
  ];

  // Bigotes: dos trazos finos por lado desde la mejilla.
  const whiskerL = p.whiskers
    ? `M ${n(cx - hw * 0.66)} ${n(muzzleY - 1)} Q ${n(cx - hw - 5)} ${n(muzzleY - 3)} ${n(cx - hw - 9)} ${n(muzzleY - 5)} ` +
      `M ${n(cx - hw * 0.66)} ${n(muzzleY + 2.5)} Q ${n(cx - hw - 5)} ${n(muzzleY + 4)} ${n(cx - hw - 9)} ${n(muzzleY + 6)}`
    : "";
  const whiskerR = p.whiskers
    ? `M ${n(cx + hw * 0.66)} ${n(muzzleY - 1)} Q ${n(cx + hw + 5)} ${n(muzzleY - 3)} ${n(cx + hw + 9)} ${n(muzzleY - 5)} ` +
      `M ${n(cx + hw * 0.66)} ${n(muzzleY + 2.5)} Q ${n(cx + hw + 5)} ${n(muzzleY + 4)} ${n(cx + hw + 9)} ${n(muzzleY + 6)}`
    : "";

  const blushRx = p.blush ? p.eyeRx * 0.62 : 0;
  const blushY = muzzleY - p.muzzleH * 0.1;
  const blushL = {
    cx: cx - hw * 0.62,
    cy: blushY,
    rx: blushRx,
    ry: blushRx * 0.62,
  };
  const blushR = {
    cx: cx + hw * 0.62,
    cy: blushY,
    rx: blushRx,
    ry: blushRx * 0.62,
  };

  // Cuerpo: óvalo un poco más ancho abajo (sentado).
  const body = ell(cx, p.bodyCy, p.bodyRx, p.bodyRy);
  const belly = p.belly
    ? ell(cx, p.bodyCy + p.bodyRy * 0.3, p.bodyRx * 0.52, p.bodyRy * 0.58)
    : undefined;

  // Patas delanteras: dos óvalos asomando al pie del cuerpo; traseras
  // más gordas a los lados en las etapas sentadas.
  const paws: string[] = [];
  const pawGap = p.bodyRx * 0.38;
  const pawY = p.bodyCy + p.bodyRy - 2.5;
  const pawR = Math.min(4.6, p.bodyRx * 0.3);
  paws.push(ell(cx - pawGap, pawY, pawR, pawR * 0.8));
  paws.push(ell(cx + pawGap, pawY, pawR, pawR * 0.8));
  if (p.feet) {
    paws.push(ell(cx - p.bodyRx * 0.8, pawY + 0.5, pawR + 0.6, pawR * 0.7));
    paws.push(ell(cx + p.bodyRx * 0.8, pawY + 0.5, pawR + 0.6, pawR * 0.7));
  }

  const tail: Stroke = { d: p.tailD, w: p.tailW };
  const pawUp: Stroke | undefined = p.pawUp
    ? { d: `M ${n(cx + pawGap)} ${n(pawY - 1)} L ${n(cx + pawGap + 4)} ${n(pawY - 9)}`, w: pawR * 2.1 }
    : undefined;
  // Saludo y fiesta: patitas que nacen detrás de la mandíbula — la
  // cabeza se dibuja encima y las deja asomar junto a las orejas
  // como nubecitos gordos. Cortas: el «¡yay!» del cartoon, nunca
  // un brazo largo desde el pecho.
  const pawBaseY = headBottom - 8;
  const pawBaseX = hw * 0.55;
  const pawCtrlY = p.headCy + p.headR * 0.55;
  const cheerTipX = hw + 4;
  const cheerTipY = earBaseY + p.earH * 0.1;
  const wave: Stroke = {
    d: `M ${n(cx + pawBaseX)} ${n(pawBaseY)} Q ${n(cx + hw + 5)} ${n(p.headCy + p.headR * 0.4)} ${n(cx + hw + 6.5)} ${n(earBaseY - p.earH * 0.75)}`,
    w: pawR * 2.35,
  };
  const cheerL: Stroke = {
    d: `M ${n(cx - pawBaseX)} ${n(pawBaseY)} Q ${n(cx - hw - 2)} ${n(pawCtrlY)} ${n(cx - cheerTipX)} ${n(cheerTipY)}`,
    w: pawR * 2.2,
  };
  const cheerR: Stroke = {
    d: `M ${n(cx + pawBaseX)} ${n(pawBaseY)} Q ${n(cx + hw + 2)} ${n(pawCtrlY)} ${n(cx + cheerTipX)} ${n(cheerTipY)}`,
    w: pawR * 2.2,
  };

  // Libro abierto del bibliotecario frente a las patas — grande
  // para que se lea como libro, no como mancha.
  const book = p.book
    ? [
        // Portada roja asomando.
        `M ${n(cx - 14)} ${n(pawY - 6)} L ${n(cx)} ${n(pawY - 9)} L ${n(cx + 14)} ${n(pawY - 6)} L ${n(cx + 14)} ${n(pawY + 3)} L ${n(cx)} ${n(pawY)} L ${n(cx - 14)} ${n(pawY + 3)} Z`,
        // Páginas claras.
        `M ${n(cx - 13)} ${n(pawY - 6.8)} L ${n(cx)} ${n(pawY - 9.8)} L ${n(cx + 13)} ${n(pawY - 6.8)} L ${n(cx + 13)} ${n(pawY + 1.8)} L ${n(cx)} ${n(pawY - 1.2)} L ${n(cx - 13)} ${n(pawY + 1.8)} Z`,
        // Lomo y renglones.
        `M ${n(cx)} ${n(pawY - 9.8)} L ${n(cx)} ${n(pawY - 1.2)} ` +
          `M ${n(cx - 9.5)} ${n(pawY - 4.6)} L ${n(cx - 3.5)} ${n(pawY - 6.4)} ` +
          `M ${n(cx - 9.5)} ${n(pawY - 2.2)} L ${n(cx - 3.5)} ${n(pawY - 4)} ` +
          `M ${n(cx + 3.5)} ${n(pawY - 6.4)} L ${n(cx + 9.5)} ${n(pawY - 4.6)} ` +
          `M ${n(cx + 3.5)} ${n(pawY - 4)} L ${n(cx + 9.5)} ${n(pawY - 2.2)}`,
      ]
    : undefined;

  // Rayas atigradas: dos medias lunas en la frente, dos arcos a cada
  // lado del lomo siguiendo la elipse y un anillo en la cola —
  // siempre dentro de la silueta para que lean como pelaje.
  const marks: string[] = [
    `M ${n(cx - p.eyeDx - 1)} ${n(headTop + p.headR * 0.16)} Q ${n(cx - p.eyeDx - 0.4)} ${n(headTop + p.headR * 0.36)} ${n(cx - p.eyeDx - 1.6)} ${n(headTop + p.headR * 0.52)}`,
    `M ${n(cx + p.eyeDx + 1)} ${n(headTop + p.headR * 0.16)} Q ${n(cx + p.eyeDx + 0.4)} ${n(headTop + p.headR * 0.36)} ${n(cx + p.eyeDx + 1.6)} ${n(headTop + p.headR * 0.52)}`,
    `M ${n(cx - p.bodyRx * 0.72)} ${n(p.bodyCy - p.bodyRy * 0.32)} Q ${n(cx - p.bodyRx * 0.45)} ${n(p.bodyCy - p.bodyRy * 0.14)} ${n(cx - p.bodyRx * 0.6)} ${n(p.bodyCy + p.bodyRy * 0.16)}`,
    `M ${n(cx - p.bodyRx * 0.78)} ${n(p.bodyCy + p.bodyRy * 0.26)} Q ${n(cx - p.bodyRx * 0.52)} ${n(p.bodyCy + p.bodyRy * 0.4)} ${n(cx - p.bodyRx * 0.58)} ${n(p.bodyCy + p.bodyRy * 0.6)}`,
    `M ${n(cx + p.bodyRx * 0.72)} ${n(p.bodyCy - p.bodyRy * 0.32)} Q ${n(cx + p.bodyRx * 0.45)} ${n(p.bodyCy - p.bodyRy * 0.14)} ${n(cx + p.bodyRx * 0.6)} ${n(p.bodyCy + p.bodyRy * 0.16)}`,
    `M ${n(cx + p.bodyRx * 0.78)} ${n(p.bodyCy + p.bodyRy * 0.26)} Q ${n(cx + p.bodyRx * 0.52)} ${n(p.bodyCy + p.bodyRy * 0.4)} ${n(cx + p.bodyRx * 0.58)} ${n(p.bodyCy + p.bodyRy * 0.6)}`,
  ];
  // Anillo en la cola: banda perpendicular a 0.6 del último tramo
  // curvo (la cola siempre es «M x y (Q cx cy ex ey)+»).
  const tailNums = (p.tailD.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (tailNums.length >= 6) {
    const px = tailNums[tailNums.length - 6];
    const py = tailNums[tailNums.length - 5];
    const qx = tailNums[tailNums.length - 4];
    const qy = tailNums[tailNums.length - 3];
    const ex = tailNums[tailNums.length - 2];
    const ey = tailNums[tailNums.length - 1];
    const t = 0.62;
    const bx = (1 - t) ** 2 * px + 2 * (1 - t) * t * qx + t * t * ex;
    const by = (1 - t) ** 2 * py + 2 * (1 - t) * t * qy + t * t * ey;
    const tx = 2 * (1 - t) * (qx - px) + 2 * t * (ex - qx);
    const ty = 2 * (1 - t) * (qy - py) + 2 * t * (ey - qy);
    const tl = Math.hypot(tx, ty) || 1;
    const hl = p.tailW * 0.8 + 0.8;
    marks.push(
      `M ${n(bx + (ty / tl) * hl)} ${n(by - (tx / tl) * hl)} ` +
        `L ${n(bx - (ty / tl) * hl)} ${n(by + (tx / tl) * hl)}`,
    );
  }

  const shadow = {
    cx,
    cy: 90.5,
    rx: p.bodyRx + 7,
    ry: 2.6,
  };

  // ---- Ropa ----
  // Las prendas se anclan a curvas del propio cuerpo: el rulo de la
  // bufanda y el collar abrazan la mandíbula (se dibujan sobre la
  // cabeza, así «visten» al gato) y el chaleco sigue la elipse del
  // torso. Nada flota: cada pieza toca pelaje por los cuatro lados.
  const wear: StageArt["wear"] = {};

  const jawY = headBottom - 3;
  const jawW = hw * 0.7;

  // Bufanda: rulo grueso que abraza bajo la barbilla + cola cayendo
  // sobre el pecho con muesca en la punta.
  wear.bufanda = [
    // Rulo.
    `M ${n(cx - jawW)} ${n(jawY - 1)} Q ${n(cx)} ${n(jawY + 7)} ${n(cx + jawW)} ${n(jawY - 1)} ` +
      `L ${n(cx + jawW - 2.5)} ${n(jawY + 4)} Q ${n(cx)} ${n(jawY + 12)} ${n(cx - jawW + 2.5)} ${n(jawY + 4)} Z`,
    // Cola colgante con punta en V.
    `M ${n(cx + jawW * 0.3)} ${n(jawY + 3)} L ${n(cx + jawW * 0.3 + 8)} ${n(jawY + 1)} ` +
      `L ${n(cx + jawW * 0.3 + 9)} ${n(jawY + 13)} L ${n(cx + jawW * 0.3 + 5)} ${n(jawY + 10.6)} ` +
      `L ${n(cx + jawW * 0.3 + 1)} ${n(jawY + 13)} Z`,
  ];
  // Collar: tira fina pegada al mentón + cascabel al frente.
  wear.collar = [
    `M ${n(cx - jawW * 0.78)} ${n(jawY + 0.5)} Q ${n(cx)} ${n(jawY + 5.5)} ${n(cx + jawW * 0.78)} ${n(jawY + 0.5)} ` +
      `L ${n(cx + jawW * 0.78)} ${n(jawY + 2.8)} Q ${n(cx)} ${n(jawY + 8)} ${n(cx - jawW * 0.78)} ${n(jawY + 2.8)} Z`,
    ell(cx, jawY + 5.8, 2.1, 2.1),
  ];
  // Moño prendido en la oreja derecha: dos alas + nudo, anclado a
  // media oreja para que se lea prendido y no flotando encima.
  {
    const bx = cx + earSpread + p.earW * 0.35;
    const by = earBaseY - p.earH * 0.55;
    wear.moño = [
      `M ${n(bx)} ${n(by)} L ${n(bx - 5.6)} ${n(by - 4)} L ${n(bx - 5.2)} ${n(by + 3.6)} Z`,
      `M ${n(bx)} ${n(by)} L ${n(bx + 5.6)} ${n(by - 4)} L ${n(bx + 5.2)} ${n(by + 3.6)} Z`,
      ell(bx, by, 1.9, 1.7),
    ];
  }
  // Anteojos: marcos redondos sobre los ojos + puente y patillas.
  {
    const fr = Math.max(p.eyeRx, p.eyeRy) + 2.6;
    wear.anteojos = [
      ell(cx - p.eyeDx, eyeY, fr, fr),
      ell(cx + p.eyeDx, eyeY, fr, fr),
      `M ${n(cx - p.eyeDx + fr)} ${n(eyeY - 0.6)} L ${n(cx + p.eyeDx - fr)} ${n(eyeY - 0.6)} ` +
        `M ${n(cx - p.eyeDx - fr)} ${n(eyeY - 0.8)} L ${n(cx - hw - 0.6)} ${n(eyeY - 4)} ` +
        `M ${n(cx + p.eyeDx + fr)} ${n(eyeY - 0.8)} L ${n(cx + hw + 0.6)} ${n(eyeY - 4)}`,
    ];
  }
  // Chaleco: dos paneles curvos que abrazan los costados del torso,
  // abiertos al frente dejando la panza — borde exterior sobre la
  // silueta del cuerpo, borde interior casi recto.
  {
    const vTopY = p.bodyCy - p.bodyRy * 0.62;
    const vBotY = p.bodyCy + p.bodyRy - 3;
    const vOutX = p.bodyRx - 0.5;
    const vInX = Math.max(4.5, p.bodyRx * 0.32);
    wear.chaleco = [
      `M ${n(cx - vInX)} ${n(vTopY - 2)} ` +
        `Q ${n(cx - vOutX - 1.5)} ${n(vTopY)} ${n(cx - vOutX)} ${n(p.bodyCy)} ` +
        `Q ${n(cx - vOutX)} ${n(vBotY - 1)} ${n(cx - vInX * 1.4)} ${n(vBotY)} ` +
        `L ${n(cx - vInX)} ${n(vBotY - 4)} ` +
        `Q ${n(cx - vInX - 1.5)} ${n(p.bodyCy)} ${n(cx - vInX)} ${n(vTopY + 3)} Z`,
      `M ${n(cx + vInX)} ${n(vTopY - 2)} ` +
        `Q ${n(cx + vOutX + 1.5)} ${n(vTopY)} ${n(cx + vOutX)} ${n(p.bodyCy)} ` +
        `Q ${n(cx + vOutX)} ${n(vBotY - 1)} ${n(cx + vInX * 1.4)} ${n(vBotY)} ` +
        `L ${n(cx + vInX)} ${n(vBotY - 4)} ` +
        `Q ${n(cx + vInX + 1.5)} ${n(p.bodyCy)} ${n(cx + vInX)} ${n(vTopY + 3)} Z`,
    ];
  }
  // Corbatín: cinta fina bajo el mentón + lazo con alas y nudo central.
  {
    const bowY = jawY + 3.8;
    wear.corbatin = [
      `M ${n(cx - jawW * 0.72)} ${n(jawY + 0.5)} Q ${n(cx)} ${n(jawY + 5)} ${n(cx + jawW * 0.72)} ${n(jawY + 0.5)} ` +
        `L ${n(cx + jawW * 0.72)} ${n(jawY + 2.4)} Q ${n(cx)} ${n(jawY + 6.8)} ${n(cx - jawW * 0.72)} ${n(jawY + 2.4)} Z`,
      `M ${n(cx)} ${n(bowY)} L ${n(cx - 5.4)} ${n(bowY - 3)} L ${n(cx - 5)} ${n(bowY + 3)} Z`,
      `M ${n(cx)} ${n(bowY)} L ${n(cx + 5.4)} ${n(bowY - 3)} L ${n(cx + 5)} ${n(bowY + 3)} Z`,
      ell(cx, bowY, 1.8, 1.6),
    ];
  }
  // Boina: gorra francesa inclinada sobre la coronilla + rabito de fieltro.
  {
    const bx = cx - hw * 0.08;
    const by = headTop + p.headR * 0.22;
    const bw = hw * 0.68;
    const bh = p.headR * 0.36;
    wear.boina = [
      `M ${n(bx - bw)} ${n(by + 1)} ` +
        `C ${n(bx - bw * 0.9)} ${n(by - bh * 1.5)} ${n(bx + bw * 0.7)} ${n(by - bh * 1.8)} ${n(bx + bw)} ${n(by - bh * 0.4)} ` +
        `C ${n(bx + bw * 1.05)} ${n(by + bh * 0.6)} ${n(bx + bw * 0.4)} ${n(by + bh * 0.9)} ${n(bx)} ${n(by + bh * 0.7)} ` +
        `C ${n(bx - bw * 0.6)} ${n(by + bh * 0.6)} ${n(bx - bw * 1.02)} ${n(by + bh * 0.4)} ${n(bx - bw)} ${n(by + 1)} Z`,
      `M ${n(bx + 1)} ${n(by - bh * 1.25)} Q ${n(bx + 2)} ${n(by - bh * 1.6)} ${n(bx + 4.5)} ${n(by - bh * 1.55)}`,
    ];
  }
  // Monóculo: aro dorado sobre el ojo derecho + cadena descendente.
  {
    const fr = Math.max(p.eyeRx, p.eyeRy) + 2.4;
    const mEyeX = cx + p.eyeDx;
    wear.monoculo = [
      ell(mEyeX, eyeY, fr, fr),
      `M ${n(mEyeX + fr * 0.7)} ${n(eyeY + fr * 0.7)} ` +
        `Q ${n(mEyeX + fr + 3.5)} ${n(eyeY + fr + 5.5)} ${n(cx + hw * 0.5)} ${n(jawY + 1.5)}`,
    ];
  }
  // Capa de terciopelo: dos alas sobre los hombros + broche dorado central.
  {
    const cTopY = jawY + 2;
    const cBotY = p.bodyCy + p.bodyRy - 2;
    const cOutX = p.bodyRx + 2.2;
    const cInX = Math.max(5, p.bodyRx * 0.38);
    wear.capa = [
      `M ${n(cx - jawW * 0.55)} ${n(cTopY)} ` +
        `Q ${n(cx - cOutX - 2)} ${n(p.bodyCy)} ${n(cx - cOutX)} ${n(cBotY)} ` +
        `L ${n(cx - cInX)} ${n(cBotY)} ` +
        `Q ${n(cx - cInX - 2)} ${n(p.bodyCy)} ${n(cx - 2.5)} ${n(cTopY + 3.5)} Z`,
      `M ${n(cx + jawW * 0.55)} ${n(cTopY)} ` +
        `Q ${n(cx + cOutX + 2)} ${n(p.bodyCy)} ${n(cx + cOutX)} ${n(cBotY)} ` +
        `L ${n(cx + cInX)} ${n(cBotY)} ` +
        `Q ${n(cx + cInX + 2)} ${n(p.bodyCy)} ${n(cx + 2.5)} ${n(cTopY + 3.5)} Z`,
      ell(cx, cTopY + 3.5, 2.3, 2.3),
    ];
  }
  // Boina de Poeta (head)
  {
    const bpx = cx - hw * 0.12;
    const bpy = headTop + p.headR * 0.2;
    const bpw = hw * 0.72;
    const bph = p.headR * 0.38;
    wear.beret_poet = [
      `M ${n(bpx - bpw)} ${n(bpy + 2)} ` +
        `C ${n(bpx - bpw * 0.95)} ${n(bpy - bph * 1.6)} ${n(bpx + bpw * 0.65)} ${n(bpy - bph * 1.9)} ${n(bpx + bpw)} ${n(bpy - bph * 0.3)} ` +
        `C ${n(bpx + bpw * 1.05)} ${n(bpy + bph * 0.7)} ${n(bpx + bpw * 0.35)} ${n(bpy + bph * 0.9)} ${n(bpx)} ${n(bpy + bph * 0.75)} ` +
        `C ${n(bpx - bpw * 0.65)} ${n(bpy + bph * 0.65)} ${n(bpx - bpw * 1.02)} ${n(bpy + bph * 0.4)} ${n(bpx - bpw)} ${n(bpy + 2)} Z`,
      `M ${n(bpx)} ${n(bpy - bph * 1.4)} Q ${n(bpx + 1)} ${n(bpy - bph * 1.8)} ${n(bpx + 3)} ${n(bpy - bph * 1.7)}`,
    ];
  }
  // Sombrero de Sabio (head)
  {
    const whBaseY = headTop + p.headR * 0.25;
    const whBrimW = hw * 0.95;
    wear.wizard_hat = [
      `M ${n(cx - whBrimW)} ${n(whBaseY + 2)} Q ${n(cx)} ${n(whBaseY - 3)} ${n(cx + whBrimW)} ${n(whBaseY + 2)} ` +
        `Q ${n(cx)} ${n(whBaseY + 6)} ${n(cx - whBrimW)} ${n(whBaseY + 2)} Z`,
      `M ${n(cx - whBrimW * 0.65)} ${n(whBaseY)} ` +
        `Q ${n(cx - 10)} ${n(whBaseY - p.headR * 1.1)} ${n(cx - 16)} ${n(whBaseY - p.headR * 1.7)} ` +
        `Q ${n(cx - 2)} ${n(whBaseY - p.headR * 1.3)} ${n(cx + whBrimW * 0.65)} ${n(whBaseY)} Z`,
      `M ${n(cx - 10)} ${n(whBaseY - p.headR * 0.9)} l 1.5 2 l 2.5 0.5 l -2 1.8 l 0.5 2.5 l -2.5 -1.5 l -2.5 1.5 l 0.5 -2.5 l -2 -1.8 l 2.5 -0.5 Z`,
    ];
  }
  // Corona de Laurel (head)
  {
    const lcY = headTop + p.headR * 0.45;
    const lcW = hw * 0.65;
    wear.laurel_crown = [
      `M ${n(cx - lcW)} ${n(lcY)} Q ${n(cx)} ${n(lcY + 5)} ${n(cx + lcW)} ${n(lcY)}`,
      `M ${n(cx - lcW * 0.8)} ${n(lcY - 1)} Q ${n(cx - lcW * 0.9)} ${n(lcY - 5)} ${n(cx - lcW * 0.65)} ${n(lcY - 4)} Z ` +
        `M ${n(cx - lcW * 0.5)} ${n(lcY + 1)} Q ${n(cx - lcW * 0.6)} ${n(lcY - 4)} ${n(cx - lcW * 0.35)} ${n(lcY - 2)} Z`,
      `M ${n(cx + lcW * 0.8)} ${n(lcY - 1)} Q ${n(cx + lcW * 0.9)} ${n(lcY - 5)} ${n(cx + lcW * 0.65)} ${n(lcY - 4)} Z ` +
        `M ${n(cx + lcW * 0.5)} ${n(lcY + 1)} Q ${n(cx + lcW * 0.6)} ${n(lcY - 4)} ${n(cx + lcW * 0.35)} ${n(lcY - 2)} Z`,
    ];
  }
  // Audífonos de Estudio (head)
  {
    const hpY = headTop + p.headR * 0.15;
    const hpW = hw * 0.85;
    wear.headphones_cozy = [
      `M ${n(cx - hpW + 2)} ${n(hpY + 10)} Q ${n(cx)} ${n(headTop - 5)} ${n(cx + hpW - 2)} ${n(hpY + 10)}`,
      ell(cx - hpW, hpY + 10, 3.5, 6),
      ell(cx + hpW, hpY + 10, 3.5, 6),
    ];
  }
  // Bufanda de Invierno ámbar (neck)
  {
    wear.scarf_amber = [
      `M ${n(cx - jawW * 1.05)} ${n(jawY)} Q ${n(cx)} ${n(jawY + 8)} ${n(cx + jawW * 1.05)} ${n(jawY)} ` +
        `L ${n(cx + jawW - 1)} ${n(jawY + 6)} Q ${n(cx)} ${n(jawY + 14)} ${n(cx - jawW + 1)} ${n(jawY + 6)} Z`,
      `M ${n(cx - jawW * 0.4)} ${n(jawY + 5)} L ${n(cx - jawW * 0.4 + 9)} ${n(jawY + 4)} ` +
        `L ${n(cx - jawW * 0.4 + 8)} ${n(jawY + 16)} L ${n(cx - jawW * 0.4 - 1)} ${n(jawY + 16)} Z`,
    ];
  }
  // Capa Azul de Darío (neck)
  {
    const cmTopY = jawY + 2.5;
    const cmBotY = p.bodyCy + p.bodyRy;
    const cmOutX = p.bodyRx + 3;
    const cmInX = Math.max(4, p.bodyRx * 0.3);
    wear.cape_modernist = [
      `M ${n(cx - jawW * 0.6)} ${n(cmTopY)} Q ${n(cx - cmOutX - 3)} ${n(p.bodyCy)} ${n(cx - cmOutX)} ${n(cmBotY)} ` +
        `L ${n(cx - cmInX)} ${n(cmBotY)} Q ${n(cx - cmInX - 2)} ${n(p.bodyCy)} ${n(cx - 2)} ${n(cmTopY + 3.5)} Z`,
      `M ${n(cx + jawW * 0.6)} ${n(cmTopY)} Q ${n(cx + cmOutX + 3)} ${n(p.bodyCy)} ${n(cx + cmOutX)} ${n(cmBotY)} ` +
        `L ${n(cx + cmInX)} ${n(cmBotY)} Q ${n(cx + cmInX + 2)} ${n(p.bodyCy)} ${n(cx + 2)} ${n(cmTopY + 3.5)} Z`,
      ell(cx, cmTopY + 3.5, 2.5, 2.5),
    ];
  }
  // Moño de Académico (neck)
  {
    const bwsY = jawY + 3.5;
    wear.bowtie_scholar = [
      `M ${n(cx - jawW * 0.75)} ${n(jawY + 1)} Q ${n(cx)} ${n(jawY + 5)} ${n(cx + jawW * 0.75)} ${n(jawY + 1)} ` +
        `L ${n(cx + jawW * 0.75)} ${n(jawY + 2.8)} Q ${n(cx)} ${n(jawY + 6.8)} ${n(cx - jawW * 0.75)} ${n(jawY + 2.8)} Z`,
      `M ${n(cx)} ${n(bwsY)} L ${n(cx - 7)} ${n(bwsY - 4)} L ${n(cx - 6)} ${n(bwsY + 4)} Z`,
      `M ${n(cx)} ${n(bwsY)} L ${n(cx + 7)} ${n(bwsY - 4)} L ${n(cx + 6)} ${n(bwsY + 4)} Z`,
      ell(cx, bwsY, 2, 1.8),
    ];
  }
  // Esclavina de Detective (neck)
  {
    const detTopY = jawY + 1.5;
    const detBotY = p.bodyCy + p.bodyRy * 0.65;
    const detOutX = p.bodyRx + 2.5;
    wear.detective_cape = [
      `M ${n(cx - jawW * 0.7)} ${n(detTopY - 1)} Q ${n(cx)} ${n(detTopY + 2)} ${n(cx + jawW * 0.7)} ${n(detTopY - 1)} ` +
        `L ${n(cx + jawW * 0.6)} ${n(detTopY + 3)} Q ${n(cx)} ${n(detTopY + 4.5)} ${n(cx - jawW * 0.6)} ${n(detTopY + 3)} Z`,
      `M ${n(cx - jawW * 0.55)} ${n(detTopY + 2)} Q ${n(cx - detOutX - 1)} ${n(p.bodyCy * 0.8)} ${n(cx - detOutX)} ${n(detBotY)} ` +
        `Q ${n(cx)} ${n(detBotY + 4)} ${n(cx + detOutX)} ${n(detBotY)} ` +
        `Q ${n(cx + detOutX + 1)} ${n(p.bodyCy * 0.8)} ${n(cx + jawW * 0.55)} ${n(detTopY + 2)} Z`,
      ell(cx, detTopY + 6, 1.1, 1.1),
      ell(cx, detTopY + 11, 1.1, 1.1),
    ];
  }
  // Gafas de Lectura (face)
  {
    const rfr = Math.max(p.eyeRx, p.eyeRy) + 2.2;
    wear.glasses_round = [
      ell(cx - p.eyeDx, eyeY, rfr, rfr),
      ell(cx + p.eyeDx, eyeY, rfr, rfr),
      `M ${n(cx - p.eyeDx + rfr)} ${n(eyeY - 0.5)} Q ${n(cx)} ${n(eyeY - 2.5)} ${n(cx + p.eyeDx - rfr)} ${n(eyeY - 0.5)} ` +
        `M ${n(cx - p.eyeDx - rfr)} ${n(eyeY - 0.5)} L ${n(cx - hw)} ${n(eyeY - 3)} ` +
        `M ${n(cx + p.eyeDx + rfr)} ${n(eyeY - 0.5)} L ${n(cx + hw)} ${n(eyeY - 3)}`,
    ];
  }
  // Monóculo de Crítico (face)
  {
    const mfr = Math.max(p.eyeRx, p.eyeRy) + 2.6;
    const mgEyeX = cx + p.eyeDx;
    wear.monocle_gold = [
      ell(mgEyeX, eyeY, mfr, mfr),
      `M ${n(mgEyeX + mfr * 0.8)} ${n(eyeY + mfr * 0.6)} ` +
        `Q ${n(mgEyeX + mfr + 4)} ${n(eyeY + mfr + 5)} ${n(cx + hw * 0.45)} ${n(jawY + 3)}`,
    ];
  }

  // Atrejos: platito y pelota frente a las patas.
  const propX = cx - 14;
  const propY = pawY + 2;

  const zAt = [
    { x: cx + hw * 0.5, y: headTop - 2 },
    { x: cx + hw * 0.5 + 6, y: headTop - 8 },
    { x: cx + hw * 0.5 + 12, y: headTop - 14 },
  ];

  return {
    head: `${head} ${earL} ${earR}`,
    headShade,
    earInnerL: earInner(cx - earSpread, earBaseY, p.earW, p.earH),
    earInnerR: earInner(cx + earSpread, earBaseY, p.earW, p.earH),
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
    propX,
    propY,
    zAt,
  };
}

// ---------- Atrejos compartidos ----------

export const PROPS = {
  // Plato hondo con croquetas.
  bowl: [
    `M -9 0 L 9 0 L 6.6 5.2 Q 0 7.4 -6.6 5.2 Z`,
    `M -5.4 -0.8 A 1.5 1.4 0 1 0 -2.4 -0.8 A 1.5 1.4 0 1 0 -5.4 -0.8 Z ` +
      `M 0.4 -1 A 1.5 1.4 0 1 0 3.4 -1 A 1.5 1.4 0 1 0 0.4 -1 Z ` +
      `M -2.4 0.2 A 1.4 1.3 0 1 0 0.4 0.2 A 1.4 1.3 0 1 0 -2.4 0.2 Z`,
  ],
  // Pelota con franja y brillo.
  ball: [
    `M -5 5 A 5 5 0 1 0 5 5 A 5 5 0 1 0 -5 5 Z`,
    `M -4.6 3.2 A 5.4 5.4 0 0 0 4.6 3.2 L 4.2 5 A 4.2 4.2 0 0 1 -4.2 5 Z`,
  ],
  // Taza de té humeante (lectura diurna): platito, pocillo, infusión, asa y volutas de vapor.
  tea: {
    saucer: `M -8 5 Q 0 6.6 8 5 L 6.6 6.8 Q 0 7.8 -6.6 6.8 Z`,
    cup: `M -5.8 0 L 5.8 0 L 4.6 4.6 Q 0 5.6 -4.6 4.6 Z`,
    liquid: `M -4.8 0.4 Q 0 1.2 4.8 0.4 Q 0 -0.4 -4.8 0.4 Z`,
    handle: `M 5 0.8 Q 8 0.8 7.6 2.8 Q 7.2 4.5 4.4 4.2`,
    steam: [
      `M -1.8 -1.8 Q -3.6 -4.5 -1.8 -7 Q 0 -9.5 -1.2 -12`,
      `M 1.8 -2.2 Q 3.6 -5 1.8 -7.8 Q 0.2 -10.2 1.4 -13`,
    ],
  },
  // Velita nocturna (lectura nocturna / foco profundo): palmatoria, cera, mecha, llama.
  candle: {
    dish: `M -7 4.5 Q 0 6 7 4.5 L 5.5 6 Q 0 7 -5.5 6 Z`,
    handle: `M 5.5 3.5 Q 8.5 2.5 7.5 5.5 Q 6.5 6 5 5.2`,
    wax: `M -3.2 -1 L 3.2 -1 L 3.2 4.6 L -3.2 4.6 Z`,
    wick: `M 0 -1 L 0 -2.8`,
    flame: `M 0 -3 C -1.6 -4.6 -1.2 -6.6 0 -8.4 C 1.2 -6.6 1.6 -4.6 0 -3 Z`,
  },
  // Chispa de cuatro puntas (evolución/fiesta).
  spark:
    `M 0 -4.4 L 1.2 -1.2 L 4.4 0 L 1.2 1.2 L 0 4.4 ` +
    `L -1.2 1.2 L -4.4 0 L -1.2 -1.2 Z`,
  sparkAt: [
    { x: 20, y: 14 },
    { x: 76, y: 12 },
    { x: 16, y: 46 },
    { x: 80, y: 44 },
  ],
};

// ---------- Las cinco edades ----------

const S0 = makeStage({
  // Bebé: cabeza enorme sobre un cuerpo mínimo, ojos gigantes —
  // la lectura instantánea de «gatito chiquito».
  headW: 62,
  headR: 27,
  headCy: 40,
  earW: 9.5,
  earH: 11,
  eyeRx: 6,
  eyeRy: 7,
  eyeDx: 11,
  eyeDy: 1.5,
  muzzleW: 26,
  muzzleH: 11,
  muzzleDy: 13,
  noseDy: 11,
  whiskers: false,
  blush: true,
  bodyRx: 13,
  bodyRy: 8,
  bodyCy: 80,
  belly: false,
  feet: false,
  pawUp: false,
  book: false,
  tailD: "M 58 83 Q 68 79 66 70",
  tailW: 4.2,
  tuft: false,
});

const S1 = makeStage({
  // Curioso: orejas grandes y erguidas, cuerpo ya presente.
  headW: 50,
  headR: 21,
  headCy: 34,
  earW: 8.4,
  earH: 13.5,
  eyeRx: 5.2,
  eyeRy: 6,
  eyeDx: 9,
  eyeDy: 1,
  muzzleW: 21,
  muzzleH: 9,
  muzzleDy: 11,
  noseDy: 9,
  whiskers: true,
  blush: true,
  bodyRx: 16,
  bodyRy: 13,
  bodyCy: 72,
  belly: true,
  feet: false,
  pawUp: false,
  book: false,
  tailD: "M 61 82 Q 74 77 72 62",
  tailW: 5,
  tuft: true,
});

const S2 = makeStage({
  // Joven: proporciones medias y una pata arriba de juego.
  headW: 46,
  headR: 19.5,
  headCy: 30,
  earW: 7.6,
  earH: 12.5,
  eyeRx: 4.7,
  eyeRy: 5.6,
  eyeDx: 8.4,
  eyeDy: 1,
  muzzleW: 19,
  muzzleH: 8.4,
  muzzleDy: 10.4,
  noseDy: 8.6,
  whiskers: true,
  blush: true,
  bodyRx: 17,
  bodyRy: 17,
  bodyCy: 68,
  belly: true,
  feet: false,
  pawUp: true,
  book: false,
  tailD: "M 63 81 Q 77 75 74 58",
  tailW: 5.4,
  tuft: true,
});

const S3 = makeStage({
  // Adulto: sentado seguro, pecho y patas traseras a la vista.
  headW: 44,
  headR: 18.5,
  headCy: 27,
  earW: 7.2,
  earH: 11.5,
  eyeRx: 4.4,
  eyeRy: 5.3,
  eyeDx: 8,
  eyeDy: 1,
  muzzleW: 18,
  muzzleH: 8,
  muzzleDy: 9.6,
  noseDy: 8,
  whiskers: true,
  blush: false,
  bodyRx: 19,
  bodyRy: 20,
  bodyCy: 66,
  belly: true,
  feet: true,
  pawUp: false,
  book: false,
  tailD: "M 65 82 Q 80 77 76 58 Q 75 50 70 46",
  tailW: 6,
  tuft: true,
});

const S4 = makeStage({
  // Bibliotecario: el adulto con un libro abierto a las patas.
  headW: 44,
  headR: 18.5,
  headCy: 25,
  earW: 7.2,
  earH: 11.5,
  eyeRx: 4.4,
  eyeRy: 5.3,
  eyeDx: 8,
  eyeDy: 1,
  muzzleW: 18,
  muzzleH: 8,
  muzzleDy: 9.6,
  noseDy: 8,
  whiskers: true,
  blush: false,
  bodyRx: 19,
  bodyRy: 20,
  bodyCy: 63,
  belly: true,
  feet: true,
  pawUp: false,
  book: true,
  tailD: "M 65 80 Q 80 75 76 56 Q 75 48 70 44",
  tailW: 6,
  tuft: true,
});

export const STAGES: readonly StageArt[] = [S0, S1, S2, S3, S4];
