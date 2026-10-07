// Tarjeta del inbox de festejos del compañero (fase 5): una tarjeta
// pequeña fija en la zona segura inferior, con role="status" —
// anuncia sin robar foco, sin confeti ni flashes, y sin bloquear
// nada de lo que hay detrás. Vive una sola instancia dentro del
// CompanionProvider, que conoce la cuenta vigente y si hay capas
// encima (hoja de cuidado, modales, lectura suprimida).
//
// Contrato de «visto»: al MOSTRARSE de verdad una tarjeta se persiste
// su recibo (achievement-seen:<id> por cada logro, stage-seen:<n>
// para la etapa) — monotónico e idempotente. Si la superficie está
// bloqueada (overlay, «off», supresión por libro), la tarjeta queda
// PENDIENTE sin marcar: se verá cuando haya contexto seguro. La
// memoria local `shown` evita repetir dentro de la sesión mientras el
// recibo aterriza; la remontaje por cambio de cuenta (key en el
// proveedor) la limpia.

import { useEffect, useState } from "react";
import { Companion } from "./Companion";
import type { CelebrationItem } from "../lib/companion-inbox";

// Duración en pantalla por clase de festejo (ms).
export const CELEBRATION_MS: Record<CelebrationItem["kind"], number> = {
  achievements: 4_000,
  stage: 3_000,
};

// Nombres de etapa del gato, alineados con catStageForLevel.
const STAGE_LABELS = [
  "gatito",
  "gatito atento",
  "gato",
  "gato con collar",
  "gato bibliotecario",
];

const itemKey = (item: CelebrationItem): string =>
  item.kind === "stage"
    ? `stage:${item.stage}`
    : `achievements:${item.ids.join(",")}`;

export function CompanionCelebration({
  items,
  blocked,
  name,
  stage,
  accessories,
  onSeen,
}: {
  // Pendientes calculados por el proveedor (máx. dos entradas:
  // logros agrupados y/o evolución).
  items: CelebrationItem[];
  // La superficie no es segura para festejar ahora (hoja, modal,
  // lectura suprimida o «off»): quedan pendientes sin marcar.
  blocked: boolean;
  name: string;
  stage: number;
  accessories: string[];
  // La tarjeta se mostró: persistir el recibo correspondiente.
  onSeen: (item: CelebrationItem) => void;
}) {
  // Tarjetas ya exhibidas en esta sesión del componente: el recibo
  // puede tardar un instante en aterrizar; sin esta memoria se
  // repetirían en la ventana entre marca y persistencia.
  const [shown, setShown] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [display, setDisplay] = useState<CelebrationItem | null>(null);

  // La primera pendiente no exhibida todavía.
  const next = items.find((item) => !shown.has(itemKey(item))) ?? null;

  // Ajuste durante el render (como `seenStatus` del lector): la
  // tarjeta vigente solo cede cuando ya cumplió su tiempo — así un
  // recibo que aterriza a mitad y saca la pendiente de `items` no la
  // corta. Con la superficie bloqueada no entra ninguna.
  if (!blocked) {
    if (display === null && next !== null) {
      setDisplay(next);
    } else if (
      display !== null &&
      shown.has(itemKey(display)) &&
      (next === null || itemKey(next) !== itemKey(display))
    ) {
      setDisplay(next);
    }
  }

  // Al mostrarse: se marca como vista (recibo persistente) y corre
  // su temporizador. Si la superficie se bloquea a mitad la tarjeta
  // se retira sin completar; al volver corre su tiempo entero otra
  // vez — pendiente, nunca perdida.
  useEffect(() => {
    if (!display || blocked) return;
    onSeen(display);
    const timer = window.setTimeout(() => {
      setShown((prev) => new Set(prev).add(itemKey(display)));
    }, CELEBRATION_MS[display.kind]);
    return () => window.clearTimeout(timer);
  }, [display, blocked, onSeen]);

  if (blocked || !display) return null;

  const text =
    display.kind === "stage"
      ? `${name} ha crecido: ${STAGE_LABELS[display.stage] ?? "nueva etapa"}`
      : display.titles[0] +
        (display.ids.length > 1 ? ` y ${display.ids.length - 1} más` : "");

  return (
    <div
      className="companion-toast cat-anim"
      role="status"
      data-kind={display.kind}
    >
      <Companion
        stage={stage}
        mood="awake"
        accessories={accessories}
        pose={display.kind === "stage" ? "evolve" : "celebrate"}
        decorative
      />
      <p className="companion-toast-text">{text}</p>
    </div>
  );
}
