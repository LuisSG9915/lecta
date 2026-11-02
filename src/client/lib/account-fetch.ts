import { isDbScopeActive, StaleScopeError, type DbScope } from "./idb";
import { markSessionExpired } from "./sync-state";
import { readLocalResetMarker } from "./account-cleanup";

// Qué hacer cuando el servidor contesta 409 `account_reset`: la marca
// local quedó vieja y hay que vaciar la copia de la cuenta. Se registra
// desde account-reset.ts (mismo patrón que registerSyncRetryRunner):
// importarlo directo crearía un ciclo account-fetch ↔ account-reset.
type AccountResetHandler = (userId: string, resetAt: number) => Promise<boolean>;
let accountResetHandler: AccountResetHandler | null = null;

export function registerAccountResetHandler(handler: AccountResetHandler): void {
  accountResetHandler = handler;
}

// fetch ligado a una cuenta. Declara la identidad esperada con la
// cabecera `x-lecta-user-id` (el servidor la contrasta con la sesión
// auténtica y rechaza si ya es otra — a un fetch viejo no le sirve
// la cookie nueva) y aborta con StaleScopeError si el contexto venció
// antes o después de la red. Una respuesta tardía jamás se aplica a la
// cuenta recién activada.
export async function accountFetch(
  path: string,
  init?: RequestInit,
  scope?: DbScope,
): Promise<Response> {
  if (scope && !isDbScopeActive(scope)) throw new StaleScopeError();
  const headers = new Headers(init?.headers);
  if (scope?.userId) {
    headers.set("x-lecta-user-id", scope.userId);
    // El sello del último reinicio que este dispositivo conoce: el
    // servidor rechaza con 409 las escrituras de una copia más vieja —
    // así una cuenta reiniciada en otro dispositivo no resucita desde
    // datos locales obsoletos.
    headers.set("x-lecta-reset", String(readLocalResetMarker(scope.userId)));
  }
  const response = await fetch(path, { ...init, headers });
  if (scope && !isDbScopeActive(scope)) throw new StaleScopeError();
  // 401 con cuenta en scope = la sesión murió en el servidor. Sin esta
  // marca el fallo entra como «reintentando» genérico y la persona cree
  // que sus datos viajan cuando ya no hay a quién enviarlos.
  if (response.status === 401 && scope?.userId) {
    markSessionExpired();
  }
  // 409 account_reset = la cuenta se reinició en otro lado. El cuerpo se
  // lee en un clon (el llamador también puede leerlo) y el vaciado corre
  // detrás: esta petición falla igual, pero el siguiente ciclo ya nace
  // con la cuenta limpia.
  if (response.status === 409 && scope?.userId && accountResetHandler) {
    const data = (await response.clone().json().catch(() => null)) as {
      error?: string;
      resetAt?: unknown;
    } | null;
    const resetAt = Number(data?.resetAt);
    if (data?.error === "account_reset" && Number.isFinite(resetAt) && resetAt > 0) {
      void accountResetHandler(scope.userId, resetAt);
    }
  }
  return response;
}
