// Cobro de Lecta+ con Stripe sin SDK (docs/designs/2026-11-12-planes-y-landing.md).
// Checkout y Customer Portal son redirecciones; el webhook firmado es la única
// vía que escribe el plan. El cliente solo envía `period`: nunca montos ni
// Price IDs.
import { Hono } from "hono";
import {
  hasLectaPlus,
  isWelcomeOfferActive,
  PLAN_GRACE_MS,
  planSource,
  type PlanSource,
} from "../shared/plan";
import { runInBackground } from "./background";
import { isMissingTableError, withClient, type WorkerEnv } from "./db";
import { recordLandingEvent, recordPlanEvent } from "./landing-events";
import { loadUserPlan, upsertPlanFromStripe } from "./plan-store";
import { getSession } from "./session";
import { STRIPE_VERSION, stripeRequest } from "./stripe";

export { STRIPE_VERSION };

const SIGNATURE_TOLERANCE_S = 300;
const TRIAL_END_MIN_MS = 48 * 3_600_000 + 5 * 60_000;
const PASS_YEARLY_MS = 365 * 86_400_000;

/** Embudo de compra: contador diario anónimo y por cuenta (F19); un fallo nunca rompe la respuesta. */
function trackPlanEvent(
  env: WorkerEnv,
  event: string,
  source: PlanSource,
  userId?: string,
): Promise<unknown> {
  const tasks: Promise<unknown>[] = [
    recordLandingEvent(env, { event, source }).catch(() => false),
  ];
  if (userId) tasks.push(recordPlanEvent(env, userId, event).catch(() => false));
  return Promise.all(tasks);
}

type QueryClient = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

// ---------- Firma del webhook ----------

const toHex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

const timingSafeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

/** Verifica `Stripe-Signature` (t=…,v1=…) sobre el cuerpo crudo. */
export async function verifyStripeSignature(
  body: string,
  header: string | null | undefined,
  secret: string,
  nowMs = Date.now(),
): Promise<boolean> {
  if (!header || !secret) return false;
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key?.trim() === "t") timestamp = value?.trim() ?? "";
    if (key?.trim() === "v1" && value) signatures.push(value.trim());
  }
  const t = Number(timestamp);
  if (!Number.isFinite(t) || signatures.length === 0) return false;
  if (Math.abs(nowMs / 1000 - t) > SIGNATURE_TOLERANCE_S) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = toHex(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)),
  );
  return signatures.some((sig) => timingSafeEqual(sig, expected));
}

// ---------- Suscripción → vencimiento ----------

type StripeSubscription = {
  id?: string;
  customer?: string;
  status?: string;
  ended_at?: number | null;
  metadata?: Record<string, string>;
  items?: {
    data?: Array<{
      current_period_start?: number;
      current_period_end?: number;
      price?: { recurring?: { interval?: string } };
    }>;
  };
};

/**
 * Vencimiento a escribir según el estado; `undefined` = no escribir nada.
 * El paso a `free` lo decide getUserPlan con la gracia, nunca este mapa.
 */
export function expiresAtForSubscription(
  sub: StripeSubscription,
  event: string,
  nowMs = Date.now(),
): number | null | undefined {
  const ended = (sub.ended_at ?? Math.floor(nowMs / 1000)) * 1000;
  if (event === "customer.subscription.deleted") return ended;
  switch (sub.status) {
    case "active":
    case "trialing": {
      const end = sub.items?.data?.[0]?.current_period_end;
      return typeof end === "number" ? end * 1000 : null;
    }
    case "past_due": {
      // Fallo de cobro mientras Stripe reintenta. Al renovar, Stripe adelanta
      // el periodo y avisa con `active` antes de cobrar, así que el periodo
      // impago ya pudo escribirse: el vencimiento vuelve al inicio de ese
      // periodo (fin del último pagado) y la gracia de 3 días corre desde ahí.
      const start = sub.items?.data?.[0]?.current_period_start;
      return typeof start === "number" ? start * 1000 : undefined;
    }
    case "unpaid":
      return typeof sub.ended_at === "number" ? sub.ended_at * 1000 : nowMs - PLAN_GRACE_MS - 1;
    case "canceled":
    case "incomplete_expired":
    case "paused":
      return ended;
    default:
      // incomplete u otro estado aún no cobrado: sin escritura.
      return undefined;
  }
}

