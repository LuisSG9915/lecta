// Paso «Elige a tu gato» (docs/designs/2026-11-12-planes-y-landing.md): una
// cuenta free que no trae pelaje del landing elige uno de los 5. Se reclama
// una sola vez (PUT /api/account/starter-coat) y queda como pelaje inicial.
import { useState } from "react";
import { Companion } from "./Companion";
import { COMPANION_COATS, COMPANION_COAT_IDS, type CompanionCoatId } from "../../shared/companion-data";
import { claimStarterCoat, pendingStarterCoat, type PlanSnapshot } from "../lib/account-plan";
import { captureDbScope, getActiveUserId } from "../lib/idb";

/** Solo cuentas free sin pelaje inicial ni pelaje pendiente del landing. */
export function needsCoatChoice(plan: PlanSnapshot | null): boolean {
  return plan?.plan === "free" && !plan.starterCoat && !pendingStarterCoat();
}

export default function CoatChoice() {
  const [chosen, setChosen] = useState<CompanionCoatId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const choose = async (coat: CompanionCoatId) => {
    const userId = getActiveUserId();
    if (!userId || busy) return;
    setChosen(coat);
    setBusy(true);
    setError("");
    const saved = await claimStarterCoat(userId, captureDbScope(), coat);
    setBusy(false);
    if (!saved) setError("No se pudo guardar tu gato. Inténtalo de nuevo.");
  };

  return (
    <section className="coat-choice" aria-labelledby="coat-choice-title">
      <h2 id="coat-choice-title" className="coat-choice__title">
        Elige al gato que va a leer contigo
      </h2>
      <div className="coat-choice__options">
        {COMPANION_COAT_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className="coat-choice__option"
            aria-pressed={chosen === id}
            disabled={busy}
            onClick={() => void choose(id)}
          >
            <span className="coat-choice__thumb" aria-hidden="true">
              <Companion stage={0} mood="awake" accessories={[]} coatId={id} decorative still />
            </span>
            {COMPANION_COATS[id].name}
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="status">
          {error}
        </p>
      ) : null}
    </section>
  );
}
