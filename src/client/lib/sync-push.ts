// Contrato de los envíos incrementales al servidor.
//
// Un push puede confirmar solo una parte de lo enviado (p. ej. el primer lote
// de tres). Devolver `acceptedMax` — el sello máximo de lo que el servidor
// confirmó — permite avanzar el cursor de push hasta ahí y no más: lo que no
// se confirmó se reenviará en el siguiente ciclo en vez de perderse.

export interface PushResult {
  /** `true` si el servidor confirmó todo lo enviado (o no había nada que enviar). */
  ok: boolean;
  /** Sello máximo de lo confirmado; 0 si no se confirmó nada. */
  acceptedMax: number;
}

export const EMPTY_PUSH: PushResult = { ok: true, acceptedMax: 0 };

/** Sello máximo de una lista; 0 si está vacía. */
export function maxStamp<T>(items: readonly T[], stamp: (item: T) => number): number {
  let max = 0;
  for (const item of items) {
    const value = stamp(item);
    if (Number.isFinite(value) && value > max) max = value;
  }
  return max;
}
