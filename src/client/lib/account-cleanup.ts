// Clave del marcador local que recuerda que se pidió borrar la cuenta.
export const PENDING_DELETE_KEY = "lecta:pending-delete";

export type PendingDeleteDecision = {
  cleanupUserId?: string;
  clearMarker: boolean;
};

// Decide qué hacer con el marcador de borrado pendiente. La base local
// solo se limpia cuando el correo de confirmación redirigió aquí con
// «cuenta=eliminada»; cerrar sesión, que la sesión siga cargando o un
// enlace vencido no bastan para tocar los datos.
export function decidePendingDelete(input: {
  confirmed: boolean;
  urlError?: string;
  pendingUserId: string | null;
  sessionUserId?: string;
}): PendingDeleteDecision {
  if (!input.pendingUserId) return { clearMarker: false };
  if (input.confirmed && !input.sessionUserId) {
    return { cleanupUserId: input.pendingUserId, clearMarker: true };
  }
  if (input.urlError) return { clearMarker: true };
  return { clearMarker: false };
}
