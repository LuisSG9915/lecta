// Panel del juego dentro del Cuaderno: el gato de biblioteca, nivel
// con su barra de tinta, racha de días, cofres pendientes y la vitrina
// de logros. Si la preferencia «Compañero y logros» está apagada en
// Cuenta, este panel no existe — ni compañero ni XP visible.

import { useEffect, useState } from "react";
import {
  loadGame,
  loadGameEnabled,
  openGameChest,
  subscribeGame,
} from "../lib/game";
import { captureDbScope } from "../lib/idb";
import {
  ACCESSORY_LABELS,
  ACHIEVEMENTS,
  catMood,
  catStageForLevel,
  levelProgress,
  pendingChests,
  unlockedAccessories,
  type GameState,
} from "../lib/gamification";
import { Companion } from "./Companion";

export function GamePanel() {
  const [state, setState] = useState<GameState | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  // El humor depende del reloj: se captura al refrescar, no en render.
  const [now, setNow] = useState(0);
  // El cofre recién abierto muestra su contenido un momento.
  const [revealed, setRevealed] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const scope = captureDbScope();
      const [on, game] = await Promise.all([
        loadGameEnabled(scope),
        loadGame(scope),
      ]);
      if (!alive) return;
      setEnabled(on);
      setState(game);
      setNow(Date.now());
    };
    void refresh();
    const unsub = subscribeGame(() => void refresh());
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  if (!enabled || !state) return null;

  const prog = levelProgress(state.xp);
  const stage = catStageForLevel(prog.level);
  const mood = catMood(state, now || state.caredAt || 1);
  const chests = pendingChests(state);
  const earned = ACHIEVEMENTS.filter((a) => state.achievements[a.id]);

  const open = (id: string) => {
    const chest = state.chests.find((c) => c.id === id);
    setRevealed(
      chest ? (ACCESSORY_LABELS[chest.reward] ?? chest.reward) : null,
    );
    void openGameChest(id, captureDbScope());
  };

  return (
    <section className="game" aria-label="Tu compañero y progreso">
      <div className="game-head">
        <Companion
          stage={stage}
          mood={mood}
          accessories={unlockedAccessories(state)}
        />
        <div className="game-meta">
          <p className="game-level">
            Nivel {prog.level + 1} · {prog.name}
          </p>
          <div
            className="game-xpbar"
            role="progressbar"
            aria-valuenow={Math.floor(state.xp)}
            aria-valuemin={prog.floor}
            aria-valuemax={prog.ceil ?? Math.floor(state.xp)}
            aria-label="Progreso al siguiente nivel"
          >
            <span style={{ width: `${prog.ratio * 100}%` }} />
          </div>
          <p className="meta">
            {Math.floor(state.xp)} puntos
            {prog.ceil !== null ? ` · ${prog.ceil - Math.floor(state.xp)} para el siguiente` : " · nivel máximo"}
            {state.stats.streakDays > 1 ? ` · racha de ${state.stats.streakDays} días` : ""}
          </p>
          {mood === "asleep" ? (
            <p className="meta">El gato duerme; una lectura lo despierta.</p>
          ) : null}
        </div>
      </div>

      {revealed ? (
        <p className="game-reveal" role="status">
          El cofre tenía: {revealed}.
        </p>
      ) : null}

      {chests.length ? (
        <ul className="game-chests" aria-label="Cofres por abrir">
          {chests.map((chest) => (
            <li key={chest.id}>
              <button
                type="button"
                className="game-chest"
                onClick={() => open(chest.id)}
              >
                <span className="game-chest-fig" aria-hidden="true">
                  ▣
                </span>
                <span>
                  <span className="game-chest-label">{chest.label}</span>
                  <span className="meta">Toca para abrir</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {earned.length ? (
        <details className="game-shelf">
          <summary className="meta">
            Logros · {earned.length} de {ACHIEVEMENTS.length}
          </summary>
          <ul className="game-badges">
            {earned.map((a) => (
              <li key={a.id} className="game-badge" title={a.desc}>
                {a.title}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
