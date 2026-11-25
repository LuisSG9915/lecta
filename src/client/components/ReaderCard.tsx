// Carné de Lector (docs/designs/2026-11-12-planes-y-landing.md): ficha de
// biblioteca en la cabecera de «Tú» con el estado del plan, el selector
// Mensual / Anual y los botones a Stripe Checkout / Customer Portal (sin SDK:
// son redirecciones). Se importa de forma estática desde Account, que ya es
// un chunk lazy.
import { useState } from "react";
import { accountFetch } from "../lib/account-fetch";
import { captureDbScope } from "../lib/idb";
import type { PlanSnapshot } from "../lib/account-plan";

type Period = "monthly" | "yearly";

const PRICES: Record<Period, { label: string; price: string; note: string }> = {
  monthly: { label: "Mensual", price: "$59 MXN al mes", note: "" },
  yearly: { label: "Anual", price: "$499 MXN al año", note: "Son $42 al mes." },
};

const DAY_MS = 86_400_000;

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
        <>
          <strong className="reader-card__state">
            {notice === "gracias" ? "Lecta+ ya está activo" : "Suscriptor Lecta+"}
          </strong>
          {plan.expiresAt ? (
            <p className="reader-card__detail">Se renueva el {dateLabel(plan.expiresAt)}.</p>
          ) : null}
          <button type="button" className="btn" disabled={busy} onClick={() => void go("/api/billing/portal")}>
            Administrar suscripción
          </button>
        </>
      ) : (
        <>
          {trialEndsAt !== null ? (
            <>
              <strong className="reader-card__state">
                Prueba de Lecta+ · {daysLeft === 1 ? "queda 1 día" : `quedan ${daysLeft} días`}
              </strong>
              <p className="reader-card__detail">
                El {dateLabel(trialEndsAt)} vuelves a Gratis sin ningún cargo. Tus palabras, tu gato y
                tu lectura se quedan.
              </p>
            </>
          ) : (
            <>
              <strong className="reader-card__state">Lector de Cuaderno Abierto</strong>
              <p className="reader-card__detail">
                Lecta+ suma Kindle, explicaciones con IA, palabras previstas y tus libros en la nube.
              </p>
            </>
          )}
          <div className="reader-card__periods" role="group" aria-label="Periodo de pago">
            {(Object.keys(PRICES) as Period[]).map((key) => (
              <button
                key={key}
                type="button"
                className="reader-card__period"
                aria-pressed={period === key}
                onClick={() => setPeriod(key)}
              >
                <span>{PRICES[key].label}</span>
                <span className="reader-card__price">{PRICES[key].price}</span>
              </button>
            ))}
          </div>
          {PRICES[period].note ? <p className="reader-card__detail">{PRICES[period].note}</p> : null}
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() => void go("/api/billing/checkout", { period })}
          >
            Hacerme Lecta+
          </button>
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
