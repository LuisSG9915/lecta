// Sesión simulada para las pruebas e2e (docs/designs/2026-11-12-planes-y-landing.md):
// la cuenta es obligatoria, así que toda spec que abre la app sin sesión ve la
// bienvenida. Este arnés simula Better Auth, /api/account/state y las rutas
// de sync con respuestas vacías (extraído de smoke-journeys Journey 3). Sin
// las rutas de sync, un 401 haría que accountFetch marque la sesión vencida.
//
// Las rutas que registra cada spec después tienen prioridad (Playwright
// recorre las rutas en orden inverso al registro).
import type { BrowserContext, Page } from "@playwright/test";

export const TEST_USER_ID = "u_e2e_test";

/** Base IndexedDB de la cuenta de prueba (idb.ts: `lecta:u:<id>`). */
export const TEST_DB_NAME = `lecta:u:${TEST_USER_ID}`;

export type TestPlan = "free" | "lecta_plus" | "founder_lifetime";

type Target = Pick<BrowserContext, "route"> | Pick<Page, "route">;

const json = (body: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify(body),
});

export async function withTestSession(
  target: Target,
  opts: { plan?: TestPlan; starterCoat?: string | null } = {},
): Promise<void> {
  const plan = opts.plan ?? "founder_lifetime";
  let starterCoat = opts.starterCoat ?? "ginger";
  const serverTime = () => Date.now();

  await target.route("**/api/auth/get-session", (route) =>
    route.fulfill(
      json({
        session: {
          id: "sess_e2e",
          userId: TEST_USER_ID,
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        },
        user: { id: TEST_USER_ID, email: "e2e@test.com", name: "E2E" },
      }),
    ),
  );
  await target.route("**/api/account/state", (route) =>
    route.fulfill(json({ ok: true, resetAt: 0, plan, starterCoat, planExpiresAt: null })),
  );
  await target.route("**/api/account/starter-coat", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}") as { coat?: string };
    starterCoat = starterCoat ?? body.coat ?? null;
    await route.fulfill(json({ starterCoat }));
  });

  const appendOnly = (listKey: string) => async (route: Parameters<Parameters<Target["route"]>[1]>[0]) => {
    if (route.request().method() === "PUT") {
      await route.fulfill(json({ ok: true, serverTime: serverTime() }));
    } else {
      await route.fulfill(json({ [listKey]: [], hasMore: false, serverTime: serverTime() }));
    }
  };
  await target.route("**/api/positions**", async (route) => {
    if (route.request().method() === "PUT") {
      await route.fulfill(json({ ok: true, upserted: 0, serverTime: serverTime() }));
    } else {
      await route.fulfill(
        json({
          positions: [],
          serverTime: serverTime(),
          hasMore: false,
          nextCursor: 0,
          nextAfterBookHash: null,
        }),
      );
    }
  });
  await target.route("**/api/annotations**", appendOnly("annotations"));
  await target.route("**/api/activity**", appendOnly("intervals"));
  await target.route("**/api/reviews**", appendOnly("reviews"));
  await target.route("**/api/knowledge**", appendOnly("rows"));
  await target.route("**/api/vocab**", appendOnly("words"));
  await target.route("**/api/companion**", async (route) => {
    if (route.request().method() === "PUT") {
      await route.fulfill(
        json({ accepted: { baselines: [], events: [], fields: [], receipts: [] } }),
      );
    } else {
      await route.fulfill(json({ items: [], nextCursor: null }));
    }
  });
  await target.route("**/api/sync/counts**", (route) =>
    route.fulfill(
      json({
        ok: true,
        counts: { words: 0, annotations: 0, activity: 0, reviews: 0, positions: 0, knowledge: 0 },
      }),
    ),
  );
  await target.route("**/api/books**", (route) => route.fulfill(json({ books: [] })));
  await target.route("**/api/user/books**", (route) => route.fulfill(json({ books: [] })));
  await target.route("**/api/catalog**", (route) => route.fulfill(json({ books: [] })));
}
