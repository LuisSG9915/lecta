// Hoja del día 15, «Terminó tu prueba de Lecta+» (F6): se muestra una sola vez,
// en la estantería, cuando la prueba ya venció. Descartable; jamás con un libro
// abierto. Chunk lazy: App decide si se monta (`shouldShowTrialEnd`).
import { useEffect, useState } from "react";
import { accountFetch } from "../lib/account-fetch";
import { captureDbScope } from "../lib/idb";
import { trackPlanEvent } from "../lib/plan-events";
import {
  fetchTrialSummary,
  formatTrialDate,
  formatTrialDeadline,
  FREE_AFTER_TRIAL,
  markTrialEndSeen,
  trialFigures,
  type TrialSummary,
} from "../lib/trial-notice";
import { PRICES, WELCOME_YEARLY } from "./ReaderCard";
import Sheet from "./Sheet";

export { trialFigures };
export type { TrialSummary };

type Period = "monthly" | "yearly" | "pass_yearly";

export default function TrialEndSheet({
  endedAt,
  welcomeOfferEndsAt,
  passYearlyAvailable,
  navigate = (url: string) => window.location.assign(url),
}: {
  /** Fin de la prueba (ms) que manda el servidor. */
  endedAt?: number;
  /** Fin de la oferta de bienvenida de 72 h (ms), solo si hay cupón real configurado. */
  welcomeOfferEndsAt?: number | null;
  /** `true` si el servidor ofrece el pase anual de pago único ($549 MXN). */
  passYearlyAvailable?: boolean;
  navigate?: (url: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [summary, setSummary] = useState<TrialSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mountedAt] = useState(() => Date.now());

  useEffect(() => {
    trackPlanEvent("app:trial-end-view");
    let alive = true;
    void fetchTrialSummary().then((data) => {
      if (alive && data) setSummary(data);
    });
    return () => {
      alive = false;
    };
  }, []);

  const close = () => {
    markTrialEndSeen();
    setOpen(false);
  };

  const checkout = async (period: Period) => {
    trackPlanEvent("app:trial-end-cta");
    setBusy(true);
    setError("");
    try {
      const res = await accountFetch(
        "/api/billing/checkout",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ period }),
        },
        captureDbScope(),
      );
      const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (res.ok && data?.url) {
        // La marca se escribe solo al salir a Stripe: un error deja la hoja viva.
        markTrialEndSeen();
        navigate(data.url);
        return;
      }
      setError(data?.error ?? "No se pudo abrir el pago. Inténtalo de nuevo.");
    } catch {
      setError("Sin conexión. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  const figures = trialFigures(summary);
  const welcomeDeadline =
    typeof welcomeOfferEndsAt === "number" && welcomeOfferEndsAt > mountedAt
      ? welcomeOfferEndsAt
      : null;
  return (
    <Sheet label="Terminó tu prueba de Lecta+" onClose={close}>
      <div className="trial-end">
        <h2 className="trial-end__title" tabIndex={-1} data-autofocus>
          Terminó tu prueba de Lecta+
        </h2>
        {figures.length > 0 ? (
          <ul className="trial-end__figures">
            {figures.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        <p className="trial-end__detail">
          {endedAt ? `Desde el ${formatTrialDate(endedAt)} estás` : "Estás"} en Gratis: {FREE_AFTER_TRIAL}
        </p>
        {welcomeDeadline !== null ? (
          <p className="trial-end__detail">
            Oferta de bienvenida por 72 h (hasta el {formatTrialDeadline(welcomeDeadline)}); después{" "}
            {WELCOME_YEARLY.regular}.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="status">
            {error}
          </p>
        ) : null}
        <div className="trial-end__actions">
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void checkout("yearly")}>
            {welcomeDeadline !== null
              ? `${PRICES.yearly.label} · ${WELCOME_YEARLY.price} (≈${WELCOME_YEARLY.perMonth} MXN al mes)`
              : `${PRICES.yearly.label} · ${PRICES.yearly.price} (≈${PRICES.yearly.perMonth} MXN al mes)`}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void checkout("monthly")}>
            {PRICES.monthly.label} · {PRICES.monthly.price}
          </button>
          {passYearlyAvailable === true ? (
            <button
              type="button"
              className="btn--quiet reader-card__pass"
              disabled={busy}
              onClick={() => void checkout("pass_yearly")}
            >
              ¿Prefieres pago único sin renovación? Pase de 1 año ($549 MXN)
            </button>
          ) : null}
          <button type="button" className="btn--quiet" onClick={close}>
            Seguir gratis
          </button>
        </div>
      </div>
    </Sheet>
  );
}
