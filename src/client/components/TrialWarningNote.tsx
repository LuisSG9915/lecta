// Aviso descartable de los últimos 3 días de la prueba de Lecta+ (F5). Sin
// modal: una nota al margen con un botón que abre el Carné. Sirve a la
// estantería y al lector.
import { useEffect, useState } from "react";
import { useUserPlan } from "../lib/account-plan";
import { trackPlanEvent } from "../lib/plan-events";
import {
  dismissTrialNotice,
  fetchTrialSummary,
  formatTrialDate,
  FREE_AFTER_TRIAL,
  isTrialNoticeDismissed,
  trialFigures,
  trialNoticeDay,
} from "../lib/trial-notice";

/**
 * Lector: `armAt` es el índice de sección y `ready` que el libro ya cargó. La
 * referencia es el primer índice visto con `ready` (el de la posición
 * restaurada); el aviso sale solo si después cambia de verdad, nunca al abrir
 * el libro. `suppressed`: otro aviso del lector está a la vista.
 */
export default function TrialWarningNote({
  armAt,
  ready = true,
  suppressed = false,
}: {
  armAt?: number;
  ready?: boolean;
  suppressed?: boolean;
}) {
  const plan = useUserPlan();
  const [baseline, setBaseline] = useState<number | null>(null);
  const [now] = useState(() => Date.now());
  const [hidden, setHidden] = useState(false);
  const [figure, setFigure] = useState("");
  if (armAt !== undefined && ready && baseline === null) setBaseline(armAt);
  const trialEndsAt = plan?.plan === "lecta_plus" ? plan.trialEndsAt : null;
  const day = trialNoticeDay(trialEndsAt, now);
  const armed = armAt === undefined || (ready && baseline !== null && armAt !== baseline);
  const visible = day !== null && armed && !suppressed && !hidden && !isTrialNoticeDismissed(day);
  useEffect(() => {
    if (visible && day !== null) trackPlanEvent(`app:trial-warning:${day}`);
  }, [visible, day]);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    void fetchTrialSummary().then((summary) => {
      if (alive) setFigure(trialFigures(summary)[0] ?? "");
    });
    return () => {
      alive = false;
    };
  }, [visible]);
  if (!visible || day === null || trialEndsAt == null) return null;
  return (
    <div className="trial-note" role="status">
      <span className="trial-note__text">
        {figure ? `${figure} ` : ""}Desde el {formatTrialDate(trialEndsAt)} estarás en Gratis: {FREE_AFTER_TRIAL}
      </span>
      <button
        type="button"
        className="btn trial-note__cta"
        onClick={() => {
          trackPlanEvent("app:paywall");
          window.dispatchEvent(new CustomEvent("lecta:open-carne"));
        }}
      >
        Seguir con Lecta+
      </button>
      <button
        type="button"
        className="btn--quiet trial-note__close"
        aria-label="Cerrar aviso"
        onClick={() => {
          dismissTrialNotice(day);
          setHidden(true);
        }}
      >
        ×
      </button>
    </div>
  );
}
