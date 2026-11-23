// Los ids del catálogo son INT8 de unique_rowid() (~1.2e18 > 2^53):
// por JSON viajan como string de dígitos, porque un number los
// truncaría (…305 → …300). Se acepta también un entero seguro y se
// canoniza («007» → «7»); Postgres castea el texto a int8/int4.
const INT8_MAX = 9223372036854775807n;
const INT4_MAX = 2147483647n;
// Entero positivo en [1, max]: string de dígitos o number. Un number
// por encima de 2^53 ya perdió dígitos al serializarse — aceptarlo
// ligaría la acepción equivocada, así que se rechaza.
const toBoundedDigits = (value: unknown, max: bigint): string | null => {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 1 && BigInt(value) <= max
      ? String(value)
      : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const id = BigInt(trimmed);
  return id >= 1n && id <= max ? id.toString() : null;
};
export const toCatalogId = (value: unknown): string | null => toBoundedDigits(value, INT8_MAX);
// sense_order es INT4 en el catálogo: su rango no es el de los ids.
export const toSenseOrder = (value: unknown): string | null => toBoundedDigits(value, INT4_MAX);
