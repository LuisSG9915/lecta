#!/usr/bin/env node
// Retención por cohorte semanal de alta. Solo lee (transacción read-only) y
// nunca imprime correos. Uso:
//   pnpm retention:stats [--weeks 12] [--json]
// `DATABASE_URL` del `.env` es producción (`lecta`); para dev, `DATABASE_URL_DEV` (`lecta_dev`).
//
// Actividad = cualquier escritura de la cuenta: posición, palabra, repaso,
// intervalo de lectura o anotación. `lecta_user_activity` sola se queda
// corta (casi ninguna cuenta la sube) y la palabra de la demo llega con
// updated_at = 0, por eso se descarta.
// Días desde el alta: floor((t − alta) / 24 h). D1 = día 1; S1 = días 1–7;
// D8–30 = días 8–30. Una cohorte demasiado joven para un hito no cuenta en
// su denominador (sale «—»), así que no se lee como abandono.

import { pathToFileURL } from "node:url";

const DAY = 86_400_000;

// Copia de src/shared/plan.ts (REVERSE_TRIAL_MS, REVERSE_TRIAL_START, PLAN_GRACE_MS):
// este .mjs no puede importar TypeScript. retention-stats.test.mjs lee plan.ts
// como texto y falla si los valores dejan de coincidir.
export const REVERSE_TRIAL_MS = 14 * DAY;
export const REVERSE_TRIAL_START = Date.UTC(2026, 10, 25);
export const PLAN_GRACE_MS = 3 * DAY;

/** Fin de la prueba inversa de una cuenta (ms), igual que `reverseTrialEndsAt`. */
export function trialEndsAt(created) {
  return Math.max(created, REVERSE_TRIAL_START) + REVERSE_TRIAL_MS;
}

/**
 * Plan efectivo para métricas: `trial` | `free` | `plus_paid` | `founder_lifetime`.
 * `row`: { plan, expiresAt, hasSubscription, created }. Un `lecta_plus` sin
 * suscripción de Stripe (otorgado a mano) cuenta como `free`/`trial` según la fecha.
 */
export function classifyPlan(row, now) {
  const plan = row.plan ?? "free";
  if (plan === "founder_lifetime") return "founder_lifetime";
  if (plan === "lecta_plus" && row.hasSubscription) {
    const exp = row.expiresAt;
    const lapsed = exp != null && Number.isFinite(Number(exp)) && Number(exp) + PLAN_GRACE_MS < now;
    if (!lapsed) return "plus_paid";
  }
  return now < trialEndsAt(row.created) ? "trial" : "free";
}

/** Cuentas de prueba (smoke:auth, sondas, capturas): fuera de toda métrica. */
export function isTestEmail(email) {
  const e = String(email ?? "").toLowerCase();
  return e.endsWith("@smoke.test") || e.endsWith("@example.com") || e.startsWith("smoke");
}

/** Lunes UTC de la semana de `ms`, como YYYY-MM-DD. */
function weekOf(ms) {
  const d = new Date(ms);
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY;
  return new Date(monday).toISOString().slice(0, 10);
}

/**
 * `users`: `{ created, plan, days }` con `days` = instantes (ms) de actividad.
 * Devuelve una fila por semana de alta, de la más vieja a la más nueva.
 */
export function buildCohorts(users, now) {
  const byWeek = new Map();
  for (const user of users) {
    const week = weekOf(user.created);
    const row =
      byWeek.get(week) ??
      { week, signups: 0, activated: 0, d1: 0, d1Eligible: 0, w1: 0, w1Eligible: 0, d8to30: 0, d8to30Eligible: 0, trialEnded: 0, trialPaid: 0 };
    const age = (now - user.created) / DAY;
    const offsets = user.days.map((t) => Math.floor((t - user.created) / DAY)).filter((d) => d >= 0);
    row.signups += 1;
    if (offsets.length) row.activated += 1;
    if (age >= 2) {
      row.d1Eligible += 1;
      if (offsets.includes(1)) row.d1 += 1;
    }
    if (age >= 8) {
      row.w1Eligible += 1;
      if (offsets.some((d) => d >= 1 && d <= 7)) row.w1 += 1;
    }
    if (age >= 31) {
      row.d8to30Eligible += 1;
      if (offsets.some((d) => d >= 8 && d <= 30)) row.d8to30 += 1;
    }
    // prueba → pago: cuentas cuya prueba ya venció y hoy son plus_paid.
    // Los fundadores no tuvieron prueba (`trialEnd` ausente).
    if (typeof user.trialEnd === "number" && user.trialEnd <= now) {
      row.trialEnded += 1;
      if (user.plan === "plus_paid") row.trialPaid += 1;
    }
    byWeek.set(week, row);
  }
  return [...byWeek.values()].sort((a, b) => a.week.localeCompare(b.week));
}

