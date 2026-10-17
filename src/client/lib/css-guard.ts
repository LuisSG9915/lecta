// Guardia de integridad de assets y hojas de estilo (CSS Guard).
// Protege a la aplicación de estados degradados (FOUC / HTML sin estilos) causados
// por fallos de red en despliegues, preloadError de Vite o respuestas corruptas del SW.

export interface AssetRecoveryOptions {
  storage?: Storage;
  onReload?: () => void;
  debounceMs?: number;
}

const RECOVERY_DEBOUNCE_MS = 15_000;
const RECOVERY_STORAGE_KEY = "lecta_css_recovery_ts";

export async function triggerSafeAssetRecovery(options: AssetRecoveryOptions = {}): Promise<boolean> {
  if (typeof window === "undefined") return false;

  const storage = options.storage ?? window.sessionStorage;
  const debounceMs = options.debounceMs ?? RECOVERY_DEBOUNCE_MS;
  const reload = options.onReload ?? (() => window.location.reload());

  // 1. Prevención estricta contra bucles infinitos de recarga
  try {
    const lastRecovery = Number(storage?.getItem(RECOVERY_STORAGE_KEY) || 0);
    const now = Date.now();
    if (now - lastRecovery < debounceMs) {
      return false;
    }
    storage?.setItem(RECOVERY_STORAGE_KEY, String(now));
  } catch {
    // Si sessionStorage no está accesible, continuar con precaución
  }

  // 2. Limpieza exhaustiva de cachés locales del Service Worker
  try {
    if (typeof window.caches !== "undefined") {
      const keys = await window.caches.keys();
      await Promise.all(keys.map((key) => window.caches.delete(key)));
    }
  } catch {
    // ignore
  }

  // 3. Desregistro de service workers activos para forzar descarga limpia
  try {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((reg) => reg.unregister()));
    }
  } catch {
    // ignore
  }

  // 4. Recarga de la página con bust de caché
  reload();
  return true;
}

export function initCssGuard(options: AssetRecoveryOptions = {}): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }

  // Guardia 1: Errores de precarga de Vite (hashes dinámicos desactualizados)
  const onPreloadError = (event: Event) => {
    event.preventDefault();
    void triggerSafeAssetRecovery(options);
  };
  window.addEventListener("vite:preloadError", onPreloadError);

  // Guardia 2a: Evento error directo en etiquetas <link rel="stylesheet">
  const onLinkError = () => {
    void triggerSafeAssetRecovery(options);
  };

  const observeLinks = () => {
    const links = document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]');
    links.forEach((link) => {
      link.addEventListener("error", onLinkError, { once: true });
    });
  };

  observeLinks();

  // Guardia 2b: Verificación post-carga / post-hidratación
  // Si existe al menos un link a CSS de assets pero no hay hojas de estilo parseadas
  const checkStyleSheets = () => {
    const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'));
    const assetCssLinks = links.filter((link) => link.href && link.href.includes("/assets/"));

    // Si hay links a CSS de assets pero document.styleSheets está vacío, la carga falló
    if (assetCssLinks.length > 0 && document.styleSheets.length === 0) {
      void triggerSafeAssetRecovery(options);
    }
  };

  if (document.readyState === "complete") {
    setTimeout(checkStyleSheets, 200);
  } else {
    window.addEventListener(
      "load",
      () => {
        setTimeout(checkStyleSheets, 200);
      },
      { once: true },
    );
  }

  return () => {
    window.removeEventListener("vite:preloadError", onPreloadError);
    const links = document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]');
    links.forEach((link) => {
      link.removeEventListener("error", onLinkError);
    });
  };
}
