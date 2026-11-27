// Carné de Lector (docs/designs/2026-11-12-planes-y-landing.md): ficha de
// biblioteca en la cabecera de «Tú» con el estado del plan, el selector
// Mensual / Anual y los botones a Stripe Checkout / Customer Portal (sin SDK:
// son redirecciones). Se importa de forma estática desde Account, que ya es
// un chunk lazy.
import { useEffect, useState } from "react";
import { PLAN_GRACE_MS } from "../../shared/plan";
import { accountFetch } from "../lib/account-fetch";
import { captureDbScope } from "../lib/idb";
import type { PlanSnapshot } from "../lib/account-plan";
import { trackPlanEvent } from "../lib/plan-events";
import { formatTrialDate, formatTrialDeadline, FREE_AFTER_TRIAL } from "../lib/trial-notice";

type Period = "monthly" | "yearly";

const PERIOD_ORDER: readonly Period[] = ["yearly", "monthly"];

export const WELCOME_YEARLY = {
  price: "$399 MXN el primer año",
  perMonth: "$33",
  regular: "$499 MXN al año",
} as const;

export const PRICES: Record<
  Period,
  { label: string; price: string; short: string; perMonth: string; note: string }
> = {
  monthly: { label: "Mensual", price: "$59 MXN al mes", short: "$59", perMonth: "$59", note: "" },
  yearly: {
    label: "Anual",
    price: "$499 MXN al año",
    short: "$499",
    perMonth: "$42",
    note: "Son $42 al mes · ahorras $209 (4 meses gratis).",
  },
};

const DAY_MS = 86_400_000;
const TRIAL_END_MIN_MS = 48 * 3_600_000 + 5 * 60_000;

const dateLabel = (ms: number) =>
  new Date(ms).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });

