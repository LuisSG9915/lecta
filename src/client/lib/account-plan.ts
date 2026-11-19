// Plan de la cuenta en el cliente (docs/designs/2026-11-12-planes-y-landing.md).
// Un único store de módulo: `useUserPlan()` en cualquier componente lee lo
// mismo, y solo App escribe (tras checkRemoteReset, en runFullSync y en el
// sondeo de ?carne=1). `null` = desconocido: sin notas ni llamadas premium.
import { useSyncExternalStore } from "react";
import { isStarterCoat, normalizePlan, type UserPlan } from "../../shared/plan";
import type { CompanionCoatId } from "../../shared/companion-data";
import { accountFetch } from "./account-fetch";
import { getActiveUserId, loadSessionValue, saveSessionValue, type DbScope } from "./idb";

export type PlanSnapshot = {
  plan: UserPlan;
  starterCoat: CompanionCoatId | null;
  expiresAt: number | null;
  /** Usos de IA de cortesía que le quedan este mes a una cuenta gratis. */
  freeAiRemaining?: number;
  /** La cuenta aún puede estrenar la prueba de 7 días de Lecta+. */
  trialEligible?: boolean;
};

const planKey = (userId: string) => `account:plan:v1:${userId}`;
const LANDING_COAT_KEY = "lecta:gato";
/** Fuente de la visita a la landing (?src=), para contar la conversión. */
const LANDING_SOURCE_KEY = "lecta:src";

let current: { userId: string; snapshot: PlanSnapshot } | null = null;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

