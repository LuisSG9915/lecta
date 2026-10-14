import { useState } from "react";
import { Companion } from "./Companion";
import {
  COMPANION_ARTICLES,
  type CompanionArticle,
  type EquippedItems,
  type EquippedSlot,
} from "../../shared/companion-data";
import {
  ITEM_ACHIEVEMENT_REWARDS,
  LEVELS,
  requiredCoatLevel,
  rewardForLevel,
} from "../lib/gamification";
import Icon from "./Icon";

export const SLOT_ORDER: EquippedSlot[] = [
  "head",
  "neck",
  "face",
  "body",
  "coat",
];

export const SLOT_LABELS: Record<EquippedSlot, string> = {
  head: "Cabeza",
  neck: "Cuello",
  face: "Ojos",
  body: "Escenario",
  coat: "Pelaje",
};

export type ClosetFilter = "all" | "head" | "neck" | "face" | "body" | "coat";

export const CLOSET_FILTERS: { id: ClosetFilter; label: string; slot?: EquippedSlot }[] = [
  { id: "all", label: "Todo" },
  { id: "head", label: "Cabeza", slot: "head" },
  { id: "neck", label: "Cuello", slot: "neck" },
  { id: "face", label: "Ojos", slot: "face" },
  { id: "body", label: "Escenario", slot: "body" },
  { id: "coat", label: "Pelaje", slot: "coat" },
];

export const ARTICLE_LABELS: Record<CompanionArticle, string> = {
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
  beret_poet: "Boina de Poeta",
  wizard_hat: "Sombrero de Sabio",
  laurel_crown: "Corona de Laurel",
  headphones_cozy: "Audífonos de Estudio",
  scarf_amber: "Bufanda de Invierno",
  cape_modernist: "Capa Azul de Darío",
  bowtie_scholar: "Moño de Académico",
  detective_cape: "Esclavina de Detective",
  glasses_round: "Gafas de Lectura",
  monocle_gold: "Monóculo de Crítico",
  stage_rainy_window: "Ventana Lluviosa",
  stage_ancient_library: "Biblioteca Nocturna",
};

export function requiredLevel(article: CompanionArticle): number | null {
  const coat = requiredCoatLevel(article);
  if (coat !== null) return coat;
  for (let i = 0; i < LEVELS.length; i += 1) {
    if (rewardForLevel(i) === article) return i + 1;
  }
  return null;
}

export const articlesFor = (slot: EquippedSlot): CompanionArticle[] =>
  (Object.keys(COMPANION_ARTICLES) as CompanionArticle[]).filter(
    (article) => COMPANION_ARTICLES[article] === slot,
  );

export interface CompanionClosetProps {
  equipped: EquippedItems;
  stage: number;
  owned: Set<string>;
  equipBusy: boolean;
  closetError: string;
  onChoose: (slot: EquippedSlot, article: string | null) => Promise<void>;
  onTryOn: (article: CompanionArticle, reqLevel: number | null) => void;
  tryOnArticle: CompanionArticle | null;
}

export function CompanionCloset({
  equipped,
  stage,
  owned,
  equipBusy,
  closetError,
  onChoose,
  onTryOn,
  tryOnArticle,
}: CompanionClosetProps) {
  const [filter, setFilter] = useState<ClosetFilter>("all");

  // El pelaje actual para dibujarlo de fondo en prendas de otras ranuras
  const currentCoat = equipped.coat ?? null;

  const currentArticles: (CompanionArticle | null)[] =
    filter === "all"
      ? (Object.keys(COMPANION_ARTICLES) as CompanionArticle[])
      : [null, ...articlesFor(filter as EquippedSlot)];

  return (
    <section className="companion-closet" aria-label="Armario">
      {/* Fichas de filtros / ranuras: Todo, Cabeza, Cuello, Ojos, Escenario, Pelaje */}
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
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Bandeja horizontal de prendas según el filtro activo */}
      <div
        className="companion-tray"
        role="radiogroup"
        aria-labelledby={`companion-slot-${filter}`}
      >
        {currentArticles.map((article) => {
          const itemSlot: EquippedSlot =
            article === null
              ? (filter === "all" ? "body" : (filter as EquippedSlot))
              : COMPANION_ARTICLES[article];

          const isEquipped = article !== null && equipped[itemSlot] === article;
          const isTrying = tryOnArticle === article;
          const isBlocked =
            article !== null && !owned.has(article as CompanionArticle);
          const req = isBlocked
            ? requiredLevel(article as CompanionArticle)
            : null;
          const ach = isBlocked && article !== null
            ? ITEM_ACHIEVEMENT_REWARDS[article as CompanionArticle]
            : undefined;

          const label =
            article === null
              ? filter === "coat"
                ? "Natural"
                : "Sin prenda"
              : ARTICLE_LABELS[article as CompanionArticle];

          const stateText = isEquipped
            ? "Puesta"
            : ach
              ? ach.title
              : req !== null
                ? `Nivel ${req}`
                : isBlocked
                  ? "Bloqueado"
                  : "";

          // Miniatura: gato completo a ~48px sin animaciones
          const thumbAccessories: string[] = [];
          if (article !== null) {
            if (itemSlot === "coat") {
              thumbAccessories.push(article);
            } else {
              thumbAccessories.push(article);
              if (currentCoat) thumbAccessories.push(currentCoat);
            }
          } else if (itemSlot !== "coat" && currentCoat) {
            thumbAccessories.push(currentCoat);
          }

          return (
            <button
              key={article ?? "none"}
              type="button"
              className="companion-card"
              role="radio"
              aria-checked={isEquipped}
              aria-disabled={isBlocked || undefined}
              data-active={isEquipped || isTrying || undefined}
              data-trying={isTrying || undefined}
              data-locked={isBlocked || undefined}
              disabled={equipBusy}
              onClick={() => {
                if (isBlocked && article !== null) {
                  onTryOn(article as CompanionArticle, req);
                } else {
                  void onChoose(itemSlot, article);
                }
              }}
            >
              <div className="companion-thumb" aria-hidden="true">
                <Companion
                  stage={stage}
                  mood="awake"
                  accessories={thumbAccessories}
                  decorative
                />
                {isBlocked ? (
                  <span className="companion-card-lock" aria-hidden="true">
                    <Icon name="lock" size={13} />
                  </span>
                ) : null}
              </div>
              <span className="companion-card-title">{label}</span>
              {stateText ? (
                <span
                  className="companion-card-state"
                  data-state={isEquipped ? "equipped" : isBlocked ? "locked" : undefined}
                >
                  {stateText}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {closetError ? (
        <p className="status" role="alert">
          {closetError}
        </p>
      ) : null}
    </section>
  );
}
