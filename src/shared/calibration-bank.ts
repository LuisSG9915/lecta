// Banco editorial del examen inicial. La muestra deja de ser un
// random sobre todo el catálogo (que escogía fichas sin definición o
// irrelevantes como «step» o «jalifa») y pasa a salir de esta lista
// revisada: lemas comunes del español general, con acepción cargada
// y dentro de su banda zipf. El worker verifica la banda contra la
// medición real — un lema fuera de su banda simplemente no entra.
//
// Seis bandas de 0.5 entre 2.0 y 5.0, el mismo rango que usaba el
// muestreo anterior: lo raro primero (2.0), lo cotidiano al final
// (5.0). Doce lemas por banda dan suficiente rotación para que dos
// muestras no repitan siempre lo mismo.
//
// Versión: se guarda con el borrador del examen; al cambiar la lista
// se sube la versión para no restaurar respuestas contra otra muestra.
export const CALIBRATION_BANK_VERSION = "es-bank-v1";

// Bandas del examen: [desde, hasta) en zipf. La última queda
// abierta en 5.0 — más frecuente sería trivial para casi cualquier
// lector y no aporta señal.
export const CALIBRATION_BANDS: readonly (readonly [number, number])[] = [
  [2.0, 2.5],
  [2.5, 3.0],
  [3.0, 3.5],
  [3.5, 4.0],
  [4.0, 4.5],
  [4.5, 5.0],
];

// Cuántas palabras por banda salen en la muestra (6 × 3 = 18, en
// tres pasos de seis).
export const CALIBRATION_PER_BAND = 3;

export const CALIBRATION_BANK: readonly (readonly string[])[] = [
  // [2.0, 2.5) — raras pero reconocibles para un lector general.
  [
    "subyugar",
    "zancada",
    "hibernar",
    "injertar",
    "tartán",
    "bajamar",
    "escenificar",
    "trivialidad",
    "cimitarra",
    "amargor",
    "purpúreo",
    "picacho",
  ],
  // [2.5, 3.0)
  [
    "berrinche",
    "pescuezo",
    "candelero",
    "serrucho",
    "torniquete",
    "zarpar",
    "gruñón",
    "desprender",
    "inacabado",
    "parco",
    "inmemorial",
    "batacazo",
  ],
  // [3.0, 3.5)
  [
    "esquivar",
    "aislar",
    "sujetar",
    "moler",
    "desmayo",
    "yugo",
    "simular",
    "tarro",
    "sardina",
    "castaña",
    "saborear",
    "orfanato",
  ],
  // [3.5, 4.0)
  [
    "panza",
    "asombro",
    "ubicar",
    "alejar",
    "cohete",
    "diente",
    "máscara",
    "dilema",
    "percibir",
    "pretender",
    "mudo",
    "desigual",
  ],
  // [4.0, 4.5) — cotidianas para casi cualquier lector.
  [
    "temor",
    "eficaz",
    "urgente",
    "orgulloso",
    "ciego",
    "patio",
    "quitar",
    "funcionar",
    "bloquear",
    "sombrero",
    "defecto",
    "patente",
  ],
  // [4.5, 5.0) — las más frecuentes de la muestra.
  [
    "lluvia",
    "viento",
    "paciente",
    "profundo",
    "hermoso",
    "barrio",
    "cuarto",
    "escuchar",
    "llorar",
    "triste",
    "destino",
    "propósito",
  ],
];

// Índice de banda para una medición zipf; -1 fuera del rango.
export function calibrationBandIndex(zipf: number): number {
  return CALIBRATION_BANDS.findIndex(([lo, hi]) => zipf >= lo && zipf < hi);
}

// Lista plana de lemas del banco (para el WHERE del catálogo).
export function calibrationBankLemmas(): string[] {
  return CALIBRATION_BANK.flat();
}
