import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REVERSE_TRIAL_MS, REVERSE_TRIAL_START } from "../shared/plan";
import type { WorkerEnv } from "./db";
import * as landingEvents from "./landing-events";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  withClient: async (
    _env: unknown,
    run: (client: { query: typeof queryMock }) => Promise<unknown>,
  ) => run({ query: queryMock }),
}));

import {
  TRIAL_END_CTA_URL,
  TRIAL_END_ELIGIBLE_SQL,
  TRIAL_END_EMAIL_EVENT,
  TRIAL_END_EMAIL_WINDOW_MS,
  buildTrialEndHtml,
  isTrialActive,
  runTrialEndEmails,
  trialEndSubject,
} from "./trial-end-email";

const SECRET = "s3cr3t";
const env: WorkerEnv = {
  RESEND_API_KEY: "re_x",
  BETTER_AUTH_SECRET: SECRET,
  DATABASE_URL: "postgres://x",
};
const NOW = Date.UTC(2026, 11, 10, 12, 0, 0);

beforeEach(() => {
  queryMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("trial-end-email plantilla y filtros", () => {
  it("acepta app:trial-end-email en el registro de eventos de landing", () => {
    expect(landingEvents.isAllowedLandingEvent(TRIAL_END_EMAIL_EVENT)).toBe(true);
    expect(TRIAL_END_EMAIL_EVENT).toBe("app:trial-end-email");
  });

  it("isTrialActive exige al menos una señal de uso real", () => {
    expect(isTrialActive({ aiUses: 0, wordsSaved: 0, cloudBooks: 0 })).toBe(false);
    expect(isTrialActive({ aiUses: 1, wordsSaved: 0, cloudBooks: 0 })).toBe(true);
    expect(isTrialActive({ aiUses: 0, wordsSaved: 1, cloudBooks: 0 })).toBe(true);
    expect(isTrialActive({ aiUses: 0, wordsSaved: 0, cloudBooks: 1 })).toBe(true);
  });

  it("genera asunto y HTML sobrio con singular/plural, omite ceros y escapa enlace de baja", () => {
    expect(trialEndSubject()).toBe("Terminaron tus 14 días de prueba en Lecta+");

    const singular = buildTrialEndHtml(
      { aiUses: 1, wordsSaved: 0, cloudBooks: 1 },
      'https://lectal.app/api/reengage/unsubscribe?u=u1&t=abc"',
    );
    expect(singular).toContain("1 consulta con IA mientras leías");
    expect(singular).not.toContain("Herbario</li>");
    expect(singular).toContain("1 libro sincronizado en tu Biblioteca");
    expect(TRIAL_END_CTA_URL).toBe("https://lectal.app/?carne=1&src=trial_end");
    expect(singular).toContain("https://lectal.app/?carne=1&amp;src=trial_end");
    expect(singular).toContain("&amp;t=abc&quot;");
    expect(singular).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);

    const plural = buildTrialEndHtml(
      { aiUses: 4, wordsSaved: 12, cloudBooks: 3 },
      "https://lectal.app/api/reengage/unsubscribe?u=u1&t=abc",
    );
    expect(plural).toContain("4 consultas con IA mientras leías");
    expect(plural).toContain("12 palabras guardadas en tu Herbario");
    expect(plural).toContain("3 libros sincronizados en tu Biblioteca");
  });
});

describe("runTrialEndEmails", () => {
  it("consulta elegibles en la ventana de 48h con idempotencia por lecta_plan_events", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const sleepMock = vi.fn(async () => undefined);
    const res = await runTrialEndEmails(env, NOW, sleepMock);

    expect(res).toEqual({ sent: 0, eligible: 0, skippedInactive: 0 });
    expect(sleepMock).not.toHaveBeenCalled();

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toBe(TRIAL_END_ELIGIBLE_SQL);
    expect(params).toEqual([
      REVERSE_TRIAL_START,
      REVERSE_TRIAL_MS,
      NOW - TRIAL_END_EMAIL_WINDOW_MS,
      NOW,
    ]);
    expect(sql).toContain('u."emailVerified"');
    expect(sql).toContain("reengage_opt_out");
    expect(sql).toContain("NOT EXISTS");
    expect(sql).toContain("lecta_plan_events");
    expect(sql).toContain(TRIAL_END_EMAIL_EVENT);
  });

  it("envía a cuenta activa con baja de un clic, espera 600ms y registra plan + landing events", async () => {
    const trialEndsAt = NOW - 6 * 3_600_000;
    queryMock.mockImplementation(async (sql: string) => {
      if (sql === TRIAL_END_ELIGIBLE_SQL) {
        return { rows: [{ id: "u1", email: "activa@correo.mx", trial_ends_at: trialEndsAt }] };
      }
      if (sql.includes("FROM lecta_ai_quota")) {
        return { rows: [{ ai_uses: "5", words_saved: "8", cloud_books: "1" }] };
      }
      return { rows: [], rowCount: 1 };
    });

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const planSpy = vi.spyOn(landingEvents, "recordPlanEvent").mockResolvedValue(true);
    const landingSpy = vi.spyOn(landingEvents, "recordLandingEvent").mockResolvedValue(true);
    const sleepMock = vi.fn(async () => undefined);

    const res = await runTrialEndEmails(env, NOW, sleepMock);
    expect(res).toEqual({ sent: 1, eligible: 1, skippedInactive: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.to).toEqual(["activa@correo.mx"]);
    expect(body.subject).toBe("Terminaron tus 14 días de prueba en Lecta+");
    expect(body.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(body.headers["List-Unsubscribe"]).toContain("/api/reengage/unsubscribe?u=u1&t=");
    expect(body.html).toContain("5 consultas con IA");
    expect(body.html).toContain("8 palabras guardadas");
    expect(body.html).toContain("1 libro sincronizado");
    expect(body.html).toContain("https://lectal.app/?carne=1&amp;src=trial_end");

    expect(planSpy).toHaveBeenCalledWith(env, "u1", TRIAL_END_EMAIL_EVENT, new Date(NOW));
    expect(landingSpy).toHaveBeenCalledWith(
      env,
      { event: TRIAL_END_EMAIL_EVENT, source: "free" },
      new Date(NOW),
    );
    expect(sleepMock).toHaveBeenCalledWith(600);
  });

  it("salta cuentas inactivas (0/0/0) sin llamar a Resend, sin registrar ni dormir", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql === TRIAL_END_ELIGIBLE_SQL) {
        return { rows: [{ id: "u_idle", email: "idle@correo.mx", trial_ends_at: NOW - 1000 }] };
      }
      if (sql.includes("FROM lecta_ai_quota")) {
        return { rows: [{ ai_uses: "0", words_saved: "0", cloud_books: "0" }] };
      }
      return { rows: [], rowCount: 1 };
    });

    const fetchMock = vi.spyOn(globalThis, "fetch");
    const planSpy = vi.spyOn(landingEvents, "recordPlanEvent");
    const landingSpy = vi.spyOn(landingEvents, "recordLandingEvent");
    const sleepMock = vi.fn(async () => undefined);

    const res = await runTrialEndEmails(env, NOW, sleepMock);
    expect(res).toEqual({ sent: 0, eligible: 1, skippedInactive: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(planSpy).not.toHaveBeenCalled();
    expect(landingSpy).not.toHaveBeenCalled();
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("si Resend falla no registra app:trial-end-email y continúa con el resto", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql === TRIAL_END_ELIGIBLE_SQL) {
        return {
          rows: [
            { id: "u1", email: "fail@correo.mx", trial_ends_at: NOW - 1000 },
            { id: "u2", email: "ok@correo.mx", trial_ends_at: NOW - 500 },
          ],
        };
      }
      if (sql.includes("FROM lecta_ai_quota")) {
        return { rows: [{ ai_uses: "2", words_saved: "1", cloud_books: "0" }] };
      }
      return { rows: [], rowCount: 1 };
    });

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("err", { status: 500 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const planSpy = vi.spyOn(landingEvents, "recordPlanEvent").mockResolvedValue(true);
    const landingSpy = vi.spyOn(landingEvents, "recordLandingEvent").mockResolvedValue(true);
    const sleepMock = vi.fn(async () => undefined);

    const res = await runTrialEndEmails(env, NOW, sleepMock);
    expect(res).toEqual({ sent: 1, eligible: 2, skippedInactive: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(planSpy).toHaveBeenCalledTimes(1);
    expect(planSpy).toHaveBeenCalledWith(env, "u2", TRIAL_END_EMAIL_EVENT, new Date(NOW));
    expect(landingSpy).toHaveBeenCalledTimes(1);
    expect(sleepMock).toHaveBeenCalledTimes(2);
  });

  it("sin tabla/columna (42P01/42703), sin Resend o sin secreto no falla ni envía", async () => {
    const sleepMock = vi.fn(async () => undefined);
    const fetchMock = vi.spyOn(globalThis, "fetch");

    queryMock.mockRejectedValueOnce(Object.assign(new Error("no table"), { code: "42P01" }));
    expect(await runTrialEndEmails(env, NOW, sleepMock)).toEqual({
      sent: 0,
      eligible: 0,
      skippedInactive: 0,
    });

    queryMock.mockRejectedValueOnce(Object.assign(new Error("no col"), { code: "42703" }));
    expect(await runTrialEndEmails(env, NOW, sleepMock)).toEqual({
      sent: 0,
      eligible: 0,
      skippedInactive: 0,
    });

    expect(
      await runTrialEndEmails({ ...env, RESEND_API_KEY: undefined }, NOW, sleepMock),
    ).toEqual({ sent: 0, eligible: 0, skippedInactive: 0 });
    expect(
      await runTrialEndEmails({ ...env, BETTER_AUTH_SECRET: undefined }, NOW, sleepMock),
    ).toEqual({ sent: 0, eligible: 0, skippedInactive: 0 });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(sleepMock).not.toHaveBeenCalled();
  });
});
