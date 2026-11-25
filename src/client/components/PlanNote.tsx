// Nota al margen de Lecta+ (docs/designs/2026-11-12-planes-y-landing.md):
// dos líneas tipográficas y un enlace al Carné. Nunca un modal de pago.
// Ultraligera a propósito: sin estado ni dependencias.
import { useEffect } from "react";
import type { PlanFeature } from "../../shared/plan";
import { trackPlanEvent } from "../lib/plan-events";

export default function PlanNote({ title, detail, feature }: { title: string; detail: string; feature: PlanFeature }) {
  useEffect(() => {
    trackPlanEvent(`app:plannote:${feature}`);
  }, [feature]);
  return (
    <p className="plan-note" role="note">
      <span className="plan-note__title">{title}</span>
      <span className="plan-note__detail">
        {detail}{" "}
        <a
          className="plan-note__link"
          href="/?carne=1"
          onClick={(e) => {
            // Abre el Carné sin recargar ni desmontar el lector (App escucha).
            e.preventDefault();
            trackPlanEvent("app:paywall");
            window.dispatchEvent(new CustomEvent("lecta:open-carne"));
          }}
        >
          Ver Lecta+
        </a>
      </span>
    </p>
  );
}