/** Cuentas con actividad en los últimos 7 y 30 días, en total y por plan. */
export function summarizeActive(users, now) {
  const out = { total: 0, active7: 0, active30: 0, byPlan: {} };
  for (const user of users) {
    const last = user.days.length ? Math.max(...user.days) : -Infinity;
    const a7 = last > now - 7 * DAY ? 1 : 0;
    const a30 = last > now - 30 * DAY ? 1 : 0;
    const plan = user.plan ?? "free";
    const p = (out.byPlan[plan] ??= { total: 0, active7: 0, active30: 0 });
    out.total += 1;
    out.active7 += a7;
    out.active30 += a30;
    p.total += 1;
    p.active7 += a7;
    p.active30 += a30;
  }
  return out;
}

/** Familias de aviso de lecta_plan_events (F19) que mide el reporte. */
export const PLAN_EVENT_FAMILIES = [
  ["trialEnd", (e) => e === "app:trial-end-view"],
  ["paywall", (e) => e === "app:paywall" || e.startsWith("app:paywall:")],
  ["checkout", (e) => e.startsWith("app:checkout-start:")],
];

/**
 * `users`: { created, plan, id }; `events`: Map id → lista de nombres de evento.
 * Por semana de alta: cuentas que vieron cada familia y cuántas son plus_paid.
 * El id solo se usa para cruzar; nunca sale en el resultado.
 */
export function buildPlanEventCohorts(users, events) {
  const byWeek = new Map();
  for (const user of users) {
    const week = weekOf(user.created);
    const row = byWeek.get(week) ?? { week, signups: 0 };
    row.signups += 1;
    const seen = events.get(user.id) ?? [];
    for (const [name, matches] of PLAN_EVENT_FAMILIES) {
      row[name] ??= 0;
      row[name + "Paid"] ??= 0;
      if (seen.some(matches)) {
        row[name] += 1;
        if (user.plan === "plus_paid") row[name + "Paid"] += 1;
      }
    }
    byWeek.set(week, row);
  }
  return [...byWeek.values()].sort((a, b) => a.week.localeCompare(b.week));
}

export function rate(part, whole) {
  return whole > 0 ? `${part}/${whole} (${Math.round((part / whole) * 100)}%)` : "—";
}

function parseArgs(argv) {
  const out = { weeks: 12, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") out.json = true;
    else if (argv[i] === "--weeks") out.weeks = Math.max(1, Math.min(104, Number(argv[++i]) || 12));
  }
  return out;
}

