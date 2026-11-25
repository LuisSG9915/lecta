// Hoja del día 15, «Así usaste Lecta+» (F6): se muestra una sola vez, en la
// estantería, cuando la prueba ya venció. Descartable; jamás con un libro
// abierto. Chunk lazy: App decide si se monta (`shouldShowTrialEnd`).
import { useEffect, useState } from "react";
import { accountFetch } from "../lib/account-fetch";
import { captureDbScope } from "../lib/idb";
import { trackPlanEvent } from "../lib/plan-events";
import { markTrialEndSeen } from "../lib/trial-notice";
import { PRICES } from "./ReaderCard";
import Sheet from "./Sheet";

export type TrialSummary = {
  aiUses: number;
  wordsSaved: number;
  cloudBooks: number;
  kindleLinked: boolean;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Una línea por cifra distinta de 0; lo que vale 0 se omite. */
export function trialFigures(summary: TrialSummary | null): string[] {
  if (!summary) return [];
  const lines: string[] = [];
  if (summary.aiUses > 0) lines.push(`Usaste la IA ${plural(summary.aiUses, "vez", "veces")}.`);
  if (summary.wordsSaved > 0) lines.push(`Guardaste ${plural(summary.wordsSaved, "palabra", "palabras")}.`);
  if (summary.cloudBooks > 0) {
    lines.push(
      summary.cloudBooks === 1 ? "1 libro vive en la nube." : `${summary.cloudBooks} libros viven en la nube.`,
    );
  }
  if (summary.kindleLinked) lines.push("Vinculaste tu Kindle.");
  return lines;
}

export default function TrialEndSheet({
  navigate = (url: string) => window.location.assign(url),
}: {
  navigate?: (url: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [summary, setSummary] = useState<TrialSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    trackPlanEvent("app:trial-end-view");
    let alive = true;
    void (async () => {
      try {
        const res = await accountFetch("/api/account/trial-summary", undefined, captureDbScope());
        if (!res.ok) return;
        const data = (await res.json().catch(() => null)) as Partial<TrialSummary> | null;
        if (alive && data) {
          setSummary({
            aiUses: Number(data.aiUses) || 0,
            wordsSaved: Number(data.wordsSaved) || 0,
            cloudBooks: Number(data.cloudBooks) || 0,
            kindleLinked: data.kindleLinked === true,
          });
        }
      } catch {
        /* sin cifras la hoja sigue siendo útil */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const close = () => {
    markTrialEndSeen();
    setOpen(false);
  };

  const checkout = async () => {
    trackPlanEvent("app:trial-end-cta");
    markTrialEndSeen();
    setBusy(true);
    setError("");
    try {
      const res = await accountFetch(
        "/api/billing/checkout",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ period: "yearly" }),
        },
        captureDbScope(),
      );
      const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (res.ok && data?.url) {
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
  return (
    <Sheet label="Así usaste Lecta+" onClose={close}>
      <div className="trial-end">
        <h2 className="trial-end__title">Así usaste Lecta+</h2>
        {figures.length > 0 ? (
          <ul className="trial-end__figures">
            {figures.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        <p className="trial-end__detail">
          Tus palabras, tu gato y tu progreso se quedan. La IA, la nube y el Kindle vuelven a Lecta+.
        </p>
        <p className="trial-end__detail">
          {PRICES.monthly.price}, o {PRICES.yearly.price}. {PRICES.yearly.note}
        </p>
        {error ? (
          <p role="alert" className="status">
            {error}
          </p>
        ) : null}
        <div className="trial-end__actions">
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void checkout()}>
            Seguir con Lecta+
          </button>
          <button type="button" className="btn--quiet" onClick={close}>
            Seguir con Gratis
          </button>
        </div>
      </div>
    </Sheet>
  );
}
