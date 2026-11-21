// Guardia del sello de reinicio de cuenta. Cada escritura de datos de
// cuenta toma la fila-marcador con FOR UPDATE dentro de su propia
// transacción antes de tocar filas: si el sello del servidor es más
// nuevo que el que el cliente declara en `x-lecta-reset`, ese cliente
// tiene una copia local vieja y su lote resucitaría lo que otro
// dispositivo acabó de borrar — se rechaza con 409 y el sello, y el
// cliente usa esa respuesta para vaciarse y arrancar limpio.
//
// El bloqueo de fila es lo que cierra la carrera de un push en vuelo
// durante el reset: el reset escribe el sello ANTES de borrar, así que
// quien gane el FOR UPDATE define el orden — o el writer comitea antes
// y el reset lo borra junto con todo, o el reset comitea antes y el
// writer lee el sello nuevo y aborta. En ambos casos nada resucita.

import type { Context } from "hono";
import type pg from "pg";
import { isMissingTableError, readAccountResetAt, withClient, type WorkerEnv } from "./db";

export const RESET_ACK_HEADER = "x-lecta-reset";
export const RESET_STALE_ERROR = "account_reset";

// La marca que el cliente recuerda del último reinicio que conoció.
// Falta de encabezado (cliente viejo o nunca sincronizado) cuenta 0:
// cualquier reset previo lo vuelve obsoleto.
export function readResetAck(context: Context): number {
  const stamp = Number(context.req.header(RESET_ACK_HEADER));
  return Number.isFinite(stamp) && stamp > 0 ? stamp : 0;
}

// Centinela que devuelve `withResetGuard` cuando la marca venció: se
// distingue del resultado normal del endpoint con `isResetBlocked`.
export type ResetBlocked = { blockedAt: number };

export function isResetBlocked(value: unknown): value is ResetBlocked {
  return (
    typeof value === "object" &&
    value !== null &&
    "blockedAt" in value &&
    typeof (value as ResetBlocked).blockedAt === "number"
  );
}

export function resetBlockedResponse(context: Context, resetAt: number): Response {
  return context.json(
    {
      error: RESET_STALE_ERROR,
      message: "Los datos de la cuenta se reiniciaron en otro dispositivo.",
      resetAt,
    },
    409,
  );
}

// Variante de excepción para los caminos cuya transacción la abre otra
// función (companion, escritores internos): se lanza dentro del BEGIN,
// el catch del llamador hace ROLLBACK y el endpoint responde 409.
export class StaleResetError extends Error {
  readonly resetAt: number;
  constructor(resetAt: number) {
    super(`account data reset at ${resetAt}`);
    this.name = "StaleResetError";
    this.resetAt = resetAt;
  }
}

// Asegura la fila-marcador del usuario y la toma con FOR UPDATE — debe
// llamarse DENTRO de la transacción del escritor, antes de sus writes.
// Devuelve el sello vigente (0 si la cuenta nunca se reinició). La fila
// se crea con reset_at=0 si falta: el FOR UPDATE siempre tiene algo que
// bloquear, así el INSERT/UPDATE del reset espera a que este writer
// termine — y si el reset ya ganó, aquí se lee su sello.
//
// El SAVEPOINT protege el despliegue previo a la migración 023: sin la
// tabla el INSERT lanza 42P01 y en Postgres un error dentro de la txn
// la envenena entera — ROLLBACK TO SAVEPOINT la reanima y la escritura
// corre sin guardia, igual que antes del cambio.
export async function lockResetMarker(
  client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  userId: string,
): Promise<number> {
  await client.query("SAVEPOINT lecta_reset_marker");
  try {
    const lock = async () =>
      (await client.query(
        "SELECT reset_at FROM lecta_account_state WHERE user_id = $1 FOR UPDATE",
        [userId],
      )) as { rows?: Array<{ reset_at?: unknown }> };
    // Casi siempre la fila ya existe: una sola ida a la base. El INSERT
    // solo corre la primera vez (y no escribe si otro writer la creó).
    // No se usa ON CONFLICT DO UPDATE: escribiría la fila en cada
    // escritura, y una escritura replicada cuesta más que el candado.
    let res = await lock();
    if (!res.rows?.length) {
      await client.query(
        `INSERT INTO lecta_account_state (user_id, reset_at)
         VALUES ($1, 0)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId],
      );
      res = await lock();
    }
    const stamp = Number(res.rows?.[0]?.reset_at);
    return Number.isFinite(stamp) && stamp > 0 ? stamp : 0;
  } catch (err) {
    if (isMissingTableError(err)) {
      await client.query("ROLLBACK TO SAVEPOINT lecta_reset_marker").catch(() => undefined);
      return 0;
    }
    throw err;
  }
}

// Envoltura de `withClient`: abre la transacción, toma el sello con
// FOR UPDATE y, si la marca del cliente venció, hace ROLLBACK y
// devuelve el centinela sin ejecutar `run` — la escritura jamás toca
// filas tras un reset que el cliente no conoce. `run` no debe abrir su
// propia transacción (para eso está lockResetMarker + StaleResetError).
export async function withResetGuard<T>(
  env: WorkerEnv,
  ack: number,
  userId: string,
  run: (client: pg.Client) => Promise<T>,
): Promise<T | ResetBlocked | undefined> {
  return withClient(env, async (client) => {
    await client.query("BEGIN");
    try {
      const marker = await lockResetMarker(client, userId);
      if (marker > ack) {
        await client.query("ROLLBACK").catch(() => undefined);
        return { blockedAt: marker } satisfies ResetBlocked;
      }
      const out = await run(client);
      await client.query("COMMIT");
      return out;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    }
  });
}

// Variante de lectura simple para endpoints cuya escritura no cabe en
// una transacción guardada (subidas a R2): abre una conexión solo para
// el sello. Devuelve el sello vencedor o 0 si la marca del cliente está
// al día. Es un pre-chequeo — la escritura de la fila en base debe ir
// además por `withResetGuard`/`lockResetMarker` para cerrar la carrera.
export async function staleResetAt(
  env: WorkerEnv,
  context: Context,
  userId: string,
): Promise<number> {
  const resetAt = await withClient(env, (client) =>
    readAccountResetAt(client, userId),
  );
  return resetAt && resetAt > readResetAck(context) ? resetAt : 0;
}
