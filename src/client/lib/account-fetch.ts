import { isDbScopeActive, StaleScopeError, type DbScope } from "./idb";
import { markSessionExpired } from "./sync-state";

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
  if (scope?.userId) headers.set("x-lecta-user-id", scope.userId);
  const response = await fetch(path, { ...init, headers });
  if (scope && !isDbScopeActive(scope)) throw new StaleScopeError();
  // 401 con cuenta en scope = la sesión murió en el servidor. Sin esta
  // marca el fallo entra como «reintentando» genérico y la persona cree
  // que sus datos viajan cuando ya no hay a quién enviarlos.
  if (response.status === 401 && scope?.userId) {
    markSessionExpired();
  }
  return response;
}
