// El gato de biblioteca rediseñado: compañero de Lecta dibujado en SVG de
// caricatura suave estilo Ghibli / Cozy Editorial en lienzo 160×160.
// Anatomía orgánica, doble catchlight en pupilas, medallón de pecho
// esponjoso, parpadeo procedural, movimiento asíncrono de orejas,
// 5 paletas de pelaje con luz de borde (rim-light) y 3 zonas táctiles.

import { useEffect, useRef, useState, type ReactNode } from "react";
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
import {
  COMPANION_COAT_IDS,
  resolveCoatId,
  type CompanionCoatId,
} from "../../shared/companion-data";
import { triggerHaptic } from "../lib/haptics";

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

export type CompanionMood =
  | "idle"
  | "happy"
  | "purring"
  | "curious"
  | "sleeping"
  | "excited"
  | "reading"
  | "thinking"
  | CatMood;

export interface CompanionProps {
  // 0 gatito bebé · 1 gatito curioso · 2 joven · 3 adulto ·
  // 4 bibliotecario (adulto con un libro abierto a las patas).
  stage: number;
  mood: CompanionMood;
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
  // Nuevas props Bloque 1, 2 y 3:
  coatId?: CompanionCoatId;
  lookAtX?: number; // -1 a 1
  lookAtY?: number; // -1 a 1
  size?: number | string;
  onHitboxClick?: (zone: "head" | "nose" | "paws") => void;
  onPet?: () => void;
}

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

const MOOD_SUFFIX: Record<string, string> = {
  asleep: "duerme",
  sleeping: "duerme plácidamente",
  sleepy: "tiene sueño",
  awake: "te acompaña",
  idle: "te acompaña relajado",
  happy: "está feliz",
  purring: "ronronea con cariño",
  curious: "mira con curiosidad",
  excited: "está muy emocionado",
  reading: "lee concentrado contigo",
  thinking: "reflexiona sobre la lectura",
};

