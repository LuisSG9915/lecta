// Hoja del compañero: vista previa del gato, acciones de cuidado
// (acariciar, dar de comer, jugar), editor de nombre, armario visual
// por ranuras (cuerpo, cuello, cabeza, cara, pelaje), y el nuevo
// apartado sólido de Recompensas (apertura de cofres, ceremonia de
// revelación, ruta de niveles) y Vitrina de colección (estampas y exlibris).
//
// Monta una sola vez CompanionProvider para toda la app. Todo lo que
// se escribe pasa por writeCompanionField / openGameChest con el
// DbScope capturado al pulsar, sincronizado por cuenta.

import { useEffect, useState, type FormEvent } from "react";
import Sheet from "./Sheet";
import { Companion } from "./Companion";
import { openGameChest, writeCompanionField } from "../lib/game";
import { captureDbScope } from "../lib/idb";
import {
  COMPANION_ARTICLES,
  type CompanionArticle,
  type EquippedItems,
  type EquippedSlot,
} from "../../shared/companion-data";
import {
  ACCESSORY_LABELS,
  ACHIEVEMENTS,
  COAT_LEVELS,
  LEVELS,
  catStageForLevel,
  dayKeyOf,
  levelProgress,
  pendingChests,
  requiredCoatLevel,
  rewardForLevel,
  unlockedAccessories,
  unlockedCoats,
  type CatMood,
  type GameChest,
  type GameState,
} from "../lib/gamification";
import { triggerPurrHaptic } from "../lib/haptics";
import { playCompanionSound } from "../lib/companion-audio";
import {
  CARE_POSES,
  CARE_STATUS,
  cleanCompanionName,
  companionGreeting,
  type CareKind,
} from "../lib/companion-interactions";

export type CompanionPanelProps = {
  // null mientras carga: la hoja enseña su esqueleto y nada más.
  state: GameState | null;
  name: string;
  // Lo puesto según los registros (null = ranura vacía a propósito);
  // puede incluir prendas elegidas en otro dispositivo que aquí aún
  // están bloqueadas — se conservan como dato aunque no se dibujen.
  equipped: EquippedItems;
  // Lo que sí se dibuja: lo puesto ∩ el inventario local.
  accessories: string[];
  mood: CatMood;
  activeCare: CareKind | null;
  onCare: (kind: CareKind) => Promise<void>;
  onClose: () => void;
};

const SLOT_ORDER: EquippedSlot[] = ["body", "neck", "head", "face", "coat"];

const SLOT_LABELS: Record<EquippedSlot, string> = {
  body: "Cuerpo",
  neck: "Cuello",
  head: "Cabeza",
  face: "Cara",
  coat: "Pelaje",
};

const ARTICLE_LABELS: Record<CompanionArticle, string> = {
  chaleco: "Chaleco",
  capa: "Capa de terciopelo",
  bufanda: "Bufanda",
  collar: "Collar",
  corbatin: "Corbatín",
  moño: "Moño",
  boina: "Boina de poeta",
  anteojos: "Anteojos",
  monoculo: "Monóculo",
  "pelaje-atigrado": "Atigrado",
  "pelaje-gris": "Gris azulado",
  "pelaje-calico": "Calicó",
  "pelaje-siames": "Siamés",
  "pelaje-negro": "Medianoche",
  "pelaje-tuxedo": "Tuxedo",
  "pelaje-dorado": "Dorado",
};

const ARTICLE_ICONS: Record<CompanionArticle, string> = {
  chaleco: "🦺",
  capa: "🦸",
  bufanda: "🧣",
  collar: "🔔",
  corbatin: "🎀",
  moño: "🎀",
  boina: "🎓",
  anteojos: "👓",
  monoculo: "🧐",
  "pelaje-atigrado": "🐯",
  "pelaje-gris": "🐺",
  "pelaje-calico": "🐱",
  "pelaje-siames": "🐱",
  "pelaje-negro": "🐈‍⬛",
  "pelaje-tuxedo": "🤵",
  "pelaje-dorado": "👑",
};

