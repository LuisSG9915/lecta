// Hoja del compañero: vista previa del gato, acciones de cuidado
// (acariciar, dar de comer, jugar), editor de nombre y el armario
// por ranuras (cuerpo, cuello, cabeza, cara). La monta una sola vez
// CompanionProvider — el GamePanel y futuras superficies abren esta
// misma hoja por contexto, así nunca hay dos gatos compitiendo.
//
// Todo lo que se escribe aquí pasa por writeCompanionField con el
// DbScope capturado al pulsar — igual que el resto del perfil del
// compañero, sincroniza por cuenta y respeta el cambio de cuenta.
// Nada aquí toca XP, racha ni logros: el cuidado solo deja constancia
// en «lastCare» y las prendas en «equipped.<ranura>».

import { useEffect, useState, type FormEvent } from "react";
import Sheet from "./Sheet";
import { Companion } from "./Companion";
import { writeCompanionField } from "../lib/game";
import { captureDbScope } from "../lib/idb";
import {
  COMPANION_ARTICLES,
  type CompanionArticle,
  type EquippedItems,
  type EquippedSlot,
} from "../../shared/companion-data";
import {
  LEVELS,
  catStageForLevel,
  dayKeyOf,
  levelProgress,
  requiredCoatLevel,
  rewardForLevel,
  unlockedAccessories,
  unlockedCoats,
  type CatMood,
  type GameState,
} from "../lib/gamification";
import { triggerPurrHaptic } from "../lib/haptics";
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
  const [closetOpen, setClosetOpen] = useState(false);
  const [equipBusy, setEquipBusy] = useState(false);
  const [closetError, setClosetError] = useState("");
  const [careError, setCareError] = useState("");
  const [draft, setDraft] = useState(name);
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState("");

  // Saludo de llegada: el gato saluda con la patita al abrir la hoja
  // y la línea contextual conserva el humor del momento de llegada —
  // si una caricia lo despierta a mitad de visita, el mensaje sigue
  // contando lo que sintió al verte, no lo que siente ahora. Se fija
  // cuando el estado aterriza (no al montar): si la hoja abre aún
  // cargando, el humor real todavía no existe y «awake» sería un
  // saludo equivocado.
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

  // Si el nombre cambia desde fuera (otra superficie, otro
  // dispositivo o el propio guardado), el borrador sigue al registro
  // — es su valor de verdad. Ajuste durante el render: el patrón
  // oficial para reiniciar estado cuando cambia una prop.
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
      // El error real llega por la promesa; aquí solo se muestra.
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

  // Elegir prenda — o «Sin prenda», que escribe null explícito: para
  // los registros equipped.* null es un dato válido (ranura vacía),
  // no una ausencia.
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
  // Inventario local: el chaleco es gratis; las prendas llegan de
  // cofres ya abiertos en esta copia y los pelajes del nivel
  // proyectado. Una prenda elegida en otro dispositivo cuyo cofre aún
  // no se abre aquí se muestra bloqueada.
  const owned = state
    ? new Set<string>([
        "chaleco",
        ...unlockedAccessories(state),
        ...unlockedCoats(state),
      ])
    : new Set<string>();

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
    return (
      <button
        key={article ?? "none"}
        type="button"
        className="companion-wear"
        role="radio"
        aria-checked={puesto}
        data-active={puesto || undefined}
        // Ponerse exige inventario local; la opción queda visible con
        // su requisito aunque la prenda venga de otro dispositivo.
        disabled={equipBusy || blocked}
        onClick={() => void choose(slot, article)}
      >
        <span className="companion-wear-name">
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
              <p className="meta">{Math.floor(state.xp)} puntos</p>
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
              onClick={() => setClosetOpen((open) => !open)}
            >
              Cambiar ropa
            </button>
          </div>

          {closetOpen ? (
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
        </>
      )}
    </Sheet>
  );
}