function Eyes({
  art,
  kind,
  gazeOffsetX = 0,
  gazeOffsetY = 0,
  isBlinking = false,
  isCurious = false,
}: {
  art: StageArt;
  kind: EyeKind;
  gazeOffsetX?: number;
  gazeOffsetY?: number;
  isBlinking?: boolean;
  isCurious?: boolean;
}) {
  const pupilStyle =
    gazeOffsetX !== 0 || gazeOffsetY !== 0
      ? { transform: `translate(${gazeOffsetX}px, ${gazeOffsetY}px)` }
      : undefined;

  const pupilScale = isCurious ? 1.25 : 1;

  if (kind === "open" && !isBlinking) {
    return (
      <>
        <g className="cat-eyes cat-eyes--open">
          {art.eyesOpen.map((e, i) => (
            <g key={i}>
              <ellipse
                className="cat-eye"
                cx={e.cx}
                cy={e.cy}
                rx={e.rx}
                ry={e.ry}
              />
              <g className="cat-pupils" style={pupilStyle}>
                <ellipse
                  className="cat-pupil"
                  cx={e.cx}
                  cy={e.cy}
                  rx={e.rx * 0.65 * pupilScale}
                  ry={e.ry * 0.72 * pupilScale}
                />
                {/* Doble brillo especular (catchlights) */}
                <circle
                  className="cat-eye-glint cat-eye-glint--main"
                  cx={e.cx - e.rx * 0.3}
                  cy={e.cy - e.ry * 0.35}
                  r={e.rx * 0.34}
                />
                <circle
                  className="cat-eye-glint cat-eye-glint--sub"
                  cx={e.cx + e.rx * 0.34}
                  cy={e.cy + e.ry * 0.3}
                  r={e.rx * 0.16}
                />
              </g>
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
  if (isBlinking || kind === "blink") {
    return (
      <g className="cat-eyes cat-eyes--blink">
        {art.eyesClosed.map((d, i) => (
          <path key={i} className="cat-eye-line" d={d} />
        ))}
      </g>
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
      <g className="cat-eyes cat-eyes--half">
        {art.eyesOpen.map((e, i) => (
          <g key={i}>
            <ellipse
              className="cat-eye"
              cx={e.cx}
              cy={e.cy}
              rx={e.rx}
              ry={e.ry}
            />
            <g className="cat-pupils" style={pupilStyle}>
              <ellipse
                className="cat-pupil"
                cx={e.cx}
                cy={e.cy}
                rx={e.rx * 0.6}
                ry={e.ry * 0.68}
              />
              <circle
                className="cat-eye-glint"
                cx={e.cx - e.rx * 0.3}
                cy={e.cy - e.ry * 0.35}
                r={e.rx * 0.28}
              />
            </g>
            <path className="cat-lid" d={art.eyesHalf[i]} />
          </g>
        ))}
      </g>
    );
  }
  return (
    <g className={`cat-eyes cat-eyes--${kind}`}>
      {art.eyesClosed.map((d, i) => (
        <path key={i} className="cat-eye-line" d={d} />
      ))}
    </g>
  );
}

function Mouth({ art, kind }: { art: StageArt; kind: MouthKind }) {
  const m = art.mouth;
  if (kind === "eat") {
    return (
      <g className="cat-mouth cat-mouths">
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

function StrokePatch({ s, cls }: { s: Stroke; cls: string }) {
  return (
    <>
      <path
        className={`${cls}-edge`}
        d={s.d}
        strokeWidth={s.w + 3.2}
        aria-hidden="true"
      />
      <path className={`${cls}-fill`} d={s.d} strokeWidth={s.w} />
    </>
  );
}

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
  coatId,
  lookAtX,
  lookAtY,
  size,
  onHitboxClick,
  onPet,
}: CompanionProps) {
  // Estado interno para interactividad táctil
  const [internalMood, setInternalMood] = useState<CompanionMood | null>(null);
  const [isBooped, setIsBooped] = useState(false);
  const [isWavingPaw, setIsWavingPaw] = useState(false);
  const [heartsVisible, setHeartsVisible] = useState(false);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetMoodTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Parpadeo orgánico aleatorio (Bloque 2.1)
  const [isBlinking, setIsBlinking] = useState(false);

  // Movimiento de oreja asíncrono (Bloque 2.2)
  const [earTwitch, setEarTwitch] = useState<"left" | "right" | null>(null);

  const activeMood = internalMood ?? mood;
  const sleeping =
    activeMood === "asleep" || activeMood === "sleeping" || focus === "sleep";

  useEffect(() => {
    if (sleeping) return;
    let blinkTimer: ReturnType<typeof setTimeout>;
    let blinkDurationTimer: ReturnType<typeof setTimeout>;
    let isMounted = true;

    const scheduleBlink = () => {
      const delay = 2800 + Math.random() * 3000;
      blinkTimer = setTimeout(() => {
        if (!isMounted) return;
        setIsBlinking(true);
        blinkDurationTimer = setTimeout(() => {
          if (!isMounted) return;
          setIsBlinking(false);
          if (Math.random() < 0.2) {
            setTimeout(() => {
              if (!isMounted) return;
              setIsBlinking(true);
              setTimeout(() => {
                if (isMounted) setIsBlinking(false);
                scheduleBlink();
              }, 110);
            }, 90);
          } else {
            scheduleBlink();
          }
        }, 140);
      }, delay);
    };

    scheduleBlink();
    return () => {
      isMounted = false;
      clearTimeout(blinkTimer);
      clearTimeout(blinkDurationTimer);
    };
  }, [sleeping]);

  useEffect(() => {
    if (sleeping) return;
    let twitchTimer: ReturnType<typeof setTimeout>;
    let twitchDurationTimer: ReturnType<typeof setTimeout>;
    let isMounted = true;

    const scheduleTwitch = () => {
      const delay = 6000 + Math.random() * 5000;
      twitchTimer = setTimeout(() => {
        if (!isMounted) return;
        const side = Math.random() < 0.5 ? "left" : "right";
        setEarTwitch(side);
        twitchDurationTimer = setTimeout(() => {
          if (!isMounted) return;
          setEarTwitch(null);
          scheduleTwitch();
        }, 220);
      }, delay);
    };

    scheduleTwitch();
    return () => {
      isMounted = false;
      clearTimeout(twitchTimer);
      clearTimeout(twitchDurationTimer);
    };
  }, [sleeping]);

  // Seguimiento ocular suave (Bloque 2.3)
  const computedGazeX =
    typeof lookAtX === "number"
      ? Math.max(-3.5, Math.min(3.5, Math.round(lookAtX * 3.5 * 10) / 10))
      : typeof gazeOffset === "number"
        ? Math.max(-3.5, Math.min(3.5, gazeOffset))
        : typeof gazeProgress === "number"
          ? Math.max(-3.5, Math.min(3.5, Math.round((gazeProgress - 0.5) * 7 * 10) / 10))
          : 0;

  const computedGazeY =
    typeof lookAtY === "number"
      ? Math.max(-2.5, Math.min(2.5, Math.round(lookAtY * 2.5 * 10) / 10))
      : 0;

  const s = Math.min(4, Math.max(0, Math.round(stage)));
  const art = STAGES[s];

  const effectivePose = isWavingPaw ? "greet" : pose;
  const act: CompanionPose =
    effectivePose && effectivePose !== "idle"
      ? effectivePose
      : focus === "celebrating" || activeMood === "excited"
        ? "celebrate"
        : "idle";

  const isHappyMood =
    activeMood === "happy" ||
    activeMood === "purring" ||
    act === "pet" ||
    act === "celebrate" ||
    act === "evolve";

  const eyes: EyeKind = sleeping
    ? "sleep"
    : isHappyMood
      ? "happy"
      : focus === "yawn"
        ? "sleep"
        : activeMood === "sleepy"
          ? "half"
          : "open";

  const mouth: MouthKind =
    act === "eat"
      ? "eat"
      : focus === "yawn"
        ? "yawn"
        : act === "celebrate" || act === "evolve" || activeMood === "happy" || activeMood === "excited"
          ? "smile"
          : "cat";

  const who = name?.trim() || "El gato";
  const label =
    act !== "idle"
      ? `${who} ${POSE_SUFFIX[act]}`
      : focus
        ? `${who} ${FOCUS_SUFFIX[focus]}`
        : `${who} ${MOOD_SUFFIX[activeMood] ?? "te acompaña"}`;

  // Pelaje (Bloque 1.2): 5 paletas seleccionables
  const coatArticle = accessories.find((a) => a.startsWith("pelaje-") || COMPANION_COAT_IDS.includes(a as CompanionCoatId)) ?? null;
  const resolvedCoat = coatId ?? resolveCoatId(coatArticle);

  const coatCls =
    `cat--coat-${resolvedCoat}` +
    (resolvedCoat === "latte" ? " cat--coat-siames" : "") +
    (resolvedCoat === "ginger" ? " cat--coat-atigrado" : "") +
    (resolvedCoat === "mist" ? " cat--coat-gris" : "") +
    (coatArticle === "pelaje-negro" ? " cat--coat-negro" : "") +
    (coatArticle === "pelaje-dorado" ? " cat--coat-dorado" : "");

  const cls =
    `cat cat-anim cat--${activeMood} cat--mood-${activeMood} cat--s${s} ${coatCls}` +
    (focus ? ` cat--f-${focus}` : "") +
    (act && act !== "idle" ? ` cat--p-${act}` : "") +
    (isBooped ? " cat--boop" : "");

  // Manejo de zonas táctiles (Bloque 3)
  const handleHeadDown = () => {
    pressTimerRef.current = setTimeout(() => {
      pressTimerRef.current = null;
      setInternalMood("purring");
      setHeartsVisible(true);
      triggerHaptic([12, 40, 12, 40, 12]);
      onPet?.();
      onHitboxClick?.("head");
      if (resetMoodTimeoutRef.current) clearTimeout(resetMoodTimeoutRef.current);
      resetMoodTimeoutRef.current = setTimeout(() => {
        setInternalMood(null);
        setHeartsVisible(false);
      }, 2600);
    }, 450);
  };

  const handleHeadUp = () => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
      setInternalMood("happy");
      triggerHaptic(15);
      onHitboxClick?.("head");
      if (resetMoodTimeoutRef.current) clearTimeout(resetMoodTimeoutRef.current);
      resetMoodTimeoutRef.current = setTimeout(() => setInternalMood(null), 1400);
    }
  };

  const handleNoseClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsBooped(true);
    setInternalMood("curious");
    triggerHaptic(10);
    onHitboxClick?.("nose");
    if (resetMoodTimeoutRef.current) clearTimeout(resetMoodTimeoutRef.current);
    resetMoodTimeoutRef.current = setTimeout(() => {
      setIsBooped(false);
      setInternalMood(null);
    }, 1500);
  };

  const handlePawsClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsWavingPaw(true);
    setInternalMood("excited");
    triggerHaptic(12);
    onHitboxClick?.("paws");
    if (resetMoodTimeoutRef.current) clearTimeout(resetMoodTimeoutRef.current);
    resetMoodTimeoutRef.current = setTimeout(() => {
      setIsWavingPaw(false);
      setInternalMood(null);
    }, 1800);
  };

  const headTilt =
    activeMood === "curious"
      ? "rotate(-10deg)"
      : activeMood === "purring"
        ? "rotate(8deg)"
        : undefined;

  return (
    <svg
      className={cls}
      viewBox={`0 0 ${CAT_BOX} ${CAT_BOX}`}
      width={size ?? "72"}
      height={size ?? "72"}
      {...(decorative
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": label })}
    >
      {decorative ? null : <title>{label}</title>}

      {/* Sombra de suelo orgánica (Bloque 1.1) */}
      <ellipse
        className="cat-shadow cat-ground-shadow"
        cx={art.shadow.cx}
        cy={art.shadow.cy}
        rx={art.shadow.rx}
        ry={art.shadow.ry}
      />

      <g className="cat-figure">
        {/* Cola articulada con transform-origin en la base de la cadera (108px 124px) */}
        <g
          className="cat-tail cat-tail-group"
          style={{ transformOrigin: "108px 124px" }}
        >
          <StrokePatch s={art.tail} cls="cat-tail" />
        </g>

        {/* Cuerpo y Pecho Esponjoso (Bloque 1.1) */}
        <g className="cat-body cat-body-group">
          <path className="cat-fur" d={art.body} />
          {art.belly ? <path className="cat-fur-light" d={art.belly} /> : null}
          {/* Medallón de pecho esponjoso */}
          <path className="cat-chest-fluff cat-fur-light" d={art.chestFluff} />

          {/* Patitas delanteras con hitbox */}
          <g
            className="cat-paws"
            data-hitbox="paws"
            onClick={handlePawsClick}
            style={{ cursor: "pointer" }}
          >
            {art.paws.map((d, i) => (
              <path key={i} className="cat-fur cat-paw-shape" d={d} />
            ))}
          </g>
        </g>

        {/* Patas en gesto / Saludo con almohadillas rosadas (toe beans) */}
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
          <g className="cat-paw cat-paw--wave" data-hitbox="paws">
            <StrokePatch s={art.wave} cls="cat-paw" />
            {/* Almohadillas rosadas ("toe beans") */}
            <g className="cat-toe-beans" transform="translate(126, 60)">
              <ellipse
                className="cat-paw-pad"
                cx="0"
                cy="0"
                rx="4.5"
                ry="3.5"
                fill="#F4A698"
              />
              <circle
                className="cat-toe-bean"
                cx="-3.6"
                cy="-4.2"
                r="1.8"
                fill="#F4A698"
              />
              <circle
                className="cat-toe-bean"
                cx="0"
                cy="-5.2"
                r="1.8"
                fill="#F4A698"
              />
              <circle
                className="cat-toe-bean"
                cx="3.6"
                cy="-4.2"
                r="1.8"
                fill="#F4A698"
              />
            </g>
          </g>
        ) : null}
        {art.pawUp && act === "idle" ? (
          <g className="cat-paw cat-paw--up">
            <StrokePatch s={art.pawUp} cls="cat-paw" />
          </g>
        ) : null}

        {/* Cabeza con mejillas abullonadas y transform-origin 80px 78px (Bloque 1.1) */}
        <g
          className="cat-head cat-head-group"
          data-hitbox="head"
          style={{
            transformOrigin: "80px 78px",
            transform: headTilt,
            cursor: "pointer",
          }}
          onPointerDown={handleHeadDown}
          onPointerUp={handleHeadUp}
        >
          {/* Orejas independientes */}
          <g className="cat-ears">
            <g
              className={`cat-ear cat-ear--left${earTwitch === "left" ? " cat-ear--twitch" : ""}`}
              style={{ transformOrigin: "56px 50px" }}
            >
              <path className="cat-fur" d={art.earL} />
              <path className="cat-ear-inner" d={art.earInnerL} />
            </g>
            <g
              className={`cat-ear cat-ear--right${earTwitch === "right" ? " cat-ear--twitch" : ""}`}
              style={{ transformOrigin: "104px 50px" }}
            >
              <path className="cat-fur" d={art.earR} />
              <path className="cat-ear-inner" d={art.earInnerR} />
            </g>
          </g>

          <path className="cat-fur" d={art.head} />
          <path className="cat-fur-shade" d={art.headShade} />
          {art.tuft ? <path className="cat-fur-shade" d={art.tuft} /> : null}

          {/* Mejillas sonrojadas translúcidas */}
          <ellipse
            className="cat-blush"
            cx={art.blushL.cx}
            cy={art.blushL.cy}
            rx={art.blushL.rx}
            ry={art.blushL.ry}
            style={{
              opacity:
                activeMood === "purring" || activeMood === "happy" ? 0.85 : 0.45,
              transition: "opacity 200ms ease-out",
            }}
          />
          <ellipse
            className="cat-blush"
            cx={art.blushR.cx}
            cy={art.blushR.cy}
            rx={art.blushR.rx}
            ry={art.blushR.ry}
            style={{
              opacity:
                activeMood === "purring" || activeMood === "happy" ? 0.85 : 0.45,
              transition: "opacity 200ms ease-out",
            }}
          />

          {/* Rostro de Alta Expresividad (Bloque 1.1) */}
          <g className="cat-face-group">
            <path className="cat-muzzle" d={art.muzzle} />
            <g
              data-hitbox="nose"
              onClick={handleNoseClick}
              style={{ cursor: "pointer" }}
            >
              <path className="cat-nose" d={art.nose} />
            </g>
            <Eyes
              art={art}
              kind={eyes}
              gazeOffsetX={computedGazeX}
              gazeOffsetY={computedGazeY}
              isBlinking={isBlinking}
              isCurious={activeMood === "curious"}
            />
            <Mouth art={art} kind={mouth} />
            <g
              className="cat-whiskers"
              data-hitbox="nose"
              onClick={handleNoseClick}
              style={{ cursor: "pointer" }}
            >
              <path className="cat-whisker" d={art.whiskerL} />
              <path className="cat-whisker" d={art.whiskerR} />
            </g>
          </g>
        </g>

        {/* Rayas del pelaje atigrado / calicó */}
        {(resolvedCoat === "ginger" ||
          resolvedCoat === "calico" ||
          coatArticle === "pelaje-atigrado" ||
          coatArticle === "pelaje-calico") &&
        art.marks.length ? (
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
          <g transform={`translate(${art.propX + 6} ${art.propY + 2}) scale(1.25)`}>
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
            transform={`translate(${art.propX + 44} ${art.propY - 2}) scale(1.3)`}
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
            transform={`translate(${art.propX + 44} ${art.propY - 2}) scale(1.3)`}
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

        {/* Corazones flotantes durante el ronroneo */}
        {heartsVisible || activeMood === "purring" ? (
          <g className="cat-hearts" aria-hidden="true">
            <path
              className="cat-heart cat-heart--1"
              d="M 64 36 C 64 30 56 26 52 30 C 48 34 64 45 64 45 C 64 45 80 34 76 30 C 72 26 64 30 64 36 Z"
              fill="#E07A72"
            />
            <path
              className="cat-heart cat-heart--2"
              d="M 96 28 C 96 23 90 20 86 23 C 82 26 96 35 96 35 C 96 35 110 26 106 23 C 102 20 96 23 96 28 Z"
              fill="#F4A698"
            />
          </g>
        ) : null}

        {/* «z z z» flotantes cuando duerme */}
        {sleeping ? (
          <g className="cat-zzz">
            {art.zAt.map((at, i) => (
              <text key={i} className="cat-z" x={at.x} y={at.y}>
                z
              </text>
            ))}
          </g>
        ) : null}
      </g>
    </svg>
  );
}
