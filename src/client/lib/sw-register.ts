import { scheduleHabitReminder } from "./localNotificationScheduler";
// Registro y ciclo de vida del Service Worker de Lecta.
// Garantiza actualización instantánea en móviles mediante updateViaCache: 'none',
// comprobaciones en visibilitychange/online, autocuración ante ASSET_MISMATCH_RELOAD
// y auto-recarga limpia sin bucles al cambiar de controlador.

export interface SwRegisterOptions {
  scriptUrl?: string;
  onReload?: () => void;
  storage?: Storage;
}

const RELOAD_DEBOUNCE_MS = 15_000;
const CONTROLLER_RELOAD_KEY = "lecta_sw_controller_ts";
const MISMATCH_RELOAD_KEY = "lecta_sw_mismatch_ts";
const NAV_STALE_RELOAD_KEY = "lecta_sw_navstale_ts";
// Un aviso LECTA_NAV_STALE solo puede llegar justo tras una navegación en
// que la red fue lenta: pasado este tiempo la página ya está asentada y
// recargar interrumpiría una lectura — la copia fresca ya quedó en caché
// para la próxima apertura.
const NAV_STALE_WINDOW_MS = 45_000;

/**
 * Lista blanca de nombres de cachés de datos descargables (DLC)
 * que deben ser preservados permanentemente durante la purga de cachés del SW.
 */
export const PERSISTENT_DLC_CACHE_NAMES = [
  "lecta-kitten-tts-v2",
  "lecta-offline-dict-v1",
] as const;

export type PersistentDlcCacheName = (typeof PERSISTENT_DLC_CACHE_NAMES)[number];

export function isPersistentDlcCache(cacheName: string): boolean {
  return (PERSISTENT_DLC_CACHE_NAMES as readonly string[]).includes(cacheName);
}

// En dev no se registra el SW, pero uno viejo del mismo origen (un
// `vite preview` de producción, por ejemplo) sigue controlando la
// página y sirve assets de producción que ya no existen en dev: la
// app queda cargando para siempre. Se desregistra y se purgan sus
// cachés — menos las DLC (modelo TTS, diccionarios), que son pesadas
// de volver a bajar y no estorban en dev.
export async function clearForeignServiceWorker(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  } catch {
    /* sin soporte o denegado: no es bloqueante */
  }
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith("lecta") && !isPersistentDlcCache(k))
        .map((k) => caches.delete(k)),
    );
  } catch {
    /* CacheStorage puede no existir */
  }
}

export function shouldAllowReload(key: string, storage?: Storage): boolean {
  try {
    const s = storage ?? (typeof window !== "undefined" ? window.sessionStorage : undefined);
    if (!s) return true;
    const last = Number(s.getItem(key) || 0);
    const now = Date.now();
    if (now - last < RELOAD_DEBOUNCE_MS) {
      return false;
    }
    s.setItem(key, String(now));
    return true;
  } catch {
    return true;
  }
}

export async function registerServiceWorker(
  options: SwRegisterOptions = {},
): Promise<ServiceWorkerRegistration | undefined> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return undefined;
  }

  const scriptUrl = options.scriptUrl ?? "/sw.js";
  const reload = options.onReload ?? (() => window.location.reload());
  const storage = options.storage;

  // 1. Escuchar controllerchange para recargar cuando el nuevo SW tome el control.
  // Solo si la página YA estaba controlada: en la primera visita el
  // service worker se instala y llama a clients.claim(), la página es la
  // misma que el SW acaba de precachear y recargarla no actualiza nada —
  // en cambio sí borra lo que se estuviera haciendo (una importación a
  // medias, la primera sección del libro, la posición recién restaurada).
  const hadController = Boolean(navigator.serviceWorker.controller);
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    if (!hadController) return;
    if (!shouldAllowReload(CONTROLLER_RELOAD_KEY, storage)) return;
    refreshing = true;
    reload();
  });

  // 2. Escuchar mensajes del SW:
  // - ASSET_MISMATCH_RELOAD: desajuste de hashes en deploy.
  // - LECTA_NAV_STALE: la navegación sirvió el HTML guardado por red lenta
  //   y la copia fresca llegó después. Recargar solo en los primeros
  //   segundos de la sesión (la copia nueva ya está en caché, así que la
  //   recarga sale instantánea y con la versión correcta).
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "ASSET_MISMATCH_RELOAD") {
      if (!shouldAllowReload(MISMATCH_RELOAD_KEY, storage)) return;
      reload();
      return;
    }
    if (event.data?.type === "LECTA_NAV_STALE") {
      if (
        typeof performance !== "undefined" &&
        performance.now() > NAV_STALE_WINDOW_MS
      ) {
        return;
      }
      if (!shouldAllowReload(NAV_STALE_RELOAD_KEY, storage)) return;
      reload();
    }
  });

  try {
    // 3. Registrar el Service Worker forzando que el navegador siempre verifique el script contra la red
    const registration = await navigator.serviceWorker.register(scriptUrl, {
      updateViaCache: "none",
    });

    const triggerUpdate = () => {
      registration.update().catch(() => {});
    };

    // 4. Chequeo de actualizaciones en tres momentos clave:
    // a) Inmediatamente tras registrar
    triggerUpdate();

    // b) Cada vez que el usuario vuelva a la pestaña en el móvil
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          triggerUpdate();
        }
      });
    }

    // d) Scheduler local de ventana de hábito en visibilidad / pagehide (Fase 4)
    if (typeof window !== "undefined") {
      const handleAppLeave = () => {
        try {
          const raw = localStorage.getItem("lecta_active_book_context");
          if (raw) {
            const activeBook = JSON.parse(raw);
            void scheduleHabitReminder(activeBook);
          }
        } catch {
          // Ignore
        }
      };

      window.addEventListener("pagehide", handleAppLeave, { passive: true });
      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "hidden") {
            handleAppLeave();
          }
        }, { passive: true });
      }
    }

    // c) Cuando el navegador recupere la conexión
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => {
        triggerUpdate();
      });
    }

    // 5. Si ya existe un worker en espera (waiting), activarlo de inmediato
    if (registration.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    }

    // Si entra un nuevo worker instalándose, esperar a que termine de instalarse
    // y si ya hay un controlador activo gobernando la página, pedirle skipWaiting
    registration.addEventListener("updatefound", () => {
      const installingWorker = registration.installing;
      if (!installingWorker) return;

      installingWorker.addEventListener("statechange", () => {
        if (installingWorker.state === "installed" && navigator.serviceWorker.controller) {
          installingWorker.postMessage({ type: "SKIP_WAITING" });
        }
      });
    });

    return registration;
  } catch {
    return undefined;
  }
}
