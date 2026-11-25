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
      { week, signups: 0, activated: 0, d1: 0, d1Eligible: 0, w1: 0, w1Eligible: 0, d8to30: 0, d8to30Eligible: 0 };
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

async function readUsers(weeks) {
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
              COALESCE(p.plan, 'free') AS plan
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
    return {
      database: db.rows[0]?.db,
      excluded: users.rows.length - real.length,
      users: real.map((row) => ({
        created: Number(row.created),
        plan: String(row.plan),
        days: daysById.get(row.id) ?? [],
      })),
    };
  } finally {
    await client.end();
  }
}

async function main() {
  const { weeks, json } = parseArgs(process.argv.slice(2));
  const { database, excluded, users } = await readUsers(weeks);
  const now = Date.now();
  const cohorts = buildCohorts(users, now);
  const active = summarizeActive(users, now);
  if (json) {
    console.log(JSON.stringify({ database, weeks, excluded, cohorts, active }, null, 2));
    return;
  }
  console.log(`Retención · ${database} · altas de las últimas ${weeks} semanas · ${excluded} cuentas de prueba excluidas\n`);
  if (!cohorts.length) {
    console.log("Sin altas reales en el periodo.");
    return;
  }
  const header = ["semana", "altas", "activadas", "D1", "S1 (días 1–7)", "D8–30"];
  const lines = cohorts.map((c) => [
    c.week,
    c.signups,
    rate(c.activated, c.signups),
    rate(c.d1, c.d1Eligible),
    rate(c.w1, c.w1Eligible),
    rate(c.d8to30, c.d8to30Eligible),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...lines.map((l) => String(l[i]).length)));
  const fmt = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join("  ");
  console.log(fmt(header));
  for (const line of lines) console.log(fmt(line));
  console.log(`\nActivas: ${active.active7} en 7 días · ${active.active30} en 30 días · de ${active.total}`);
  for (const [plan, p] of Object.entries(active.byPlan)) {
    console.log(`  ${plan}: ${p.active7} en 7 días · ${p.active30} en 30 días · de ${p.total}`);
  }
}

// pathToFileURL: la ruta del repo lleva espacios («Desarrollos Devin»).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
