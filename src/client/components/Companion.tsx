// El gato de biblioteca: compañero del Cuaderno dibujado en SVG de
// tinta (una sola tinta + papel, como el resto de Lecta). La etapa
// crece con el nivel; el humor refleja si hubo lectura reciente; los
// accesorios salen de los cofres de nivel abiertos.

import type { CatMood } from "../lib/gamification";
import type { CompanionState } from "../lib/companion-state";

// Rótulo accesible de cada estado de lectura (companion-state).
const FOCUS_LABELS: Record<CompanionState, string> = {
  sleep: "El gato descansa junto a tu lectura",
  reading: "El gato te acompaña mientras lees",
  deep_focus: "El gato lee contigo en silencio",
  curious: "El gato se fija en lo que consultas",
  yawn: "El gato bosteza: tal vez es hora de un descanso",
  celebrating: "El gato celebra tu lectura",
};

export function Companion({
  stage,
  mood,
  accessories,
  focus,
}: {
  // 0 gatito dormido · 1 gatito · 2 gato · 3 gato con presencia ·
  // 4 bibliotecario. La etapa solo cambia proporciones y presencia.
  stage: number;
  mood: CatMood;
  accessories: string[];
  // Estado de lectura en vivo (lector); ausente en el Cuaderno,
  // donde manda el humor de largo plazo.
  focus?: CompanionState | null;
}) {
  const kitten = stage <= 1;
  // Cabeza proporcionalmente más grande en gatito.
  const headR = kitten ? 15 : 13;
  const headCy = kitten ? 34 : 30;
  const bodyRy = kitten ? 14 : 20;
  const bodyCy = 54;

  const sleeping = mood === "asleep" || focus === "sleep";
  const eyes =
    sleeping ? "closed" : mood === "sleepy" || stage === 0 ? "half" : "open";

  const label = focus
    ? FOCUS_LABELS[focus]
    : mood === "asleep"
      ? "El gato del cuaderno duerme"
      : mood === "sleepy"
        ? "El gato del cuaderno tiene sueño"
        : "El gato del cuaderno te acompaña";

  return (
    <svg
      className={`cat cat--${mood} cat--s${stage}${focus ? ` cat--f-${focus}` : ""}`}
      viewBox="0 0 72 72"
      width="72"
      height="72"
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      {/* Cola: un trazo que se asoma por detrás del cuerpo. */}
      <path
        className="cat-tail"
        d={
          kitten
            ? "M52 58 q14 -4 12 -16"
            : "M54 56 q14 -2 12 -18 q-1 -7 -6 -8"
        }
        fill="none"
        strokeWidth={kitten ? 4 : 5}
        strokeLinecap="round"
      />
      {/* Cuerpo sentado. */}
      <ellipse className="cat-body" cx="36" cy={bodyCy} rx={kitten ? 15 : 18} ry={bodyRy} />
      {/* Orejas. */}
      <path
        className="cat-ink"
        d={`M${36 - headR + 3} ${headCy - headR + 6} l${kitten ? 4 : 5} ${kitten ? -9 : -11} l${kitten ? 6 : 8} 7 Z`}
      />
      <path
        className="cat-ink"
        d={`M${36 + headR - 3} ${headCy - headR + 6} l${kitten ? -4 : -5} ${kitten ? -9 : -11} l${kitten ? -6 : -8} 7 Z`}
      />
      {/* Cabeza. */}
      <circle className="cat-ink" cx="36" cy={headCy} r={headR} />
      {/* Ojos: tinta del papel, cambian con el humor. */}
      {eyes === "open" ? (
        <>
          <circle className="cat-eye" cx={36 - 5} cy={headCy} r={1.7} />
          <circle className="cat-eye" cx={36 + 5} cy={headCy} r={1.7} />
        </>
      ) : eyes === "half" ? (
        <>
          <path className="cat-eye-line" d={`M${36 - 7} ${headCy} h4`} />
          <path className="cat-eye-line" d={`M${36 + 3} ${headCy} h4`} />
        </>
      ) : (
        <>
          <path className="cat-eye-line" d={`M${36 - 7} ${headCy} q2 2 4 0`} />
          <path className="cat-eye-line" d={`M${36 + 3} ${headCy} q2 2 4 0`} />
        </>
      )}
      {/* Nariz y bigotes. */}
      <path className="cat-eye" d={`M36 ${headCy + 3} l-1.5 1.6 h3 Z`} />
      <path
        className="cat-whisker"
        d={`M${36 - headR + 1} ${headCy + 3} h-9 M${36 - headR + 1} ${headCy + 6} l-8 2 M${36 + headR - 1} ${headCy + 3} h9 M${36 + headR - 1} ${headCy + 6} l8 2`}
      />
      {/* Accesorios de cofre + collar de la etapa bibliotecaria. */}
      {accessories.includes("bufanda") ? (
        <path
          className="cat-acc cat-acc--cloth"
          d={`M${36 - headR + 2} ${headCy + headR - 3} q${headR - 2} 7 ${headR * 2 - 4} 0 l-2 5 q-${headR - 4} 4 -${headR * 2 - 8} 0 Z`}
        />
      ) : null}
      {(accessories.includes("collar") || stage >= 3) && !accessories.includes("bufanda") ? (
        <path
          className="cat-acc cat-acc--collar"
          d={`M${36 - headR + 3} ${headCy + headR - 2} q${headR - 3} 6 ${headR * 2 - 6} 0`}
        />
      ) : null}
      {accessories.includes("moño") ? (
        <path
          className="cat-acc cat-acc--cloth"
          d={`M${36 + headR - 8} ${headCy - headR - 2} l6 -5 2 7 -6 4 Z M${36 + headR - 8} ${headCy - headR - 2} l-2 -6 7 1 1 7 Z`}
        />
      ) : null}
      {accessories.includes("anteojos") ? (
        <g className="cat-acc cat-acc--glasses">
          <circle cx={36 - 5} cy={headCy} r={3.4} />
          <circle cx={36 + 5} cy={headCy} r={3.4} />
          <path d={`M${36 - 1.6} ${headCy} h3.2 M${36 - 8.4} ${headCy} l-4 -3 M${36 + 8.4} ${headCy} l4 -3`} />
        </g>
      ) : null}
      {/* «zzz» sobre la oreja cuando duerme; se desvanece en CSS. */}
      {sleeping ? (
        <text className="cat-zzz" x="54" y="20">
          z
        </text>
      ) : null}
    </svg>
  );
}
