// Acciones de cuidado del gato — acariciar, dar de comer y jugar —
// una a la vez. Cada acción enciende su pose durante unos segundos
// y, al terminar, deja constancia en el registro «lastCare»: el
// humor del gato la combina con caredAt para despertar
// (max(caredAt, lastCare.at)). El cuidado jamás toca XP, racha,
// logros, estadísticas ni hambre — es puro afecto, no puntos.

import { writeCompanionField } from "./game";
import { captureDbScope, type DbScope } from "./idb";
import {
  COMPANION_NAME_MAX,
  type CompanionCare,
} from "../../shared/companion-data";
import type { CatMood } from "../../shared/gamification";
import type { CompanionPose } from "../components/Companion";

export type CareKind = CompanionCare["kind"];

// Duración del gesto visible por acción. El fin lo marca este
// temporizador con cleanup — nunca un evento de animación.
export const CARE_DURATIONS: Record<CareKind, number> = {
  pet: 1800,
  feed: 2500,
  play: 3000,
};

// La pose de Companion que enciende cada acción mientras corre.
export const CARE_POSES: Record<CareKind, CompanionPose> = {
  pet: "pet",
  feed: "eat",
  play: "play",
};

// Texto del estado durante la acción — se anuncia en un role=status
// para que el gesto no dependa de ver la animación.
export const CARE_STATUS: Record<CareKind, (name: string) => string> = {
  pet: (name) => `${name} disfruta las caricias`,
  feed: () => "Está comiendo",
  play: () => "Persigue la pelota",
};

// Rechazado por cancel(): quien llama decide si lo muestra — el
// proveedor lo ignora, las pruebas lo distinguen de un error real.
export class CareCancelledError extends Error {
  constructor() {
    super("La acción de cuidado se canceló.");
    this.name = "CareCancelledError";
  }
}

export interface CareHandle {
  pose: CompanionPose;
  // Resuelve solo si la constancia «lastCare» quedó escrita; rechaza
  // con el error real de persistencia o con CareCancelledError.
  promise: Promise<void>;
  cancel(): void;
}

export interface CareOptions {
  scope?: DbScope;
  // El proveedor la calcula (prefers-reduced-motion o la preferencia
  // «motion: reduced» del dispositivo); con ella la pose no anima y
  // la persistencia es inmediata.
  reducedMotion?: boolean;
  // Inyectable en pruebas; por omisión Date.now.
  now?: () => number;
  // Inyectable en pruebas; por omisión writeCompanionField.
  persist?: (care: CompanionCare, scope: DbScope) => Promise<void>;
}

// Acción en curso — mientras exista, startCare rechaza las nuevas.
let active: symbol | null = null;

const persistCare = (care: CompanionCare, bound: DbScope) =>
  writeCompanionField("lastCare", care, bound);

// Inicia un cuidado. Devuelve null si ya hay otra acción en curso —
// las capas de UI también deshabilitan los botones mientras tanto.
// «at» se fija al inicio del gesto; la constancia se escribe al
// terminar, nunca antes ni aunque se cancele.
export function startCare(
  kind: CareKind,
  opts: CareOptions = {},
): CareHandle | null {
  if (active !== null) return null;
  const token = (active = Symbol("care"));
  const scope = opts.scope ?? captureDbScope();
  const persist = opts.persist ?? persistCare;
  const at = opts.now?.() ?? Date.now();

  let timer: ReturnType<typeof setTimeout> | undefined;
  let done = false;
  const release = () => {
    if (active === token) active = null;
  };

  let cancelFn: () => void = () => undefined;
  const promise = new Promise<void>((resolve, reject) => {
    const finish = () => {
      if (done) return;
      done = true;
      release();
      // El error real llega a quien llama: aquí no se finge éxito.
      void persist({ kind, at }, scope).then(resolve, reject);
    };
    cancelFn = () => {
      if (done) return;
      done = true;
      if (timer !== undefined) clearTimeout(timer);
      release();
      reject(new CareCancelledError());
    };
    if (opts.reducedMotion) finish();
    else timer = setTimeout(finish, CARE_DURATIONS[kind]);
  });
  // El handle se suele ignorar con void; evita el unhandled rejection
  // si nadie escucha la promesa — cancelar o un fallo de escritura no
  // deben ruido en consola cuando la UI ya la maneja.
  promise.catch(() => undefined);

  return {
    pose: CARE_POSES[kind],
    promise,
    cancel: () => cancelFn(),
  };
}

// Saludo contextual de la hoja: una línea que reacciona al tiempo
// real. El humor resume los días sin actividad (catMood) — un gato
// dormido «te extrañó» — y la hora del día matiza el saludo del gato
// despierto. Nunca regaña: la mascota se alegra de verte, punto.
export function companionGreeting(
  name: string,
  mood: CatMood,
  date: Date,
): string {
  if (mood === "asleep") {
    return `¡${name} te extrañó! Se despereza al verte.`;
  }
  if (mood === "sleepy") {
    return `${name} tenía sueño, pero te vio llegar.`;
  }
  const hour = date.getHours();
  if (hour < 6) return `${name} te acompaña de madrugada.`;
  if (hour < 12) return `${name} te da los buenos días.`;
  if (hour < 20) return `${name} te acompaña un rato.`;
  return `${name} te hace compañía de noche.`;
}

// Nombre del gato listo para persistir: 1–24 caracteres Unicode tras
// trim/NFC y sin caracteres de control — la misma regla que valida
// el lote del compañero (FIELD_CHECKS en shared/companion-data).
// Devuelve null si el borrador no sirve, para que la UI no escriba.
export function cleanCompanionName(raw: string): string | null {
  const trimmed = raw.normalize("NFC").trim();
  const len = [...trimmed].length;
  if (len < 1 || len > COMPANION_NAME_MAX || /\p{Cc}/u.test(trimmed)) {
    return null;
  }
  return trimmed;
}
