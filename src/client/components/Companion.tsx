// El gato de biblioteca: compañero de Lecta dibujado en SVG de
// caricatura suave — formas redondas, ojos grandes con brillo,
// mejillas rosadas y sombreado tenue sobre la paleta --cat-* del
// tema. Tres cosas independientes definen el dibujo: la etapa
// (proporciones de verdad distintas por edad — el bebé es casi toda
// cabeza), el sueño (solo humor o foco de lectura, jamás la edad) y
// la pose transitoria que un controlador enciende por unos segundos.
// La ropa llega por ids de accesorios anclados a cada etapa;
// bufanda/collar comparten la ranura del cuello.

import type { ReactNode } from "react";
import type { CatMood } from "../lib/gamification";
import type { CompanionState } from "../lib/companion-state";
import {
  CAT_BOX,
  STAGES,
  PROPS,
  type EyeKind,
  type MouthKind,
  type StageArt,
  type Stroke,
} from "./companion-sprites";

// Gestos transitorios: la clase cat--p-* anima una iteración corta o
// un bucle suave mientras el controlador mantenga la pose; «idle» es
// el reposo con respiración y parpadeo.
export type CompanionPose =
  | "idle"
  | "greet"
  | "pet"
  | "eat"
  | "play"
  | "celebrate"
  | "evolve"
  | "walk"
  | "playful_hop";

export interface CompanionProps {
  // 0 gatito bebé · 1 gatito curioso · 2 joven · 3 adulto ·
  // 4 bibliotecario (adulto con un libro abierto a las patas).
  stage: number;
  mood: CatMood;
  // Ids de artículos puestos: chaleco, bufanda, collar, moño,
  // anteojos. La bufanda gana la ranura del cuello si llegan las dos.
  accessories: string[];
  // Estado de lectura en vivo (lector); ausente en el Cuaderno,
  // donde manda el humor de largo plazo.
  focus?: CompanionState | null;
  // Gesto transitorio con prioridad visual sobre el humor; el sueño
  // sigue mandando en ojos y opacidad mientras la pose mueve el resto.
  pose?: CompanionPose;
  // Nombre propio para el rótulo accesible («Michi te acompaña…»).
  name?: string;
  // Dentro de un botón el dibujo es decorativo: sin role ni título,
  // el label lo pone el elemento interactivo que lo contiene.
  decorative?: boolean;
  // Fracción leída [0, 1] o desplazamiento horizontal [-2, 2] px para seguimiento ocular
  gazeProgress?: number;
  gazeOffset?: number;
}

// Rótulo accesible: «<sujeto> <sufijo>». El foco describe lo que el
// gato hace junto a la lectura; la pose, el gesto del momento; el
// humor solo informa vigilia/sueño cuando no hay nada más activo.
const FOCUS_SUFFIX: Record<CompanionState, string> = {
  sleep: "descansa junto a tu lectura",
  reading: "te acompaña mientras lees",
  deep_focus: "lee contigo en silencio",
  curious: "se fija en lo que consultas",
  yawn: "bosteza: tal vez es hora de un descanso",
  celebrating: "celebra tu lectura",
};

const POSE_SUFFIX: Record<Exclude<CompanionPose, "idle">, string> = {
  greet: "te saluda con la pata",
  pet: "disfruta las caricias",
  eat: "come de su platito",
  play: "juega con su pelota",
  celebrate: "celebra contigo",
  evolve: "creció y está orgulloso",
  walk: "pasea por su rincón",
  playful_hop: "da un salto juguetón",
};

const MOOD_SUFFIX: Record<CatMood, string> = {
  asleep: "duerme",
  sleepy: "tiene sueño",
  awake: "te acompaña",
};

