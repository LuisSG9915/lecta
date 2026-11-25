// Aviso descartable de los últimos 3 días de la prueba de Lecta+ (F5). Sin
// modal: una nota al margen con un botón que abre el Carné. Sirve a la
// estantería y al lector.
import { useEffect, useState } from "react";
import { useUserPlan } from "../lib/account-plan";
import { trackPlanEvent } from "../lib/plan-events";
import { dismissTrialNotice, formatTrialDate, isTrialNoticeDismissed, trialNoticeDay } from "../lib/trial-notice";

/**
 * `armAt`: índice de sección del lector. Con valor, el aviso solo sale cuando
 * cambia (entre secciones), nunca al abrir el libro.
 */
export default function TrialWarningNote({ armAt }: { armAt?: number }) {
  const plan = useUserPlan();
  const [initialSection] = useState(armAt);
  const [now] = useState(() => Date.now());
  const [hidden, setHidden] = useState(false);
  const trialEndsAt = plan?.plan === "lecta_plus" ? plan.trialEndsAt : null;
  const day = trialNoticeDay(trialEndsAt, now);
  const armed = armAt === undefined || armAt !== initialSection;
  const visible = day !== null && armed && !hidden && !isTrialNoticeDismissed(day);
  useEffect(() => {
    if (visible && day !== null) trackPlanEvent(`app:trial-warning:${day}`);
  }, [visible, day]);
  if (!visible || day === null || trialEndsAt == null) return null;
  return (
    <div className="trial-note" role="status">
      <span className="trial-note__text">
        La IA en contexto, tus libros en la nube y la lista completa de palabras previstas vuelven a
        Lecta+ el {formatTrialDate(trialEndsAt)}.
      </span>
      <button
        type="button"
        className="btn trial-note__cta"
        onClick={() => window.dispatchEvent(new CustomEvent("lecta:open-carne"))}
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
