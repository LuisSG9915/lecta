// Panel del juego dentro del Cuaderno: el gato de biblioteca, nivel
// con su barra de tinta, racha de días, cofres pendientes y la vitrina
// de logros. Si la preferencia «Compañero y logros» está apagada en
// Cuenta, este panel no existe — ni compañero ni XP visible.
//
// El gato es un botón que abre la hoja del CompanionProvider (cuidado,
// nombre, armario) — el estado lo comparte ese mismo proveedor, así
// que aquí solo se consume por contexto y no hay otra carga ni otro
// gato. Los cofres se comprometen ANTES de revelar: primero se
// persiste la recepción y solo entonces se muestra el contenido.

import { useEffect, useRef, useState } from "react";
import { loadGame, openGameChest, writeCompanionField } from "../lib/game";
import { captureDbScope } from "../lib/idb";
import { useCompanion } from "./CompanionProvider";
import { CompanionButton } from "./CompanionButton";
import {
  COMPANION_ARTICLES,
  type CompanionArticle,
} from "../../shared/companion-data";
import {
  ACCESSORY_LABELS,
  ACHIEVEMENTS,
  levelProgress,
  pendingChests,
  type GameChest,
} from "../lib/gamification";

// Contenido recién abierto de un cofre: la ropa ofrece ponérsela sin
// salir del panel y el resto se retira solo a los segundos.
const REVEAL_MS = 2500;

export function GamePanel() {
  const { enabled, state, name, accessories, mood, stage, openPanel } =
    useCompanion();
  const [chestBusy, setChestBusy] = useState<string | null>(null);
  const [chestError, setChestError] = useState("");
  const [revealed, setRevealed] = useState<GameChest | null>(null);
  const [wearBusy, setWearBusy] = useState(false);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRevealTimer = () => {
    if (revealTimer.current !== null) {
      clearTimeout(revealTimer.current);
      revealTimer.current = null;
    }
  };
  useEffect(() => clearRevealTimer, []);

  if (!enabled || !state) return null;

  const prog = levelProgress(state.xp);
  const chests = pendingChests(state);
  const earned = ACHIEVEMENTS.filter((a) => state.achievements[a.id]);
  const revealedArticle =
    revealed && Object.hasOwn(COMPANION_ARTICLES, revealed.reward)
      ? (revealed.reward as CompanionArticle)
      : null;

  const open = (chest: GameChest) => {
    if (chestBusy) return;
    const scope = captureDbScope();
    setChestBusy(chest.id);
    setChestError("");
    clearRevealTimer();
    setRevealed(null);
    void (async () => {
      // El compromiso manda: la recepción del cofre se persiste y se
      // relee la proyección — solo una apertura REAL se revela; un
      // commit que no aterrizó muestra el error, nunca el contenido.
      await openGameChest(chest.id, scope);
      const fresh = await loadGame(scope);
      const opened =
        fresh.chests.find((c) => c.id === chest.id)?.openedAt != null;
      if (!opened) {
        setChestError("No se pudo abrir el cofre. Intenta de nuevo.");
        return;
      }
      setRevealed(chest);
      // La ropa espera la decisión «Ponérselo / Después»; las demás
      // recompensas se anuncian un momento y se retiran solas.
      if (!Object.hasOwn(COMPANION_ARTICLES, chest.reward)) {
        revealTimer.current = setTimeout(() => {
          revealTimer.current = null;
          setRevealed(null);
        }, REVEAL_MS);
      }
    })()
      .catch(() => {
        setChestError("No se pudo abrir el cofre. Intenta de nuevo.");
      })
      .finally(() => setChestBusy(null));
  };

  const wear = (article: CompanionArticle) => {
    if (wearBusy) return;
    const scope = captureDbScope();
    setWearBusy(true);
    setChestError("");
    void writeCompanionField(`equipped.${COMPANION_ARTICLES[article]}`, article, scope)
      .then(() => {
        clearRevealTimer();
        setRevealed(null);
      })
      .catch(() => {
        setChestError("No se pudo poner la prenda. Intenta de nuevo.");
      })
      .finally(() => setWearBusy(false));
  };

  return (
    <section className="game cat-anim" aria-label="Tu compañero y progreso">
      <div className="game-head">
        <CompanionButton
          stage={stage}
          mood={mood}
          accessories={accessories}
          name={name}
          label={`Ver a ${name}`}
          onClick={openPanel}
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
        <div className="game-reveal">
          <p role="status">
            El cofre tenía: {ACCESSORY_LABELS[revealed.reward] ?? revealed.reward}.
          </p>
          {revealedArticle ? (
            <div className="actions">
              <button
                type="button"
                className="btn"
                disabled={wearBusy}
                onClick={() => wear(revealedArticle)}
              >
                Ponérselo
              </button>
              <button
                type="button"
                className="btn--quiet"
                disabled={wearBusy}
                onClick={() => {
                  clearRevealTimer();
                  setRevealed(null);
                }}
              >
                Después
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {chestError ? (
        <p className="status" role="alert">
          {chestError}
        </p>
      ) : null}

      {chests.length ? (
        <ul className="game-chests" aria-label="Cofres por abrir">
          {chests.map((chest) => (
            <li key={chest.id}>
              <button
                type="button"
                className="game-chest"
                disabled={chestBusy !== null}
                onClick={() => open(chest)}
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