type CompanionTab = "care" | "rewards" | "closet" | "collection";

// Requisito real de desbloqueo: el nivel visible (1-based) — de
// cofre para las prendas, directo del nivel para los pelajes;
// null = sin requisito (el chaleco es gratis).
function requiredLevel(article: CompanionArticle): number | null {
  const coat = requiredCoatLevel(article);
  if (coat !== null) return coat;
  for (let i = 0; i < LEVELS.length; i += 1) {
    if (rewardForLevel(i) === article) return i + 1;
  }
  return null;
}

const articlesFor = (slot: EquippedSlot): CompanionArticle[] =>
  (Object.keys(COMPANION_ARTICLES) as CompanionArticle[]).filter(
    (article) => COMPANION_ARTICLES[article] === slot,
  );

export function CompanionPanel({
  state,
  name,
  equipped,
  accessories,
  mood,
  activeCare,
  onCare,
  onClose,
}: CompanionPanelProps) {
  const [tab, setTab] = useState<CompanionTab>("care");
  const [closetOpen, setClosetOpen] = useState(false);
  const [equipBusy, setEquipBusy] = useState(false);
  const [closetError, setClosetError] = useState("");
  const [careError, setCareError] = useState("");
  const [draft, setDraft] = useState(name);
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState("");

  // Apertura de cofres y revelación de recompensas
  const [chestBusy, setChestBusy] = useState<string | null>(null);
  const [chestError, setChestError] = useState("");
  const [revealedChest, setRevealedChest] = useState<GameChest | null>(null);

  // Saludo de llegada: el gato saluda con la patita al abrir la hoja
  // y la línea contextual conserva el humor del momento de llegada.
  const [arrival, setArrival] = useState<{ mood: CatMood; at: Date } | null>(
    null,
  );
  if (state && arrival === null) setArrival({ mood, at: new Date() });
  const [waving, setWaving] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setWaving(false), 2400);
    return () => clearTimeout(timer);
  }, []);
  const greeting = arrival
    ? companionGreeting(name, arrival.mood, arrival.at)
    : null;

  // Sincronización del borrador del nombre con las props
  const [draftFor, setDraftFor] = useState(name);
  if (draftFor !== name) {
    setDraftFor(name);
    setDraft(name);
  }

  const cleaned = cleanCompanionName(draft);
  const nameInvalid = cleaned === null && draft !== name;
  const canSave = cleaned !== null && cleaned !== name;

  const doCare = (kind: CareKind) => {
    if (activeCare) return;
    if (kind === "pet") triggerPurrHaptic();
    setCareError("");
    void onCare(kind).catch(() => {
      setCareError("No se pudo registrar el cuidado. Intenta de nuevo.");
    });
  };

  const saveName = async (event: FormEvent) => {
    event.preventDefault();
    const value = cleanCompanionName(draft);
    if (value === null || value === name || nameBusy) return;
    setNameBusy(true);
    setNameError("");
    try {
      await writeCompanionField("name", value, captureDbScope());
    } catch {
      setNameError("No se pudo guardar el nombre. Intenta de nuevo.");
    } finally {
      setNameBusy(false);
    }
  };

  // Elegir prenda — o «Sin prenda», que escribe null explícito
  const choose = async (slot: EquippedSlot, article: string | null) => {
    if (equipBusy) return;
    setEquipBusy(true);
    setClosetError("");
    try {
      await writeCompanionField(`equipped.${slot}`, article, captureDbScope());
    } catch {
      setClosetError("No se pudo guardar la prenda. Intenta de nuevo.");
    } finally {
      setEquipBusy(false);
    }
  };

  const prog = state ? levelProgress(state.xp) : null;
  const owned = state
    ? new Set<string>([
        "chaleco",
        ...unlockedAccessories(state),
        ...unlockedCoats(state),
      ])
    : new Set<string>();

  const chests = state ? pendingChests(state) : [];

  // Abrir cofre con ceremonia de sonido y háptica
  const doOpenChest = async (chest: GameChest) => {
    if (chestBusy) return;
    setChestBusy(chest.id);
    setChestError("");
    setRevealedChest(null);
    try {
      const scope = captureDbScope();
      await openGameChest(chest.id, scope);
      triggerPurrHaptic();
      playCompanionSound("purr");
      setRevealedChest(chest);
    } catch {
      setChestError("No se pudo abrir el cofre. Intenta de nuevo.");
    } finally {
      setChestBusy(null);
    }
  };

  // Ponerse directamente la recompensa recién abierta
  const wearRevealed = async (article: string) => {
    if (equipBusy) return;
    const slot = COMPANION_ARTICLES[article as CompanionArticle];
    if (!slot) return;
    await choose(slot, article);
    setRevealedChest(null);
  };

  const wearOption = (slot: EquippedSlot, article: string | null) => {
    const puesto = equipped[slot] === article;
    const blocked =
      article !== null && !owned.has(article as CompanionArticle);
    const req = blocked ? requiredLevel(article as CompanionArticle) : null;
    const stateText = puesto
      ? "Puesta"
      : req !== null
        ? `Nivel ${req}`
        : "";
    const icon = article !== null ? ARTICLE_ICONS[article as CompanionArticle] : null;

    return (
      <button
        key={article ?? "none"}
        type="button"
        className="companion-wear"
        role="radio"
        aria-checked={puesto}
        data-active={puesto || undefined}
        disabled={equipBusy || blocked}
        onClick={() => void choose(slot, article)}
      >
        <span className="companion-wear-name">
          {icon ? (
            <span className="companion-wear-icon" aria-hidden="true">
              {icon}{" "}
            </span>
          ) : null}
          {article === null
            ? slot === "coat"
              ? "Natural"
              : "Sin prenda"
            : ARTICLE_LABELS[article as CompanionArticle]}
        </span>
        {stateText ? (
          <span className="companion-wear-state">{stateText}</span>
        ) : null}
      </button>
    );
  };

  // Datos para la ruta de recompensas y próximo botín
  const nextLevelIdx = prog ? prog.level + 1 : 0;
  const nextLevel = nextLevelIdx < LEVELS.length ? LEVELS[nextLevelIdx] : null;
  const nextRewardArticle = nextLevel ? (rewardForLevel(nextLevelIdx) as CompanionArticle) : null;
  const nextRewardCoat = nextLevel
    ? (Object.keys(COAT_LEVELS).find(
        (coat) => COAT_LEVELS[coat] === nextLevelIdx,
      ) as CompanionArticle | undefined)
    : undefined;
  const pointsRemaining = nextLevel && state ? Math.max(0, nextLevel.xp - Math.floor(state.xp)) : 0;

  const earnedAchievements = state
    ? ACHIEVEMENTS.filter((a) => Boolean(state.achievements[a.id]))
    : [];

  return (
    <Sheet label={name} onClose={onClose}>
      <div className="sheet-head">
        <strong className="sheet-title">{name}</strong>
        <button
          type="button"
          className="btn--quiet"
          onClick={onClose}
          aria-label="Cerrar"
          data-autofocus
        >
          Cerrar
        </button>
      </div>

      {!state || !prog ? (
        <p className="meta">Llegando…</p>
      ) : (
        <>
          <div className="companion-sheet-tabs" role="tablist" aria-label="Secciones del compañero">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "care"}
              className="companion-tab-btn"
              data-active={tab === "care" || undefined}
              onClick={() => setTab("care")}
            >
              🐾 Cuidado
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "rewards"}
              className="companion-tab-btn"
              data-active={tab === "rewards" || undefined}
              onClick={() => setTab("rewards")}
            >
              🎁 Recompensas
              {chests.length > 0 ? (
                <span className="companion-badge-dot" aria-label={`${chests.length} cofres por abrir`} />
              ) : null}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "closet"}
              className="companion-tab-btn"
              data-active={tab === "closet" || undefined}
              onClick={() => {
                setTab("closet");
                setClosetOpen(true);
              }}
            >
              🎩 Armario
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "collection"}
              className="companion-tab-btn"
              data-active={tab === "collection" || undefined}
              onClick={() => setTab("collection")}
            >
              📜 Vitrina
            </button>
          </div>

          <div className="companion-hero">
            <button
              type="button"
              className="companion-hero-cat"
              onClick={() => doCare("pet")}
              disabled={activeCare !== null}
              aria-label={`Acariciar a ${name}`}
              title={`Acariciar a ${name}`}
            >
              <Companion
                stage={catStageForLevel(prog.level)}
                mood={mood}
                accessories={accessories}
                focus={
                  !activeCare &&
                  !waving &&
                  arrival &&
                  state.stats.lastDayKey === dayKeyOf(arrival.at.getTime())
                    ? "reading"
                    : undefined
                }
                pose={
                  activeCare
                    ? CARE_POSES[activeCare]
                    : waving
                      ? "greet"
                      : undefined
                }
                name={name}
                decorative
              />
              {activeCare === "pet" ? (
                <span className="companion-pet-hearts" aria-hidden="true">
                  ♥
                </span>
              ) : null}
            </button>
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
                aria-label="Progreso de lectura"
              >
                <span style={{ width: `${prog.ratio * 100}%` }} />
              </div>
              <p className="meta">
                {Math.floor(state.xp)} puntos
                {prog.ceil !== null ? ` · ${prog.ceil - Math.floor(state.xp)} para el siguiente nivel` : " · nivel máximo"}
              </p>
              {arrival && state.stats.lastDayKey === dayKeyOf(arrival.at.getTime()) ? (
                <p className="companion-goal-badge" role="status">
                  <span className="companion-goal-icon" aria-hidden="true">🥣</span> Plato lleno hoy · Racha de {state.stats.streakDays} {state.stats.streakDays === 1 ? "día" : "días"}
                  {state.stats.streakDays >= 3 ? (
                    <span
                      className="companion-shield-hint"
                      title="Marcapáginas protector activo: si un día no lees, tu gato cuidará tu racha"
                    >
                      {" "}· 🔖 Activo
                    </span>
                  ) : null}
                </p>
              ) : (
                <p className="companion-goal-badge companion-goal-badge--pending">
                  <span className="companion-goal-icon" aria-hidden="true">📖</span> Lectura pendiente hoy
                  {state.stats.streakDays >= 3 ? (
                    <span
                      className="companion-shield-hint"
                      title="Marcapáginas protector activo: si un día no lees, tu gato cuidará tu racha"
                    >
                      {" "}· 🔖 Activo
                    </span>
                  ) : null}
                </p>
              )}
            </div>
          </div>

          {/* TAB 1: CUIDADO */}
          {tab === "care" ? (
            <div role="tabpanel" aria-label="Cuidado">
              <p className="meta companion-greeting">{greeting}</p>

              {activeCare ? (
                <p className="status companion-status" role="status">
                  {CARE_STATUS[activeCare](name)}
                </p>
              ) : null}
              {careError ? (
                <p className="status" role="alert">
                  {careError}
                </p>
              ) : null}

              <div
                className="companion-actions"
                role="group"
                aria-label="Cuidar al gato"
              >
                <button
                  type="button"
                  className="btn"
                  disabled={activeCare !== null}
                  onClick={() => doCare("pet")}
                >
                  Acariciar
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={activeCare !== null}
                  onClick={() => doCare("feed")}
                >
                  Dar de comer
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={activeCare !== null}
                  onClick={() => doCare("play")}
                >
                  Jugar con la pelota
                </button>
                <button
                  type="button"
                  className="btn--quiet"
                  aria-expanded={closetOpen}
                  onClick={() => {
                    setClosetOpen((open) => !open);
                    setTab("closet");
                  }}
                >
                  Cambiar ropa
                </button>
              </div>

              {/* Estadísticas de lectura */}
              <div className="companion-stats-summary" aria-label="Resumen de lectura">
                <div className="companion-stat-item">
                  <span className="companion-stat-icon" aria-hidden="true">⏱️</span>
                  <div>
                    <span className="companion-stat-val">{Math.round(state.stats.minutes)} min</span>
                    <span className="companion-stat-label">Tiempo leído</span>
                  </div>
                </div>
                <div className="companion-stat-item">
                  <span className="companion-stat-icon" aria-hidden="true">📚</span>
                  <div>
                    <span className="companion-stat-val">{state.stats.booksFinished}</span>
                    <span className="companion-stat-label">Libros leídos</span>
                  </div>
                </div>
                <div className="companion-stat-item">
                  <span className="companion-stat-icon" aria-hidden="true">📖</span>
                  <div>
                    <span className="companion-stat-val">{state.stats.saved}</span>
                    <span className="companion-stat-label">Palabras en Cuaderno</span>
                  </div>
                </div>
                <div className="companion-stat-item">
                  <span className="companion-stat-icon" aria-hidden="true">🔥</span>
                  <div>
                    <span className="companion-stat-val">{state.stats.streakDays} {state.stats.streakDays === 1 ? "día" : "días"}</span>
                    <span className="companion-stat-label">Racha actual</span>
                  </div>
                </div>
              </div>

              {chests.length > 0 ? (
                <div className="companion-chest-card" style={{ marginBlock: "var(--s-3)" }}>
                  <div className="companion-chest-info">
                    <span className="companion-chest-icon" aria-hidden="true">🎁</span>
                    <div>
                      <p className="companion-chest-title">¡Tienes {chests.length} cofre{chests.length === 1 ? "" : "s"} por abrir!</p>
                      <p className="companion-chest-sub">Descubre nuevos atuendos y estampas para tu compañero.</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setTab("rewards")}
                  >
                    Ver premios
                  </button>
                </div>
              ) : null}

              {/* Formulario de nombre del gato */}
              <form className="field companion-name" onSubmit={saveName}>
                <label className="setting-label" htmlFor="companion-name">
                  Nombre del gato
                </label>
                <input
                  id="companion-name"
                  type="text"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  autoComplete="off"
                  aria-invalid={nameInvalid || undefined}
                  aria-describedby={
                    nameInvalid ? "companion-name-error" : undefined
                  }
                />
                {nameInvalid ? (
                  <p className="status" role="alert" id="companion-name-error">
                    El nombre puede tener de 1 a 24 caracteres.
                  </p>
                ) : null}
                {nameError ? (
                  <p className="status" role="alert">
                    {nameError}
                  </p>
                ) : null}
                <div className="actions">
                  <button
                    type="submit"
                    className="btn"
                    disabled={!canSave || nameBusy}
                  >
                    {nameBusy ? "Guardando…" : "Guardar nombre"}
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {/* TAB 2: RECOMPENSAS Y COFRES */}
          {tab === "rewards" ? (
            <div role="tabpanel" className="companion-rewards-view" aria-label="Recompensas y cofres">
              {revealedChest ? (
                <div className="companion-reveal-box" role="status">
                  <div className="companion-reveal-sparkle" aria-hidden="true">✨🎁✨</div>
                  <h3 className="companion-reveal-title">¡Tesoro abierto!</h3>
                  <p className="companion-reveal-desc">
                    Has descubierto: <strong>{ACCESSORY_LABELS[revealedChest.reward] ?? revealedChest.reward}</strong>.
                  </p>
                  {Object.hasOwn(COMPANION_ARTICLES, revealedChest.reward) ? (
                    <div className="actions" style={{ justifyContent: "center" }}>
                      <button
                        type="button"
                        className="btn"
                        disabled={equipBusy}
                        onClick={() => void wearRevealed(revealedChest.reward)}
                      >
                        Vestir a {name} ahora
                      </button>
                      <button
                        type="button"
                        className="btn--quiet"
                        disabled={equipBusy}
                        onClick={() => setRevealedChest(null)}
                      >
                        Guardar en el armario
                      </button>
                    </div>
                  ) : (
                    <div className="actions" style={{ justifyContent: "center" }}>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          setRevealedChest(null);
                          setTab("collection");
                        }}
                      >
                        Ver en mi vitrina
                      </button>
                      <button
                        type="button"
                        className="btn--quiet"
                        onClick={() => setRevealedChest(null)}
                      >
                        Aceptar
                      </button>
                    </div>
                  )}
                </div>
              ) : null}

              {chestError ? (
                <p className="status" role="alert">
                  {chestError}
                </p>
              ) : null}

              {chests.length > 0 ? (
                <div className="companion-chests-list">
                  <h3 className="settings-group-title">Tesoros por abrir ({chests.length})</h3>
                  {chests.map((c) => (
                    <div key={c.id} className="companion-chest-card">
                      <div className="companion-chest-info">
                        <span className="companion-chest-icon" aria-hidden="true">🎁</span>
                        <div>
                          <p className="companion-chest-title">{c.label}</p>
                          <p className="companion-chest-sub">Toca para descubrir tu recompensa</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn"
                        disabled={chestBusy !== null}
                        onClick={() => void doOpenChest(c)}
                      >
                        {chestBusy === c.id ? "Abriendo…" : "Abrir cofre"}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="companion-next-reward-card">
                  <div className="companion-next-reward-head">
                    <span className="setting-label">Estado de tesoros</span>
                    <span className="companion-item-badge">Al día</span>
                  </div>
                  <p className="meta" style={{ margin: 0 }}>
                    ✨ ¡Todos tus cofres están abiertos! Sigue leyendo y subiendo de nivel para encontrar nuevos tesoros.
                  </p>
                </div>
              )}

              {/* Próximo botín (Goal gradient) */}
              {nextLevel && (nextRewardArticle || nextRewardCoat) ? (
                <div className="companion-next-reward-card">
                  <div className="companion-next-reward-head">
                    <span className="setting-label">Próximo botín en camino</span>
                    <span className="companion-item-badge">Faltan {pointsRemaining} XP</span>
                  </div>
                  <p style={{ margin: "0 0 var(--s-2)", fontWeight: 600 }}>
                    Nivel {nextLevelIdx + 1} · {nextLevel.name}
                  </p>
                  <p className="meta" style={{ margin: 0 }}>
                    Desbloqueará:{" "}
                    {nextRewardArticle ? (
                      <strong>
                        {ARTICLE_ICONS[nextRewardArticle]} {ARTICLE_LABELS[nextRewardArticle]}
                      </strong>
                    ) : null}
                    {nextRewardArticle && nextRewardCoat ? " y " : ""}
                    {nextRewardCoat ? (
                      <strong>
                        {ARTICLE_ICONS[nextRewardCoat]} Pelaje {ARTICLE_LABELS[nextRewardCoat]}
                      </strong>
                    ) : null}
                    .
                  </p>
                </div>
              ) : null}

              {/* Ruta de niveles y recompensas */}
              <div>
                <h3 className="settings-group-title">Ruta de Niveles de Biblioteca</h3>
                <div className="companion-roadmap">
                  {LEVELS.map((lvl, idx) => {
                    const isAchieved = prog.level >= idx;
                    const isNext = prog.level + 1 === idx;
                    const rawReward = rewardForLevel(idx);
                    const reward = Object.hasOwn(COMPANION_ARTICLES, rawReward)
                      ? (rawReward as CompanionArticle)
                      : null;
                    const coat = Object.keys(COAT_LEVELS).find(
                      (c) => COAT_LEVELS[c] === idx,
                    ) as CompanionArticle | undefined;

                    return (
                      <div
                        key={idx}
                        className="companion-roadmap-item"
                        data-status={isAchieved ? "achieved" : isNext ? "next" : "locked"}
                      >
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                            <span>{isAchieved ? "✓" : isNext ? "🎯" : "🔒"}</span>
                            <strong>Nivel {idx + 1} · {lvl.name}</strong>
                          </div>
                          <span className="meta" style={{ fontSize: "var(--fs-xs)" }}>
                            {lvl.xp} XP {reward ? `· ${ARTICLE_ICONS[reward]} ${ARTICLE_LABELS[reward]}` : ""}
                            {coat ? ` · ${ARTICLE_ICONS[coat]} ${ARTICLE_LABELS[coat]}` : ""}
                          </span>
                        </div>
                        <span className="companion-item-badge">
                          {isAchieved ? "Conseguido" : isNext ? "Siguiente" : "Bloqueado"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}

          {/* TAB 3: ARMARIO (O si closetOpen está activado) */}
          {tab === "closet" || closetOpen ? (
            <section className="companion-closet" aria-label="Armario">
              {SLOT_ORDER.map((slot) => (
                <div className="companion-slot" key={slot}>
                  <span
                    className="setting-label"
                    id={`companion-slot-${slot}`}
                  >
                    {SLOT_LABELS[slot]}
                  </span>
                  <div
                    className="companion-wears"
                    role="radiogroup"
                    aria-labelledby={`companion-slot-${slot}`}
                  >
                    {[null, ...articlesFor(slot)].map((article) =>
                      wearOption(slot, article),
                    )}
                  </div>
                </div>
              ))}
              {closetError ? (
                <p className="status" role="alert">
                  {closetError}
                </p>
              ) : null}
            </section>
          ) : null}

          {/* TAB 4: VITRINA (Colección de Estampas y Exlibris) */}
          {tab === "collection" ? (
            <div role="tabpanel" aria-label="Vitrina de colección">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBlockEnd: "var(--s-3)" }}>
                <h3 className="settings-group-title" style={{ margin: 0 }}>
                  Álbum de Estampas de Lectura
                </h3>
                <span className="companion-item-badge">
                  {earnedAchievements.length} de {ACHIEVEMENTS.length} conseguidas
                </span>
              </div>

              <div className="companion-stamps-grid">
                {ACHIEVEMENTS.map((a) => {
                  const isEarned = Boolean(state.achievements[a.id]);
                  return (
                    <div
                      key={a.id}
                      className="companion-stamp"
                      data-earned={isEarned}
                      title={a.desc}
                    >
                      <span className="companion-stamp-icon" aria-hidden="true">
                        {isEarned ? "🏆" : "🔒"}
                      </span>
                      <p className="companion-stamp-title">{a.title}</p>
                      <p className="companion-stamp-desc">{a.desc}</p>
                      <span className="companion-stamp-xp">+{a.xp} XP</span>
                    </div>
                  );
                })}
              </div>

              {state.finishedBooks.length > 0 ? (
                <div style={{ marginBlockStart: "var(--s-5)" }}>
                  <h3 className="settings-group-title">Exlibris de Libros Completados</h3>
                  <div className="companion-next-reward-card">
                    <p style={{ margin: "0 0 var(--s-1)", fontWeight: 600 }}>
                      📜 {state.finishedBooks.length} libro{state.finishedBooks.length === 1 ? "" : "s"} terminado{state.finishedBooks.length === 1 ? "" : "s"}
                    </p>
                    <p className="meta" style={{ margin: 0 }}>
                      Cada obra que concluyes queda sellada en la historia de tu biblioteca personal.
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </Sheet>
  );
}