async function userExists(client: QueryClient, userId: string): Promise<boolean> {
  const res = (await client.query('SELECT 1 FROM "user" WHERE id = $1', [userId])) as {
    rows?: unknown[];
  };
  return (res.rows?.length ?? 0) > 0;
}

async function userByCustomer(client: QueryClient, customer: string): Promise<string | null> {
  const res = (await client.query(
    "SELECT user_id FROM lecta_user_plan WHERE stripe_customer_id = $1 LIMIT 1",
    [customer],
  )) as { rows?: Array<{ user_id?: string }> };
  return res.rows?.[0]?.user_id ?? null;
}

// ---------- Rutas ----------

export const billing = new Hono<{ Bindings: WorkerEnv }>();

billing.post("/api/billing/checkout", async (c) => {
  const session = await getSession(c);
  if (!session?.user?.id) return c.json({ error: "No autorizado" }, 401);
  const body = (await c.req.json().catch(() => null)) as { period?: unknown } | null;
  const period = body?.period;
  if (period !== "monthly" && period !== "yearly" && period !== "pass_yearly") {
    return c.json({ error: "Periodo no válido" }, 400);
  }
  const plan = await loadUserPlan(c.env, session.user.id).catch(() => undefined);
  if (!plan || plan.degraded) {
    return c.json({ error: "Servicio temporalmente no disponible" }, 503);
  }
  // La prueba inversa da Lecta+ sin pago: durante ella sí se puede suscribir.
  if (hasLectaPlus(plan.plan) && plan.trialEndsAt === null) {
    return c.json({ error: "Tu cuenta ya tiene Lecta+." }, 409);
  }
  const price =
    period === "pass_yearly"
      ? c.env.STRIPE_PRICE_PASS_YEARLY_ID
      : period === "monthly"
        ? c.env.STRIPE_PRICE_MONTHLY_ID
        : c.env.STRIPE_PRICE_YEARLY_ID;
  if (!price || !c.env.STRIPE_SECRET_KEY) {
    return c.json({ error: "El cobro no está configurado." }, 503);
  }
  const origin = new URL(c.req.url).origin;
  const form: Record<string, string> =
    period === "pass_yearly"
      ? {
          mode: "payment",
          "line_items[0][price]": price,
          "line_items[0][quantity]": "1",
          "adaptive_pricing[enabled]": "true",
          client_reference_id: session.user.id,
          "metadata[user_id]": session.user.id,
          "metadata[kind]": "pass_yearly",
          "payment_intent_data[metadata][user_id]": session.user.id,
          "payment_intent_data[metadata][kind]": "pass_yearly",
          success_url: `${origin}/?carne=gracias`,
          cancel_url: `${origin}/?carne=cancelado`,
        }
      : {
          mode: "subscription",
          "line_items[0][price]": price,
          "line_items[0][quantity]": "1",
          "adaptive_pricing[enabled]": "true",
          client_reference_id: session.user.id,
          "subscription_data[metadata][user_id]": session.user.id,
          success_url: `${origin}/?carne=gracias`,
          cancel_url: `${origin}/?carne=cancelado`,
        };
  if (period !== "pass_yearly") {
    // Sin prueba de Stripe: toda cuenta ya tuvo 14 días de prueba inversa
    // (docs/designs/2026-11-24-prueba-inversa-y-cortesia-diaria.md). Pagar
    // durante ella no regala ni pierde días: el cobro empieza al terminar la
    // prueba (trial_end). Stripe exige trial_end ≥ 48 h en el futuro; con menos
    // (margen de 5 min por la latencia) no se pasa y el cobro es inmediato.
    if (plan.trialEndsAt !== null && plan.trialEndsAt > Date.now() + TRIAL_END_MIN_MS) {
      form["subscription_data[trial_end]"] = String(Math.floor(plan.trialEndsAt / 1000));
    }
    const welcomeCoupon = c.env.STRIPE_COUPON_TRIAL_END_ID?.trim();
    if (
      period === "yearly" &&
      welcomeCoupon &&
      plan.plan === "free" &&
      isWelcomeOfferActive(plan.trialEndedAt, Date.now())
    ) {
      form["discounts[0][coupon]"] = welcomeCoupon;
    }
  }
  if (plan.stripeCustomerId) form.customer = plan.stripeCustomerId;
  const result = await stripeRequest(c.env, "POST", "/checkout/sessions", form);
  const url = typeof result.body.url === "string" ? result.body.url : null;
  if (!result.ok || !url) {
    return c.json({ error: "No se pudo abrir el pago. Inténtalo de nuevo." }, 502);
  }
  runInBackground(
    c,
    trackPlanEvent(
      c.env,
      `app:checkout-start:${period}`,
      planSource(plan.plan, plan.trialEndsAt),
      session.user.id,
    ),
  );
  return c.json({ url });
});

