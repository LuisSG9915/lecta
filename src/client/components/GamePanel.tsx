// Panel del juego dentro del Cuaderno: el gato de biblioteca, nivel
// con su barra de tinta continua (ProgressInk), racha de días, cofres
// pendientes y la meta próxima hacia el siguiente rango de logro.
// Si la preferencia «Compañero y logros» está apagada en Cuenta, este
// panel no existe — ni compañero ni XP visible.
//
// El gato es un botón que abre la hoja del CompanionProvider (cuidado,
// nombre, armario, vitrina) — el estado lo comparte ese mismo proveedor,
// así que aquí solo se consume por contexto y no hay otra carga ni otro
// gato. Los cofres se comprometen ANTES de revelar: primero se persiste
// la recepción y solo entonces se muestra el contenido.

import { useEffect, useRef, useState } from "react";
import { loadGame, openGameChest, writeCompanionField } from "../lib/game";
import { captureDbScope } from "../lib/idb";
import { useCompanion } from "./CompanionProvider";
import { CompanionButton } from "./CompanionButton";
import { ProgressInk } from "./ProgressInk";
import { Seal, toRoman } from "./Seal";
import {
  COMPANION_ARTICLES,
  type CompanionArticle,
} from "../../shared/companion-data";
import {
  ACCESSORY_LABELS,
  levelProgress,
  listFamilyProgress,
  pendingChests,
  type GameChest,
} from "../lib/gamification";

// Contenido recién abierto de un cofre: la ropa ofrece ponérsela sin
// salir del panel y el resto se retira solo a los segundos.
const REVEAL_MS = 2500;

export function GamePanel() {
  const {
    enabled,
    state,
    name,
    accessories,
    mood,
    stage,
    openPanel,
    reducedMotion = false,
  } = useCompanion();
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
  const revealedArticle =
    revealed && Object.hasOwn(COMPANION_ARTICLES, revealed.reward)
      ? (revealed.reward as CompanionArticle)
      : null;

  // Meta próxima: familia con mayor progreso relativo al siguiente rango
  const pendingFamilies = listFamilyProgress(state).filter(
    (f) => f.nextAchievement !== null,
  );
  const nextGoal =
    pendingFamilies.length > 0
      ? [...pendingFamilies].sort((a, b) => b.ratio - a.ratio)[0]
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
          <ProgressInk
            value={state.xp}
            max={prog.ceil ?? state.xp}
            floor={prog.floor}
            level={prog.level}
            label="Progreso al siguiente nivel"
            variant="vermilion"
            reducedMotion={reducedMotion}
          />
          <p className="meta">
            {Math.floor(state.xp)} puntos
            {prog.ceil !== null
              ? ` · ${prog.ceil - Math.floor(state.xp)} para el siguiente`
              : " · nivel máximo"}
            {state.stats.streakDays > 1
              ? ` · racha de ${state.stats.streakDays} días`
              : ""}
          </p>
          {mood === "asleep" ? (
            <p className="meta">El gato duerme; una lectura lo despierta.</p>
          ) : null}
        </div>
      </div>

      {revealed ? (
        <div
          className={`game-reveal ${reducedMotion ? "" : "game-reveal-stamped"}`.trim()}
        >
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
                <svg
                  viewBox="0 0 24 24"
                  width="22"
                  height="22"
                  className={`game-chest-svg ${chestBusy === chest.id ? "is-opening" : ""}`.trim()}
                  aria-hidden="true"
                >
                  <path
                    d="M3 10 H21 V19 C21 20.1 20.1 21 19 21 H5 C3.9 21 3 20.1 3 19 Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                  />
                  <rect
                    x="10.5"
                    y="10"
                    width="3"
                    height="4"
                    rx="0.5"
                    fill="currentColor"
                  />
                  <path
                    className="game-chest-lid"
                    d="M2.5 10 C2.5 7 5 5 12 5 C19 5 21.5 7 21.5 10 Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>
                  <span className="game-chest-label">{chest.label}</span>
                  <span className="meta">Toca para abrir</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {nextGoal ? (
        <div
          className="game-next-goal"
          aria-label={`Siguiente meta: ${nextGoal.info.name}`}
        >
          <Seal
            family={nextGoal.family}
            rank={nextGoal.ranksEarned}
            maxRank={nextGoal.ranksTotal}
            size={40}
          />
          <div className="game-next-goal-meta">
            <div className="game-next-goal-title">
              <span>{nextGoal.info.name}</span>
              <span className="game-next-goal-rank">
                Rango {toRoman(nextGoal.ranksEarned + 1)}
              </span>
            </div>
            <ProgressInk
              value={nextGoal.current}
              max={nextGoal.goal}
              variant="ochre"
              reducedMotion={reducedMotion}
            />
            <p className="game-next-goal-hint">
              {Math.floor(nextGoal.current)} de {nextGoal.goal}{" "}
              {nextGoal.goal === 1
                ? nextGoal.info.unit.singular
                : nextGoal.info.unit.plural}
              {nextGoal.nextAchievement
                ? ` · «${nextGoal.nextAchievement.title}»`
                : ""}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