// Ojos abiertos: óvalos oscuros con dos brillos — el tamaño cambia por
// etapa (el bebé los lleva enormes). El «blink» convive como capa:
// CSS alterna opacidades para el guiño.
function Eyes({
  art,
  kind,
  gazeOffset = 0,
}: {
  art: StageArt;
  kind: EyeKind;
  gazeOffset?: number;
}) {
  const gazeStyle =
    gazeOffset !== 0 ? { transform: `translateX(${gazeOffset}px)` } : undefined;

  if (kind === "open") {
    return (
      <>
        <g className="cat-eyes cat-eyes--open" style={gazeStyle}>
          {art.eyesOpen.map((e, i) => (
            <g key={i}>
              <ellipse
                className="cat-eye"
                cx={e.cx}
                cy={e.cy}
                rx={e.rx}
                ry={e.ry}
              />
              <circle
                className="cat-eye-glint"
                cx={e.cx - e.rx * 0.3}
                cy={e.cy - e.ry * 0.35}
                r={e.rx * 0.34}
              />
              <circle
                className="cat-eye-glint"
                cx={e.cx + e.rx * 0.34}
                cy={e.cy + e.ry * 0.3}
                r={e.rx * 0.16}
              />
            </g>
          ))}
        </g>
        <g className="cat-eyes cat-eyes--blink" aria-hidden="true">
          {art.eyesClosed.map((d, i) => (
            <path key={i} className="cat-eye-line" d={d} />
          ))}
        </g>
      </>
    );
  }
  if (kind === "happy") {
    return (
      <g className="cat-eyes cat-eyes--happy">
        {art.eyesHappy.map((d, i) => (
          <path key={i} className="cat-eye-line" d={d} />
        ))}
      </g>
    );
  }
  if (kind === "half") {
    return (
      <g className="cat-eyes cat-eyes--half" style={gazeStyle}>
        {art.eyesOpen.map((e, i) => (
          <g key={i}>
            <ellipse
              className="cat-eye"
              cx={e.cx}
              cy={e.cy}
              rx={e.rx}
              ry={e.ry}
            />
            <path className="cat-lid" d={art.eyesHalf[i]} />
          </g>
        ))}
      </g>
    );
  }
  // "sleep" y "blink" comparten la línea cerrada.
  return (
    <g className={`cat-eyes cat-eyes--${kind}`}>
      {art.eyesClosed.map((d, i) => (
        <path key={i} className="cat-eye-line" d={d} />
      ))}
    </g>
  );
}

// Boca por expresión: gatito («ω»), sonrisa abierta, bostezo, lengua
// y el ñam-ñam de comer (dos bocas alternando, CSS las mezcla).
function Mouth({ art, kind }: { art: StageArt; kind: MouthKind }) {
  const m = art.mouth;
  if (kind === "eat") {
    return (
      <g className="cat-mouths">
        <g className="cat-mouth cat-mouth--a">
          <path className="cat-mouth-open" d={m.open} />
        </g>
        <g className="cat-mouth cat-mouth--b" aria-hidden="true">
          <path className="cat-mouth-line" d={m.munch} />
        </g>
      </g>
    );
  }
  if (kind === "yawn") {
    return (
      <g className="cat-mouth cat-mouth--yawn">
        <path className="cat-mouth-open" d={m.yawn} />
        <path className="cat-tongue" d={m.tongueFill} />
      </g>
    );
  }
  if (kind === "tongue") {
    return (
      <g className="cat-mouth cat-mouth--tongue">
        <path className="cat-mouth-open" d={m.open} />
        <path className="cat-tongue" d={m.tongueFill} />
      </g>
    );
  }
  if (kind === "smile") {
    return (
      <g className="cat-mouth cat-mouth--smile">
        <path className="cat-mouth-open" d={m.smile} />
        <path className="cat-tongue" d={m.tongueFill} />
      </g>
    );
  }
  return (
    <g className="cat-mouth cat-mouth--cat">
      <path className="cat-mouth-line" d={m.cat} />
    </g>
  );
}

// Cola y patas en gesto son trazos: el par borde+pelaje dibuja el
// perfil grueso de la caricatura (contorno debajo, pelaje encima).
// El grupo que los envuelve (.cat-tail, .cat-paw--*) es quien recibe
// las animaciones — las rutas internas llevan -edge/-fill.
function StrokePatch({ s, cls }: { s: Stroke; cls: string }) {
  return (
    <>
      <path
        className={`${cls}-edge`}
        d={s.d}
        strokeWidth={s.w + 2.2}
        aria-hidden="true"
      />
      <path className={`${cls}-fill`} d={s.d} strokeWidth={s.w} />
    </>
  );
}

