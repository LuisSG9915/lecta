// Armario del compañero: espejo, no inventario.
//
// Seis vistas de una sola dimensión, una a la vez (el panel mide ~226 px:
// apilar bloques dejaba la rejilla fuera de la primera pantalla):
//   Todo · Cabeza · Cuello · Ojos · Escenario · Pelaje · Looks
//
// Encima de las vistas, la pista que convierte el armario en una lista de
// cosas por hacer: la prenda bloqueada MÁS CERCA, con su número. Debajo, la
// ficha de la prenda tocada (nombre, una línea de historia y su requisito).
//
// Toda la decisión vive en `lib/companion-closet.ts` (puro y probado); aquí
// sólo se pinta y se avisa al panel.

import { useState } from "react";
import { Companion } from "./Companion";
import {
  COMPANION_ARTICLES,
  resolveCoatId,
  type BookMood,
  type CompanionArticle,
  type EquippedItems,
  type EquippedSlot,
} from "../../shared/companion-data";
import {
  CLOSET_FILTERS,
  COMPANION_LOOKS,
  coatCards,
  gridArticles,
  initialSelection,
  labelFor,
  lookStatus,
  BOOK_MOOD_OPTIONS,
  lookForMood,
  nextUnlock,
  requiredLevel,
  seasonalNow,
  slotInventory,
  sortForGrid,
  storyFor,
  surpriseLook,
  closetRequirement,
  type ClosetFilter,
} from "../lib/companion-closet";
import type { GameState } from "../lib/gamification";
import { triggerHaptic } from "../lib/haptics";
import Icon from "./Icon";

export {
  ARTICLE_LABELS,
  CLOSET_FILTERS,
  SLOT_LABELS,
  SLOT_ORDER,
  articlesFor,
  requiredLevel,
  type ClosetFilter,
} from "../lib/companion-closet";

export interface CompanionClosetProps {
  // Libro abierto (sólo dentro del lector): permite vestir «para este libro».
  bookId?: string | null;
  bookMood?: BookMood | null;
  onBookMood?: (mood: BookMood | null) => void;
  equipped: EquippedItems;
  stage: number;
  owned: Set<string>;
  equipBusy: boolean;
  closetError: string;
  state: GameState | null;
  onChoose: (slot: EquippedSlot, article: string | null) => Promise<void>;
  onChooseMany: (items: Partial<EquippedItems>) => Promise<void>;
  onTryOn: (article: CompanionArticle, reqLevel: number | null) => void;
  onClearTryOn: () => void;
  tryOnArticle: CompanionArticle | null;
}

// Barra de avance del requisito: 3 px, tinta de acento, sin animación de
// relleno (el avance no debe bailar cada vez que se abre la hoja).
function RequirementBar({ ratio }: { ratio: number }) {
  return (
    <span className="closet-bar" aria-hidden="true">
      <span
        className="closet-bar__fill"
        style={{ inlineSize: `${Math.round(ratio * 100)}%` }}
      />
    </span>
  );
}

