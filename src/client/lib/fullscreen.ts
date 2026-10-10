/**
 * Utilidades para el modo de pantalla completa con soporte amplio
 * (estándar W3C y prefijos de navegadores para webkit/moz/ms).
 */

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  mozFullScreenElement?: Element | null;
  msFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  mozFullScreenEnabled?: boolean;
  msFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void>;
  mozCancelFullScreen?: () => Promise<void>;
  msExitFullscreen?: () => Promise<void>;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void>;
  mozRequestFullScreen?: () => Promise<void>;
  msRequestFullscreen?: () => Promise<void>;
};

/**
 * Comprueba si la aplicación se encuentra actualmente en pantalla completa.
 */
export function isFullscreen(): boolean {
  if (typeof document === "undefined") return false;
  const doc = document as FullscreenDocument;
  return Boolean(
    doc.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.mozFullScreenElement ||
      doc.msFullscreenElement,
  );
}

/**
 * Comprueba si el navegador actual soporta la API de pantalla completa.
 */
export function isFullscreenSupported(): boolean {
  if (typeof document === "undefined") return false;
  const doc = document as FullscreenDocument;
  const el = (doc.documentElement ?? {}) as FullscreenElement;

  return Boolean(
    doc.fullscreenEnabled ||
      doc.webkitFullscreenEnabled ||
      doc.mozFullScreenEnabled ||
      doc.msFullscreenEnabled ||
      typeof el.requestFullscreen === "function" ||
      typeof el.webkitRequestFullscreen === "function" ||
      typeof el.mozRequestFullScreen === "function" ||
      typeof el.msRequestFullscreen === "function",
  );
}

/**
 * Alterna o establece el modo de pantalla completa.
 * Si targetState es undefined, invierte el estado actual.
 */
export async function toggleFullscreen(targetState?: boolean): Promise<boolean> {
  if (typeof document === "undefined") return false;
  const current = isFullscreen();
  const enter = targetState !== undefined ? targetState : !current;

  if (enter === current) return current;

  try {
    if (enter) {
      const el = (document.documentElement ?? {}) as FullscreenElement;
      if (typeof el.requestFullscreen === "function") {
        await el.requestFullscreen();
      } else if (typeof el.webkitRequestFullscreen === "function") {
        await el.webkitRequestFullscreen();
      } else if (typeof el.mozRequestFullScreen === "function") {
        await el.mozRequestFullScreen();
      } else if (typeof el.msRequestFullscreen === "function") {
        await el.msRequestFullscreen();
      }
      return true;
    } else {
      const doc = document as FullscreenDocument;
      if (typeof doc.exitFullscreen === "function") {
        await doc.exitFullscreen();
      } else if (typeof doc.webkitExitFullscreen === "function") {
        await doc.webkitExitFullscreen();
      } else if (typeof doc.mozCancelFullScreen === "function") {
        await doc.mozCancelFullScreen();
      } else if (typeof doc.msExitFullscreen === "function") {
        await doc.msExitFullscreen();
      }
      return false;
    }
  } catch {
    // Si el usuario o el navegador bloquea la llamada (o no hay gesto de usuario), no fallar
  }
  return isFullscreen();
}

/**
 * Escucha cambios en el estado de pantalla completa (estándar y prefijos).
 * Devuelve una función para desuscribirse.
 */
export function subscribeFullscreenChange(callback: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  const events = [
    "fullscreenchange",
    "webkitfullscreenchange",
    "mozfullscreenchange",
    "MSFullscreenChange",
  ];
  for (const ev of events) {
    document.addEventListener(ev, callback);
  }
  return () => {
    for (const ev of events) {
      document.removeEventListener(ev, callback);
    }
  };
}
