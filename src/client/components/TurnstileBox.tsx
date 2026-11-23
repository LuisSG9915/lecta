// Widget de Cloudflare Turnstile para el registro y el enlace por correo
// (el servidor exige el token en esos dos endpoints: src/worker/auth.ts).
// El script se carga solo al montar el widget, nunca en el arranque.
import { useEffect, useRef } from "react";

type TurnstileApi = {
  render(
    el: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
      appearance?: "always" | "execute" | "interaction-only";
      language?: string;
    },
  ): string;
  remove(id: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
// Clave de prueba de Cloudflare que siempre pasa: en local el servidor no
// tiene secret y no exige nada, pero así el formulario se comporta igual.
const TEST_SITE_KEY = "1x00000000000000000000AA";
const SITE_KEYS: Record<string, string> = {
  "lectal.app": "0x4AAAAAAGOToz5mtXBEj3Wn",
  localhost: TEST_SITE_KEY,
  "127.0.0.1": TEST_SITE_KEY,
};

/** Sitekey del host actual, o null donde el widget no aplica. */
export function turnstileSiteKey(hostname = globalThis.location?.hostname ?? ""): string | null {
  return SITE_KEYS[hostname] ?? null;
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile"));
    script.onerror = () => {
      scriptPromise = null;
      script.remove();
      reject(new Error("turnstile"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/**
 * Pinta el widget y entrega el token. Cada token sirve una sola vez: quien
 * lo usa cambia `resetKey` y el widget se vuelve a pintar con uno nuevo.
 */
export default function TurnstileBox({
  siteKey,
  resetKey,
  onToken,
}: {
  siteKey: string;
  resetKey: number;
  onToken: (token: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  });

  useEffect(() => {
    let widgetId: string | null = null;
    let cancelled = false;
    onTokenRef.current("");
    loadTurnstile()
      .then((api) => {
        if (cancelled || !ref.current) return;
        widgetId = api.render(ref.current, {
          sitekey: siteKey,
          appearance: "interaction-only",
          language: "es",
          callback: (token) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(""),
          "error-callback": () => onTokenRef.current(""),
        });
      })
      .catch(() => {
        // Sin script (red, bloqueador): el servidor responderá que falta la
        // verificación y el formulario lo dice.
      });
    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey, resetKey]);

  return <div ref={ref} className="auth-turnstile" />;
}
