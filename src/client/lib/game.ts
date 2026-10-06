// Capa de IO del juego del Cuaderno: preferencia «companion» (mismo
// patrón que «Usar IA») y el estado en la tienda session de IndexedDB
// — por cuenta, sin migración, local a este dispositivo. `award` es
// auxiliar como trackReadingEvent: el llamador lo invoca con `void` y
// un fallo jamás interrumpe lectura ni repaso.

import {
  captureDbScope,
  isDbScopeActive,
  loadSessionValue,
  saveSessionValue,
  type DbScope,
} from "./idb";
import {
  applyGameEvent,
  emptyGameState,
  openChest,
  type GameEvent,
  type GameState,
} from "./gamification";

export const GAME_KEY = "companion";
const GAME_STATE_KEY = "gameState";

// Encendido por defecto, opt-out en Cuenta — igual que el historial.
export async function loadGameEnabled(scope?: DbScope): Promise<boolean> {
  try {
    return (await loadSessionValue(GAME_KEY, scope)) !== "0";
  } catch {
    return true;
  }
}

export async function saveGameEnabled(on: boolean, scope?: DbScope) {
  await saveSessionValue(GAME_KEY, on ? "1" : "0", scope);
}

// ---------- Estado en memoria + persistencia ----------

// La caché va etiquetada con el contexto de cuenta que la produjo:
// un premio o una lectura bajo un contexto vencido jamás presenta ni
// persiste el estado de la cuenta nueva.
let cache: { scope: DbScope; state: GameState } | null = null;
// Las escrituras se encolan: lectura (Reader) y repaso (Cuaderno)
// pueden coincidir y un JSON sobreescrito perdería XP. La cola no se
// reinicia al cambiar de cuenta — cada tarea encolada lleva su propio
// contexto y aborta sola si el suyo venció.
let queue: Promise<void> = Promise.resolve();

const listeners = new Set<() => void>();

export function subscribeGame(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const notify = () => {
  for (const fn of listeners) fn();
};

export async function loadGame(scope?: DbScope): Promise<GameState> {
  const bound = scope ?? captureDbScope();
  if (cache && isDbScopeActive(cache.scope) && cache.scope.userId === bound.userId)
    return cache.state;
  let state: GameState;
  try {
    const raw = await loadSessionValue(GAME_STATE_KEY, bound);
    const parsed = raw ? (JSON.parse(raw) as GameState) : null;
    state = parsed && parsed.version === 1 && parsed.stats ? parsed : emptyGameState();
  } catch {
    /* estado dañado: se reinicia limpio, sin drama */
    state = emptyGameState();
  }
  // Solo se memoriza el estado del contexto vigente: una lectura
  // tardía de la cuenta anterior no tapa la de la cuenta activa.
  if (isDbScopeActive(bound)) cache = { scope: bound, state };
  return state;
}

const persist = (state: GameState, scope: DbScope) =>
  saveSessionValue(GAME_STATE_KEY, JSON.stringify(state), scope);

// Suma el evento al estado si el juego está encendido. Encola la
// escritura con el contexto que la originó y aborta en silencio si
// venció (la cuenta cambió antes de que el premio tocara disco):
// nunca se aplica a la cuenta nueva. Avisa a quien escuche (el panel
// del Cuaderno) solo si el estado persistido quedó vigente.
export function award(event: GameEvent, scope?: DbScope): Promise<void> {
  const bound = scope ?? captureDbScope();
  queue = queue.then(async () => {
    try {
      if (!isDbScopeActive(bound)) return;
      if (!(await loadGameEnabled(bound))) return;
      if (!isDbScopeActive(bound)) return;
      const prev = await loadGame(bound);
      const { state } = applyGameEvent(prev, event, Date.now(), () =>
        crypto.randomUUID(),
      );
      if (!isDbScopeActive(bound)) return;
      cache = { scope: bound, state };
      await persist(state, bound);
      if (!isDbScopeActive(bound)) return;
      notify();
    } catch {
      /* el juego es extra: un fallo no debe notarse */
    }
  });
  return queue;
}

export function openGameChest(id: string, scope?: DbScope): Promise<void> {
  const bound = scope ?? captureDbScope();
  queue = queue.then(async () => {
    try {
      if (!isDbScopeActive(bound)) return;
      const prev = await loadGame(bound);
      const state = openChest(prev, id, Date.now());
      if (!isDbScopeActive(bound)) return;
      cache = { scope: bound, state };
      await persist(state, bound);
      if (!isDbScopeActive(bound)) return;
      notify();
    } catch {
      /* igual: silencio */
    }
  });
  return queue;
}

// Para pruebas y cambio de cuenta: suelta el estado en memoria. La
// cola y los listeners siguen — cada tarea encolada lleva su contexto
// y aborta sola si venció; las suscripciones las maneja el desmontaje.
export function resetGameCache() {
  cache = null;
}