export const planStore = {
  /** Plan de la cuenta activa, o null si es otra cuenta o aún no se sabe. */
  get(): PlanSnapshot | null {
    const active = getActiveUserId();
    return current && active && current.userId === active ? current.snapshot : null;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  set(userId: string, snapshot: PlanSnapshot | null): void {
    current = snapshot ? { userId, snapshot } : null;
    notify();
  },
};

export function useUserPlan(): PlanSnapshot | null {
  return useSyncExternalStore(planStore.subscribe, planStore.get, () => null);
}

/**
 * Convierte el cuerpo de GET /api/account/state en un snapshot. Sin `plan`
 * (el servidor lo omite ante un error) devuelve null: se conserva la caché.
 */
export function planFromAccountState(body: unknown): PlanSnapshot | null {
  if (!body || typeof body !== "object") return null;
  const data = body as {
    plan?: unknown;
    starterCoat?: unknown;
    planExpiresAt?: unknown;
    freeAiRemaining?: unknown;
    trialEligible?: unknown;
  };
  if (typeof data.plan !== "string") return null;
  const expires = Number(data.planExpiresAt);
  return {
    plan: normalizePlan(data.plan),
    starterCoat: isStarterCoat(data.starterCoat) ? data.starterCoat : null,
    expiresAt: data.planExpiresAt == null || !Number.isFinite(expires) ? null : expires,
    ...(typeof data.freeAiRemaining === "number" && Number.isFinite(data.freeAiRemaining)
      ? { freeAiRemaining: Math.max(0, Math.floor(data.freeAiRemaining)) }
      : {}),
    ...(typeof data.trialEligible === "boolean" ? { trialEligible: data.trialEligible } : {}),
  };
}

/** Lee la caché local del plan y la publica si el store aún no sabe nada. */
export async function loadPlan(userId: string, scope?: DbScope): Promise<void> {
  try {
    const raw = await loadSessionValue(planKey(userId), scope);
    if (typeof raw !== "string") return;
    const cached = planFromAccountState(JSON.parse(raw));
    if (cached && !(current && current.userId === userId)) planStore.set(userId, cached);
  } catch {
    /* caché ilegible: se espera a la red */
  }
}

/** Publica y persiste el plan de un cuerpo de /api/account/state. */
export async function savePlan(userId: string, body: unknown, scope?: DbScope): Promise<void> {
  const snapshot = planFromAccountState(body);
  if (!snapshot) return;
  planStore.set(userId, snapshot);
  try {
    await saveSessionValue(
      planKey(userId),
      JSON.stringify({
        plan: snapshot.plan,
        starterCoat: snapshot.starterCoat,
        planExpiresAt: snapshot.expiresAt,
        freeAiRemaining: snapshot.freeAiRemaining,
        trialEligible: snapshot.trialEligible,
      }),
      scope,
    );
  } catch {
    /* sin almacenamiento: el plan vale para esta sesión */
  }
}

/** Pide /api/account/state y publica el plan. Devuelve el snapshot o null. */
export async function refreshPlan(userId: string, scope?: DbScope): Promise<PlanSnapshot | null> {
  try {
    const response = await accountFetch("/api/account/state", undefined, scope);
    if (!response.ok) return null;
    const body = await response.json().catch(() => null);
    await savePlan(userId, body, scope);
    return planFromAccountState(body);
  } catch {
    return null;
  }
}

/**
 * Tras volver de Stripe Checkout el webhook puede llegar después: consulta
 * cada `intervalMs` hasta ver Lecta+ o agotar `timeoutMs`.
 */
export async function pollPlanUntilPlus(
  userId: string,
  scope: DbScope | undefined,
  opts: { intervalMs?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<boolean> {
  const interval = opts.intervalMs ?? 2000;
  const timeout = opts.timeoutMs ?? 20000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let waited = 0; waited <= timeout; waited += interval) {
    const snapshot = await refreshPlan(userId, scope);
    if (snapshot?.plan === "lecta_plus" || snapshot?.plan === "founder_lifetime") return true;
    if (waited + interval > timeout) break;
    await sleep(interval);
  }
  return false;
}

// ---- Pelaje inicial elegido en el landing ----

/** Guarda el pelaje que llegó por ?gato= (antes de limpiar la URL). */
export function rememberStarterCoat(value: unknown): void {
  if (!isStarterCoat(value)) return;
  try {
    localStorage.setItem(LANDING_COAT_KEY, value);
  } catch {
    /* sin almacenamiento */
  }
}

/** Guarda la fuente que llegó por ?src= (el worker la normaliza). */
export function rememberLandingSource(value: string | null): void {
  if (!value) return;
  try {
    localStorage.setItem(LANDING_SOURCE_KEY, value.slice(0, 64));
  } catch {
    /* sin almacenamiento */
  }
}

function pendingLandingSource(): string | null {
  try {
    return localStorage.getItem(LANDING_SOURCE_KEY);
  } catch {
    return null;
  }
}

/** Pelaje pendiente de reclamar (solo si es válido). */
export function pendingStarterCoat(): CompanionCoatId | null {
  try {
    const value = localStorage.getItem(LANDING_COAT_KEY);
    return isStarterCoat(value) ? value : null;
  } catch {
    return null;
  }
}

let claimInflight: Promise<CompanionCoatId | null> | null = null;

/**
 * Reclama el pelaje inicial una sola vez: PUT /api/account/starter-coat con
 * el pendiente (o `coat` si se elige en el onboarding). Al confirmarse
 * borra `lecta:gato` y publica el pelaje en el plan.
 */
export function claimStarterCoat(
  userId: string,
  scope: DbScope | undefined,
  coat: CompanionCoatId | null = pendingStarterCoat(),
): Promise<CompanionCoatId | null> {
  if (!coat) return Promise.resolve(null);
  if (claimInflight) return claimInflight;
  claimInflight = (async () => {
    try {
      const src = pendingLandingSource();
      const response = await accountFetch(
        "/api/account/starter-coat",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          // `src` solo si la cuenta llegó desde la landing: el worker cuenta
          // `signup` la primera vez que se escribe el pelaje.
          body: JSON.stringify({ coat, ...(src ? { src } : {}) }),
        },
        scope,
      );
      if (!response.ok) return null;
      const body = (await response.json().catch(() => null)) as { starterCoat?: unknown } | null;
      const saved = isStarterCoat(body?.starterCoat) ? body.starterCoat : null;
      if (!saved) return null;
      try {
        localStorage.removeItem(LANDING_COAT_KEY);
        localStorage.removeItem(LANDING_SOURCE_KEY);
      } catch {
        /* sin almacenamiento */
      }
      const prev = current && current.userId === userId ? current.snapshot : null;
      if (prev) planStore.set(userId, { ...prev, starterCoat: saved });
      return saved;
    } catch {
      return null;
    } finally {
      claimInflight = null;
    }
  })();
  return claimInflight;
}

/**
 * Ajusta el contador de cortesía sin esperar a la red: `n` fijo (402 → 0) o
 * `null` para descontar uno tras una respuesta de IA correcta.
 */
export function setFreeAiRemaining(n: number | null): void {
  if (!current) return;
  const snap = current.snapshot;
  if (snap.freeAiRemaining === undefined) return;
  const next = n === null ? Math.max(0, snap.freeAiRemaining - 1) : Math.max(0, n);
  if (next === snap.freeAiRemaining) return;
  planStore.set(current.userId, { ...snap, freeAiRemaining: next });
}

/** Solo para pruebas. */
export function resetPlanStoreForTests(): void {
  current = null;
  claimInflight = null;
  listeners.clear();
}
