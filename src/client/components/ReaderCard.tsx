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

const dateLabel = (ms: number) =>
  new Date(ms).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });

export default function ReaderCard({
  plan,
  navigate = (url: string) => window.location.assign(url),
}: {
  plan: PlanSnapshot | null;
  /** Inyectable en pruebas. */
  navigate?: (url: string) => void;
}) {
  const [period, setPeriod] = useState<Period>("yearly");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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

  return (
    <section className="reader-card" aria-label="Carné de Lector">
      <p className="eyebrow">Carné de Lector</p>
      {plan.plan === "founder_lifetime" ? (
        <>
          <strong className="reader-card__state">Mecenas de Primera Imprenta · Acceso Vitalicio</strong>
          <p className="reader-card__detail">
            Llegaste antes de que existiera el cobro: Lecta+ es tuyo para siempre.
          </p>
        </>
      ) : plan.plan === "lecta_plus" ? (
        <>
          <strong className="reader-card__state">Suscriptor Lecta+</strong>
          {plan.expiresAt ? (
            <p className="reader-card__detail">Se renueva el {dateLabel(plan.expiresAt)}.</p>
          ) : null}
          <button type="button" className="btn" disabled={busy} onClick={() => void go("/api/billing/portal")}>
            Administrar suscripción
          </button>
        </>
      ) : (
        <>
          <strong className="reader-card__state">Lector de Cuaderno Abierto</strong>
          <p className="reader-card__detail">
            Lecta+ suma Kindle, explicaciones con IA, palabras previstas y tus libros en la nube.
          </p>
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
