// Eventos de plan (docs/designs/2026-11-25-monetizacion-lecta-plus.md, F2):
// cuenta qué nota de Lecta+ se ve y cuál lleva al Carné. Sin sesión ni cookies.
import { planSource } from "../../shared/plan";
import { planStore } from "./account-plan";

const sent = new Set<string>();

/** Una vez por evento y pestaña. Nunca lanza; sin `sendBeacon` no hace nada. */
export function trackPlanEvent(event: string): void {
  try {
    if (sent.has(event) || typeof navigator === "undefined" || !navigator.sendBeacon) return;
    sent.add(event);
    const plan = planStore.get();
    const source = plan ? planSource(plan.plan, plan.trialEndsAt) : undefined;
    // Cadena = text/plain: evita el preflight de CORS, como la landing.
    navigator.sendBeacon("/api/landing-events", JSON.stringify(source ? { event, source } : { event }));
  } catch {
    /* medir nunca rompe la app */
  }
}

export function resetPlanEventsForTests(): void {
  sent.clear();
}