billing.post("/api/billing/portal", async (c) => {
  const session = await getSession(c);
  if (!session?.user?.id) return c.json({ error: "No autorizado" }, 401);
  const plan = await loadUserPlan(c.env, session.user.id).catch(() => undefined);
  if (!plan) return c.json({ error: "Servicio temporalmente no disponible" }, 503);
  if (!plan.stripeCustomerId) return c.json({ error: "Sin suscripción" }, 404);
  const result = await stripeRequest(c.env, "POST", "/billing_portal/sessions", {
    customer: plan.stripeCustomerId,
    return_url: `${new URL(c.req.url).origin}/?carne=1`,
  });
  const url = typeof result.body.url === "string" ? result.body.url : null;
  if (!result.ok || !url) return c.json({ error: "No se pudo abrir el portal." }, 502);
  return c.json({ url });
});

const HANDLED = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

billing.post("/api/billing/webhook", async (c) => {
  const raw = await c.req.text();
  const valid = await verifyStripeSignature(
    raw,
    c.req.header("stripe-signature"),
    c.env.STRIPE_WEBHOOK_SECRET ?? "",
  );
  if (!valid) return c.json({ error: "Firma no válida" }, 400);
  const event = JSON.parse(raw) as {
    id?: string;
    type?: string;
    created?: number;
    data?: { object?: Record<string, unknown> };
  };
  const type = event.type ?? "";
  const object = event.data?.object ?? {};
  if (!event.id || !HANDLED.has(type)) return c.json({ received: true });

  // La red con Stripe va fuera de la transacción.
  let subscription: StripeSubscription = object as StripeSubscription;
  let referenceUser: string | null = null;
  let completeSource: PlanSource = "free";
  let expiresAt: number | null | undefined;
  let subscriptionId: string | null = null;
  const isPaymentCheckout =
    (type === "checkout.session.completed" || type === "checkout.session.async_payment_succeeded") &&
    object.mode === "payment";

  if (isPaymentCheckout) {
    const meta = (object.metadata ?? {}) as Record<string, unknown>;
    if (meta.kind !== "pass_yearly") return c.json({ received: true });
    // OXXO / SPEI devuelven payment_status = "unpaid" en checkout.session.completed;
    // el pase se activa únicamente cuando llega paid o async_payment_succeeded.
    if (type === "checkout.session.completed" && object.payment_status !== "paid") {
      return c.json({ received: true });
    }
    referenceUser =
      typeof object.client_reference_id === "string"
        ? object.client_reference_id
        : typeof meta.user_id === "string"
          ? meta.user_id
          : null;
    const nowMs = Date.now();
    let currentExpires = 0;
    if (referenceUser) {
      try {
        const before = await loadUserPlan(c.env, referenceUser);
        if (before && !before.degraded) {
          completeSource = planSource(before.plan, before.trialEndsAt);
          if (before.expiresAt && Number.isFinite(before.expiresAt)) {
            currentExpires = before.expiresAt;
          }
        }
      } catch {
        /* sin fuente: se cuenta como free */
      }
    }
    expiresAt = (currentExpires > nowMs ? currentExpires : nowMs) + PASS_YEARLY_MS;
    subscriptionId = null;
  } else if (type === "checkout.session.async_payment_succeeded") {
    return c.json({ received: true });
  } else if (type === "checkout.session.completed") {
    if (object.status !== "complete" || typeof object.subscription !== "string") {
      return c.json({ received: true });
    }
    referenceUser = typeof object.client_reference_id === "string" ? object.client_reference_id : null;
    const fetched = await stripeRequest(c.env, "GET", `/subscriptions/${object.subscription}`);
    if (!fetched.ok) return c.json({ error: "Stripe no respondió" }, 502);
    subscription = fetched.body as StripeSubscription;
    // Fuente = plan ANTES de aplicar el pago (después siempre sería plus).
    if (referenceUser) {
      try {
        const before = await loadUserPlan(c.env, referenceUser);
        if (before && !before.degraded) completeSource = planSource(before.plan, before.trialEndsAt);
      } catch {
        /* sin fuente: se cuenta como free */
      }
    }
    expiresAt = expiresAtForSubscription(subscription, type);
    subscriptionId = subscription.id ?? null;
  } else {
    referenceUser = subscription.metadata?.user_id ?? null;
    // Dos eventos subscription.* del mismo segundo pueden llegar en desorden
    // y `event.created` no los distingue: se lee el estado vigente de la
    // suscripción (idempotente, gana siempre el estado terminal real).
    if (typeof subscription.id === "string") {
      const fetched = await stripeRequest(c.env, "GET", `/subscriptions/${subscription.id}`);
      if (fetched.ok) {
        const current = fetched.body as StripeSubscription;
        referenceUser = referenceUser ?? current.metadata?.user_id ?? null;
        subscription = current;
      } else if (fetched.status !== 404) {
        return c.json({ error: "Stripe no respondió" }, 502);
      }
    }
    expiresAt = expiresAtForSubscription(subscription, type);
    subscriptionId = subscription.id ?? null;
  }

  const customer = isPaymentCheckout
    ? typeof object.customer === "string"
      ? object.customer
      : null
    : typeof subscription.customer === "string"
      ? subscription.customer
      : typeof object.customer === "string"
        ? object.customer
        : null;

  const outcome = await withClient(c.env, async (client) => {
    await client.query("BEGIN");
    try {
      const inserted = (await client.query(
        "INSERT INTO lecta_stripe_events (event_id, processed_at) VALUES ($1, $2) ON CONFLICT (event_id) DO NOTHING RETURNING event_id",
        [event.id, Date.now()],
      )) as { rows?: unknown[] };
      if ((inserted.rows?.length ?? 0) === 0) {
        await client.query("COMMIT");
        return { status: "duplicate" as const };
      }
      let userId = referenceUser && (await userExists(client, referenceUser)) ? referenceUser : null;
      if (!userId && customer) userId = await userByCustomer(client, customer);
      if (!userId) {
        // Sin cuenta: ROLLBACK (el evento no queda registrado) y 500 para
        // que Stripe reintente — p. ej. eventos que llegan en desorden.
        await client.query("ROLLBACK");
        return { status: "no-account" as const };
      }
      let wrote = false;
      if (expiresAt !== undefined) {
        wrote = await upsertPlanFromStripe(client, userId, {
          stripeCustomerId: customer,
          stripeSubscriptionId: subscriptionId,
          planExpiresAt: expiresAt,
          eventCreated: typeof event.created === "number" ? event.created * 1000 : undefined,
        });
      }
      await client.query("COMMIT");
      // Un evento descartado por viejo no cuenta como compra.
      return wrote ? ({ status: "applied" as const, userId }) : ({ status: "skipped" as const });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (isMissingTableError(err)) return { status: "unavailable" as const };
      throw err;
    }
  });

  if (outcome === undefined || outcome.status === "unavailable") {
    return c.json({ error: "Servicio temporalmente no disponible" }, 503);
  }
  if (outcome.status === "no-account") return c.json({ error: "Cuenta no encontrada" }, 500);
  // Solo la compra inicial: las renovaciones y cambios llegan como subscription.*.
  if (outcome.status === "applied" && isPaymentCheckout) {
    runInBackground(
      c,
      trackPlanEvent(c.env, "app:checkout-complete:pass_yearly", completeSource, outcome.userId),
    );
  } else if (outcome.status === "applied" && type === "checkout.session.completed") {
    const interval = subscription.items?.data?.[0]?.price?.recurring?.interval;
    const period = interval === "year" ? "yearly" : interval === "month" ? "monthly" : null;
    if (period) {
      runInBackground(
        c,
        trackPlanEvent(c.env, `app:checkout-complete:${period}`, completeSource, outcome.userId),
      );
    }
  }
  return c.json({ received: true });
});
