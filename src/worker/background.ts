import type { Context } from "hono";

/** Corre `work` en waitUntil si hay ExecutionContext; si no, suelto. */
export function runInBackground(context: Context, work: Promise<unknown>): void {
  try {
    const executionCtx = context.executionCtx;
    if (executionCtx && typeof executionCtx.waitUntil === "function") {
      executionCtx.waitUntil(work);
      return;
    }
  } catch {
    /* pruebas sin ExecutionContext */
  }
  void work;
}
