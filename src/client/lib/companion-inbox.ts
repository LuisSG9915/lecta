// Inbox de festejos del compañero (fase 5): lo que el juego ya ganó
// — logros nuevos, subidas de nivel o un cambio de etapa — y la interfaz
// aún no anuncia. Módulo puro: entra la proyección vigente más lo ya
// importado (baselines) y lo ya visto (receipts), y sale la cola de
// pendientes. No toca XP, estadísticas ni logros: solo decide qué
// tarjeta falta por mostrarse.
//
// Reglas duras:
// - Un premio importado en un baseline v1 NUNCA celebra (ya existía
//   cuando se migró).
// - Lo que ya tiene recibo «achievement-seen:<id>», «level-seen:<n>» o
//   «stage-seen:<etapa>» no se repite — ni tras remontar ni tras
//   sincronizar desde otro dispositivo.
// - Varios logros pendientes se agrupan en UNA tarjeta.
// - Saltos de varios niveles se agrupan en UNA tarjeta con el nivel
//   más alto; si coincide con una evolución de etapa, se celebra junta.
// - La evolución es una sola: la etapa actual proyectada; si ya se
//   celebró con recibo, nada pendiente.
// - El pull/sync no genera festejos ficticios: solo llegan logros o
//   XP reales de eventos, y el filtro de baseline/recibos decide.

import {
  ACHIEVEMENTS,
  catStageForLevel,
  levelFor,
  type GameState,
} from "./gamification";
import {
  receiptIdFor,
  type CompanionReceipt,
  type LegacyGameBaseline,
} from "../../shared/companion-data";

export type CelebrationItem =
  // Logros pendientes agrupados: ids (para el recibo) + títulos.
  | { kind: "achievements"; ids: string[]; titles: string[] }
  // Subida de nivel proyectada y aún no vista (con salto de varios niveles agrupado).
  | { kind: "level"; level: number; crossed: number[]; stage?: number }
  // Cambio de etapa proyectado y aún no celebrado (fallback si no se agrupó con nivel).
  | { kind: "stage"; stage: number };

export function pendingCelebrations(input: {
  state: GameState;
  baselines: LegacyGameBaseline[];
  receipts: CompanionReceipt[];
}): CelebrationItem[] {
  const seen = new Set(input.receipts.map((r) => r.id));
  // Lo que venía de la migración v1 no es «nuevo»: ni sus logros ni
  // su nivel cuentan como premio fresco.
  const baselineAchievements = new Set<string>();
  let baselineXp = 0;
  for (const b of input.baselines) {
    for (const id of Object.keys(b.state.achievements))
      baselineAchievements.add(id);
    if (b.state.xp > baselineXp) baselineXp = b.state.xp;
  }

  // Solo logros del catálogo vigente, ganados en `state`, que no
  // vinieran en la baseline ni tengan recibo de visto. Orden de
  // obtención para un texto estable («el primero y N más»).
  const ids = ACHIEVEMENTS.filter(
    (a) =>
      input.state.achievements[a.id] !== undefined &&
      !baselineAchievements.has(a.id) &&
      !seen.has(receiptIdFor("achievement-seen", a.id)),
  )
    .map((a) => a.id)
    .sort(
      (a, b) => input.state.achievements[a] - input.state.achievements[b],
    );

  const items: CelebrationItem[] = [];
  if (ids.length) {
    const titleById = new Map(ACHIEVEMENTS.map((a) => [a.id, a.title]));
    items.push({
      kind: "achievements",
      ids,
      titles: ids.map((id) => titleById.get(id) ?? id),
    });
  }

  const currentLevel = levelFor(input.state.xp);
  const baseLevel = levelFor(baselineXp);

  const unseenCrossed: number[] = [];
  for (let lvl = baseLevel + 1; lvl <= currentLevel; lvl++) {
    if (!seen.has(receiptIdFor("level-seen", String(lvl)))) {
      unseenCrossed.push(lvl);
    }
  }

  const stage = catStageForLevel(currentLevel);
  const baseStage = catStageForLevel(baseLevel);
  const hasPendingStage =
    stage > baseStage &&
    !seen.has(receiptIdFor("stage-seen", String(stage)));

  if (unseenCrossed.length > 0) {
    const highestLevel = Math.max(...unseenCrossed);
    items.push({
      kind: "level",
      level: highestLevel,
      crossed: unseenCrossed,
      ...(hasPendingStage ? { stage } : {}),
    });
  } else if (hasPendingStage) {
    items.push({ kind: "stage", stage });
  }

  return items;
}
