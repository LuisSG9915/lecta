import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { WorkerEnv } from "./db";
import { billing, expiresAtForSubscription, verifyStripeSignature } from "./billing";
import { cancelBillingForDeletion, cancelSubscriptionForDeletion } from "./stripe";

const getSessionMock = vi.hoisted(() => vi.fn());
const loadUserPlanMock = vi.hoisted(() => vi.fn());
const queryMock = vi.hoisted(() => vi.fn());
const withClientMock = vi.hoisted(() => vi.fn());

vi.mock("./session", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));
vi.mock("./plan-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./plan-store")>()),
  loadUserPlan: (...args: unknown[]) => loadUserPlanMock(...args),
}));
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  withClient: (...args: unknown[]) => withClientMock(...args),
}));

const SECRET = "whsec_test";
const env: WorkerEnv = {
  STRIPE_SECRET_KEY: "sk_test",
  STRIPE_WEBHOOK_SECRET: SECRET,
  STRIPE_PRICE_MONTHLY_ID: "price_m",
  STRIPE_PRICE_YEARLY_ID: "price_y",
};

const app = new Hono<{ Bindings: WorkerEnv }>().route("/", billing);

const plan = (over: Record<string, unknown> = {}) => ({
  plan: "free",
  starterCoat: null,
  expiresAt: null,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  trialEndsAt: null,
  degraded: false,
  ...over,
});