export default function ReaderCard({
  plan,
  notice,
  navigate = (url: string) => window.location.assign(url),
}: {
  plan: PlanSnapshot | null;
  /** Vuelta de Checkout: éxito (`gracias`) o cancelación sin cargos. */
  notice?: "gracias" | "cancelado";
  /** Inyectable en pruebas. */
  navigate?: (url: string) => void;
}) {
  const [period, setPeriod] = useState<Period>("yearly");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Hora del montaje: basta para contar días y mantiene puro el render.
  const [mountedAt] = useState(() => Date.now());

  useEffect(() => {
    trackPlanEvent("app:carne-open");
  }, []);

  const go = async (path: string, body?: unknown) => {
    setBusy(true);
    setError("");
    try {
      const response = await accountFetch(
        path,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        captureDbScope(),
      );
      const data = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (response.ok && data?.url) {
        navigate(data.url);
        return;
      }
      setError(
        response.status === 409
          ? "Tu cuenta ya tiene Lecta+."
          : (data?.error ?? "No se pudo abrir el pago. Inténtalo de nuevo."),
      );
    } catch {
      setError("Sin conexión. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  if (!plan) return null;
  // Prueba inversa: Lecta+ sin pago, con opción de suscribirse.
  const trialEndsAt = plan.plan === "lecta_plus" && plan.trialEndsAt ? plan.trialEndsAt : null;
  const paid = plan.plan === "lecta_plus" && trialEndsAt === null;
  const daysLeft = trialEndsAt === null ? 0 : Math.max(1, Math.ceil((trialEndsAt - mountedAt) / DAY_MS));
  const defersCharge = trialEndsAt !== null && trialEndsAt > mountedAt + TRIAL_END_MIN_MS;
  const welcomeDeadline =
    plan.plan === "free" &&
    typeof plan.welcomeOfferEndsAt === "number" &&
    plan.welcomeOfferEndsAt > mountedAt
      ? plan.welcomeOfferEndsAt
      : null;

  return (
    <section className="reader-card" aria-label="Carné de Lector">
      <p className="eyebrow">Carné de Lector</p>
      {notice === "gracias" && paid ? (
        <p role="status" className="status">
          ¡Gracias! Lecta+ ya está activo.
        </p>
      ) : notice === "gracias" ? (
        <p role="status" className="status">
          Gracias. Estamos confirmando tu pago; Lecta+ aparece en unos segundos.
        </p>
      ) : notice === "cancelado" && !paid ? (
        <p role="status" className="status">
          Cancelaste el pago: no se hizo ningún cargo.
        </p>
      ) : null}
      {plan.plan === "founder_lifetime" ? (
        <>
          <strong className="reader-card__state">Mecenas de Primera Imprenta · Acceso Vitalicio</strong>
          <p className="reader-card__detail">
            Llegaste antes de que existiera el cobro: Lecta+ es tuyo para siempre.
          </p>
        </>
      ) : paid ? (
        (() => {
          const isPassOnly = plan.hasSubscription === false;
          if (isPassOnly) {
            return (
              <>
                <strong className="reader-card__state">
                  {notice === "gracias" ? "Lecta+ ya está activo" : "Pase anual Lecta+"}
                </strong>
                {plan.expiresAt ? (
                  <p className="reader-card__detail">
                    Vigente hasta el {dateLabel(plan.expiresAt)} (sin renovación automática).
                  </p>
                ) : null}
              </>
            );
          }
          const isPastDue = plan.pastDue === true;
          const graceEndsAt = plan.expiresAt !== null ? plan.expiresAt + PLAN_GRACE_MS : null;
          return (
            <>
              <strong className="reader-card__state">
                {notice === "gracias" ? "Lecta+ ya está activo" : "Suscriptor Lecta+"}
              </strong>
              {isPastDue ? (
                <p role="alert" className="status">
                  No pudimos renovar tu pago. Actualiza tu método de pago
                  {graceEndsAt ? ` antes del ${dateLabel(graceEndsAt)}` : ""} para conservar Lecta+.
                </p>
              ) : plan.expiresAt ? (
                <p className="reader-card__detail">Se renueva el {dateLabel(plan.expiresAt)}.</p>
              ) : null}
              <button
                type="button"
                className={isPastDue ? "btn btn--primary" : "btn"}
                disabled={busy}
                onClick={() => void go("/api/billing/portal")}
              >
                {isPastDue ? "Actualizar tarjeta" : "Administrar suscripción"}
              </button>
            </>
          );
        })()
      ) : (
        <>
          {trialEndsAt !== null ? (
            <>
              <strong className="reader-card__state">
                Prueba de Lecta+ · {daysLeft === 1 ? "queda 1 día" : `quedan ${daysLeft} días`}
              </strong>
              <p className="reader-card__detail">
                Desde el {formatTrialDate(trialEndsAt)} estarás en Gratis: {FREE_AFTER_TRIAL}
              </p>
            </>
          ) : plan.plan === "free" && plan.trialEndedAt ? (
            <>
              <strong className="reader-card__state">Plan Gratis · 3 explicaciones con IA al día</strong>
              <p className="reader-card__detail">
                Lecta+ suma Kindle, más explicaciones con IA, palabras previstas, coach semanal y Biblioteca en la nube.
              </p>
            </>
          ) : (
            <>
              <strong className="reader-card__state">Lector de Cuaderno Abierto</strong>
              <p className="reader-card__detail">
                Lecta+ suma Kindle, explicaciones con IA, palabras previstas, coach semanal y Biblioteca en la nube.
              </p>
            </>
          )}
          <div className="reader-card__periods" role="group" aria-label="Periodo de pago">
            {PERIOD_ORDER.map((key) => {
              const displayPrice =
                key === "yearly" && welcomeDeadline !== null ? WELCOME_YEARLY.price : PRICES[key].price;
              return (
                <button
                  key={key}
                  type="button"
                  className="reader-card__period"
                  aria-pressed={period === key}
                  onClick={() => setPeriod(key)}
                >
                  <span>{PRICES[key].label}</span>
                  <span className="reader-card__price">{displayPrice}</span>
                </button>
              );
            })}
          </div>
          {period === "yearly" && welcomeDeadline !== null ? (
            <p className="reader-card__detail">
              Oferta de bienvenida (72 h): {WELCOME_YEARLY.price} (≈{WELCOME_YEARLY.perMonth} al mes; luego{" "}
              {WELCOME_YEARLY.regular}). Disponible hasta el {formatTrialDeadline(welcomeDeadline)}.
            </p>
          ) : PRICES[period].note ? (
            <p className="reader-card__detail">{PRICES[period].note}</p>
          ) : null}
          {defersCharge && trialEndsAt !== null ? (
            <p className="reader-card__detail">
              Conservas tus días gratis: hoy pagas $0. Tu primer cobro ({PRICES[period].price}) será el{" "}
              {formatTrialDate(trialEndsAt)}.
            </p>
          ) : null}
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() => void go("/api/billing/checkout", { period })}
          >
            {defersCharge ? "Hacerme Lecta+ ($0 hoy)" : "Hacerme Lecta+"}
          </button>
          {plan.passYearlyAvailable === true ? (
            <button
              type="button"
              className="btn--quiet reader-card__pass"
              disabled={busy}
              onClick={() => void go("/api/billing/checkout", { period: "pass_yearly" })}
            >
              ¿Prefieres pago único sin renovación? Pase de 1 año ($549 MXN)
            </button>
          ) : null}
        </>
      )}
      {error ? (
        <p role="alert" className="status">
          {error}
        </p>
      ) : null}
    </section>
  );
}