// Ropa por ranura: cada artículo es un grupo de paths ya posicionado
// para la etapa (las proporciones cambian; las anclas vienen en el
// StageArt).
function Wear({ art, accessories }: { art: StageArt; accessories: string[] }) {
  const items: ReactNode[] = [];

  // Ranura cuerpo (body)
  if (accessories.includes("chaleco") && art.wear.chaleco)
    items.push(
      <g key="chaleco" className="cat-wear cat-wear--chaleco">
        {art.wear.chaleco.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>,
    );
  else if (accessories.includes("capa") && art.wear.capa)
    items.push(
      <g key="capa" className="cat-wear cat-wear--capa">
        {art.wear.capa.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>,
    );

  // Ranura ojos / cara (face)
  if (accessories.includes("anteojos") && art.wear.anteojos)
    items.push(
      <g key="anteojos" className="cat-wear cat-wear--anteojos">
        {art.wear.anteojos.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>,
    );
  else if (accessories.includes("monoculo") && art.wear.monoculo)
    items.push(
      <g key="monoculo" className="cat-wear cat-wear--monoculo">
        {art.wear.monoculo.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>,
    );
  else if (accessories.includes("glasses_round") && art.wear.glasses_round)
    items.push(
      <g key="glasses_round" className="cat-wear cat-wear--glasses_round">
        {art.wear.glasses_round.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>,
    );
  else if (accessories.includes("monocle_gold") && art.wear.monocle_gold)
    items.push(
      <g key="monocle_gold" className="cat-wear cat-wear--monocle_gold">
        {art.wear.monocle_gold.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>,
    );

  // Ranura cabeza (head)
  if (accessories.includes("moño") && art.wear.moño)
    items.push(
      <g key="moño" className="cat-wear cat-wear--moño">
        {art.wear.moño.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>,
    );
  else if (accessories.includes("boina") && art.wear.boina)
    items.push(
      <g key="boina" className="cat-wear cat-wear--boina">
        {art.wear.boina.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>,
    );
  else if (accessories.includes("beret_poet") && art.wear.beret_poet)
    items.push(
      <g key="beret_poet" className="cat-wear cat-wear--beret_poet">
        {art.wear.beret_poet.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>,
    );
  else if (accessories.includes("wizard_hat") && art.wear.wizard_hat)
    items.push(
      <g key="wizard_hat" className="cat-wear cat-wear--wizard_hat">
        {art.wear.wizard_hat.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>,
    );
  else if (accessories.includes("laurel_crown") && art.wear.laurel_crown)
    items.push(
      <g key="laurel_crown" className="cat-wear cat-wear--laurel_crown">
        {art.wear.laurel_crown.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>,
    );
  else if (accessories.includes("headphones_cozy") && art.wear.headphones_cozy)
    items.push(
      <g key="headphones_cozy" className="cat-wear cat-wear--headphones_cozy">
        {art.wear.headphones_cozy.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>,
    );

  // Ranura cuello (neck)
  if (accessories.includes("bufanda") && art.wear.bufanda)
    items.push(
      <g key="bufanda" className="cat-wear cat-wear--bufanda">
        {art.wear.bufanda.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>,
    );
  else if (accessories.includes("collar") && art.wear.collar)
    items.push(
      <g key="collar" className="cat-wear cat-wear--collar">
        {art.wear.collar.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>,
    );
  else if (accessories.includes("corbatin") && art.wear.corbatin)
    items.push(
      <g key="corbatin" className="cat-wear cat-wear--corbatin">
        {art.wear.corbatin.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>,
    );
  else if (accessories.includes("scarf_amber") && art.wear.scarf_amber)
    items.push(
      <g key="scarf_amber" className="cat-wear cat-wear--scarf_amber">
        {art.wear.scarf_amber.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>,
    );
  else if (accessories.includes("cape_modernist") && art.wear.cape_modernist)
    items.push(
      <g key="cape_modernist" className="cat-wear cat-wear--cape_modernist">
        {art.wear.cape_modernist.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>,
    );
  else if (accessories.includes("bowtie_scholar") && art.wear.bowtie_scholar)
    items.push(
      <g key="bowtie_scholar" className="cat-wear cat-wear--bowtie_scholar">
        {art.wear.bowtie_scholar.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>,
    );
  else if (accessories.includes("detective_cape") && art.wear.detective_cape)
    items.push(
      <g key="detective_cape" className="cat-wear cat-wear--detective_cape">
        {art.wear.detective_cape.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>,
    );

  return <>{items}</>;
}

export function Companion({
  stage,
  mood,
  accessories,
  focus,
  pose,
  name,
  decorative = false,
  gazeProgress,
  gazeOffset,
}: CompanionProps) {
  const computedGaze =
    typeof gazeOffset === "number"
      ? Math.max(-2, Math.min(2, gazeOffset))
      : typeof gazeProgress === "number"
        ? Math.max(-2, Math.min(2, Math.round((gazeProgress - 0.5) * 4 * 10) / 10))
        : 0;

  const s = Math.min(4, Math.max(0, Math.round(stage)));
  const art = STAGES[s];

  const sleeping = mood === "asleep" || focus === "sleep";
  // La pose manda en la figura; el «celebrating» del foco usa el
  // mismo brinco de fiesta para no dibujar dos celebraciones.
  const act: CompanionPose =
    pose && pose !== "idle"
      ? pose
      : focus === "celebrating"
        ? "celebrate"
        : "idle";

  // El sueño/entrecierre solo viene del humor o del foco: la etapa
  // nunca cierra ojos ni baja la opacidad.
  const eyes: EyeKind = sleeping
    ? "sleep"
    : act === "pet" || act === "celebrate" || act === "evolve"
      ? "happy"
      : focus === "yawn"
        ? "sleep"
        : mood === "sleepy"
          ? "half"
          : "open";
  const mouth: MouthKind =
    act === "eat"
      ? "eat"
      : focus === "yawn"
        ? "yawn"
        : act === "celebrate" || act === "evolve"
          ? "smile"
          : "cat";

  const who = name?.trim() || "El gato";
  const label =
    act !== "idle"
      ? `${who} ${POSE_SUFFIX[act]}`
      : focus
        ? `${who} ${FOCUS_SUFFIX[focus]}`
        : `${who} ${MOOD_SUFFIX[mood]}`;

  // Pelaje: el artículo de la ranura «coat» cambia la paleta del
  // gato entero (clase cat--coat-*); el atigrado además enciende
  // las rayas del StageArt.
  const coat = accessories.find((a) => a.startsWith("pelaje-")) ?? null;
  // «cat-anim» marca el territorio animable: el modo «Completas» de
  // Cuenta lo exime de la reducción de movimiento del sistema y el
  // modo «Reducidas» lo silencia aunque el sistema anime (base.css).
  const cls =
    `cat cat-anim cat--${mood} cat--s${s}` +
    (coat ? ` cat--coat-${coat.slice("pelaje-".length)}` : "") +
    (focus ? ` cat--f-${focus}` : "") +
    (pose ? ` cat--p-${pose}` : "");

  return (
    <svg
      className={cls}
      viewBox={`0 0 ${CAT_BOX} ${CAT_BOX}`}
      // Lienzo lógico 96×96; el tamaño visible lo pone quien lo usa
      // (46–88px hoy) vía CSS o el ancho por omisión.
      width="72"
      height="72"
      {...(decorative
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": label })}
    >
      {decorative ? null : <title>{label}</title>}
      {/* Sombra de suelo: no salta con la figura; en fiesta se achata
          y estira como el piso que recibe al gato. */}
      <ellipse
        className="cat-shadow"
        cx={art.shadow.cx}
        cy={art.shadow.cy}
        rx={art.shadow.rx}
        ry={art.shadow.ry}
      />
      <g className="cat-figure">
        {/* Cola detrás del cuerpo para que el torso tape su base. */}
        <g className="cat-tail">
          <StrokePatch s={art.tail} cls="cat-tail" />
        </g>
        <g className="cat-body">
          <path className="cat-fur" d={art.body} />
          {art.belly ? <path className="cat-fur-light" d={art.belly} /> : null}
          {art.paws.map((d, i) => (
            <path key={i} className="cat-fur cat-paw-shape" d={d} />
          ))}
        </g>
        {/* Patas en gesto: saludo a la derecha, fiesta con las dos
            arriba y la pata fija del joven. */}
        {act === "celebrate" ? (
          <g className="cat-paw cat-paw--cheer-l">
            <StrokePatch s={art.cheerL} cls="cat-paw" />
          </g>
        ) : null}
        {act === "celebrate" ? (
          <g className="cat-paw cat-paw--cheer-r">
            <StrokePatch s={art.cheerR} cls="cat-paw" />
          </g>
        ) : null}
        {act === "greet" ? (
          <g className="cat-paw cat-paw--wave">
            <StrokePatch s={art.wave} cls="cat-paw" />
          </g>
        ) : null}
        {art.pawUp && act === "idle" ? (
          <g className="cat-paw cat-paw--up">
            <StrokePatch s={art.pawUp} cls="cat-paw" />
          </g>
        ) : null}
        <g className="cat-head">
          <path className="cat-fur" d={art.head} />
          <path className="cat-fur-shade" d={art.headShade} />
          {/* Orejas: interior rosa sobre la silueta ya incluida. */}
          <path className="cat-ear-inner" d={art.earInnerL} />
          <path className="cat-ear-inner" d={art.earInnerR} />
          {art.tuft ? <path className="cat-fur-shade" d={art.tuft} /> : null}
          {/* Mejillas rosadas: la ternura instantánea del cartoon. */}
          <ellipse
            className="cat-blush"
            cx={art.blushL.cx}
            cy={art.blushL.cy}
            rx={art.blushL.rx}
            ry={art.blushL.ry}
          />
          <ellipse
            className="cat-blush"
            cx={art.blushR.cx}
            cy={art.blushR.cy}
            rx={art.blushR.rx}
            ry={art.blushR.ry}
          />
          {/* Hocico claro + nariz + boca. */}
          <path className="cat-muzzle" d={art.muzzle} />
          <path className="cat-nose" d={art.nose} />
          <Eyes art={art} kind={eyes} gazeOffset={computedGaze} />
          <Mouth art={art} kind={mouth} />
          {/* Bigotes finos a los lados del hocico. */}
          <path className="cat-whisker" d={art.whiskerL} />
          <path className="cat-whisker" d={art.whiskerR} />
        </g>
        {/* Rayas del pelaje atigrado: van sobre el pelaje y bajo la
            ropa para que una bufanda las tape como en la vida real. */}
        {(coat === "pelaje-atigrado" || coat === "pelaje-calico") && art.marks.length ? (
          <path className="cat-marks" d={art.marks.join(" ")} />
        ) : null}
        <Wear art={art} accessories={accessories} />
        {art.book ? (
          <g className="cat-book">
            {art.book.map((d, i) => (
              <path key={i} d={d} />
            ))}
          </g>
        ) : null}
        {act === "eat" ? (
          <g transform={`translate(${art.propX - 1} ${art.propY - 1}) scale(1.5)`}>
            <g className="cat-bowl">
              {PROPS.bowl.map((d, i) => (
                <path key={i} d={d} />
              ))}
            </g>
          </g>
        ) : null}
        {act === "play" ? (
          <g transform={`translate(${art.propX + 4} ${art.propY}) scale(1.25)`}>
            <g className="cat-ball">
              {PROPS.ball.map((d, i) => (
                <path key={i} d={d} />
              ))}
            </g>
          </g>
        ) : null}
        {focus === "reading" && act === "idle" ? (
          <g
            className="cat-prop cat-prop--tea"
            transform={`translate(${art.propX + 27} ${art.propY - 1}) scale(1.2)`}
          >
            <g className="cat-tea">
              <path className="cat-dish" d={PROPS.tea.saucer} />
              <path className="cat-cup" d={PROPS.tea.cup} />
              <path className="cat-tea-liquid" d={PROPS.tea.liquid} />
              <path className="cat-cup-handle" d={PROPS.tea.handle} />
              <g className="cat-tea-steam">
                {PROPS.tea.steam.map((d, i) => (
                  <path key={i} className="cat-steam-line" d={d} />
                ))}
              </g>
            </g>
          </g>
        ) : null}
        {focus === "deep_focus" && act === "idle" ? (
          <g
            className="cat-prop cat-prop--candle"
            transform={`translate(${art.propX + 27} ${art.propY - 1}) scale(1.2)`}
          >
            <g className="cat-candle">
              <ellipse className="cat-candle-halo" cx="0" cy="-5.5" rx="7" ry="7" />
              <path className="cat-dish" d={PROPS.candle.dish} />
              <path className="cat-dish-handle" d={PROPS.candle.handle} />
              <path className="cat-wax" d={PROPS.candle.wax} />
              <path className="cat-wick" d={PROPS.candle.wick} />
              <path className="cat-flame" d={PROPS.candle.flame} />
            </g>
          </g>
        ) : null}
        {act === "evolve" || act === "celebrate" ? (
          <g className="cat-sparks">
            {PROPS.sparkAt.map((at, i) => (
              <path
                key={i}
                className="cat-spark"
                d={PROPS.spark}
                transform={`translate(${at.x} ${at.y})`}
              />
            ))}
          </g>
        ) : null}
        {/* «z z z» sobre la oreja cuando duerme; CSS las hace flotar
            en cascada (o las deja quietas con movimiento reducido). */}
        {sleeping ? (
          <g className="cat-zzz">
            {art.zAt.map((at, i) => (
              <text
                key={i}
                className="cat-z"
                x={at.x}
                y={at.y}
              >
                z
              </text>
            ))}
          </g>
        ) : null}
      </g>
    </svg>
  );
}