export function CompanionCloset({
  equipped,
  stage,
  owned,
  equipBusy,
  closetError,
  state,
  bookId = null,
  bookMood = null,
  onBookMood,
  onChoose,
  onChooseMany,
  onTryOn,
  onClearTryOn,
  tryOnArticle,
}: CompanionClosetProps) {
  const [filter, setFilter] = useState<ClosetFilter>("all");
  const [selected, setSelected] = useState<CompanionArticle | null>(null);

  const coats = coatCards();
  const season = seasonalNow();
  const inventory = slotInventory(owned);
  const counts = new Map(inventory.map((s) => [s.slot, s]));
  const totalOwned = inventory.reduce((sum, s) => sum + s.owned, 0);
  const totalItems = inventory.reduce((sum, s) => sum + s.total, 0);

  const currentCoat = equipped.coat ?? null;
  // Lo DIBUJABLE manda: un pelaje del registro que esta copia no tiene no
  // se pinta, así que tampoco puede marcarse como puesto.
  const thumbCoat =
    currentCoat && owned.has(currentCoat) ? currentCoat : null;
  const activeCoatId = resolveCoatId(thumbCoat);
  const naturalCoatId = resolveCoatId(null);

  const articles = sortForGrid(gridArticles(filter), owned, season?.article);
  // La ficha describe la última prenda tocada; si no hay ninguna, la que
  // lleves puesta en la ranura activa (o la primera de la ranura).
  const focused: CompanionArticle | null =
    selected && (articles.includes(selected) || filter === "coat")
      ? selected
      : filter === "all" || filter === "looks"
        ? null
        : initialSelection(filter, equipped);

  const focusedOwned0 = focused ? owned.has(focused) : false;
  const focusedSlot0 = focused ? COMPANION_ARTICLES[focused] : null;
  const focusedIsCoat = focusedSlot0 === "coat";
  // Lo que el gato DIBUJA: en el pelaje vale la paleta (el natural no
  // tiene registro) y en el resto, la ranura exacta.
  const focusedDrawn =
    focused === null
      ? false
      : focusedIsCoat
        ? resolveCoatId(thumbCoat) === resolveCoatId(focused)
        : equipped[focusedSlot0 as EquippedSlot] === focused;
  // Lo que ya lleva puesto no se explica con un candado: la ficha lo dice
  // y no vuelve a pedir el nivel que ya cruzaste.
  const focusedReq =
    focused && !focusedDrawn ? closetRequirement(focused, state, owned) : null;
  const focusedOwned = focusedOwned0;
  const focusedSlot = focusedSlot0;
  const focusedEquipped = focusedDrawn;
  const focusedTrying = focused !== null && tryOnArticle === focused;

  const hint = nextUnlock(
    state,
    owned,
    gridArticles("all").concat(coats.map((c) => c.article)),
  );
  const choose = (slot: EquippedSlot, article: string | null) => {
    if (equipBusy) return;
    setSelected(article as CompanionArticle | null);
    void onChoose(slot, article);
  };

  const touch = (article: CompanionArticle) => {
    setSelected(article);
    if (!owned.has(article)) onTryOn(article, requiredLevel(article));
  };

  const pocket = (article: CompanionArticle): string[] => {
    const thumb: string[] = [article];
    if (thumbCoat) thumb.push(thumbCoat);
    return thumb;
  };

  const countFor = (id: ClosetFilter): string => {
    if (id === "all") return `${totalOwned}/${totalItems}`;
    if (id === "looks") {
      const ready = COMPANION_LOOKS.filter(
        (look) => lookStatus(look, owned).ready,
      ).length;
      return `${ready}/${COMPANION_LOOKS.length}`;
    }
    return `${counts.get(id)?.owned ?? 0}/${counts.get(id)?.total ?? 0}`;
  };

  return (
    <section className="companion-closet" aria-label="Armario">
      {/* Temporada: un motivo para volver al armario, sin arte nuevo */}
      {season ? (
        <p className="closet-season" role="status">
          <span className="closet-season__label">De temporada</span>
          <span className="closet-season__name">{season.label}</span>
          <span className="closet-season__reason">{season.reason}</span>
        </p>
      ) : null}

      {/* Próxima meta: el armario como lista de cosas por hacer */}
      {hint ? (
        <button
          type="button"
          className="closet-next"
          title={`${hint.label} — ${
            hint.requirement.kind === "free" ? "disponible" : hint.requirement.text
          }`}
          onClick={() => {
            const article = hint.article;
            const slot = COMPANION_ARTICLES[article];
            setSelected(article);
            if (slot && slot !== filter) setFilter(slot);
            if (!owned.has(article)) onTryOn(article, requiredLevel(article));
          }}
        >
          <span className="closet-next__label">Más cerca</span>
          <span className="closet-next__name">{hint.label}</span>
          <span className="closet-next__req">
            {hint.requirement.kind === "free" ? "" : hint.requirement.text}
          </span>
          <RequirementBar ratio={hint.ratio} />
        </button>
      ) : null}

      {/* Ambiente del libro abierto: el lector dice «para este libro, así»
          y el gato se viste con lo que ya tenga de ese look. */}
      {bookId && onBookMood ? (
        <div
          className="closet-moods"
          role="group"
          aria-label="Ambiente de este libro"
        >
          <span className="closet-moods__label">Para este libro</span>
          {BOOK_MOOD_OPTIONS.map((mood) => {
            const active = bookMood === mood.id;
            const look = lookForMood(mood.id);
            const owned_ = look ? lookStatus(look, owned) : null;
            const nothing = owned_ ? Object.keys(owned_.available).length === 0 : true;
            return (
              <button
                key={mood.id}
                type="button"
                className="companion-chip"
                data-active={active || undefined}
                aria-pressed={active}
                title={
                  nothing
                    ? `${mood.hint} · aún no tienes prendas de este look`
                    : mood.hint
                }
                onClick={() => onBookMood(active ? null : mood.id)}
              >
                {mood.name}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Vistas: una dimensión cada una, con su contador */}
      <div
        className="companion-slot-chips"
        role="radiogroup"
        aria-label="Filtros del armario"
      >
        {CLOSET_FILTERS.map((f) => {
          const isSelected = filter === f.id;
          return (
            <button
              key={f.id}
              id={`companion-slot-${f.id}`}
              type="button"
              role="radio"
              aria-checked={isSelected}
              className="companion-chip"
              data-active={isSelected || undefined}
              onClick={() => {
                setFilter(f.id);
                setSelected(null);
                // La prueba pertenece a la prenda que estabas mirando: al
                // cambiar de vista, el gato vuelve a lo suyo.
                onClearTryOn();
              }}
            >
              {f.label}
              <span className="companion-chip__count">{countFor(f.id)}</span>
            </button>
          );
        })}
      </div>

      {/* Ficha de la prenda tocada */}
      {focused ? (
        <article
          className="closet-sheet"
          aria-label={`Ficha de ${labelFor(focused)}`}
        >
          <div className="closet-sheet__text">
            <p className="closet-sheet__name">
              {labelFor(focused)}
              {focusedEquipped ? (
                <span className="closet-sheet__state">
                  {focusedIsCoat && !focusedOwned ? "Natural" : "Puesta"}
                </span>
              ) : null}
            </p>
            <p className="closet-sheet__story">{storyFor(focused)}</p>
            {focusedReq && focusedReq.kind !== "free" ? (
              <>
                <p className="closet-sheet__req">
                  {focusedReq.text}
                  {focusedReq.kind === "level" && focusedReq.equivalent ? (
                    <span className="closet-sheet__equiv">
                      {" · "}
                      {focusedReq.equivalent}
                    </span>
                  ) : null}
                </p>
                <RequirementBar ratio={focusedReq.ratio} />
              </>
            ) : null}
          </div>
          <div className="closet-sheet__actions">
            {focusedOwned ? (
              <button
                type="button"
                className="btn btn--sm"
                disabled={equipBusy}
                onClick={() =>
                  focusedSlot ? choose(focusedSlot, focused) : undefined
                }
              >
                {focusedEquipped ? "Quitar" : "Poner"}
              </button>
            ) : focusedDrawn ? null : (
              <button
                type="button"
                className="btn btn--sm"
                disabled={equipBusy}
                onClick={() => touch(focused)}
              >
                {focusedTrying ? "Quitar prueba" : "Probar"}
              </button>
            )}
          </div>
        </article>
      ) : null}

      {/* Looks: cinco piezas de un toque */}
      {filter === "looks" ? (
        <div className="closet-looks" role="group" aria-label="Looks guardados">
          {COMPANION_LOOKS.map((look) => {
            const status = lookStatus(look, owned);
            const available = Object.keys(status.available).length;
            return (
              <button
                key={look.id}
                type="button"
                className="closet-look"
                data-incomplete={!status.ready || undefined}
                disabled={equipBusy || available === 0}
                title={
                  status.ready
                    ? look.hint
                    : `Te falta: ${status.missing.map(labelFor).join(", ")}`
                }
                onClick={() => {
                  triggerHaptic("success");
                  setSelected(null);
                  void onChooseMany(status.available);
                }}
              >
                <span className="closet-look__name">{look.name}</span>
                <span className="closet-look__hint">
                  {status.ready
                    ? look.hint
                    : available === 0
                      ? `${status.missing.length} por ganar`
                      : `${available} de ${
                          Object.keys(look.items).length
                        } · te falta ${labelFor(status.missing[0])}`}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Rejilla: prendas o pelajes, con nombre y requisito — nunca un
          candado mudo. */}
      <div
        className="companion-tray"
        role="radiogroup"
        aria-labelledby={`companion-slot-${filter}`}
      >
        {filter === "coat" ? (
          <>
            {/* Quitar el pelaje no es una paleta: es una acción, no una
                opción del grupo (la paleta natural ya se marca sola). */}
            <button
              key="natural"
              type="button"
              className="companion-card"
              aria-label="Quitar el pelaje"
              disabled={equipBusy || currentCoat === null}
              onClick={() => choose("coat", null)}
            >
              <span className="companion-card-title">Natural</span>
              <span className="companion-card-state">Sin pelaje</span>
            </button>
            {coats.map((coat) => {
              const isOwned = owned.has(coat.article);
              // El natural no se «gana»: el gato ya lo trae sin registro.
              const isNatural = coat.id === naturalCoatId;
              const available = isOwned || isNatural;
              const req = available
                ? null
                : closetRequirement(coat.article, state, owned);
              // La paleta manda, no el id exacto: «pelaje-dorado» y
              // «pelaje-atigrado» son el mismo color.
              const isOn = activeCoatId === coat.id;
              return (
                <button
                  key={coat.id}
                  type="button"
                  className="companion-card"
                  role="radio"
                  aria-checked={isOn}
                  // Bloqueada ≠ inerte: pulsarla la prueba en el gato. Se
                  // anuncia con el nombre accesible que explica el candado;
                  // `aria-disabled` la dejaría muda para un lector de
                  // pantalla y para el teclado.
                  aria-label={
                    available
                      ? `${coat.name}: ${isOn ? "puesta" : "tuya"}`
                      : `${coat.name}: bloqueada, ${
                          req && req.kind !== "free" ? req.text : "se gana por nivel"
                        }. Pulsa para probarla.`
                  }
                  data-active={isOn || undefined}
                  data-locked={!available || undefined}
                  data-trying={tryOnArticle === coat.article || undefined}
                  disabled={equipBusy}
                  onClick={() => {
                    setSelected(coat.article);
                    if (isOwned) choose("coat", coat.article);
                    else if (isNatural) choose("coat", null);
                    else touch(coat.article);
                  }}
                >
                  <span className="companion-thumb" aria-hidden="true">
                    <Companion
                      stage={stage}
                      mood="awake"
                      accessories={[coat.article]}
                      decorative
                    />
                  </span>
                  <span className="companion-card-title">{coat.name}</span>
                  <span
                    className="companion-card-state"
                    data-state={isOn ? "equipped" : available ? undefined : "locked"}
                  >
                    {isOn ? "Puesta" : isOwned ? "Tuya" : isNatural ? "Natural" : ""}
                  </span>
                  {req && req.kind !== "free" ? (
                    <>
                      <span className="companion-card-req">{req.text}</span>
                      <RequirementBar ratio={req.ratio} />
                    </>
                  ) : null}
                </button>
              );
            })}
          </>
        ) : filter === "looks" ? null : (
          <>
            {filter !== "all" ? (
              <button
                key="none"
                type="button"
                className="companion-card"
                role="radio"
                aria-checked={equipped[filter] === null}
                data-active={equipped[filter] === null || undefined}
                disabled={equipBusy}
                onClick={() => choose(filter, null)}
              >
                <span className="companion-card-title">Sin prenda</span>
                <span className="companion-card-state">Quitar</span>
              </button>
            ) : null}
            {articles.map((article) => {
              const slot = COMPANION_ARTICLES[article];
              const isOn = equipped[slot] === article;
              const isBlocked = !owned.has(article);
              const req = isBlocked
                ? closetRequirement(article, state, owned)
                : null;
              return (
                <button
                  key={article}
                  type="button"
                  className="companion-card"
                  role="radio"
                  aria-checked={isOn}
                  aria-label={
                    isBlocked
                      ? `${labelFor(article)}: bloqueada, ${
                          req && req.kind !== "free" ? req.text : "aún no es tuya"
                        }. Pulsa para probarla.`
                      : `${labelFor(article)}: ${isOn ? "puesta" : "tuya"}`
                  }
                  data-active={isOn || tryOnArticle === article || undefined}
                  data-trying={tryOnArticle === article || undefined}
                  data-locked={isBlocked || undefined}
                  data-selected={selected === article || undefined}
                  disabled={equipBusy}
                  onClick={() => {
                    if (isBlocked) touch(article);
                    else choose(slot, article);
                  }}
                >
                  <span className="companion-thumb" aria-hidden="true">
                    <Companion
                      stage={stage}
                      mood="awake"
                      accessories={pocket(article)}
                      decorative
                    />
                    {isBlocked ? (
                      <span className="companion-card-lock" aria-hidden="true">
                        <Icon name="lock" size={11} />
                      </span>
                    ) : null}
                  </span>
                  <span className="companion-card-title">
                    {labelFor(article)}
                  </span>
                  <span
                    className="companion-card-state"
                    data-state={isOn ? "equipped" : isBlocked ? "locked" : undefined}
                  >
                    {isOn
                      ? "Puesta"
                      : season?.article === article
                        ? "De temporada"
                        : isBlocked
                          ? ""
                          : "Tuya"}
                  </span>
                  {season?.article === article ? (
                    <span className="closet-season-tag">Temporada</span>
                  ) : null}
                  {isBlocked && req && req.kind !== "free" ? (
                    <>
                      <span className="companion-card-req">{req.text}</span>
                      <RequirementBar ratio={req.ratio} />
                    </>
                  ) : null}
                </button>
              );
            })}
          </>
        )}
      </div>

      {filter === "all" && !state ? (
        <p className="closet-empty-hint">
          Sin progreso cargado: se muestran las prendas disponibles.
        </p>
      ) : null}

      {/* Cierre: probar es gratis — azar con lo tuyo, o nada puesto */}
      <div className="closet-actions">
        <button
          type="button"
          className="btn--quiet closet-surprise"
          disabled={equipBusy}
          onClick={() => {
            const look = surpriseLook(owned, equipped);
            if (!look) return;
            triggerHaptic("success");
            setSelected(null);
            void onChooseMany(look);
          }}
        >
          Sorpréndeme
        </button>
        <button
          type="button"
          className="btn--quiet closet-clear"
          disabled={equipBusy}
          onClick={() => {
            setSelected(null);
            void onChooseMany({
              head: null,
              neck: null,
              face: null,
              body: null,
            });
          }}
        >
          Quitar prendas
        </button>
      </div>

      {closetError ? (
        <p className="status" role="alert">
          {closetError}
        </p>
      ) : null}
    </section>
  );
}
