// Armario del compañero: selector de ranuras en una fila superior
// y bandeja horizontal deslizable con tarjetas de prendas, miniaturas
// del gato completo a escala reducida y soporte para probarse ropa bloqueada.

import { useState } from "react";
import { Companion } from "./Companion";
import {
  COMPANION_ARTICLES,
  type CompanionArticle,
  type EquippedItems,
  type EquippedSlot,
} from "../../shared/companion-data";
import {
  LEVELS,
  requiredCoatLevel,
  rewardForLevel,
} from "../lib/gamification";

export const SLOT_ORDER: EquippedSlot[] = [
  "body",
  "neck",
  "head",
  "face",
  "coat",
];

export const SLOT_LABELS: Record<EquippedSlot, string> = {
  body: "Cuerpo",
  neck: "Cuello",
  head: "Cabeza",
  face: "Cara",
  coat: "Pelaje",
};

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
  const [selectedSlot, setSelectedSlot] = useState<EquippedSlot>("body");

  // El pelaje actual para dibujarlo de fondo en prendas de otras ranuras
  const currentCoat = equipped.coat ?? null;

  return (
    <section className="companion-closet" aria-label="Armario">
      {/* Fichas de ranuras en una sola fila */}
      <div
        className="companion-slot-chips"
        role="radiogroup"
        aria-label="Ranuras del armario"
      >
        {SLOT_ORDER.map((slot) => {
          const isSelected = selectedSlot === slot;
          return (
            <button
              key={slot}
              id={`companion-slot-${slot}`}
              type="button"
              role="radio"
              aria-checked={isSelected}
              className="companion-chip"
              data-active={isSelected || undefined}
              onClick={() => setSelectedSlot(slot)}
            >
              {SLOT_LABELS[slot]}
            </button>
          );
        })}
      </div>

      {/* Bandeja horizontal de prendas de la ranura activa */}
      <div
        className="companion-tray"
        role="radiogroup"
        aria-labelledby={`companion-slot-${selectedSlot}`}
      >
        {[null, ...articlesFor(selectedSlot)].map((article) => {
          const isEquipped = equipped[selectedSlot] === article;
          const isTrying = tryOnArticle === article;
          const isBlocked =
            article !== null && !owned.has(article as CompanionArticle);
          const req = isBlocked
            ? requiredLevel(article as CompanionArticle)
            : null;

          const label =
            article === null
              ? selectedSlot === "coat"
                ? "Natural"
                : "Sin prenda"
              : ARTICLE_LABELS[article as CompanionArticle];

          const stateText = isEquipped
            ? "Puesta"
            : req !== null
              ? `Nivel ${req}`
              : "";

          // Miniatura: gato completo a ~48px sin animaciones
          const thumbAccessories: string[] = [];
          if (article !== null) {
            if (selectedSlot === "coat") {
              thumbAccessories.push(article);
            } else {
              thumbAccessories.push(article);
              if (currentCoat) thumbAccessories.push(currentCoat);
            }
          } else if (selectedSlot !== "coat" && currentCoat) {
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
              disabled={equipBusy}
              onClick={() => {
                if (isBlocked) {
                  onTryOn(article as CompanionArticle, req);
                } else {
                  void onChoose(selectedSlot, article);
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
              </div>
              <span className="companion-card-title">{label}</span>
              {stateText ? (
                <span
                  className="companion-card-state"
                  data-state={isEquipped ? "equipped" : "locked"}
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