async function readUsers(weeks, now) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Falta DATABASE_URL (usa `node --env-file=.env`).");
  const { Client } = await import("pg");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("SET default_transaction_read_only = on");
    const db = await client.query("SELECT current_database() AS db");
    const users = await client.query(
      `SELECT u.id, u.email, (extract(epoch from u."createdAt") * 1000)::INT8 AS created,
              COALESCE(p.plan, 'free') AS plan, p.plan_expires_at AS expires_at,
              (p.stripe_subscription_id IS NOT NULL) AS has_subscription
         FROM "user" u LEFT JOIN lecta_user_plan p ON p.user_id = u.id
        WHERE u."createdAt" >= now() - ($1::INT8 * INTERVAL '7 days')`,
      [weeks],
    );
    const real = users.rows.filter((row) => !isTestEmail(row.email));
    const ids = real.map((row) => row.id);
    // Un instante por cuenta y día UTC (el más temprano) basta: la métrica es por día.
    const activity = ids.length
      ? await client.query(
          `SELECT user_id, min(t)::INT8 AS t FROM (
             SELECT user_id, updated_at AS t FROM lecta_user_positions WHERE user_id = ANY($1)
             UNION ALL SELECT user_id, updated_at FROM lecta_user_words WHERE user_id = ANY($1) AND updated_at > 0
             UNION ALL SELECT user_id, created_at FROM lecta_user_reviews WHERE user_id = ANY($1)
             UNION ALL SELECT user_id, ended_at FROM lecta_user_activity WHERE user_id = ANY($1)
             UNION ALL SELECT user_id, updated_at FROM lecta_user_annotations WHERE user_id = ANY($1)
           ) a GROUP BY user_id, floor(t / 86400000)`,
          [ids],
        )
      : { rows: [] };
    const daysById = new Map();
    for (const row of activity.rows) {
      const list = daysById.get(row.user_id) ?? [];
      list.push(Number(row.t));
      daysById.set(row.user_id, list);
    }
    // F19: tabla opcional (migración 035); ausente ⇒ planEvents = null.
    let planEvents = null;
    if (ids.length) {
      try {
        const ev = await client.query(
          `SELECT user_id, event FROM lecta_plan_events WHERE user_id = ANY($1) GROUP BY user_id, event`,
          [ids],
        );
        planEvents = new Map();
        for (const row of ev.rows) {
          const list = planEvents.get(row.user_id) ?? [];
          list.push(String(row.event));
          planEvents.set(row.user_id, list);
        }
      } catch (err) {
        if (err?.code !== "42P01") throw err;
      }
    }
    return {
      planEvents,
      database: db.rows[0]?.db,
      excluded: users.rows.length - real.length,
      users: real.map((row) => {
        const created = Number(row.created);
        const plan = classifyPlan(
          {
            plan: String(row.plan),
            expiresAt: row.expires_at == null ? null : Number(row.expires_at),
            hasSubscription: row.has_subscription === true,
            created,
          },
          now,
        );
        return {
          id: row.id,
          created,
          plan,
          trialEnd: plan === "founder_lifetime" ? undefined : trialEndsAt(created),
          days: daysById.get(row.id) ?? [],
        };
      }),
    };
  } finally {
    await client.end();
  }
}

async function main() {
  const { weeks, json } = parseArgs(process.argv.slice(2));
  const now = Date.now();
  const { database, excluded, users, planEvents } = await readUsers(weeks, now);
  const cohorts = buildCohorts(users, now);
  const active = summarizeActive(users, now);
  const planCohorts = planEvents ? buildPlanEventCohorts(users, planEvents) : null;
  if (json) {
    const safe = users.length && planCohorts ? planCohorts : null;
    console.log(JSON.stringify({ database, weeks, excluded, cohorts, active, planEvents: safe }, null, 2));
    return;
  }
  console.log(`Retención · ${database} · altas de las últimas ${weeks} semanas · ${excluded} cuentas de prueba excluidas\n`);
  if (!cohorts.length) {
    console.log("Sin altas reales en el periodo.");
    return;
  }
  const header = ["semana", "altas", "activadas", "D1", "S1 (días 1–7)", "D8–30", "prueba → pago"];
  const lines = cohorts.map((c) => [
    c.week,
    c.signups,
    rate(c.activated, c.signups),
    rate(c.d1, c.d1Eligible),
    rate(c.w1, c.w1Eligible),
    rate(c.d8to30, c.d8to30Eligible),
    rate(c.trialPaid, c.trialEnded),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...lines.map((l) => String(l[i]).length)));
  const fmt = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join("  ");
  console.log(fmt(header));
  for (const line of lines) console.log(fmt(line));
  console.log(`\nActivas: ${active.active7} en 7 días · ${active.active30} en 30 días · de ${active.total}`);
  for (const [plan, p] of Object.entries(active.byPlan)) {
    console.log(`  ${plan}: ${p.active7} en 7 días · ${p.active30} en 30 días · de ${p.total}`);
  }
  if (!planCohorts) {
    console.log("\nAvisos de Lecta+ por cohorte: sin lecta_plan_events (migración 035 pendiente).");
    return;
  }
  console.log("\nAvisos de Lecta+ vistos por cohorte (cuentas que lo vieron · de ellas, plus_paid)");
  const h2 = ["semana", "altas", "fin de prueba", "muro", "checkout"];
  const l2 = planCohorts.map((c) => [
    c.week,
    c.signups,
    `${c.trialEnd} · ${c.trialEndPaid}`,
    `${c.paywall} · ${c.paywallPaid}`,
    `${c.checkout} · ${c.checkoutPaid}`,
  ]);
  const w2 = h2.map((h, i) => Math.max(h.length, ...l2.map((l) => String(l[i]).length)));
  const f2 = (cells) => cells.map((c, i) => String(c).padEnd(w2[i])).join("  ");
  console.log(f2(h2));
  for (const line of l2) console.log(f2(line));
}

// pathToFileURL: la ruta del repo lleva espacios («Desarrollos Devin»).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
