// Cobro de Lecta+ con Stripe sin SDK (docs/designs/2026-11-12-planes-y-landing.md).
// Checkout y Customer Portal son redirecciones; el webhook firmado es la única
// vía que escribe el plan. El cliente solo envía `period`: nunca montos ni
// Price IDs.
import { Hono } from "hono";
import { hasLectaPlus } from "../shared/plan";
import { isMissingTableError, withClient, type WorkerEnv } from "./db";
import { loadUserPlan, upsertPlanFromStripe } from "./plan-store";
import { getSession } from "./session";
import { STRIPE_VERSION, stripeRequest } from "./stripe";

export { STRIPE_VERSION };

const SIGNATURE_TOLERANCE_S = 300;

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
  items?: { data?: Array<{ current_period_end?: number }> };
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
    case "trialing":
    case "past_due":
    case "unpaid": {
      const end = sub.items?.data?.[0]?.current_period_end;
      return typeof end === "number" ? end * 1000 : null;
    }
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
  if (period !== "monthly" && period !== "yearly") {
    return c.json({ error: "Periodo no válido" }, 400);
  }
  const plan = await loadUserPlan(c.env, session.user.id).catch(() => undefined);
  if (!plan || plan.degraded) {
    return c.json({ error: "Servicio temporalmente no disponible" }, 503);
  }
  if (hasLectaPlus(plan.plan)) {
    return c.json({ error: "Tu cuenta ya tiene Lecta+." }, 409);
  }
  const price = period === "monthly" ? c.env.STRIPE_PRICE_MONTHLY_ID : c.env.STRIPE_PRICE_YEARLY_ID;
  if (!price || !c.env.STRIPE_SECRET_KEY) {
    return c.json({ error: "El cobro no está configurado." }, 503);
  }
  const origin = new URL(c.req.url).origin;
  const form: Record<string, string> = {
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    client_reference_id: session.user.id,
    "subscription_data[metadata][user_id]": session.user.id,
    success_url: `${origin}/?carne=1`,
    cancel_url: `${origin}/?carne=1`,
  };
  if (plan.stripeCustomerId) form.customer = plan.stripeCustomerId;
  const result = await stripeRequest(c.env, "POST", "/checkout/sessions", form);
  const url = typeof result.body.url === "string" ? result.body.url : null;
  if (!result.ok || !url) {
    return c.json({ error: "No se pudo abrir el pago. Inténtalo de nuevo." }, 502);
  }
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
    data?: { object?: Record<string, unknown> };
  };
  const type = event.type ?? "";
  const object = event.data?.object ?? {};
  if (!event.id || !HANDLED.has(type)) return c.json({ received: true });

  // La red con Stripe va fuera de la transacción.
  let subscription: StripeSubscription = object as StripeSubscription;
  let referenceUser: string | null = null;
  if (type === "checkout.session.completed") {
    if (object.status !== "complete" || typeof object.subscription !== "string") {
      return c.json({ received: true });
    }
    referenceUser = typeof object.client_reference_id === "string" ? object.client_reference_id : null;
    const fetched = await stripeRequest(c.env, "GET", `/subscriptions/${object.subscription}`);
    if (!fetched.ok) return c.json({ error: "Stripe no respondió" }, 502);
    subscription = fetched.body as StripeSubscription;
  } else {
    referenceUser = subscription.metadata?.user_id ?? null;
  }
  const expiresAt = expiresAtForSubscription(subscription, type);
  const customer =
    typeof subscription.customer === "string"
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
        return "duplicate" as const;
      }
      let userId = referenceUser && (await userExists(client, referenceUser)) ? referenceUser : null;
      if (!userId && customer) userId = await userByCustomer(client, customer);
      if (!userId) {
        // Sin cuenta: ROLLBACK (el evento no queda registrado) y 500 para
        // que Stripe reintente — p. ej. eventos que llegan en desorden.
        await client.query("ROLLBACK");
        return "no-account" as const;
      }
      if (expiresAt !== undefined) {
        await upsertPlanFromStripe(client, userId, {
          stripeCustomerId: customer,
          stripeSubscriptionId: subscription.id ?? null,
          planExpiresAt: expiresAt,
        });
      }
      await client.query("COMMIT");
      return "applied" as const;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (isMissingTableError(err)) return "unavailable" as const;
      throw err;
    }
  });

  if (outcome === undefined || outcome === "unavailable") {
    return c.json({ error: "Servicio temporalmente no disponible" }, 503);
  }
  if (outcome === "no-account") return c.json({ error: "Cuenta no encontrada" }, 500);
  return c.json({ received: true });
});
