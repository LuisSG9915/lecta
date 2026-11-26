// Línea fija y discreta de la prueba de Lecta+ en la estantería: la fecha de
// fin visible desde el día 1. Sin modal; los días 3/2/1 la cubre TrialWarningNote.
import { useState } from "react";
import { useUserPlan } from "../lib/account-plan";
import { formatTrialDate, trialNoticeDay } from "../lib/trial-notice";

export default function TrialStatusLine() {
  const plan = useUserPlan();
  const [now] = useState(() => Date.now());
  const trialEndsAt = plan?.plan === "lecta_plus" ? plan.trialEndsAt : null;
  if (trialEndsAt == null || !Number.isFinite(trialEndsAt) || trialEndsAt <= now) return null;
  if (trialNoticeDay(trialEndsAt, now) !== null) return null;
  return (
    <p className="trial-status">
      Estás probando Lecta+ hasta el {formatTrialDate(trialEndsAt)}. Después sigues gratis con tus palabras y tu gato.{" "}
      <button
        type="button"
        className="trial-status__link"
        onClick={() => window.dispatchEvent(new CustomEvent("lecta:open-carne"))}
      >
        Ver qué incluye
      </button>
    </p>
  );
}
