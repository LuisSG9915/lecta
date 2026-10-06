import { loadSessionValue, saveSessionValue } from "./idb";
import type { DbScope } from "./idb";

// Preferencia «Usar IA» (session store de idb, por cuenta). Arranca
// encendida: la IA es hoy el valor central del producto y el aviso en
// Cuenta la hace visible con opción de apagarla (opt-out, no opt-in).
// Al apagarla no viaja nada al servidor de definiciones/ejercicios;
// el catálogo local (lookupWord) sigue disponible porque no usa IA.
export const USE_AI_KEY = "useAi";

// Ante un almacén que falla se asume encendida: la preferencia apagada
// nunca bloquea el arranque y el interruptor de Cuenta muestra lo real
// cuando el almacén vuelve.
export async function loadUseAi(scope?: DbScope): Promise<boolean> {
  try {
    return (await loadSessionValue(USE_AI_KEY, scope)) !== "0";
  } catch {
    return true;
  }
}

export async function saveUseAi(on: boolean, scope?: DbScope) {
  await saveSessionValue(USE_AI_KEY, on ? "1" : "0", scope);
}