async function sign(body: string, t = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${t},v1=${hex}`;
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  getSessionMock.mockReset();
  loadUserPlanMock.mockReset();
  queryMock.mockReset();
  withClientMock.mockReset();
  withClientMock.mockImplementation(async (_env, run) => run({ query: queryMock }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("verifyStripeSignature", () => {
  it("acepta una firma válida, también entre varios v1", async () => {
    const body = '{"id":"evt_1"}';
    const header = await sign(body);
    expect(await verifyStripeSignature(body, header, SECRET)).toBe(true);
    expect(await verifyStripeSignature(body, `v1=deadbeef,${header}`, SECRET)).toBe(true);
  });

  it("rechaza firma inválida, vencida o ausente", async () => {
    const body = '{"id":"evt_1"}';
    expect(await verifyStripeSignature(body, await sign("otro"), SECRET)).toBe(false);
    const old = await sign(body, Math.floor(Date.now() / 1000) - 600);
    expect(await verifyStripeSignature(body, old, SECRET)).toBe(false);
    expect(await verifyStripeSignature(body, null, SECRET)).toBe(false);
  });
});

describe("expiresAtForSubscription", () => {
  const now = 1_000_000_000_000;
  it("activa y en prueba toman el fin del periodo del item", () => {
    for (const status of ["active", "trialing"]) {
      expect(
        expiresAtForSubscription({ status, items: { data: [{ current_period_end: 50 }] } }, "x", now),
      ).toBe(50_000);
    }
  });
  it("past_due vence al inicio del periodo impago (fin del último pagado)", () => {
    expect(
      expiresAtForSubscription(
        { status: "past_due", items: { data: [{ current_period_start: 40, current_period_end: 50 }] } },
        "x",
        now,
      ),
    ).toBe(40_000);
    expect(
      expiresAtForSubscription({ status: "past_due", items: { data: [{ current_period_end: 50 }] } }, "x", now),
    ).toBeUndefined();
  });
  it("unpaid usa ended_at o vence fuera de gracia sin regalar 3 días más", () => {
    expect(expiresAtForSubscription({ status: "unpaid", ended_at: 7 }, "x", now)).toBe(7000);
    const expired = expiresAtForSubscription({ status: "unpaid" }, "x", now) as number;
    expect(expired).toBeLessThan(now - 3 * 86_400_000);
  });
  it("cancelada, expirada y pausada toman ended_at (o ahora)", () => {
    expect(expiresAtForSubscription({ status: "canceled", ended_at: 7 }, "x", now)).toBe(7000);
    expect(expiresAtForSubscription({ status: "incomplete_expired" }, "x", now)).toBe(now);
    expect(expiresAtForSubscription({ status: "paused" }, "x", now)).toBe(now);
    expect(
      expiresAtForSubscription({ status: "active", ended_at: 9 }, "customer.subscription.deleted", now),
    ).toBe(9000);
  });
  it("incomplete no escribe nada", () => {
    expect(expiresAtForSubscription({ status: "incomplete" }, "x", now)).toBeUndefined();
  });
});

describe("POST /api/billing/checkout", () => {
  const checkout = (body: unknown) =>
    app.request(
      "/api/billing/checkout",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      env,
    );

  it("sin sesión responde 401", async () => {
    getSessionMock.mockResolvedValue(null);
    expect((await checkout({ period: "yearly" })).status).toBe(401);
  });

  it("orden de respuestas: 400 → 503 → 409", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "u1" } });
    expect((await checkout({ period: "weekly" })).status).toBe(400);
    loadUserPlanMock.mockResolvedValue(undefined);
    expect((await checkout({ period: "yearly" })).status).toBe(503);
    loadUserPlanMock.mockResolvedValue(plan({ plan: "founder_lifetime", degraded: true }));
    expect((await checkout({ period: "yearly" })).status).toBe(503);
    loadUserPlanMock.mockResolvedValue(plan({ plan: "founder_lifetime" }));
    expect((await checkout({ period: "yearly" })).status).toBe(409);
  });

  it("free recibe la URL de Checkout; el cliente solo manda el periodo", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "u1" } });
    loadUserPlanMock.mockResolvedValue(plan({ stripeCustomerId: "cus_9" }));
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ url: "https://checkout.stripe.com/x" }));
    const res = await checkout({ period: "yearly" });
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.com/x" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    const form = new URLSearchParams(String(init.body));
    expect(form.get("line_items[0][price]")).toBe("price_y");
    expect(form.get("client_reference_id")).toBe("u1");
    expect(form.get("subscription_data[metadata][user_id]")).toBe("u1");
    expect(form.get("customer")).toBe("cus_9");
    // Ya fue cliente: sin prueba.
    expect(form.has("subscription_data[trial_period_days]")).toBe(false);
    expect(form.get("success_url")).toBe("http://localhost/?carne=gracias");
    expect(form.get("cancel_url")).toBe("http://localhost/?carne=cancelado");
    expect((init.headers as Record<string, string>)["stripe-version"]).toBe("2025-03-31.basil");
  });
});

describe("embudo: app:checkout-start", () => {
  const landingWrites = () =>
    queryMock.mock.calls
      .filter((call) => String(call[0]).includes("lecta_landing_daily"))
      .map((call) => (call[1] as unknown[]).slice(1));

  it("registra el periodo y la fuente trial/free tras crear el Checkout (anónimo y por cuenta)", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "u1" } });
    loadUserPlanMock.mockResolvedValue(plan({ plan: "lecta_plus", trialEndsAt: Date.now() + 1000 }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ url: "https://checkout.stripe.com/x" }));
    const res = await app.request(
      "/api/billing/checkout",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ period: "monthly" }) },
      env,
    );
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(landingWrites()).toEqual([["app:checkout-start:monthly", "trial"]]));
    const planWrites = queryMock.mock.calls
      .filter((call) => String(call[0]).includes("lecta_plan_events"))
      .map((call) => call[1] as unknown[]);
    await vi.waitFor(() => expect(planWrites).toEqual([["u1", expect.any(String), "app:checkout-start:monthly"]]));
  });

  it("un fallo al escribir el evento no rompe la respuesta", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "u1" } });
    loadUserPlanMock.mockResolvedValue(plan());
    withClientMock.mockRejectedValue(new Error("db caída"));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ url: "https://checkout.stripe.com/x" }));
    const res = await app.request(
      "/api/billing/checkout",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ period: "yearly" }) },
      env,
    );
    expect(res.status).toBe(200);
  });
});

describe("prueba inversa (sin prueba de Stripe)", () => {
  it("durante la prueba se puede pagar y el checkout no lleva trial_period_days", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "u1" } });
    loadUserPlanMock.mockResolvedValue(plan({ plan: "lecta_plus", trialEndsAt: Date.now() + 86_400_000 }));
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ url: "https://checkout.stripe.com/x" }));
    await app.request(
      "/api/billing/checkout",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ period: "monthly" }) },
      env,
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const form = new URLSearchParams(String(init.body));
    expect(form.has("subscription_data[trial_period_days]")).toBe(false);
    expect(form.has("customer")).toBe(false);
  });

  it("con >48 h de prueba el checkout lleva trial_end; con menos no", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "u1" } });
    const bodyFor = async (trialEndsAt: number) => {
      loadUserPlanMock.mockResolvedValue(plan({ plan: "lecta_plus", trialEndsAt }));
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(jsonResponse({ url: "https://checkout.stripe.com/x" }));
      await app.request(
        "/api/billing/checkout",
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ period: "yearly" }) },
        env,
      );
      const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
      fetchMock.mockRestore();
      return new URLSearchParams(String(init.body));
    };
    const far = Date.now() + 5 * 86_400_000;
    expect((await bodyFor(far)).get("subscription_data[trial_end]")).toBe(String(Math.floor(far / 1000)));
    expect((await bodyFor(Date.now() + 36 * 3_600_000)).has("subscription_data[trial_end]")).toBe(false);
  });

  it("el portal conserva /?carne=1 como return_url", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "u1" } });
    loadUserPlanMock.mockResolvedValue(plan({ stripeCustomerId: "cus_1" }));
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ url: "https://billing.stripe.com/p" }));
    await app.request("/api/billing/portal", { method: "POST" }, env);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URLSearchParams(String(init.body)).get("return_url")).toBe("http://localhost/?carne=1");
  });
});

describe("POST /api/billing/portal", () => {
  it("sin cliente de Stripe responde 404", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "u1" } });
    loadUserPlanMock.mockResolvedValue(plan());
    const res = await app.request("/api/billing/portal", { method: "POST" }, env);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/billing/webhook", () => {
  const deliver = async (event: unknown) => {
    const body = JSON.stringify(event);
    // Los eventos subscription.* releen la suscripción: por defecto Stripe
    // devuelve lo mismo que trae el evento.
    const ev = event as { type?: string; data?: { object?: unknown } };
    if (ev.type?.startsWith("customer.subscription.") && !vi.isMockFunction(globalThis.fetch)) {
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse(ev.data?.object));
    }
    return app.request(
      "/api/billing/webhook",
      { method: "POST", headers: { "stripe-signature": await sign(body) }, body },
      env,
    );
  };
  const subEvent = (type: string, sub: Record<string, unknown>) => ({
    id: "evt_sub",
    type,
    data: { object: { id: "sub_1", customer: "cus_1", ...sub } },
  });
  const sqlCalls = () => queryMock.mock.calls.map((call) => String(call[0]));

  it("firma inválida responde 400 sin tocar la base", async () => {
    const res = await app.request(
      "/api/billing/webhook",
      { method: "POST", headers: { "stripe-signature": "t=1,v1=00" }, body: "{}" },
      env,
    );
    expect(res.status).toBe(400);
    expect(withClientMock).not.toHaveBeenCalled();
  });

  it("evento repetido: responde 200 sin aplicar cambios", async () => {
    queryMock.mockImplementation(async () => ({ rows: [] }));
    const res = await deliver(
      subEvent("customer.subscription.updated", { status: "active", metadata: { user_id: "u1" } }),
    );
    expect(res.status).toBe(200);
    expect(sqlCalls().some((sql) => sql.includes("INSERT INTO lecta_user_plan"))).toBe(false);
  });

  it("resuelve por metadata.user_id y escribe el vencimiento del item en active", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("lecta_stripe_events")) return { rows: [{ event_id: "evt_sub" }] };
      if (sql.includes('FROM "user"')) return { rows: [{ "?column?": 1 }] };
      return { rows: [] };
    });
    const res = await deliver(
      subEvent("customer.subscription.updated", {
        status: "active",
        metadata: { user_id: "u1" },
        items: { data: [{ current_period_end: 100 }] },
      }),
    );
    expect(res.status).toBe(200);
    const upsert = queryMock.mock.calls.find((call) => String(call[0]).includes("INSERT INTO lecta_user_plan"));
    expect(upsert?.[1]).toEqual(["u1", "cus_1", "sub_1", 100_000, expect.any(Number)]);
    expect(sqlCalls()).toContain("COMMIT");
  });

  it("renovación con active y luego past_due: el vencimiento vuelve al inicio del periodo impago", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("lecta_stripe_events")) return { rows: [{ event_id: "evt" }] };
      if (sql.includes('FROM "user"')) return { rows: [{ "?column?": 1 }] };
      return { rows: [] };
    });
    const items = { data: [{ current_period_start: 900, current_period_end: 999 }] };
    // El GET de la suscripción devuelve el estado vigente en cada entrega.
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: "sub_1", customer: "cus_1", status: "active", metadata: { user_id: "u1" }, items }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: "sub_1", customer: "cus_1", status: "past_due", metadata: { user_id: "u1" }, items }),
    );
    await deliver({
      ...subEvent("customer.subscription.updated", { status: "active", metadata: { user_id: "u1" }, items }),
      id: "evt_renew",
    });
    await deliver({
      ...subEvent("customer.subscription.updated", { status: "past_due", metadata: { user_id: "u1" }, items }),
      id: "evt_fail",
    });
    const upserts = queryMock.mock.calls
      .filter((call) => String(call[0]).includes("INSERT INTO lecta_user_plan"))
      .map((call) => (call[1] as unknown[])[3]);
    expect(upserts).toEqual([999_000, 900_000]);
    fetchMock.mockRestore();
  });

  it("past_due sin inicio de periodo registra el evento sin tocar plan_expires_at", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("lecta_stripe_events")) return { rows: [{ event_id: "evt_past" }] };
      if (sql.includes('FROM "user"')) return { rows: [{ "?column?": 1 }] };
      return { rows: [] };
    });
    const pastRes = await deliver({
      ...subEvent("customer.subscription.updated", {
        status: "past_due",
        metadata: { user_id: "u1" },
        items: { data: [{ current_period_end: 999 }] },
      }),
      id: "evt_past",
    });
    expect(pastRes.status).toBe(200);
    expect(sqlCalls().some((sql) => sql.includes("INSERT INTO lecta_user_plan"))).toBe(false);
  });

  it("evento en desorden sin cuenta: ROLLBACK y 500 para que Stripe reintente", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("lecta_stripe_events")) return { rows: [{ event_id: "evt_sub" }] };
      return { rows: [] };
    });
    const res = await deliver(subEvent("customer.subscription.created", { status: "active" }));
    expect(res.status).toBe(500);
    expect(sqlCalls()).toContain("ROLLBACK");
  });

  it("checkout.session.completed resuelve por client_reference_id y pide la suscripción", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("lecta_stripe_events")) return { rows: [{ event_id: "evt_co" }] };
      if (sql.includes('FROM "user"')) return { rows: [{}] };
      return { rows: [] };
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ id: "sub_2", customer: "cus_2", status: "active", items: { data: [{ current_period_end: 9 }] } }),
    );
    const res = await deliver({
      id: "evt_co",
      type: "checkout.session.completed",
      data: { object: { status: "complete", subscription: "sub_2", customer: "cus_2", client_reference_id: "u2" } },
    });
    expect(res.status).toBe(200);
    const upsert = queryMock.mock.calls.find((call) => String(call[0]).includes("INSERT INTO lecta_user_plan"));
    expect(upsert?.[1]).toEqual(["u2", "cus_2", "sub_2", 9000, expect.any(Number)]);
  });

  it("checkout-complete se registra una vez con la compra y no con subscription.updated activa", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("lecta_stripe_events")) return { rows: [{ event_id: "e" }] };
      if (sql.includes('FROM "user"')) return { rows: [{}] };
      return { rows: [] };
    });
    loadUserPlanMock.mockResolvedValue(plan({ plan: "lecta_plus", trialEndsAt: Date.now() + 1000 }));
    const sub = {
      id: "sub_2",
      customer: "cus_2",
      status: "active",
      items: { data: [{ current_period_end: 9, price: { recurring: { interval: "year" } } }] },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(sub));
    const landing = () =>
      queryMock.mock.calls
        .filter((call) => String(call[0]).includes("lecta_landing_daily"))
        .map((call) => (call[1] as unknown[]).slice(1));
    await deliver({
      id: "evt_co",
      type: "checkout.session.completed",
      data: { object: { status: "complete", subscription: "sub_2", customer: "cus_2", client_reference_id: "u2" } },
    });
    await vi.waitFor(() => expect(landing()).toEqual([["app:checkout-complete:yearly", "trial"]]));
    const planEvents = () =>
      queryMock.mock.calls
        .filter((call) => String(call[0]).includes("lecta_plan_events"))
        .map((call) => call[1] as unknown[]);
    await vi.waitFor(() =>
      expect(planEvents()).toEqual([["u2", expect.any(String), "app:checkout-complete:yearly"]]),
    );
    // Renovación: subscription.updated activa, sin evento nuevo.
    await deliver(subEvent("customer.subscription.updated", { ...sub, metadata: { user_id: "u2" } }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(landing()).toHaveLength(1);
  });

  it("mismo segundo en desorden: el estado vigente de Stripe manda (cancelada gana a updated activa)", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("lecta_stripe_events")) return { rows: [{ event_id: "e" }] };
      if (sql.includes('FROM "user"')) return { rows: [{}] };
      return { rows: [{ user_id: "u1" }] };
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ id: "sub_1", customer: "cus_1", status: "canceled", ended_at: 50, metadata: { user_id: "u1" } }),
    );
    const res = await deliver({
      ...subEvent("customer.subscription.updated", {
        status: "active",
        metadata: { user_id: "u1" },
        items: { data: [{ current_period_end: 9_999 }] },
      }),
      created: 100,
    });
    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/subscriptions/sub_1");
    const upsert = queryMock.mock.calls.find((call) => String(call[0]).includes("INSERT INTO lecta_user_plan"));
    expect(upsert?.[1]?.[3]).toBe(50_000);
  });

  it("checkout-complete no se cuenta si el WHERE de orden descarta el evento", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("lecta_stripe_events")) return { rows: [{ event_id: "e" }] };
      if (sql.includes('FROM "user"')) return { rows: [{}] };
      return { rows: [] }; // upsert sin RETURNING: descartado
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        id: "sub_2",
        customer: "cus_2",
        status: "active",
        items: { data: [{ current_period_end: 9, price: { recurring: { interval: "year" } } }] },
      }),
    );
    await deliver({
      id: "evt_co",
      type: "checkout.session.completed",
      created: 5,
      data: { object: { status: "complete", subscription: "sub_2", customer: "cus_2", client_reference_id: "u2" } },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(queryMock.mock.calls.some((call) => String(call[0]).includes("lecta_landing_daily"))).toBe(false);
  });

  it("incomplete registra el evento sin escribir el plan", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("lecta_stripe_events")) return { rows: [{ event_id: "evt_sub" }] };
      if (sql.includes('FROM "user"')) return { rows: [{}] };
      return { rows: [] };
    });
    const res = await deliver(
      subEvent("customer.subscription.created", { status: "incomplete", metadata: { user_id: "u1" } }),
    );
    expect(res.status).toBe(200);
    expect(sqlCalls().some((sql) => sql.includes("INSERT INTO lecta_user_plan"))).toBe(false);
  });

  it("sin tabla (42P01): ROLLBACK y 503", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("lecta_stripe_events")) {
        throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
      }
      return { rows: [] };
    });
    const res = await deliver(
      subEvent("customer.subscription.updated", { status: "active", metadata: { user_id: "u1" } }),
    );
    expect(res.status).toBe(503);
  });

  it("tipos no manejados se aceptan sin tocar la base", async () => {
    const res = await deliver({ id: "evt_x", type: "invoice.paid", data: { object: {} } });
    expect(res.status).toBe(200);
    expect(withClientMock).not.toHaveBeenCalled();
  });
});

describe("cancelación al borrar la cuenta", () => {
  it("sin suscripción no llama a Stripe", async () => {
    loadUserPlanMock.mockResolvedValue(plan());
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await cancelBillingForDeletion(env, "u1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("free con el periodo vencido omite la llamada", async () => {
    loadUserPlanMock.mockResolvedValue(plan({ stripeSubscriptionId: "sub_1", expiresAt: 5 }));
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await cancelBillingForDeletion(env, "u1", 10);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exsuscriptor vencido que cae en la prueba inversa omite la llamada", async () => {
    loadUserPlanMock.mockResolvedValue(
      plan({ plan: "lecta_plus", trialEndsAt: 99, stripeSubscriptionId: "sub_1", expiresAt: 5 }),
    );
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await cancelBillingForDeletion(env, "u1", 10);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancela una suscripción vigente", async () => {
    loadUserPlanMock.mockResolvedValue(plan({ plan: "lecta_plus", stripeSubscriptionId: "sub_1" }));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ status: "canceled" }));
    await cancelBillingForDeletion(env, "u1");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.stripe.com/v1/subscriptions/sub_1");
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("DELETE");
  });

  it("404 / resource_missing y ya cancelada cuentan como éxito", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ error: { code: "resource_missing" } }, 404))
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: "This subscription is already canceled." } }, 400),
      );
    await expect(cancelSubscriptionForDeletion(env, "sub_1")).resolves.toBeUndefined();
    await expect(cancelSubscriptionForDeletion(env, "sub_1")).resolves.toBeUndefined();
  });

  it("otro error aborta el borrado", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ error: { code: "api_error" } }, 500));
    await expect(cancelSubscriptionForDeletion(env, "sub_1")).rejects.toThrow();
  });
});
