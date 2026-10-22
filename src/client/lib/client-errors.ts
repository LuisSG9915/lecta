// Reporte de errores del navegador al endpoint /api/client-errors.
//
// Reglas (Fase 5):
// - Solo metadatos por defecto: nombre, código, ruta y versión. El `message`
//   únicamente viaja si el usuario activa «incluir mensaje» en Diagnóstico.
// - Una huella (`name|code|route`) se envía **una vez por sesión** y como mucho
//   cinco reportes por carga: un bucle de errores no puede inundar los logs.
// - Si el envío falla, se ignora: reportar nunca puede romper la app.
import { loadFeatureFlags } from "./settings";

export const CLIENT_ERROR_ENDPOINT = "/api/client-errors";
export const CLIENT_ERROR_MAX_PER_LOAD = 5;
const MAX_NAME = 60;
const MAX_CODE = 60;
const MAX_MESSAGE = 200;

const sentFingerprints = new Set<string>();
let sentThisLoad = 0;

export interface ClientErrorInput {
  name?: string;
  code?: string;
  message?: string;
}

/** Solo para pruebas: deja el reporter como recién cargado. */
export function resetClientErrorReporter(): void {
  sentFingerprints.clear();
  sentThisLoad = 0;
}

function currentRoute(): string {
  if (typeof window === "undefined") return "/otra";
  return window.location.pathname || "/";
}

function clip(value: string, max: number): string {
  return value.trim().slice(0, max);
}

/**
 * Envía un error de cliente si los límites y los interruptores lo permiten.
 * Devuelve si se llegó a enviar (útil en pruebas).
 */
export function reportClientError(input: ClientErrorInput): boolean {
  const flags = loadFeatureFlags();
  if (!flags.shareClientErrors) return false;
  if (sentThisLoad >= CLIENT_ERROR_MAX_PER_LOAD) return false;

  const name = clip(input.name ?? "Error", MAX_NAME) || "Error";
  const code = clip(input.code ?? "", MAX_CODE);
  const route = currentRoute();
  const fingerprint = `${name}|${code}|${route}`;
  if (sentFingerprints.has(fingerprint)) return false;

  sentFingerprints.add(fingerprint);
  sentThisLoad += 1;

  const payload: Record<string, string> = {
    name,
    code,
    route,
    version: import.meta.env.PROD ? "prod" : "dev",
  };
  if (flags.includeErrorMessage && input.message) {
    payload.message = clip(input.message, MAX_MESSAGE);
  }

  try {
    void fetch(CLIENT_ERROR_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {
      // Sin red o 204 sin cuerpo: no hay nada que hacer.
    });
  } catch {
    // fetch puede lanzar de forma síncrona en entornos raros.
  }
  return true;
}

/** Extrae nombre/código/mensaje de un `unknown` y lo reporta. */
export function reportErrorObject(error: unknown, code?: string): boolean {
  if (error instanceof Error) {
    const errorCode =
      code ??
      (typeof (error as Error & { code?: unknown }).code === "string"
        ? (error as Error & { code: string }).code
        : undefined);
    return reportClientError({ name: error.name || "Error", code: errorCode, message: error.message });
  }
  return reportClientError({ name: "NonError", code, message: String(error) });
}

let installed = false;

/**
 * Engancha los errores globales del navegador. Idempotente: llamarlo dos veces
 * no duplica listeners.
 */
export function installClientErrorReporting(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (event) => {
    reportErrorObject(event.error ?? event.message, "window.error");
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportErrorObject(event.reason, "unhandledrejection");
  });
}
